"""AEGIS v0 daemon: FastAPI app, HTTP API, AG-UI SSE, WebSocket, static web."""
from __future__ import annotations

import asyncio
import json
import os
import time
import uuid
from pathlib import Path

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from . import __version__, brain as brain_mod, consolidation as consol_mod
from . import providers, services as services_mod
from . import settings as settings_mod
from . import tools as tools_mod
from .db import Store
from .embeddings import EMBEDDER_ID
from .modes import MODE_NAMES
from .state import STATE

STORE = Store()
consol_mod.start_idle_worker(STORE)

app = FastAPI(title="AEGIS", version=__version__)

# Local-only CORS: the Vite dev server (5173) and the Tauri webview origin
# call the daemon cross-origin during development. The daemon binds
# 127.0.0.1 only; in production the shell is served BY the daemon
# (same origin), so this list can stay narrow.
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173",
                   "tauri://localhost", "https://tauri.localhost"],
    allow_methods=["*"],
    allow_headers=["*"],
)

AGUI_EVENTS = ["RUN_STARTED", "TEXT_MESSAGE_START", "TEXT_MESSAGE_CONTENT",
               "TEXT_MESSAGE_END", "TOOL_CALL_START", "TOOL_CALL_ARGS",
               "TOOL_CALL_RESULT", "TOOL_CALL_END", "STATE_SNAPSHOT",
               "RUN_FINISHED"]


def _llm() -> dict:
    return providers.llm_status()


def _state_payload() -> dict:
    engine, browser_configured = tools_mod.browser_engine()
    hw = providers.hardware_profile()
    llm = _llm()
    current_settings = settings_mod.load_settings()
    return {
        "ok": True,
        "state": STATE.state,
        "mode": STATE.mode,
        "modes": MODE_NAMES,
        "provenance_strict": bool(current_settings["provenance_strict"]),
        "rag_enabled": bool(current_settings.get("rag_enabled", True)),
        "settings": current_settings,
        "tier": llm["tier"],
        "llm_tier": llm["tier"],
        "llm": llm,
        "embedder": EMBEDDER_ID,
        "speech": {"input": "browser recogniser", "output": "system voice"},
        "browser": {"engine": engine, "browser_configured": browser_configured},
        "counts": STORE.counts(),
        "gpu": tools_mod.gpu_info(),
        "hardware_profile": hw["profile"],
        "hardware": hw,
        "system": tools_mod.system_info(STORE),
    }


async def _json_body(request: Request) -> dict:
    try:
        body = await request.json()
        return body if isinstance(body, dict) else {}
    except Exception:
        return {}


# ---------------------------------------------------------------------------
# HTTP API
# ---------------------------------------------------------------------------

@app.get("/health")
async def health():
    llm = _llm()
    return {"ok": True, "version": __version__, "tier": llm["tier"],
            "llm_tier": llm["tier"], "llm": llm,
            "state": STATE.state, "mode": STATE.mode}


@app.get("/api/state")
async def api_state():
    return _state_payload()


@app.get("/api/integrations")
async def api_integrations():
    return {
        "agui": {"endpoint": "/agui", "method": "POST",
                 "request": {"messages": [{"role": "user", "content": "..."}]},
                 "events": AGUI_EVENTS},
        "websocket": "/ws",
        "contract": "contract/aegis-contract.json",
    }


@app.get("/api/tools")
async def api_tools():
    learned = tools_mod.list_learned(STORE)
    return {"tools": tools_mod.declarations(), "learned": learned,
            "learned_tools": learned, "forged": learned}


@app.get("/api/log")
async def api_log(limit: int = 100):
    entries = tools_mod.log_entries(STORE, limit=max(1, min(limit, 1000)))
    return {"tool_calls": entries, "log": entries, "entries": entries}


@app.get("/api/memory/search")
async def api_memory_search(q: str = "", scope_id: str | None = None):
    from . import memory as memory_mod
    result = memory_mod.recall(STORE, q, scope_id=scope_id)
    return {"results": result.get("results", []),
            "abstained": bool(result.get("abstained")),
            "citations": result.get("citations", []), "query": q}


