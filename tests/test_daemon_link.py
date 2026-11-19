#!/usr/bin/env python3
"""Aegis daemon-link tests (W4) — stdlib only.

Proves the link the OpenDots glue module
(apps/host/src/server/aegis-daemon.ts) is built against:

  1. the daemon starts from services/daemon (the NEW layout —
     tests/smoke_daemon.py still points at the old `daemon/` path)
     with a throwaway AEGIS_HOME on a test port, and /health answers
     with a tier field;
  2. /api/state carries the provider name the glue surfaces;
  3. a remember -> recall round trip over the HTTP API
     (POST /api/tool memory.remember / memory.recall) returns the
     fact WITH a citation whose capture id matches the remember;
  4. the same recall works through GET /api/memory/search;
  5. MCP reality check: the daemon is probed for a Streamable HTTP
     MCP endpoint at /mcp. This daemon build exposes NO MCP
     transport (verified in aegis_daemon/main.py — HTTP API, AG-UI
     and WebSocket only), so the probe must 404 and tool listing is
     skipped. If a future daemon answers MCP initialize, this test
     performs a real MCP tools/list call and asserts on it instead.

Creates services/daemon/.venv (venv + requirements) if missing.

Usage:  python3 tests/test_daemon_link.py
Exit code 0 when every check passes.
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

PORT = 8979
BASE = f"http://127.0.0.1:{PORT}"
DAEMON_DIR = Path(__file__).resolve().parent.parent / "services" / "daemon"

RESULTS: list[tuple[str, bool, str]] = []


def record(name: str, ok: bool, detail: str = "") -> bool:
    RESULTS.append((name, bool(ok), detail))
    line = f"{'PASS' if ok else 'FAIL'}: {name}"
    if detail:
        line += f" — {detail}"
    print(line, flush=True)
    return bool(ok)


def http(method: str, path: str, body=None, timeout: float = 15.0,
         headers: dict | None = None):
    url = BASE + path
    data = None
    hdrs = {"Accept": "application/json"}
    if headers:
        hdrs.update(headers)
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        hdrs["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=hdrs, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            status = resp.status
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        status = e.code
    except Exception as e:
        return 0, None, f"{type(e).__name__}: {e}"
    try:
        parsed = json.loads(raw)
    except Exception:
        parsed = None
    return status, parsed, raw


def ensure_venv() -> Path:
    scripts, exe = ("Scripts", "python.exe") if os.name == "nt" else ("bin", "python")
    venv_python = DAEMON_DIR / ".venv" / scripts / exe
    if venv_python.exists():
        return venv_python
    print(f"Creating daemon venv in {DAEMON_DIR / '.venv'} ...", flush=True)
    subprocess.run([sys.executable, "-m", "venv", str(DAEMON_DIR / ".venv")],
                   check=True)
    subprocess.run([str(venv_python), "-m", "pip", "install", "-q",
                    "-r", str(DAEMON_DIR / "requirements.txt")], check=True)
    return venv_python


def wait_for_health(proc: subprocess.Popen, timeout: float = 30.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if proc.poll() is not None:
            return False
        status, _p, _r = http("GET", "/health", timeout=3.0)
        if status == 200:
            return True
        time.sleep(0.25)
    return False


def main() -> int:
    if not DAEMON_DIR.is_dir():
        record("layout: services/daemon exists", False, str(DAEMON_DIR))
        return finish()
    record("layout: services/daemon exists", True, str(DAEMON_DIR))

    venv_python = ensure_venv()
    tmpdir = tempfile.mkdtemp(prefix="aegis-daemon-link-")
    env = dict(os.environ)
    env["AEGIS_HOME"] = tmpdir
    env["AEGIS_PORT"] = str(PORT)
    env["AEGIS_NO_LLM"] = "1"  # deterministic offline tier, no key use

    log_path = Path(tmpdir) / "daemon.log"
    log_file = open(log_path, "wb")
    proc = subprocess.Popen(
        [str(venv_python), "-m", "aegis_daemon.main"],
        cwd=str(DAEMON_DIR), env=env,
        stdout=log_file, stderr=subprocess.STDOUT)
    print(f"Starting daemon: {venv_python} -m aegis_daemon.main "
          f"(cwd={DAEMON_DIR}, AEGIS_HOME={tmpdir}, port={PORT})", flush=True)
    try:
        if not wait_for_health(proc):
            record("startup: daemon healthy within 30s", False,
                   f"exit={proc.poll()}")
            log_file.flush()
            tail = Path(log_path).read_text(errors="replace")[-2000:]
            if tail.strip():
                print("--- daemon log tail ---\n" + tail +
                      "\n--- end daemon log ---", flush=True)
            return finish()
        record("startup: daemon healthy within 30s", True)

        # 1. /health tier field
        _s, health, _r = http("GET", "/health")
        tier = (health or {}).get("tier") or (health or {}).get("llm", {}).get("tier")
        record("1. health: /health responds with a tier field",
               tier == "offline",
               f"tier={tier!r} llm={(health or {}).get('llm')!r}")

        # 2. /api/state provider (what getAegisMemoryState surfaces)
        _s, state, _r = http("GET", "/api/state")
        provider = ((state or {}).get("llm") or {}).get("provider")
        record("2. state: /api/state carries llm.provider + tier",
               bool(provider) and ((state or {}).get("tier") == "offline"),
               f"provider={provider!r} tier={(state or {}).get('tier')!r}")

        # 3. remember -> recall via /api/tool
        fact = "The Zephyr link-test codename is Halcyon-9"
        _s, remembered, _r = http("POST", "/api/tool", {
            "tool": "memory.remember", "arguments": {"text": fact}})
        capture_id = (remembered or {}).get("capture_id")
        record("3a. remember: memory.remember ok with capture_id",
               bool((remembered or {}).get("ok")) and bool(capture_id),
               f"capture_id={capture_id!r}")

        _s, recalled, _r = http("POST", "/api/tool", {
            "tool": "memory.recall",
            "arguments": {"query": "What is the Zephyr link-test codename?"}})
        citations = (recalled or {}).get("citations") or []
        blob = json.dumps(recalled or {})
        record("3b. recall: fact returned with citation == remember capture_id",
               bool((recalled or {}).get("ok"))
               and "Halcyon-9" in blob
               and capture_id in citations,
               f"citations={citations!r} abstained={(recalled or {}).get('abstained')!r}")

        # 4. recall via GET /api/memory/search
        from urllib.parse import quote
        _s, searched, _r = http(
            "GET", "/api/memory/search?q=" + quote("Zephyr link-test codename"))
        s_citations = (searched or {}).get("citations") or []
        record("4. search: GET /api/memory/search returns citations",
               capture_id in s_citations
               and not (searched or {}).get("abstained"),
               f"citations={s_citations!r}")

        # 5. MCP probe: a real MCP initialize against /mcp.
        status, mcp_body, _r = http("POST", "/mcp", {
            "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": {"protocolVersion": "2025-03-26", "capabilities": {},
                       "clientInfo": {"name": "test_daemon_link",
                                      "version": "0.1.0"}}},
            headers={"Accept": "application/json, text/event-stream"})
        if status == 200 and isinstance(mcp_body, dict) and mcp_body.get("result"):
            # Future daemon with Streamable HTTP MCP: list its tools for real.
            _s2, tools_body, _r2 = http("POST", "/mcp", {
                "jsonrpc": "2.0", "id": 2, "method": "tools/list",
                "params": {}},
                headers={"Accept": "application/json, text/event-stream"})
            tools = ((tools_body or {}).get("result") or {}).get("tools")
            record("5. mcp: Streamable HTTP MCP present, tools/list answers",
                   isinstance(tools, list),
                   f"tools={[t.get('name') for t in tools or []]!r}")
        else:
            record("5. mcp: daemon exposes no MCP transport (/mcp probe)",
                   status in (404, 405),
                   f"HTTP {status} — HTTP API only; MCP tool listing "
                   "skipped, glue degrades to health/state surface")
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
    print(f"DAEMON-LINK: {passed}/{len(RESULTS)} passed", flush=True)
    return 0 if RESULTS and passed == len(RESULTS) else 1


if __name__ == "__main__":
    sys.exit(main())
