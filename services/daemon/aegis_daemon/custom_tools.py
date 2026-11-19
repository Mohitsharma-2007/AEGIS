"""User-defined (custom) tools: named, parameterised step sequences.

A custom tool is ``name + description + params + steps`` where each step is
``{tool, args}`` and any string inside a step's args may contain
``{{param}}`` placeholders, substituted from the call's args at run time.

Storage is a ``custom_tools`` table in the SAME SQLite database the daemon's
Store uses (created lazily here via ``store.execute`` -- db.py is not
edited). Execution runs every step through ``tools.dispatch`` with
``confirmed=False``, so mode masks, the kill switch, the permission broker
and the tool_calls log all apply to steps exactly as they do to direct
calls; a step that needs confirmation comes back as the broker's
``permission_required`` error and the custom tool reports which step
blocked instead of escalating itself.

Registration: each saved tool is registered into the live tool registry as
``custom.<slug>`` -- appended to ``tools.DECLARATIONS``, keyed into
``tools.DECL_BY_NAME`` and ``tools.IMPLEMENTATIONS`` (the exact structures
``tools.dispatch`` looks up). Registration happens on creation and again at
startup (module import + ``register_all``). The custom tool's own
declaration carries ``confirmation: "never"`` so dispatch reaches its
executor; step-level confirmations still apply inside. Its scope set is the
union of its steps' scopes and its risk the highest step risk, so the mode
mask for the custom tool honestly reflects what running it can do.
"""
from __future__ import annotations

import json
import re
import threading
import time

from fastapi import APIRouter, Body
from fastapi.responses import JSONResponse

from . import tools as tools_mod
from .db import Store

_lock = threading.Lock()
_ensured_stores: set[int] = set()
_default_store: Store | None = None

_RISK_ORDER = {"low": 0, "medium": 1, "high": 2}
_PLACEHOLDER = re.compile(r"\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}")


# ---------------------------------------------------------------------------
# Storage (lazy, same DB as Store)
# ---------------------------------------------------------------------------


def _ensure_table(store: Store) -> None:
    key = id(store)
    if key in _ensured_stores:
        return
    with _lock:
        if key in _ensured_stores:
            return
        store.execute(
            "CREATE TABLE IF NOT EXISTS custom_tools("
            " slug TEXT PRIMARY KEY, name TEXT NOT NULL,"
            " description TEXT, params TEXT, steps TEXT, created_at REAL)")
        _ensured_stores.add(key)


def get_default_store() -> Store:
    """The router's store: same AEGIS_HOME / aegis.db as the daemon's."""
    global _default_store
    if _default_store is None:
        _default_store = Store()
    return _default_store


def slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", str(name or "").lower()).strip("-")
    return slug or "tool"


def _row_to_tool(row) -> dict:
    return {
        "slug": row["slug"],
        "name": row["name"],
        "tool": f"custom.{row['slug']}",
        "description": row["description"] or "",
        "params": json.loads(row["params"] or "[]"),
        "steps": json.loads(row["steps"] or "[]"),
        "created_at": row["created_at"],
    }


def list_custom_tools(store: Store) -> list[dict]:
    _ensure_table(store)
    return [_row_to_tool(r) for r in
            store.query("SELECT * FROM custom_tools ORDER BY slug")]


def get_custom_tool(store: Store, slug: str) -> dict | None:
    _ensure_table(store)
    row = store.query_one("SELECT * FROM custom_tools WHERE slug=?", (slug,))
    return _row_to_tool(row) if row is not None else None


# ---------------------------------------------------------------------------
# Registry integration
# ---------------------------------------------------------------------------