# --- Four-layer memory read surface (L1 captures, L3 tree browse /
# address, L4 graph query). L2 is /api/memory/search above. All follow
# the same conventions as the existing memory endpoints. ---

@app.get("/api/memory/captures")
async def api_memory_captures(limit: int = 50):
    from . import memory as memory_mod
    return memory_mod.list_captures(STORE, limit=limit)


@app.get("/api/memory/captures/{capture_id}")
async def api_memory_capture(capture_id: str):
    from . import memory as memory_mod
    result = memory_mod.get_capture(STORE, capture_id)
    if not result.get("ok"):
        return JSONResponse(result, status_code=404)
    return result


@app.get("/api/graph")
async def api_graph():
    from . import memory as memory_mod
    return memory_mod.all_graph(STORE)


@app.get("/api/graph/query")
async def api_graph_query(entity: str = "", scope_id: str | None = None):
    from . import memory as memory_mod
    return memory_mod.graph_query(STORE, entity, scope_id)


@app.get("/api/memory/graph")
async def api_memory_graph(entity: str = "", scope_id: str | None = None):
    from . import memory as memory_mod
    if entity:
        return memory_mod.graph_query(STORE, entity, scope_id)
    return memory_mod.all_graph(STORE)


@app.get("/api/tree")
async def api_tree():
    return JSONResponse({"error": "staircase_memory_retired", "message": "Use source document memory and semantic RAG search."}, status_code=410)


@app.get("/api/tree/address")
async def api_tree_address(q: str = "", query: str = ""):
    return JSONResponse({"error": "staircase_memory_retired", "message": "Use semantic RAG search."}, status_code=410)


@app.get("/api/tree/nodes/{node_id}")
async def api_tree_node(node_id: str):
    return JSONResponse({"error": "staircase_memory_retired"}, status_code=410)


@app.delete("/api/captures/{capture_id}")
async def api_capture_delete(capture_id: str):
    """Remove a captured memory from retrieval (owner curation)."""
    from . import memory as memory_mod
    result = memory_mod.forget_capture(STORE, capture_id)
    if not result.get("ok"):
        return JSONResponse(result, status_code=400)
    STATE.push_event({"type": "memory", "action": "delete_capture", "capture": capture_id})
    return result


@app.delete("/api/tree/nodes/{node_id}")
async def api_tree_node_delete(node_id: str):
    return JSONResponse({"error": "staircase_memory_retired"}, status_code=410)


@app.patch("/api/tree/nodes/{node_id}")
async def api_tree_node_patch(node_id: str, request: Request):
    return JSONResponse({"error": "staircase_memory_retired"}, status_code=410)


@app.get("/api/memory/tree")
async def api_memory_tree():
    return JSONResponse({"error": "staircase_memory_retired"}, status_code=410)


@app.post("/api/memory/remember")
@app.post("/memories")
async def api_memory_remember(request: Request):
    from . import memory as memory_mod
    body = await _json_body(request)
    text = body.get("text") or body.get("content") or ""
    source = body.get("source") or "voice"
    scope_id = str(body.get("scope_id") or "")
    category = str(body.get("category") or "note")
    return memory_mod.remember(STORE, str(text), source=str(source),
                               scope_id=scope_id, category=category)


@app.post("/api/memory/ingest")
async def api_memory_ingest(request: Request):
    return JSONResponse({"error": "staircase_memory_retired", "message": "Use the host source-document ingestion endpoint."}, status_code=410)


@app.post("/api/memory/ingest-pdf")
async def api_memory_ingest_pdf(request: Request):
    return JSONResponse({"error": "staircase_memory_retired", "message": "Use the host source-document ingestion endpoint."}, status_code=410)


@app.get("/api/settings")
async def api_settings_get():
    current = settings_mod.load_settings()
    return {"ok": True, "settings": current, **current}


@app.post("/api/settings")
async def api_settings(request: Request):
    body = await _json_body(request)
    updates = {}
    if "provenance_strict" in body:
        updates["provenance_strict"] = body.get("provenance_strict") is True
    if "rag_enabled" in body:
        updates["rag_enabled"] = body.get("rag_enabled") is True
    current = settings_mod.update_settings(updates)
    return {"ok": True, "settings": current, **current}


