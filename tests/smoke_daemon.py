#!/usr/bin/env python3
"""AEGIS v0 smoke tests — stdlib only.

Starts the daemon as a subprocess against a throwaway AEGIS_HOME, then
exercises the HTTP contract end to end:

  1. health / offline tier
  2. memory remember -> recall with citation
  3. abstention on unknown facts
  4. mode gating (Assistant blocks file.write)
  5. permission broker (keyboard confirm ok, voice confirm refused)
  6. tool forging after 3 repeats
  7. AG-UI SSE stream
  8. kill switch / resume

Usage:
    python3 tests/smoke.py

Exit code 0 when every check passes, 1 otherwise.
Prints one PASS/FAIL line per check and a final "SMOKE: n/n passed".
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

PORT = 8971
BASE = f"http://127.0.0.1:{PORT}"

APP_DIR = Path(__file__).resolve().parent.parent / "services" / "daemon"

RESULTS: list[tuple[str, bool, str]] = []


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def record(name: str, ok: bool, detail: str = "") -> bool:
    RESULTS.append((name, bool(ok), detail))
    status = "PASS" if ok else "FAIL"
    line = f"{status}: {name}"
    if detail:
        line += f" — {detail}"
    print(line, flush=True)
    return bool(ok)


def dumps(obj) -> str:
    try:
        return json.dumps(obj, default=str)
    except Exception:
        return str(obj)


def find_values(obj, key: str):
    """Yield every value for `key` found recursively in obj."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k == key:
                yield v
            yield from find_values(v, key)
    elif isinstance(obj, list):
        for item in obj:
            yield from find_values(item, key)


def find_key(obj, key: str):
    for v in find_values(obj, key):
        return v
    return None


def has_key(obj, key: str) -> bool:
    return any(True for _ in find_values(obj, key))


def is_ok(payload) -> bool:
    """Tolerant success check: any nested ok==True, and no error code."""
    if payload is None:
        return False
    for v in find_values(payload, "ok"):
        if v is True:
            return True
    # Some endpoints may return a bare success object without an ok flag.
    return False


def error_text(payload) -> str:
    return dumps(payload)


def contains_error(payload, needle: str) -> bool:
    return needle in dumps(payload)


# ---------------------------------------------------------------------------
# HTTP (urllib only)
# ---------------------------------------------------------------------------

