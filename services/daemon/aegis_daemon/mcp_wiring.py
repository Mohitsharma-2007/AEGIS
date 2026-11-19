"""MCP -> daemon tool-registry wiring (coordinator integration glue).

Task D delivered the MCP client manager (mcp_client.McpManager) and the
HTTP router (mcp_server.router, whose module-level manager is the shared
instance). This module connects imported MCP tools into the daemon's own
tool registry so they flow through the SAME governance as native tools:

- each imported tool is registered in tools.DECLARATIONS / DECL_BY_NAME /
  IMPLEMENTATIONS under its ``mcp.<server>.<tool>`` name;
- its declaration carries the per-server scope ``mcp.<server>`` and
  confirmation ``always`` (foreign side effects are unknown — the broker
  asks every time, voice confirmation is refused by dispatch as usual);
- that scope is granted to the **Operator** mode only: MCP tools are
  deliberately NOT available in Assistant/Browser/Memory/Silent, so a
  foreign tool can never fire from casual chat modes;
- execution goes to McpManager.call_tool_direct — dispatch has already
  applied mode mask, kill switch, confirmation and the action log.

sync() is idempotent and is called (a) from a background bootstrap thread
at daemon start (connect_all for pre-configured servers) and (b) by the
/api/mcp/servers POST handler after a server is added at runtime.
"""
from __future__ import annotations

import threading

from . import modes as modes_mod
from . import tools as tools_mod

_lock = threading.Lock()


def _make_impl(manager, full_name: str):
    def _impl(store, args):
        result = manager.call_tool_direct(full_name, args or {})
        if not isinstance(result, dict):
            return {"ok": False, "error": "mcp_bad_result", "value": result}
        return result

    return _impl


def sync(manager) -> list[str]:
    """Register all currently-imported MCP tools into the registry.

    Returns the list of registered tool names. Safe to call repeatedly.
    """
    with _lock:
        decls = manager.register_into(tools_mod.DECLARATIONS)
        manager.register_into(tools_mod.DECL_BY_NAME)
        for decl in decls:
            name = decl["name"]
            tools_mod.IMPLEMENTATIONS[name] = _make_impl(manager, name)
            for scope in decl.get("scopes") or []:
                modes_mod.MODES["Operator"].add(scope)
        return [d["name"] for d in decls]


def bootstrap_async() -> None:
    """Background: connect pre-configured MCP servers, then sync tools.

    Runs in a daemon thread so a slow/hung foreign server can never block
    daemon startup; failures surface via the manager's status() (and thus
    GET /api/mcp/servers), never silently.
    """

    def _run() -> None:
        try:
            from .mcp_server import get_manager

            manager = get_manager()
            manager.connect_all()
            sync(manager)
        except Exception:
            pass

    threading.Thread(target=_run, name="mcp-bootstrap", daemon=True).start()