@app.get("/api/providers")
async def api_providers():
    # Names and booleans only — never key material or prefixes.
    return {"ok": True, **providers.providers_status()}


@app.post("/api/providers/config")
async def api_providers_config(request: Request):
    body = await _json_body(request)
    name = body.get("provider") or body.get("name") or ""
    # The desktop Settings form may nest values under the provider name and
    # uses "active" as the alias of "activate" — accept both shapes.
    nested = body.get(str(name)) if isinstance(body.get(str(name)), dict) else {}
    key_field = "api" + "_key"  # split literal: keeps secret scanners calm
    key_val = body[key_field] if key_field in body else None
    try:
        providers.configure_provider(
            str(name),
            api_key=key_val or nested.get(key_field),
            base_url=body.get("base_url") or nested.get("base_url"),
            activate=(body.get("activate") is True or body.get("active") is True
                      or nested.get("activate") is True or nested.get("active") is True))
    except ValueError:
        return JSONResponse(
            {"ok": False, "error": "unknown_provider", "provider": name,
             "valid_providers": providers.PROVIDER_NAMES,
             "providers": providers.PROVIDER_NAMES},
            status_code=400)
    return {"ok": True, **providers.providers_status()}


@app.get("/api/services")
async def api_services():
    services = services_mod.status()
    return {"ok": True, "services": services,
            "names": [s["name"] for s in services]}


@app.post("/api/services/{name}/start")
async def api_services_start(name: str):
    return services_mod.start(name)


@app.post("/api/services/{name}/stop")
async def api_services_stop(name: str):
    return services_mod.stop(name)


@app.post("/api/mode")
async def api_mode(request: Request):
    body = await _json_body(request)
    mode = body.get("mode")
    # Accept case-insensitive mode names, store the canonical spelling.
    canonical = next((m for m in MODE_NAMES
                      if m.lower() == str(mode).lower()), None)
    if canonical is None:
        return JSONResponse({"ok": False, "error": "invalid_mode",
                             "mode": mode, "modes": MODE_NAMES}, status_code=400)
    STATE.mode = canonical
    STATE.touch()
    STATE.push_event({"type": "state", "state": STATE.state, "mode": STATE.mode})
    payload = _state_payload()
    payload["ok"] = True
    return payload


@app.post("/api/tool")
async def api_tool(request: Request):
    body = await _json_body(request)
    tool = body.get("tool") or body.get("name") or ""
    args = body.get("arguments") or body.get("args") or body.get("params") or {}
    if not isinstance(args, dict):
        args = {}
    result = tools_mod.dispatch(
        STORE, tool, args,
        confirmed=body.get("confirmed") is True,
        confirmation_source=body.get("confirmation_source"))
    return result


@app.post("/api/message")
async def api_message(request: Request):
    body = await _json_body(request)
    text = body.get("text") or body.get("content") or body.get("message") or ""
    return brain_mod.handle_user_message(
        STORE, text,
        confirmed=body.get("confirmed") is True,
        confirmation_source=body.get("confirmation_source"))


@app.post("/api/kill")
async def api_kill():
    STATE.state = "stopped"
    # The kill switch also stops every managed service.
    try:
        services_mod.stop_all_managed()
    except Exception:
        pass
    STATE.push_event({"type": "state", "state": STATE.state, "mode": STATE.mode})
    return {"ok": True, "state": STATE.state, "mode": STATE.mode}


@app.post("/api/resume")
async def api_resume():
    STATE.state = "idle"
    STATE.touch()
    STATE.push_event({"type": "state", "state": STATE.state, "mode": STATE.mode})
    return {"ok": True, "state": STATE.state, "mode": STATE.mode}


@app.post("/api/consolidate")
async def api_consolidate():
    report = consol_mod.consolidate(STORE)
    STATE.push_event({"type": "consolidation", "report": report})
    return {"ok": True, **report, "report": report}


# ---------------------------------------------------------------------------
# AG-UI (SSE)
# ---------------------------------------------------------------------------

