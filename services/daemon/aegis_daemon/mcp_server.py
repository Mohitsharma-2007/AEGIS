"""AEGIS as an MCP server, plus the daemon's /api/mcp/* HTTP router.

Two faces:

1. **stdio MCP server** — ``python -m aegis_daemon.mcp_server`` speaks MCP
   (official SDK, FastMCP) on stdio, so any MCP client (another agent, an
   IDE, AEGIS's own McpManager) can use a safe subset of AEGIS's tools.

2. **HTTP router** — ``router`` is included by main.py and exposes the
   McpManager (see mcp_client.py) to the app:
   ``GET/POST /api/mcp/servers``, ``DELETE /api/mcp/servers/{name}``,
   ``GET /api/mcp/tools``.

Exposed subset, and why it is exactly this subset
-------------------------------------------------
Exposed: memory.remember, memory.recall, memory.forget, graph.query,
system.info, file.list, file.read.

Every call goes through ``tools.dispatch(..., confirmed=False)`` — the
daemon's own permission broker — never straight to an implementation.
The subset is limited to read/memory tools whose scopes sit inside the
default Assistant mode mask. Tools that write files, launch apps, touch
the clipboard/screen or browse (file.write, file.append, os.*, browser.*)
are deliberately NOT exposed: an external MCP client driving them would
need the daemon's interactive confirmation flow, which cannot be granted
through this server (dispatch is called with confirmed=False, and voice
confirmation is refused by the broker anyway).

Consequences of confirmed=False, by design:

- ``memory.forget`` (confirmation: always) and ``file.read``
  (once_per_session) are listed because they belong to the safe
  read/memory surface, but the broker answers them with
  ``permission_required`` instead of executing until the daemon itself
  has confirmed the tool in-session. They can never execute silently
  just because an MCP client asked.
- The remaining five tools have confirmation policy "never" and execute
  normally through the broker (mode mask + tool-call log included).
"""
from __future__ import annotations

import json
import os
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from mcp.server.fastmcp import FastMCP

from . import tools as tools_mod
from .db import Store, aegis_home
from .mcp_client import McpManager

# ---------------------------------------------------------------------------
# Daemon access (lazy: importing this module must not create a Store, so
# main.py can include the router before/without touching the DB, and the
# stdio server only pays for a Store when a tool is actually called).
# ---------------------------------------------------------------------------

_STORE: Store | None = None


def _store() -> Store:
    global _STORE
    if _STORE is None:
        _STORE = Store()
    return _STORE


def _dispatch(tool: str, args: dict) -> dict:
    """Run one exposed tool through the permission broker, unconfirmed."""
    result = tools_mod.dispatch(_store(), tool, args or {}, confirmed=False)
    # Guarantee JSON-serialisability for the MCP wire.
    return json.loads(json.dumps(result, default=str))


# ---------------------------------------------------------------------------
# 1. stdio MCP server (FastMCP)
# ---------------------------------------------------------------------------

mcp = FastMCP("aegis", log_level="ERROR")


@mcp.tool(name="memory.remember",
          description="Write a capture + memory with provenance")
def memory_remember(text: str, source: str = "mcp", scope_id: str = "",
                    category: str = "note") -> dict:
    args = {"text": text, "source": source, "category": category}
    if scope_id:
        args["scope_id"] = scope_id
    return _dispatch("memory.remember", args)


@mcp.tool(name="memory.recall",
          description="Hybrid retrieval over AEGIS memory, with abstention")
def memory_recall(query: str) -> dict:
    return _dispatch("memory.recall", {"query": query})


@mcp.tool(name="memory.forget",
          description="Tombstone a memory (capture stays auditable). "
                      "Broker-gated: returns permission_required unless the "
                      "daemon session has confirmed this tool.")
def memory_forget(memory_id: str = "", capture_id: str = "") -> dict:
    args: dict = {}
    if memory_id:
        args["memory_id"] = memory_id
    if capture_id:
        args["capture_id"] = capture_id
    return _dispatch("memory.forget", args)


@mcp.tool(name="graph.query",
          description="Current + historical graph edges for an entity")
def graph_query(entity: str, scope_id: str = "") -> dict:
    args = {"entity": entity}
    if scope_id:
        args["scope_id"] = scope_id
    return _dispatch("graph.query", args)


@mcp.tool(name="system.info",
          description="Real host information (platform, CPU, memory, disk)")
def system_info() -> dict:
    return _dispatch("system.info", {})


@mcp.tool(name="file.list",
          description="List files under the AEGIS workspace root")
def file_list(path: str = "") -> dict:
    return _dispatch("file.list", {"path": path})


@mcp.tool(name="file.read",
          description="Read a file under the AEGIS workspace root. "
                      "Broker-gated once per session (permission_required "
                      "until confirmed in the daemon).")
def file_read(path: str) -> dict:
    return _dispatch("file.read", {"path": path})


def main() -> None:
    mcp.run(transport="stdio")


# ---------------------------------------------------------------------------
# 2. HTTP router for the app (McpManager administration)
# ---------------------------------------------------------------------------

router = APIRouter()

_MANAGER: McpManager | None = None


def _manager() -> McpManager:
    """Module-level manager bound to the daemon's AEGIS_HOME (db.aegis_home
    honours the AEGIS_HOME env var, same as Store). Created lazily so
    importing this module never spawns threads or subprocesses."""
    global _MANAGER
    if _MANAGER is None:
        _MANAGER = McpManager(home=aegis_home())
    return _MANAGER


def get_manager() -> McpManager:
    return _manager()


@router.get("/api/mcp/servers")
async def api_mcp_servers():
    manager = _manager()
    return {"ok": True, "servers": manager.status(),
            "configs": manager.configs()}


@router.post("/api/mcp/servers")
async def api_mcp_add_server(request: Request):
    try:
        body = await request.json()
    except Exception:
        body = {}
    if not isinstance(body, dict):
        body = {}
    cfg = {"name": body.get("name"), "command": body.get("command"),
           "args": body.get("args") or [],
           "env_names": body.get("env_names") or body.get("envNames") or []}
    try:
        entry = _manager().add_server(cfg)
    except ValueError as exc:
        return JSONResponse({"ok": False, "error": "invalid_config",
                             "detail": str(exc)}, status_code=400)
    except Exception as exc:
        return JSONResponse({"ok": False, "error": f"{type(exc).__name__}: {exc}"},
                            status_code=500)
    if entry.get("status") == "connected":
        try:
            from . import mcp_wiring

            mcp_wiring.sync(_manager())
        except Exception:
            pass
    return {"ok": entry.get("status") == "connected", "server": entry,
            "servers": _manager().status()}


@router.delete("/api/mcp/servers/{name}")
async def api_mcp_remove_server(name: str):
    if not _manager().remove_server(name):
        return JSONResponse({"ok": False, "error": "unknown_server",
                             "name": name}, status_code=404)
    return {"ok": True, "removed": name, "servers": _manager().status()}


@router.get("/api/mcp/tools")
async def api_mcp_tools():
    manager = _manager()
    return {"ok": True, "tools": manager.list_imported_tools(),
            "declarations": manager.declarations()}


if __name__ == "__main__":
    main()
