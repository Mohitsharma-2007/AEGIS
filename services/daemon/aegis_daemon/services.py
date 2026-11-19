"""Service supervisor: registry + subprocess manager for AEGIS ONE.

AEGIS ONE is several upstream apps interlinked behind one daemon. This
module knows how to start/stop the long-running pieces and report
their honest state:

  - ``aegis-daemon``     — this process. Always "running", NOT managed
                           (stopping it is the kill switch's job, and
                           the kill switch also stops managed services).
  - the browser engine (Playwright) is owned by the host and the desktop
    shell, not by this daemon.
  - entries parsed from ``docs/SERVICES.md`` when that file documents
    a runnable command (e.g. ``openmuse-server``). If the doc or a
    runnable command is absent, the registry stays daemon-only —
    nothing is invented here.

Child environment (documented glue): the resolved .env.local values
are loaded and the generic provider vars (OPENROUTER_API_KEY etc.)
are passed through as-is; additionally OPENAI_API_KEY /
OPENAI_BASE_URL mirrors are set from the ACTIVE provider, because
many upstream apps expect OpenAI-style variable names. Key material
only ever goes INTO child environments — status output never
contains it (names, pids, ports, commands and log tails only).

Logs: one append-only file per service under
``<AEGIS_HOME>/service-logs/``; status returns the last lines as a
simple ring-buffer substitute.
"""
from __future__ import annotations

import os
import re
import shlex
import shutil
import subprocess
import time
from pathlib import Path

from . import providers
from .db import aegis_home

LOG_TAIL_LINES = 20

_PROCS: dict[str, dict] = {}


def repo_root() -> Path:
    return Path(__file__).resolve().parent.parent.parent


def _docs_path() -> Path:
    return repo_root() / "docs" / "SERVICES.md"


def _logs_dir() -> Path:
    path = aegis_home() / "service-logs"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _log_path(name: str) -> Path:
    return _logs_dir() / f"{name}.log"


def _log_tail(name: str, lines: int = LOG_TAIL_LINES) -> list[str]:
    try:
        text = _log_path(name).read_text(encoding="utf-8", errors="replace")
    except OSError:
        return []
    return text.splitlines()[-lines:]


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------

def _builtin_entries() -> list[dict]:
    root = repo_root()
    # The browser engine is the host's Playwright browser service (managed
    # by the desktop shell), not a daemon child process. Keep only the
    # daemon itself as a builtin entry; the services registry stays honest
    # about what this process owns.
    return [
        {
            "name": "aegis-daemon",
            "cwd": str(root / "daemon"),
            "command": [],
            "port": int(os.environ.get("AEGIS_PORT", "8765")),
            "health_url": "http://127.0.0.1:8765/health",
            "env": {},
            "managed": False,
            "source": "builtin",
            "description": "The AEGIS daemon itself (this process).",
            "blocked_reason": None,
        },
    ]


_HEADING_RE = re.compile(r"^#{1,4}\s+(.*?)\s*$")
_KEYVAL_RE = re.compile(
    r"(?im)^\s*(?:[-*]\s*)?(command|run|cwd|working directory|port)\s*"
    r"[:=]\s*`?(.+?)`?\s*$")