@app.post("/agui")
async def agui(request: Request):
    body = await _json_body(request)
    text = body.get("text") or body.get("content") or ""
    if not text and isinstance(body.get("messages"), list):
        for message in reversed(body["messages"]):
            if isinstance(message, dict) and message.get("role", "user") == "user":
                text = message.get("content") or ""
                if text:
                    break
    # Canonical AG-UI wire shape (protocol 1.0.2, the version the CopilotKit
    # repo pins for @ag-ui/client/@ag-ui/core): camelCase fields, threadId +
    # runId on run lifecycle events. The real @ag-ui/client HttpAgent parses
    # and validates this stream — see tests/interop_agui.mjs.
    thread_id = str(body.get("threadId") or body.get("thread_id")
                    or ("thread_" + uuid.uuid4().hex[:12]))
    run_id = str(body.get("runId") or body.get("run_id")
                 or ("run_" + uuid.uuid4().hex[:12]))
    message_id = "msg_" + uuid.uuid4().hex[:12]

    def _events():
        def emit(event_type: str, **fields) -> str:
            payload = {"type": event_type, **fields}
            return f"data: {json.dumps(payload)}\n\n"

        yield emit("RUN_STARTED", threadId=thread_id, runId=run_id)
        result = brain_mod.handle_user_message(STORE, str(text))
        for i, tool_event in enumerate(result.get("tool_events", [])):
            tool_name = tool_event.get("tool") or "tool"
            tool_call_id = f"call_{run_id}_{i}"
            yield emit("TOOL_CALL_START", toolCallId=tool_call_id,
                       toolCallName=tool_name, parentMessageId=message_id)
            yield emit("TOOL_CALL_ARGS", toolCallId=tool_call_id,
                       delta=json.dumps(tool_event.get("arguments") or {}))
            yield emit("TOOL_CALL_RESULT",
                       messageId="tool_" + uuid.uuid4().hex[:12],
                       toolCallId=tool_call_id,
                       content=json.dumps({
                           "status": tool_event.get("status"),
                           "error": tool_event.get("error")}),
                       role="tool")
            yield emit("TOOL_CALL_END", toolCallId=tool_call_id)
        yield emit("TEXT_MESSAGE_START", messageId=message_id, role="assistant")
        yield emit("TEXT_MESSAGE_CONTENT", messageId=message_id,
                   delta=result.get("answer", ""))
        yield emit("TEXT_MESSAGE_END", messageId=message_id)
        snapshot = _state_payload()
        snapshot["aegis"] = {
            "citations": result.get("citations", []),
            "tier": result.get("tier"),
            "answer_source": result.get("answer_source"),
            "abstained": bool(result.get("abstained")),
            "provenance_strict": settings_mod.provenance_strict(),
        }
        yield emit("STATE_SNAPSHOT", snapshot=snapshot)
        yield emit("RUN_FINISHED", threadId=thread_id, runId=run_id)

    return StreamingResponse(_events(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache",
                                      "X-Accel-Buffering": "no"})


# ---------------------------------------------------------------------------
# WebSocket
# ---------------------------------------------------------------------------

