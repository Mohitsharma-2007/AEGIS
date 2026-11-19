"""MCP client: import tools from external MCP servers into AEGIS.

Uses the official MCP Python SDK (v1 API, pinned ``mcp<2`` in
requirements.txt): ``mcp.client.stdio.stdio_client`` + ``mcp.ClientSession``
over stdio transport.

Config
------
Servers are stored in ``<AEGIS_HOME>/mcp_servers.json`` as a JSON list::

    [{"name": "test", "command": "python3",
      "args": ["server.py"], "env_names": ["SOME_API_KEY"]}]

``env_names`` lists environment variable NAMES only. The values are pulled
from ``os.environ`` at connect time — config files never store secrets.

Permission path (important)
---------------------------
``McpManager.call_tool`` does NOT have to execute a foreign tool directly.
When the manager is wired into the daemon, the coordinator passes a
``through_dispatch`` callback; ``call_tool`` then delegates to it::

    through_dispatch(full_name, args) -> dict

so the call routes through ``tools.dispatch`` and the daemon's mode mask,
permission broker and append-only tool-call log all apply, exactly as for
native tools. The dispatch layer performs the actual execution by calling
``manager.call_tool_direct(full_name, args)`` once the broker approves.

Standalone (tests, scripts) no callback is wired, and ``call_tool`` calls
``call_tool_direct`` itself. ``register_into(registry)`` produces
declaration dicts in the exact shape of ``tools._decl`` / ``DECLARATIONS``
so imported tools can be registered alongside native ones.

Threading
---------
stdio sessions are async context managers that must live on one event
loop. The manager therefore owns a dedicated daemon thread running its
own asyncio loop; every connection lives and dies on that loop, and all
public methods are thread-safe synchronous wrappers around
``asyncio.run_coroutine_threadsafe``.
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import threading
from contextlib import AsyncExitStack
from pathlib import Path

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import get_default_environment, stdio_client

try:  # Normal package import (daemon runtime, tests with daemon/ on path).
    from .db import aegis_home
except ImportError:  # pragma: no cover - direct module import fallback
    def aegis_home() -> Path:  # type: ignore[misc]
        env = os.environ.get("AEGIS_HOME")
        if env:
            return Path(env).expanduser()
        return Path(__file__).resolve().parent.parent / "data"

CONFIG_FILENAME = "mcp_servers.json"
_NAME_RE = re.compile(r"^[A-Za-z0-9_-]+$")
DEFAULT_CALL_TIMEOUT = 30.0
DEFAULT_CONNECT_TIMEOUT = 30.0


# ---------------------------------------------------------------------------
# Config helpers
# ---------------------------------------------------------------------------

def _normalise_config(cfg: dict) -> dict:
    """Validate + normalise one server config entry. Raises ValueError."""
    if not isinstance(cfg, dict):
        raise ValueError("server config must be an object")
    name = str(cfg.get("name") or "").strip()
    command = str(cfg.get("command") or "").strip()
    if not name:
        raise ValueError("server config missing 'name'")
    if not _NAME_RE.match(name):
        raise ValueError(
            f"invalid server name {name!r}: letters, digits, '_' and '-' only "
            "(the name becomes one dot-separated namespace component)")
    if not command:
        raise ValueError(f"server {name!r} missing 'command'")
    args = cfg.get("args") or []
    if not isinstance(args, list):
        raise ValueError(f"server {name!r}: 'args' must be a list")
    env_names = cfg.get("env_names") or []
    if not isinstance(env_names, list):
        raise ValueError(f"server {name!r}: 'env_names' must be a list")
    return {"name": name, "command": command,
            "args": [str(a) for a in args],
            "env_names": [str(n) for n in env_names]}


def _env_for(cfg: dict) -> dict:
    """Build the subprocess environment: SDK safe defaults + the values of
    the variables named in ``env_names``, pulled from os.environ NOW."""
    env = dict(get_default_environment())
    for name in cfg.get("env_names") or []:
        if name in os.environ:
            env[name] = os.environ[name]
    return env


def _result_to_dict(full_name: str, result) -> dict:
    """Convert an SDK CallToolResult into a plain, JSON-friendly dict."""
    content: list[dict] = []
    texts: list[str] = []
    for item in getattr(result, "content", []) or []:
        if hasattr(item, "model_dump"):
            content.append(item.model_dump(mode="json"))
        else:
            content.append({"type": "unknown", "value": str(item)})
        if getattr(item, "type", None) == "text":
            texts.append(str(getattr(item, "text", "")))
    out = {
        "ok": not bool(getattr(result, "isError", False)),
        "tool": full_name,
        "content": content,
        "text": "\n".join(texts),
        "isError": bool(getattr(result, "isError", False)),
    }
    structured = getattr(result, "structuredContent", None)
    if structured is not None:
        out["structuredContent"] = structured
        # FastMCP wraps scalar returns as {"result": value}.
        if isinstance(structured, dict) and set(structured) == {"result"}:
            out["value"] = structured["result"]
    if out["isError"]:
        out["error"] = out["text"] or "mcp_tool_error"
    return out


class _Connection:
    __slots__ = ("cfg", "stack", "session", "tools", "status", "error")

    def __init__(self, cfg: dict):
        self.cfg = cfg
        self.stack: AsyncExitStack | None = None
        self.session: ClientSession | None = None
        self.tools: list[dict] = []
        self.status = "configured"  # configured | connected | error
        self.error: str | None = None


# ---------------------------------------------------------------------------
# Manager
# ---------------------------------------------------------------------------

class McpManager:
    """Owns every imported MCP server connection.

    Parameters
    ----------
    home: AEGIS_HOME directory (defaults to ``db.aegis_home()``).
    through_dispatch: optional callback ``(full_name, args) -> dict``.
        When set, ``call_tool`` delegates to it (daemon permission path —
        see module docstring); the callback's execution step should call
        ``call_tool_direct``.
    """

    def __init__(self, home: Path | str | None = None, through_dispatch=None):
        self.home = Path(home) if home else aegis_home()
        self.config_path = self.home / CONFIG_FILENAME
        self.through_dispatch = through_dispatch
        self._configs: dict[str, dict] = {}
        self._conns: dict[str, _Connection] = {}
        self._lock = threading.Lock()
        self._loop: asyncio.AbstractEventLoop | None = None
        self._thread: threading.Thread | None = None
        self._loop_ready = threading.Event()
        self._load_configs()

    # -- config persistence -------------------------------------------------

    def _load_configs(self) -> None:
        self._configs = {}
        try:
            raw = json.loads(self.config_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return
        if isinstance(raw, list):
            for entry in raw:
                try:
                    cfg = _normalise_config(entry)
                except ValueError:
                    continue  # a bad entry must not break the whole file
                self._configs[cfg["name"]] = cfg

    def _save_configs(self) -> None:
        self.home.mkdir(parents=True, exist_ok=True)
        tmp = self.config_path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(list(self._configs.values()), indent=2),
                       encoding="utf-8")
        tmp.replace(self.config_path)

    def configs(self) -> list[dict]:
        with self._lock:
            return [dict(c) for c in self._configs.values()]

    # -- event-loop thread ----------------------------------------------------

    def _ensure_loop(self) -> asyncio.AbstractEventLoop:
        if self._thread is not None and self._thread.is_alive():
            return self._loop  # type: ignore[return-value]
        self._loop_ready.clear()

        def _run() -> None:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            self._loop = loop
            self._loop_ready.set()
            try:
                loop.run_forever()
            finally:
                loop.close()

        self._thread = threading.Thread(
            target=_run, name="aegis-mcp-loop", daemon=True)
        self._thread.start()
        if not self._loop_ready.wait(timeout=10):
            raise RuntimeError("mcp event loop thread failed to start")
        return self._loop  # type: ignore[return-value]

    def _run_coro(self, coro, timeout: float):
        loop = self._ensure_loop()
        fut = asyncio.run_coroutine_threadsafe(coro, loop)
        return fut.result(timeout=timeout)

    # -- async internals (run on the manager loop only) -----------------------

    async def _connect_one(self, cfg: dict) -> _Connection:
        name = cfg["name"]
        old = self._conns.get(name)
        if old is not None and old.status == "connected":
            return old
        conn = _Connection(cfg)
        self._conns[name] = conn
        stack = AsyncExitStack()
        conn.stack = stack
        try:
            params = StdioServerParameters(
                command=cfg["command"], args=cfg["args"], env=_env_for(cfg))
            read, write = await stack.enter_async_context(stdio_client(params))
            session = await stack.enter_async_context(ClientSession(read, write))
            await session.initialize()
            listed = await session.list_tools()
            conn.session = session
            conn.tools = [{
                "name": f"mcp.{name}.{t.name}",
                "server": name,
                "tool": t.name,
                "description": t.description or "",
                "inputSchema": t.inputSchema or {},
            } for t in listed.tools]
            conn.status = "connected"
            conn.error = None
        except Exception as exc:
            conn.status = "error"
            conn.error = f"{type(exc).__name__}: {exc}"
            conn.session = None
            try:
                await stack.aclose()
            except Exception:
                pass
            conn.stack = None
        return conn

    async def _disconnect_one(self, name: str) -> None:
        conn = self._conns.pop(name, None)
        if conn is None:
            return
        conn.status = "configured"
        conn.session = None
        if conn.stack is not None:
            try:
                await conn.stack.aclose()
            except Exception:
                pass
            conn.stack = None

    async def _call_direct(self, full_name: str, args: dict,
                           timeout: float) -> dict:
        parsed = parse_full_name(full_name)
        if parsed is None:
            return {"ok": False, "error": "invalid_tool_name", "tool": full_name}
        server, tool = parsed
        conn = self._conns.get(server)
        if conn is None or conn.session is None or conn.status != "connected":
            return {"ok": False, "error": "mcp_server_not_connected",
                    "tool": full_name, "server": server}
        try:
            result = await asyncio.wait_for(
                conn.session.call_tool(tool, args or {}), timeout=timeout)
        except asyncio.TimeoutError:
            return {"ok": False, "error": "mcp_call_timeout",
                    "tool": full_name, "timeout": timeout}
        except Exception as exc:
            return {"ok": False, "error": f"{type(exc).__name__}: {exc}",
                    "tool": full_name}
        return _result_to_dict(full_name, result)

    # -- public sync API ------------------------------------------------------

    def connect_all(self, timeout: float = DEFAULT_CONNECT_TIMEOUT) -> list[dict]:
        """Connect every configured server; returns status()."""
        for cfg in self.configs():
            try:
                self._run_coro(self._connect_one(cfg),
                               timeout=timeout + 5)
            except Exception:
                pass  # per-server error is recorded on the connection
        return self.status()

    def add_server(self, cfg: dict,
                   timeout: float = DEFAULT_CONNECT_TIMEOUT) -> dict:
        """Persist a server config and attempt to connect. Returns the
        server's status entry."""
        cfg = _normalise_config(cfg)
        with self._lock:
            self._configs[cfg["name"]] = cfg
            self._save_configs()
        # Reconnect fresh if a stale connection exists under this name.
        if cfg["name"] in self._conns:
            try:
                self._run_coro(self._disconnect_one(cfg["name"]), timeout=10)
            except Exception:
                pass
        self._run_coro(self._connect_one(cfg), timeout=timeout + 5)
        for entry in self.status():
            if entry["name"] == cfg["name"]:
                return entry
        return {"name": cfg["name"], "status": "error",
                "error": "connect_failed", "tool_count": 0, "tools": []}

    def remove_server(self, name: str) -> bool:
        """Disconnect and forget a server. False if it wasn't configured."""
        with self._lock:
            existed = self._configs.pop(name, None) is not None
            if existed:
                self._save_configs()
        if name in self._conns:
            try:
                self._run_coro(self._disconnect_one(name), timeout=10)
            except Exception:
                pass
        return existed

    def status(self) -> list[dict]:
        """Per-server status: configured / connected / error + tool count."""
        entries = []
        names = list(self._configs.keys())
        for name in list(self._conns.keys()):
            if name not in self._configs:
                names.append(name)
        for name in names:
            conn = self._conns.get(name)
            cfg = self._configs.get(name)
            if conn is None:
                entries.append({
                    "name": name, "status": "configured", "error": None,
                    "tool_count": 0, "tools": [],
                    "command": cfg["command"] if cfg else None,
                    "args": cfg["args"] if cfg else [],
                })
            else:
                entries.append({
                    "name": name, "status": conn.status, "error": conn.error,
                    "tool_count": len(conn.tools),
                    "tools": [t["name"] for t in conn.tools],
                    "command": conn.cfg["command"], "args": conn.cfg["args"],
                })
        return entries

    def list_imported_tools(self) -> list[dict]:
        """All tools from connected servers, namespaced mcp.<server>.<tool>,
        each with description + inputSchema."""
        tools: list[dict] = []
        for conn in self._conns.values():
            if conn.status == "connected":
                tools.extend(dict(t) for t in conn.tools)
        return tools

    def call_tool_direct(self, full_name: str, args: dict | None = None,
                         timeout: float = DEFAULT_CALL_TIMEOUT) -> dict:
        """Execute an imported tool on its MCP server, bypassing the
        daemon broker. This is the execution step ``tools.dispatch`` calls
        after approval — user-facing code should use ``call_tool``."""
        return self._run_coro(
            self._call_direct(full_name, args or {}, timeout),
            timeout=timeout + 5)

    def call_tool(self, full_name: str, args: dict | None = None,
                  timeout: float = DEFAULT_CALL_TIMEOUT) -> dict:
        """Call an imported tool.

        If a ``through_dispatch`` callback is wired (daemon mode), the
        call is delegated to it so mode/permission/log apply; otherwise
        (standalone/tests) the tool is executed directly.
        """
        args = args or {}
        if self.through_dispatch is not None:
            return self.through_dispatch(full_name, args)
        return self.call_tool_direct(full_name, args, timeout=timeout)

    def declarations(self) -> list[dict]:
        """Declaration dicts for all imported tools, in tools.py's
        ``_decl`` shape (see register_into)."""
        decls = []
        for tool in self.list_imported_tools():
            schema = tool.get("inputSchema") or {}
            props = schema.get("properties") or {}
            required = set(schema.get("required") or [])
            arguments = {}
            for prop, spec in props.items():
                ptype = (spec or {}).get("type", "string")
                arguments[prop] = ptype if prop in required else f"{ptype}?"
            decls.append({
                "name": tool["name"], "tool": tool["name"],
                "description": tool.get("description", ""),
                # Foreign tools are not covered by any native scope set;
                # they get their own per-server scope so mode masks stay
                # explicit and the coordinator can grant it deliberately.
                "scopes": [f"mcp.{tool['server']}"],
                # Unknown side effects: treat as medium risk, and always
                # ask — the broker (via through_dispatch) enforces this.
                "risk": "medium", "reversible": True,
                "confirmation": "always", "confirmation_policy": "always",
                "arguments": arguments,
                "inputSchema": schema,
                "mcp": {"server": tool["server"], "tool": tool["tool"]},
            })
        return decls

    def register_into(self, registry) -> list[dict]:
        """Register imported tools into a tools.py-shaped registry.

        ``registry`` may be a list (declarations are appended, like
        ``tools.DECLARATIONS``) or a dict (keyed by name, like
        ``tools.DECL_BY_NAME``). Returns the declaration dicts added.
        Existing entries with the same name are replaced, so re-registering
        after a reconnect is safe.
        """
        decls = self.declarations()
        if isinstance(registry, dict):
            for decl in decls:
                registry[decl["name"]] = decl
        elif isinstance(registry, list):
            names = {d["name"] for d in decls}
            registry[:] = [d for d in registry
                           if not (isinstance(d, dict) and d.get("name") in names)]
            registry.extend(decls)
        else:
            raise TypeError("registry must be a list (DECLARATIONS) or "
                            "dict (DECL_BY_NAME)")
        return decls

    def shutdown(self) -> None:
        """Disconnect all servers and stop the event-loop thread."""
        if self._thread is None or not self._thread.is_alive():
            return
        try:
            async def _close_all():
                for name in list(self._conns.keys()):
                    await self._disconnect_one(name)
            self._run_coro(_close_all(), timeout=15)
        except Exception:
            pass
        if self._loop is not None:
            self._loop.call_soon_threadsafe(self._loop.stop)
        self._thread.join(timeout=10)
        self._thread = None
        self._loop = None

    close = shutdown

    def __enter__(self) -> "McpManager":
        return self

    def __exit__(self, *exc) -> None:
        self.shutdown()


def parse_full_name(full_name: str) -> tuple[str, str] | None:
    """'mcp.<server>.<tool...>' -> (server, tool). Tool names may contain
    dots; server names may not (enforced by _NAME_RE)."""
    parts = str(full_name or "").split(".", 2)
    if len(parts) != 3 or parts[0] != "mcp" or not parts[1] or not parts[2]:
        return None
    return parts[1], parts[2]