def _declaration_for(tool_def: dict) -> dict:
    scopes: list[str] = []
    risk = "low"
    for step in tool_def.get("steps") or []:
        step_name = tools_mod.ALIASES.get(step.get("tool"), step.get("tool"))
        decl = tools_mod.DECL_BY_NAME.get(step_name or "")
        if decl is None:
            continue
        for scope in decl["scopes"]:
            if scope not in scopes:
                scopes.append(scope)
        if _RISK_ORDER.get(decl["risk"], 0) > _RISK_ORDER.get(risk, 0):
            risk = decl["risk"]
    if not scopes:
        # A tool whose steps are all unknown still needs a scope set;
        # memory.read keeps it callable in every non-Silent-restricted mode
        # that can read, and its steps will fail honestly as unknown_tool.
        scopes = ["memory.read"]
    args_spec = {name: "string" for name in tool_def.get("params") or []}
    return tools_mod._decl(
        f"custom.{tool_def['slug']}",
        tool_def.get("description") or f"Custom tool: {tool_def['name']}",
        scopes, risk, True, "never", args_spec)


def register_custom_tool(tool_def: dict) -> dict:
    """Insert/replace the tool in the live registry. Thread-safe."""
    decl = _declaration_for(tool_def)
    name = decl["name"]
    slug = tool_def["slug"]
    with _lock:
        existing = tools_mod.DECL_BY_NAME.get(name)
        if existing is not None:
            idx = next((i for i, d in enumerate(tools_mod.DECLARATIONS)
                        if d["name"] == name), None)
            if idx is not None:
                tools_mod.DECLARATIONS[idx] = decl
        else:
            tools_mod.DECLARATIONS.append(decl)
        tools_mod.DECL_BY_NAME[name] = decl
        tools_mod.IMPLEMENTATIONS[name] = (
            lambda store, args, _slug=slug: execute_custom_tool(store, _slug, args))
    return decl


def unregister_custom_tool(slug: str) -> None:
    name = f"custom.{slug}"
    with _lock:
        tools_mod.DECL_BY_NAME.pop(name, None)
        tools_mod.IMPLEMENTATIONS.pop(name, None)
        tools_mod.DECLARATIONS[:] = [
            d for d in tools_mod.DECLARATIONS if d["name"] != name]


def register_all(store: Store) -> list[dict]:
    """Startup hook: register every saved custom tool into the registry."""
    return [register_custom_tool(t) for t in list_custom_tools(store)]


# ---------------------------------------------------------------------------
# CRUD (module API -- also what the router calls)
# ---------------------------------------------------------------------------


def _validate_steps(steps) -> str | None:
    if not isinstance(steps, list) or not steps:
        return "steps must be a non-empty list of {tool, args}"
    for i, step in enumerate(steps):
        if not isinstance(step, dict) or not step.get("tool"):
            return f"step {i} must be an object with a 'tool' name"
        if "args" in step and not isinstance(step["args"], dict):
            return f"step {i} args must be an object"
    return None


def create_custom_tool(store: Store, name: str, description: str = "",
                       params: list | None = None,
                       steps: list | None = None) -> dict:
    _ensure_table(store)
    if not str(name or "").strip():
        return {"ok": False, "error": "invalid_args",
                "detail": "name is required"}
    error = _validate_steps(steps)
    if error:
        return {"ok": False, "error": "invalid_args", "detail": error}
    params = [str(p) for p in (params or [])]
    slug = slugify(name)
    # De-duplicate slugs deterministically: name, name-2, name-3, ...
    candidate, n = slug, 2
    while True:
        row = store.query_one("SELECT slug FROM custom_tools WHERE slug=?",
                              (candidate,))
        if row is None:
            slug = candidate
            break
        candidate = f"{slug}-{n}"
        n += 1
    store.execute(
        "INSERT INTO custom_tools(slug,name,description,params,steps,created_at)"
        " VALUES(?,?,?,?,?,?)",
        (slug, str(name), str(description or ""), json.dumps(params),
         json.dumps(steps), time.time()))
    tool_def = get_custom_tool(store, slug)
    register_custom_tool(tool_def)
    return {"ok": True, **tool_def}