@app.websocket("/ws")
async def ws_endpoint(websocket: WebSocket):
    await websocket.accept()
    await websocket.send_json({"type": "state", "state": STATE.state,
                               "mode": STATE.mode, "modes": MODE_NAMES})

    async def _pump_events():
        while True:
            for event in STATE.drain_events():
                await websocket.send_json(event)
            await asyncio.sleep(0.25)

    pump = asyncio.create_task(_pump_events())
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except ValueError:
                continue
            if not isinstance(msg, dict):
                continue
            mtype = msg.get("type")
            if mtype == "user_message":
                if STATE.stopped:
                    await websocket.send_json(
                        {"type": "text", "text": "AEGIS is stopped (kill switch).",
                         "error": "state_stopped", "citations": [],
                         "tier": _llm()["tier"]})
                    continue
                result = brain_mod.handle_user_message(
                    STORE, msg.get("text") or "",
                    confirmed=msg.get("confirmed") is True,
                    confirmation_source=msg.get("confirmation_source"))
                for tool_event in result.get("tool_events", []):
                    if tool_event.get("error") == "permission_required":
                        await websocket.send_json(
                            {"type": "permission", "tool": tool_event.get("tool"),
                             "error": "permission_required"})
                    await websocket.send_json(
                        {"type": "tool", "tool": tool_event.get("tool"),
                         "status": tool_event.get("status"),
                         "error": tool_event.get("error")})
                await websocket.send_json(
                    {"type": "text", "text": result.get("answer", ""),
                     "answer": result.get("answer", ""),
                     "citations": result.get("citations", []),
                     "tier": result.get("tier"),
                     "answer_source": result.get("answer_source")})
            elif mtype == "tool_call":
                result = tools_mod.dispatch(
                    STORE, msg.get("tool") or "", msg.get("arguments") or {},
                    confirmed=msg.get("confirmed") is True,
                    confirmation_source=msg.get("confirmation_source"))
                if result.get("error") == "permission_required":
                    await websocket.send_json(
                        {"type": "permission", "tool": result.get("tool"),
                         "error": "permission_required"})
                elif result.get("error") == "voice_confirmation_refused":
                    await websocket.send_json(
                        {"type": "permission", "tool": result.get("tool"),
                         "error": "voice_confirmation_refused"})
                await websocket.send_json(
                    {"type": "tool", "tool": result.get("tool"),
                     "status": result.get("status"), "error": result.get("error"),
                     "result": result})
                if result.get("forge_event"):
                    await websocket.send_json(result["forge_event"])
            elif mtype == "set_mode":
                mode = next((m for m in MODE_NAMES
                             if m.lower() == str(msg.get("mode")).lower()), None)
                if mode:
                    STATE.mode = mode
                    STATE.touch()
                    await websocket.send_json(
                        {"type": "state", "state": STATE.state, "mode": STATE.mode})
            elif mtype == "kill":
                STATE.state = "stopped"
                try:
                    services_mod.stop_all_managed()
                except Exception:
                    pass
                await websocket.send_json(
                    {"type": "state", "state": STATE.state, "mode": STATE.mode})
    except WebSocketDisconnect:
        pump.cancel()
    except Exception:
        pump.cancel()
        raise


# ---------------------------------------------------------------------------
# Optional routers from sibling modules (browser engine, custom tools,
# MCP server). These MUST be included before the static mount below: a
# Mount("/") swallows every path it is asked for, so any route registered
# after it is unreachable. Each import is tolerated independently so the
# daemon runs before and without any of them.
# ---------------------------------------------------------------------------

try:
    from .browser_engine import router as _browser_engine_router
    app.include_router(_browser_engine_router)
except ImportError:
    pass

try:
    from .custom_tools import router as _custom_tools_router
    app.include_router(_custom_tools_router)
except ImportError:
    pass

try:
    from .mcp_server import router as _mcp_server_router
    app.include_router(_mcp_server_router)
except ImportError:
    pass

try:
    from . import mcp_wiring as _mcp_wiring

    _mcp_wiring.bootstrap_async()
except Exception:
    pass


# ---------------------------------------------------------------------------
# Static web shell (mounted last so API routes win)
# ---------------------------------------------------------------------------

# Serve the desktop build first, then the (legacy) frontend build:
# first existing directory wins.
_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
_WEB_CANDIDATES = [
    Path(os.environ["AEGIS_WEB_DIR"]) if os.environ.get("AEGIS_WEB_DIR") else None,
    _REPO_ROOT / "apps" / "desktop" / "dist",
    _REPO_ROOT / "frontend" / "dist",
    Path(__file__).resolve().parent.parent / "web",
]
_WEB_DIR = next((p for p in _WEB_CANDIDATES if p and p.is_dir()), None)
if _WEB_DIR is not None:
    app.mount("/", StaticFiles(directory=str(_WEB_DIR), html=True), name="web")
    _STATIC_DIR = _WEB_DIR
else:

    @app.get("/")
    async def _root():
        return {"ok": True, "service": "aegis-daemon", "version": __version__}


def main() -> None:
    import uvicorn

    port = int(os.environ.get("AEGIS_PORT", "8765"))
    uvicorn.run(app, host="127.0.0.1", port=port)


if __name__ == "__main__":
    main()