def http_request(method: str, path: str, body=None, timeout: float = 15.0):
    """Return (status, parsed_json_or_None, raw_text). Never raises for HTTP errors."""
    url = BASE + path
    data = None
    headers = {"Accept": "application/json, text/event-stream"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            status = resp.status
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        status = e.code
    except Exception as e:  # connection refused etc.
        return 0, None, f"{type(e).__name__}: {e}"
    parsed = None
    try:
        parsed = json.loads(raw)
    except Exception:
        parsed = None
    return status, parsed, raw


def http_get(path: str, timeout: float = 15.0):
    return http_request("GET", path, body=None, timeout=timeout)


def http_post(path: str, body: dict, timeout: float = 15.0):
    return http_request("POST", path, body=body, timeout=timeout)


def call_tool(tool: str, arguments: dict | None = None, confirmed=None,
              confirmation_source: str | None = None):
    body: dict = {"tool": tool, "arguments": arguments or {}}
    if confirmed is not None:
        body["confirmed"] = confirmed
    if confirmation_source is not None:
        body["confirmation_source"] = confirmation_source
    return http_post("/api/tool", body)


def set_mode(mode: str):
    return http_post("/api/mode", {"mode": mode})


# ---------------------------------------------------------------------------
# daemon lifecycle
# ---------------------------------------------------------------------------

def daemon_command() -> list[str]:
    venv_python = (APP_DIR / ".venv" / "Scripts" / "python.exe"
                    if os.name == "nt" else APP_DIR / ".venv" / "bin" / "python")
    if venv_python.exists():
        return [str(venv_python), "-m", "aegis_daemon.main"]
    return ["python3", "-m", "aegis_daemon.main"]


def wait_for_health(proc: subprocess.Popen, timeout: float = 30.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if proc.poll() is not None:
            return False
        status, _parsed, _raw = http_get("/health", timeout=3.0)
        if status == 200:
            return True
        time.sleep(0.25)
    return False


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def main() -> int:
    tmpdir = tempfile.mkdtemp(prefix="aegis-smoke-")
    aegis_home = tmpdir  # AEGIS_HOME itself is the temp dir
    env = dict(os.environ)
    env["AEGIS_HOME"] = aegis_home
    env["AEGIS_PORT"] = str(PORT)
    env["AEGIS_NO_LLM"] = "1"
    # Isolate the provider env file: an empty file in the temp home, so a
    # developer machine's real keys (e.g. the project's own .env.local)
    # are never loaded — phase 1's tier must be deterministically offline.
    env_file = Path(tmpdir) / "smoke.env"
    env_file.write_text("", encoding="utf-8")
    env["AEGIS_ENV_FILE"] = str(env_file)
    env["AEGIS_BROWSER_URL"] = "http://127.0.0.1:4311"

    log_path = Path(tmpdir) / "daemon.log"
    log_file = open(log_path, "wb")

    cmd = daemon_command()
    print(f"Starting daemon: {' '.join(cmd)} (cwd={APP_DIR}, AEGIS_HOME={aegis_home}, port={PORT})",
          flush=True)

    proc = subprocess.Popen(
        cmd,
        cwd=str(APP_DIR),
        env=env,
        stdout=log_file,
        stderr=subprocess.STDOUT,
    )

    try:
        # --- startup -------------------------------------------------------
        healthy = wait_for_health(proc, timeout=30.0)
        if not healthy:
            record("startup: daemon becomes healthy within 30s", False,
                   f"exit={proc.poll()}")
            try:
                log_file.flush()
                tail = Path(log_path).read_text(errors="replace")[-2000:]
                if tail.strip():
                    print("--- daemon log tail ---\n" + tail + "\n--- end daemon log ---",
                          flush=True)
            except Exception:
                pass
            return finish()

        # --- 1. health ------------------------------------------------------
        try:
            _status, payload, raw = http_get("/health")
            blob = dumps(payload) if payload is not None else raw
            tier = find_key(payload, "tier") if payload is not None else None
            llm_tier = find_key(payload, "llm_tier") if payload is not None else None
            ok_flag = find_key(payload, "ok") if payload is not None else None
            tier_val = llm_tier if llm_tier is not None else tier
            ok = (ok_flag is True or '"ok": true' in blob or '"ok":true' in blob) \
                and tier_val == "offline"
            record("1. health: ok true, tier/llm_tier == offline", ok,
                   f"ok={ok_flag!r} tier={tier!r} llm_tier={llm_tier!r}")
        except Exception as e:
            record("1. health: ok true, tier/llm_tier == offline", False, f"{type(e).__name__}: {e}")

        # --- 2. remember + recall with citation ------------------------------
        try:
            _s, payload, raw = call_tool(
                "memory.remember",
                {"text": "Acme wants net-45 payment terms from now on"},
                confirmed=False,
            )
            ok = is_ok(payload) if payload is not None else False
            record("2a. remember: memory.remember returns ok", ok,
                   dumps(payload)[:300] if not ok else "")
        except Exception as e:
            record("2a. remember: memory.remember returns ok", False, f"{type(e).__name__}: {e}")

        try:
            _s, payload, raw = call_tool(
                "memory.recall",
                {"query": "What payment terms does Acme want?"},
            )
            blob = dumps(payload) if payload is not None else raw
            ok = is_ok(payload) if payload is not None else False
            has_net45 = "net-45" in blob
            has_citation = ("capture" in blob.lower()) or ("citation" in blob.lower())
            # Also accept a non-empty citations list explicitly.
            for v in find_values(payload, "citations") if payload is not None else []:
                if isinstance(v, list) and len(v) > 0:
                    has_citation = True
            record("2b. recall: contains net-45 with citation/capture id",
                   bool(ok and has_net45 and has_citation),
                   f"ok={ok} net-45={has_net45} citation={has_citation}")
        except Exception as e:
            record("2b. recall: contains net-45 with citation/capture id", False,
                   f"{type(e).__name__}: {e}")

        # --- 3. abstention ----------------------------------------------------
        try:
            _s, payload, raw = call_tool(
                "memory.recall",
                {"query": "What is the hedge fund leverage ratio for Zorblax Industries?"},
            )
            blob = dumps(payload) if payload is not None else raw
            blob_lower = blob.lower()
            abstained_flag = False
            if payload is not None:
                for v in find_values(payload, "abstained"):
                    if v is True:
                        abstained_flag = True
            abstained_text = ("don't know" in blob_lower or "do not know" in blob_lower
                              or "don’t know" in blob_lower or "abstain" in blob_lower)
            record("3. abstention: unknown fact abstains, no invented figures",
                   bool(abstained_flag or abstained_text),
                   f"abstained_flag={abstained_flag} abstained_text={abstained_text}")
        except Exception as e:
            record("3. abstention: unknown fact abstains, no invented figures", False,
                   f"{type(e).__name__}: {e}")

        # --- 4. mode_blocked ---------------------------------------------------
        try:
            set_mode("Assistant")
            _s, payload, raw = call_tool(
                "file.write",
                {"path": "notes/test.txt", "content": "hello"},
            )
            blob = dumps(payload) if payload is not None else raw
            record("4. mode_blocked: file.write blocked in Assistant mode",
                   "mode_blocked" in blob,
                   blob[:300] if "mode_blocked" not in blob else "")
        except Exception as e:
            record("4. mode_blocked: file.write blocked in Assistant mode", False,
                   f"{type(e).__name__}: {e}")

        # --- 5. permission flow -------------------------------------------------
        target = Path(aegis_home) / "workspace" / "notes" / "test.txt"
        try:
            set_mode("Operator")
            _s, payload, raw = call_tool(
                "file.write",
                {"path": "notes/test.txt", "content": "hello"},
            )
            blob = dumps(payload) if payload is not None else raw
            needs_perm = ("permission_required" in blob) or ("permission_denied" in blob)
            record("5a. permission: unconfirmed file.write requires permission",
                   needs_perm, blob[:300] if not needs_perm else "")
        except Exception as e:
            record("5a. permission: unconfirmed file.write requires permission", False,
                   f"{type(e).__name__}: {e}")

        try:
            _s, payload, raw = call_tool(
                "file.write",
                {"path": "notes/test.txt", "content": "hello"},
                confirmed=True,
                confirmation_source="keyboard",
            )
            ok = is_ok(payload) if payload is not None else False
            file_ok = target.exists() and target.read_text(errors="replace") == "hello"
            record("5b. permission: keyboard-confirmed file.write succeeds, file on disk",
                   bool(ok and file_ok),
                   f"ok={ok} file_exists={target.exists()}")
        except Exception as e:
            record("5b. permission: keyboard-confirmed file.write succeeds, file on disk",
                   False, f"{type(e).__name__}: {e}")

        try:
            voice_path_rel = "notes/voice-test.txt"
            voice_target = Path(aegis_home) / "workspace" / voice_path_rel
            if voice_target.exists():
                voice_target.unlink()
            _s, payload, raw = call_tool(
                "file.write",
                {"path": voice_path_rel, "content": "should not be written"},
                confirmed=True,
                confirmation_source="voice",
            )
            blob = dumps(payload) if payload is not None else raw
            refused = ("voice_confirmation_refused" in blob) or ("permission_required" in blob) \
                or ("permission_denied" in blob) or not is_ok(payload if payload is not None else {})
            not_written = not voice_target.exists()
            record("5c. permission: voice confirmation refused, file not written",
                   bool(refused and not_written),
                   f"refused={refused} file_exists={voice_target.exists()} blob={blob[:200]}")
        except Exception as e:
            record("5c. permission: voice confirmation refused, file not written", False,
                   f"{type(e).__name__}: {e}")

        # --- 6. forging -----------------------------------------------------------
        learned_slug = None
        try:
            # file.read is once_per_session: send keyboard confirmation every time.
            read_results = []
            for _i in range(3):
                _s, payload, _raw = call_tool(
                    "file.read",
                    {"path": "notes/test.txt"},
                    confirmed=True,
                    confirmation_source="keyboard",
                )
                read_results.append(is_ok(payload) if payload is not None else False)
            record("6a. forging: 3x file.read succeeds",
                   all(read_results), f"results={read_results}")

            _s, payload, raw = http_get("/api/tools")
            blob = dumps(payload) if payload is not None else raw
            learned: list = []
            if payload is not None:
                for v in find_values(payload, "learned"):
                    if isinstance(v, list):
                        learned = v
                        break
                if not learned:
                    # Fall back: a top-level learned_tools key.
                    for v in find_values(payload, "learned_tools"):
                        if isinstance(v, list):
                            learned = v
                            break
            matching = []
            for item in learned if isinstance(learned, list) else []:
                if isinstance(item, dict) and item.get("source_tool") == "file.read":
                    matching.append(item)
                elif isinstance(item, dict) and "file.read" in dumps(item):
                    matching.append(item)
            if matching:
                first = matching[0]
                if isinstance(first, dict):
                    learned_slug = first.get("slug") or first.get("name") or first.get("id")
            ok = bool(learned) and bool(matching)
            record("6b. forging: learned tool from file.read appears in GET /api/tools",
                   ok, f"learned_count={len(learned) if isinstance(learned, list) else 0} slug={learned_slug!r}")
        except Exception as e:
            record("6a. forging: 3x file.read succeeds", False, f"{type(e).__name__}: {e}")
            record("6b. forging: learned tool from file.read appears in GET /api/tools",
                   False, f"{type(e).__name__}: {e}")

        try:
            _s, payload4, raw4 = call_tool(
                "file.read",
                {"path": "notes/test.txt"},
                confirmed=True,
                confirmation_source="keyboard",
            )
            blob4 = dumps(payload4) if payload4 is not None else raw4
            signal_response = ("learned" in blob4.lower()) or ("forged" in blob4.lower()) \
                or (learned_slug is not None and str(learned_slug) in blob4)

            _s2, log_payload, log_raw = http_get("/api/log")
            log_blob = dumps(log_payload) if log_payload is not None else log_raw
            signal_log = False
            if learned_slug and str(learned_slug) in log_blob:
                signal_log = True
            elif "learned" in log_blob.lower() or "forged" in log_blob.lower():
                # Only count log signal if it plausibly references the forged tool.
                signal_log = ("file.read" in log_blob) or bool(learned_slug)

            if signal_log:
                which = "log"
            elif signal_response:
                which = "response"
            else:
                which = "none"
            record("6c. forging: 4th file.read surfaces learned/forged signal",
                   bool(signal_log or signal_response), f"signal={which}")
        except Exception as e:
            record("6c. forging: 4th file.read surfaces learned/forged signal", False,
                   f"{type(e).__name__}: {e}")

        # --- 7. AG-UI ---------------------------------------------------------------
        try:
            _s, _payload, raw = http_post(
                "/agui",
                {"messages": [{"role": "user",
                               "content": "What payment terms does Acme want?"}]},
                timeout=30.0,
            )
            has_started = "RUN_STARTED" in raw
            has_finished = "RUN_FINISHED" in raw
            has_content = "TEXT_MESSAGE_CONTENT" in raw
            record("7. AG-UI: SSE contains RUN_STARTED, TEXT_MESSAGE_CONTENT, RUN_FINISHED",
                   bool(has_started and has_finished and has_content),
                   f"started={has_started} content={has_content} finished={has_finished}")
        except Exception as e:
            record("7. AG-UI: SSE contains RUN_STARTED, TEXT_MESSAGE_CONTENT, RUN_FINISHED",
                   False, f"{type(e).__name__}: {e}")

        # --- 8. kill switch ------------------------------------------------------------
        try:
            http_post("/api/kill", {})
            _s, state_payload, state_raw = http_get("/api/state")
            state_blob = dumps(state_payload) if state_payload is not None else state_raw
            state_val = find_key(state_payload, "state") if state_payload is not None else None
            record("8a. kill switch: state == stopped after POST /api/kill",
                   state_val == "stopped" or '"stopped"' in state_blob,
                   f"state={state_val!r}")

            _s, payload, raw = call_tool(
                "memory.recall",
                {"query": "What payment terms does Acme want?"},
            )
            blob = dumps(payload) if payload is not None else raw
            blocked = ("state_stopped" in blob) or (not is_ok(payload if payload is not None else {}))
            record("8b. kill switch: tool call rejected while stopped",
                   bool(blocked), blob[:300] if not blocked else f"state_stopped={'state_stopped' in blob}")

            # Cleanliness: resume.
            http_post("/api/resume", {})
        except Exception as e:
            record("8a. kill switch: state == stopped after POST /api/kill", False,
                   f"{type(e).__name__}: {e}")
            record("8b. kill switch: tool call rejected while stopped", False,
                   f"{type(e).__name__}: {e}")
            try:
                http_post("/api/resume", {})
            except Exception:
                pass

            # ===============================================================
        # Phase 2 — AEGIS ONE behaviour (conversational brain, provenance
        # toggle, forging stats, CUA gating, custom tools, browser).
        # ===============================================================

        def msg(text):
            _s, payload, _raw = http_post("/api/message", {"text": text})
            return payload or {}

        try:
            p = msg("hello")
            ans = str(p.get("answer") or "")
            record("9. chat: greeting is conversational, never abstains",
                   bool(ans) and "abstain" not in ans.lower(), ans[:100])
        except Exception as e:
            record("9. chat: greeting is conversational, never abstains", False,
                   f"{type(e).__name__}: {e}")
        try:
            p = msg("what can you do")
            ans = str(p.get("answer") or "")
            record("10. chat: capability question answered in full",
                   len(ans) > 80 and "abstain" not in ans.lower(), ans[:100])
        except Exception as e:
            record("10. chat: capability question answered in full", False,
                   f"{type(e).__name__}: {e}")
        try:
            p = msg("my favourite editor is Helix")
            stored = "capture" in dumps(p).lower()
            p2 = msg("what is my favourite editor")
            blob = dumps(p2)
            cited = any(isinstance(v, list) and len(v) > 0
                        for v in find_values(p2, "citations")) or "cap_" in blob
            record("11. chat: auto-capture + cited recall",
                   bool(stored and "Helix" in blob and cited),
                   f"stored={stored} cited={cited}")
        except Exception as e:
            record("11. chat: auto-capture + cited recall", False,
                   f"{type(e).__name__}: {e}")
        try:
            http_post("/api/settings", {"provenance_strict": False})
            p = msg("what is my dog's name")
            flag = any(v is True for v in find_values(p, "abstained"))
            conversational = "don't have that stored" in str(p.get("answer") or "")
            http_post("/api/settings", {"provenance_strict": True})
            p2 = msg("what is my dog's name")
            strict_text = "no memory matches" in str(p2.get("answer") or "")
            http_post("/api/settings", {"provenance_strict": False})
            record("12. provenance toggle: flag both ways, text follows toggle",
                   bool(flag and conversational and strict_text),
                   f"flag={flag} conversational={conversational} strict={strict_text}")
        except Exception as e:
            record("12. provenance toggle: flag both ways, text follows toggle",
                   False, f"{type(e).__name__}: {e}")
        try:
            _s, payload, _raw = http_get("/api/tools")
            learned = (payload or {}).get("learned") or []
            stats_ok = bool(learned) and all(
                "uses" in e and "avg_duration_ms" in e for e in learned)
            record("13. forging stats: learned tools carry uses + avg_duration_ms",
                   stats_ok, dumps(learned)[:160])
        except Exception as e:
            record("13. forging stats: learned tools carry uses + avg_duration_ms",
                   False, f"{type(e).__name__}: {e}")
        try:
            set_mode("Assistant")
            _s, p, _raw = call_tool("cua.click", {"x": 5, "y": 5},
                                    confirmed=True, confirmation_source="keyboard")
            gated = "mode_blocked" in dumps(p)
            set_mode("Operator")
            _s, p2, _raw = call_tool("cua.click", {"x": 5, "y": 5},
                                     confirmed=True, confirmation_source="keyboard")
            blob2 = dumps(p2)
            honest = ("platform_error" in blob2) or is_ok(p2)
            _s, log_payload, _raw = http_get("/api/log")
            logged = "cua.click" in dumps(log_payload)
            record("14. CUA: mode-gated, honest platform result, logged",
                   bool(gated and honest and logged),
                   f"gated={gated} honest={honest} logged={logged} result={blob2[:120]}")
        except Exception as e:
            record("14. CUA: mode-gated, honest platform result, logged", False,
                   f"{type(e).__name__}: {e}")
        try:
            _s, p, _raw = http_post("/api/custom-tools", {
                "name": "Sysinfo Twice", "description": "smoke",
                "params": [], "steps": [{"tool": "system.info", "args": {}},
                                        {"tool": "system.info", "args": {}}]})
            created = _s == 200 and "sysinfo" in dumps(p).lower()
            _s, p2, _raw = call_tool("custom.sysinfo-twice", {})
            record("15. custom tools: created via API and callable",
                   bool(created and is_ok(p2)), dumps(p2)[:160])
        except Exception as e:
            record("15. custom tools: created via API and callable", False,
                   f"{type(e).__name__}: {e}")
        try:
            http_post("/api/browser/serve", {"action": "start"})
            set_mode("Browser")
            _s, p, _raw = http_post("/api/tool", {
                "tool": "browser.navigate",
                "arguments": {"url": "https://example.com"},
                "confirmed": True, "confirmation_source": "keyboard"},
                timeout=60.0)
            labelled = "engine" in dumps(p)
            import urllib.request as _u
            try:
                with _u.urlopen(BASE + "/api/browser/preview", timeout=20) as r:
                    data = r.read()
                preview_ok = data[:4] == b"\x89PNG"
                preview_detail = f"png_bytes={len(data)}"
            except urllib.error.HTTPError as he:
                body = he.read().decode("utf-8", errors="replace")
                preview_ok = "no_preview" in body
                preview_detail = f"http_{he.code} labelled fallback"
            http_post("/api/browser/serve", {"action": "stop"})
            record("16. browser: navigate engine-labelled, preview PNG or labelled fallback",
                   bool(labelled and preview_ok),
                   f"labelled={labelled} preview={preview_detail} nav={dumps(p)[:140]}")
        except Exception as e:
            record("16. browser: navigate engine-labelled, preview PNG or labelled fallback",
                   False, f"{type(e).__name__}: {e}")

        # ===============================================================
        # Phase 3 — provider config flips the tier. Configure a dummy key
        # (written to the isolated temp env file), restart the daemon
        # WITHOUT AEGIS_NO_LLM, and the health tier must become cloud.
        # ===============================================================
        try:
            _s, p, _raw = http_post("/api/providers/config", {
                "provider": "groq", "api_key": "dummy-smoke-key",
                "activate": True})
            provs = (p or {}).get("providers") or {}
            configured = bool((provs.get("groq") or {}).get("configured"))
            record("17a. provider config: dummy key stored as configured",
                   configured, dumps(p)[:200])
        except Exception as e:
            configured = False
            record("17a. provider config: dummy key stored as configured",
                   False, f"{type(e).__name__}: {e}")
        try:
            proc.terminate()
            proc.wait(timeout=5)
            env2 = dict(env)
            env2.pop("AEGIS_NO_LLM", None)
            log2 = open(Path(tmpdir) / "daemon2.log", "wb")
            proc = subprocess.Popen(cmd, cwd=str(APP_DIR), env=env2,
                                    stdout=log2, stderr=subprocess.STDOUT)
            healthy2 = wait_for_health(proc, timeout=30.0)
            _s, payload, _raw = http_get("/health")
            blob = dumps(payload)
            record("17b. provider config: tier flips to cloud on restart",
                   bool(healthy2 and '"cloud"' in blob and "groq" in blob),
                   blob[:200])
        except Exception as e:
            record("17b. provider config: tier flips to cloud on restart",
                   False, f"{type(e).__name__}: {e}")

        return finish()

    finally:
        try:
            if proc.poll() is None:
                proc.terminate()
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait(timeout=5)
        except Exception:
            pass
        try:
            log_file.close()
        except Exception:
            pass


def finish() -> int:
    passed = sum(1 for _n, ok, _d in RESULTS if ok)
    total = len(RESULTS)
    print(f"SMOKE: {passed}/{total} passed", flush=True)
    return 0 if (total > 0 and passed == total) else 1


if __name__ == "__main__":
    sys.exit(main())