def delete_custom_tool(store: Store, slug: str) -> dict:
    _ensure_table(store)
    # The slug argument is already a registry slug (router path / caller),
    # so it is used verbatim rather than re-slugified.
    row = store.query_one("SELECT slug FROM custom_tools WHERE slug=?", (slug,))
    if row is None:
        return {"ok": False, "error": "not_found", "slug": slug}
    store.execute("DELETE FROM custom_tools WHERE slug=?", (slug,))
    unregister_custom_tool(slug)
    return {"ok": True, "deleted": slug}


# ---------------------------------------------------------------------------
# Execution
# ---------------------------------------------------------------------------


class MissingParam(Exception):
    def __init__(self, param: str):
        super().__init__(param)
        self.param = param


def _substitute(value, params: dict):
    if isinstance(value, str):
        whole = _PLACEHOLDER.fullmatch(value.strip())
        if whole:
            param = whole.group(1)
            if param not in params:
                raise MissingParam(param)
            return params[param]  # raw value: keeps non-string types intact

        def _replace(match: re.Match) -> str:
            param = match.group(1)
            if param not in params:
                raise MissingParam(param)
            return str(params[param])

        return _PLACEHOLDER.sub(_replace, value)
    if isinstance(value, dict):
        return {k: _substitute(v, params) for k, v in value.items()}
    if isinstance(value, list):
        return [_substitute(v, params) for v in value]
    return value


def execute_custom_tool(store: Store, slug: str, args: dict | None = None) -> dict:
    tool_def = get_custom_tool(store, slug)
    if tool_def is None:
        return {"ok": False, "error": "not_found", "slug": slug}
    call_args = dict(args or {})
    results = []
    for i, step in enumerate(tool_def["steps"]):
        step_tool = step.get("tool")
        try:
            step_args = _substitute(step.get("args") or {}, call_args)
        except MissingParam as exc:
            return {"ok": False, "error": "missing_param", "param": exc.param,
                    "blocked_step": i, "step": i, "step_tool": step_tool,
                    "slug": slug, "steps": results}
        # confirmed=False on purpose: the broker decides per step. A step
        # needing confirmation returns permission_required and we surface
        # exactly which step blocked rather than confirming on its behalf.
        result = tools_mod.dispatch(store, step_tool, step_args,
                                    confirmed=False)
        entry = {"step": i, "tool": step_tool, "args": step_args,
                 "ok": bool(result.get("ok")), "status": result.get("status"),
                 "error": result.get("error"), "result": result}
        results.append(entry)
        if not result.get("ok"):
            return {"ok": False, "error": result.get("error") or "step_failed",
                    "blocked_step": i, "step": i, "step_tool": step_tool,
                    "slug": slug, "steps": results}
    last = results[-1]["result"] if results else {}
    return {"ok": True, "slug": slug, "tool": f"custom.{slug}",
            "steps": results, "output": last, "result": last}


# ---------------------------------------------------------------------------
# HTTP router (main.py includes this via its tolerant import hook)
# ---------------------------------------------------------------------------

router = APIRouter()


@router.get("/api/custom-tools")
def api_list_custom_tools():
    store = get_default_store()
    register_all(store)
    tools = list_custom_tools(store)
    return {"ok": True, "custom_tools": tools, "tools": tools,
            "count": len(tools)}


@router.post("/api/custom-tools")
def api_create_custom_tool(body: dict = Body(default_factory=dict)):
    body = body or {}
    result = create_custom_tool(
        get_default_store(),
        name=body.get("name") or "",
        description=body.get("description") or "",
        params=body.get("params") or [],
        steps=body.get("steps") or [])
    if not result.get("ok"):
        return JSONResponse(result, status_code=400)
    return result


@router.delete("/api/custom-tools/{slug}")
def api_delete_custom_tool(slug: str):
    result = delete_custom_tool(get_default_store(), slug)
    if not result.get("ok"):
        return JSONResponse(result, status_code=404)
    return result


# Startup registration: load any tools saved in the daemon's database into
# the live registry. Best-effort only -- a broken/absent DB must never stop
# this module (and therefore the daemon) from importing.
try:  # noqa: SIM105
    register_all(get_default_store())
except Exception:  # pragma: no cover - import must never fail on this
    pass