def _slug(heading: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", heading.lower()).strip("-")
    return slug


def _docs_sections() -> list[tuple[str, str]]:
    """Split docs/SERVICES.md into its level-2 (##) app sections."""
    path = _docs_path()
    if not path.is_file():
        return []
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return []
    sections: list[tuple[str, str]] = []
    name, lines = None, []
    for line in text.splitlines():
        if line.startswith("## "):
            if name is not None:
                sections.append((name, "\n".join(lines)))
            name, lines = line[3:].strip(), []
        elif name is not None:
            lines.append(line)
    if name is not None:
        sections.append((name, "\n".join(lines)))
    return sections


def _doc_verdict(body: str) -> str:
    """The section's own (f) Verdict token (first bold word there) —
    prose elsewhere in the section also mentions other verdicts."""
    part = body.split("(f) Verdict", 1)[-1]
    m = re.search(r"\*\*([A-Z_]+)\*\*", part)
    return m.group(1) if m else ""


def _doc_port(body: str) -> int | None:
    """First bold port in the section's (b) Ports subsection."""
    ports_part = body.split("(b) Ports", 1)[-1].split("### (c)", 1)[0]
    m = re.search(r"\*\*(\d{3,5})\*\*", ports_part)
    return int(m.group(1)) if m else None


def _doc_command(body: str) -> tuple[list[str] | None, str]:
    """Extract the runnable command the section documents, using the
    doc's own evidence (root package.json scripts / canonical stack
    entry points), in the form this supervisor can actually spawn."""
    if "bash scripts/start.sh" in body:
        # OpenBot canonical full-stack entry / OpenDuet root "start".
        return ["bash", "scripts/start.sh"], "stack start script"
    if '"dev": "tsx watch apps/server/src/index.ts"' in body:
        # openmuse root "dev" script (tsx watch on the Hono API).
        return ["npm", "run", "dev"], 'root "dev" script (tsx watch API)'
    if '"dev": "concurrently' in body:
        # OpenDots root "dev" script (Hono server + Vite together).
        return ["npm", "run", "dev"], 'root "dev" script (server + Vite)'
    for key, value in _KEYVAL_RE.findall(body):
        if key.lower() in ("command", "run"):
            try:
                return shlex.split(value), f"{key}: line"
            except ValueError:
                return None, ""
    block = re.search(r"```[a-z]*\n(.+?)```", body, re.DOTALL)
    if block:
        for cand in block.group(1).splitlines():
            cand = cand.strip().lstrip("$ ").strip()
            if cand and not cand.startswith("#") and (
                    " " in cand or cand.startswith(("./", "python",
                                                     "node", "npm"))):
                try:
                    return shlex.split(cand), "fenced code block"
                except ValueError:
                    return None, ""
    return None, ""


# Apps in SERVICES.md whose boot hard-requires a CopilotKit
# Intelligence project key (their sections' verdict: BLOCKED_ACCOUNT).
_DOC_BLOCKED_ENV = "CPK_INTELLIGENCE_API_KEY"


def _entries_from_docs() -> list[dict]:
    """Build registry entries from docs/SERVICES.md.

    An app section becomes an entry only when the doc documents a
    runnable command for it and does not verdict it NOT_A_SERVER.
    Sections verdicted BLOCKED_ACCOUNT still get entries — with the
    missing-account requirement recorded, so start() reports the
    honest blocked state instead of pretending to run. Commands that
    need the app's JS dependencies get a node_modules requirement for
    the same reason.
    """
    entries: list[dict] = []
    known = {e["name"] for e in _builtin_entries()}
    root = repo_root()
    for heading, body in _docs_sections():
        slug = _slug(re.sub(r"^\d+\.\s*", "", heading))
        if not slug or "verdict" in slug:
            continue
        if "NOT_A_SERVER" in body:
            continue
        app_key = next((k for k in ("openmuse", "openbot", "openduet",
                                    "opendots", "copilotkit")
                        if k in slug), None)
        if app_key is None:
            continue
        name = f"{app_key}-server"
        if name in known or any(e["name"] == name for e in entries):
            continue
        command, how = _doc_command(body)
        if not command:
            continue
        cwd_match = re.search(r"Vendored root:\s*`([^`]+)`", body)
        cwd = (root / cwd_match.group(1).strip("/")) if cwd_match \
            else root / "upstream-apps" / app_key
        port = _doc_port(body)
        requires_env = [_DOC_BLOCKED_ENV] \
            if _doc_verdict(body) == "BLOCKED_ACCOUNT" else []
        entries.append({
            "name": name,
            "cwd": str(cwd),
            "command": command,
            "port": port,
            "health_url": (f"http://127.0.0.1:{port}/" if port else None),
            "env": {"OPENAI_API_KEY": "OPENAI_API_KEY",
                    "OPENAI_BASE_URL": "OPENAI_BASE_URL"},
            "managed": True,
            "source": "docs/SERVICES.md",
            "description": f"docs/SERVICES.md §{heading}: {how}.",
            "blocked_reason": None,
            "requires_env": requires_env,
            # npm-run dev/start scripts cannot run before install.
            "requires_node_modules": command[:2] == ["npm", "run"],
        })
    return entries


def build_registry() -> list[dict]:
    return _builtin_entries() + _entries_from_docs()


def _blocked_reason(entry: dict) -> str | None:
    if entry.get("blocked_reason"):
        return entry["blocked_reason"]
    if not entry.get("managed"):
        return None
    command = entry.get("command") or []
    if not command:
        return "no command documented"
    cwd = Path(entry["cwd"])
    if not cwd.is_dir():
        return f"working directory missing: {entry['cwd']}"
    for var in entry.get("requires_env") or []:
        if not providers.get_var(var, ""):
            return (f"blocked: requires {var}, which is not configured "
                    "(docs/SERVICES.md verdict: BLOCKED_ACCOUNT)")
    if entry.get("requires_node_modules") and \
            not (cwd / "node_modules").is_dir():
        return (f"dependencies not installed: no node_modules in "
                f"{entry['cwd']} (install the app's dependencies first)")
    exe = command[0]
    if "/" in exe:
        if not Path(exe).is_file() and not (cwd / exe).is_file():
            return f"executable not found: {exe}"
    elif shutil.which(exe) is None:
        return f"executable not on PATH: {exe}"
    return None


# ---------------------------------------------------------------------------
# Manager
# ---------------------------------------------------------------------------

def _child_env(entry: dict) -> dict:
    env = dict(os.environ)
    found = providers.find_env_file()
    if found is not None:
        for key, value in providers._parse_env_file(found).items():
            env.setdefault(key, value)
    cfg = providers.provider_config()
    if cfg["key_present"]:
        env["OPENAI_API_KEY"] = cfg["key"]
    env["OPENAI_BASE_URL"] = cfg["base_url"]
    if cfg["model"]:
        env["OPENAI_MODEL"] = cfg["model"]
    # Per-entry env mapping: child var <- (already assembled) env var.
    snapshot = dict(env)
    for child_var, source_var in (entry.get("env") or {}).items():
        if source_var in snapshot:
            env[child_var] = snapshot[source_var]
    return env


def _entry_status(entry: dict) -> dict:
    name = entry["name"]
    proc_info = _PROCS.get(name)
    pid, started_at, running = None, None, False
    if not entry.get("managed"):
        status = "running"  # the daemon itself
        pid = os.getpid()
    elif proc_info is not None:
        proc = proc_info["proc"]
        pid = proc.pid
        started_at = proc_info["started_at"]
        if proc.poll() is None:
            running, status = True, "running"
        else:
            status = "stopped"
    else:
        status = "stopped"
    blocked = _blocked_reason(entry)
    if blocked and not running and entry.get("managed"):
        status = "blocked"
    out = {
        "name": name,
        "status": status,
        "running": running or status == "running",
        "pid": pid,
        "started_at": started_at,
        "port": entry.get("port"),
        "health_url": entry.get("health_url"),
        "cwd": entry.get("cwd"),
        "command": entry.get("command"),
        "managed": bool(entry.get("managed")),
        "source": entry.get("source"),
        "description": entry.get("description"),
        "log_tail": _log_tail(name) if entry.get("managed") else [],
    }
    if blocked:
        out["blocked_reason"] = blocked
        out["detail"] = blocked
    if entry.get("requires_env"):
        out["requires_env"] = entry["requires_env"]
    if proc_info is not None and proc_info["proc"].poll() is not None:
        out["exit_code"] = proc_info["proc"].returncode
    return out


def status() -> list[dict]:
    return [_entry_status(e) for e in build_registry()]


def _find(name: str) -> dict | None:
    for entry in build_registry():
        if entry["name"] == name:
            return entry
    return None


def start(name: str) -> dict:
    entry = _find(name)
    if entry is None:
        return {"ok": False, "error": "unknown_service", "service": name,
                "valid_services": [e["name"] for e in build_registry()],
                "services": status()}
    current = _entry_status(entry)
    if not entry.get("managed"):
        return {"ok": True, "note": "self_not_managed_already_running",
                "service": current, **current}
    if current["status"] == "running":
        return {"ok": True, "note": "already_running",
                "service": current, **current}
    blocked = _blocked_reason(entry)
    if blocked:
        # Honest state, never a fake success.
        return {"ok": False, "error": "service_blocked", "detail": blocked,
                "service": current, **current}
    log_file = open(_log_path(name), "ab", buffering=0)
    try:
        proc = subprocess.Popen(
            entry["command"], cwd=entry["cwd"], env=_child_env(entry),
            stdout=log_file, stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL, start_new_session=True)
    except (OSError, ValueError) as exc:
        log_file.close()
        return {"ok": False, "error": f"start_failed:{type(exc).__name__}",
                "detail": str(exc), "service": current, **current}
    _PROCS[name] = {"proc": proc, "started_at": time.time(),
                    "log_file": log_file}
    current = _entry_status(entry)
    return {"ok": True, "service": current, **current}


def stop(name: str) -> dict:
    entry = _find(name)
    if entry is None:
        return {"ok": False, "error": "unknown_service", "service": name,
                "valid_services": [e["name"] for e in build_registry()],
                "services": status()}
    current = _entry_status(entry)
    if not entry.get("managed"):
        return {"ok": False, "error": "self_not_managed",
                "detail": "aegis-daemon is stopped via the kill switch "
                          "(POST /api/kill), not the supervisor.",
                "service": current, **current}
    proc_info = _PROCS.get(name)
    if proc_info is None or proc_info["proc"].poll() is not None:
        return {"ok": True, "note": "not_running",
                "service": current, **current}
    proc = proc_info["proc"]
    try:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=5)
    except OSError as exc:
        return {"ok": False, "error": f"stop_failed:{type(exc).__name__}",
                "detail": str(exc), "service": _entry_status(entry)}
    finally:
        try:
            proc_info["log_file"].close()
        except Exception:
            pass
    current = _entry_status(entry)
    return {"ok": True, "service": current, **current}


def stop_all_managed() -> list[dict]:
    """Kill-switch helper: stop every managed service that is running."""
    results = []
    for entry in build_registry():
        if entry.get("managed"):
            info = _PROCS.get(entry["name"])
            if info is not None and info["proc"].poll() is None:
                results.append(stop(entry["name"]))
    return results
