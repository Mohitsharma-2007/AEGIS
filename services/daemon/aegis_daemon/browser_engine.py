"""Browser engine for the daemon tools — Playwright only.

AEGIS's browser is the AEGIS Computer browser: a local Playwright Chromium
run by the host's browser service (apps/host/src/browser, port 4311). The
Obscura engine (CDP binary, tools-bin/obscura) has been removed entirely.

This module is the daemon's client for that service:

* `navigate(url)` / `screenshot(url)` call the host browser service's
  `/browse` endpoint and surface its real result.
* `fetch(url)` falls back to plain urllib for text when the browser service
  is not configured, labelled `urllib`.
* `click` / `type` return an honest error: interactive browser control lives
  in the AEGIS Computer surface (host), not in a daemon CDP session.

Everything here is read-only or honest: a result always says which engine
actually did the work (`engine` / `engine_detail`), and no page state is
ever fabricated.
"""
from __future__ import annotations

import json
import logging
import os
import re
import urllib.request
from pathlib import Path

from fastapi import APIRouter, Body
from fastapi.responses import FileResponse, JSONResponse

from .db import aegis_home

logger = logging.getLogger("aegis.browser_engine")

# ---------------------------------------------------------------------------
# Host browser service configuration
# ---------------------------------------------------------------------------


def browser_service_url() -> str | None:
    """The host browser service base URL, or None when not configured."""
    raw = (
        os.environ.get("AEGIS_BROWSER_URL")
        or os.environ.get("BROWSER_URL")
        or os.environ.get("AEGIS_HOST_URL")
    )
    if not raw:
        return None
    return str(raw).rstrip("/")


def browser_service_secret() -> str | None:
    return os.environ.get("AEGIS_BROWSER_SECRET") or os.environ.get(
        "BROWSER_SECRET"
    )


def _preview_path() -> Path:
    path = aegis_home() / "browser" / "preview.png"
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def _post_browse(url: str) -> dict:
    """Call the host browser service /browse and return its JSON body."""
    base = browser_service_url()
    secret = browser_service_secret()
    if not base or not secret:
        return {
            "ok": False,
            "error": "browser_service_not_configured",
            "detail": (
                "The AEGIS Computer browser service is not configured. "
                "Set BROWSER_URL/BROWSER_SECRET (or AEGIS_BROWSER_URL/"
                "AEGIS_BROWSER_SECRET) in .env.local and restart."
            ),
        }
    request = urllib.request.Request(
        f"{base}/browse",
        data=json.dumps({"url": url}).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {secret}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            return json.loads(response.read().decode("utf-8", errors="replace"))
    except Exception as exc:
        return {
            "ok": False,
            "error": f"browse_failed:{type(exc).__name__}",
            "detail": str(exc),
        }


def _strip_html(raw: str) -> str:
    text = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", raw, flags=re.S | re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", text).strip()


# ---------------------------------------------------------------------------
# Page state (module level, lock guarded)
# ---------------------------------------------------------------------------

import threading  # noqa: E402 - after helpers for readability

_state_lock = threading.Lock()
_page_state: dict = {
    "current_url": None,
    "title": None,
    "text_excerpt": None,
    "screenshot_path": None,
    "engine": "playwright",
    "engine_detail": "AEGIS Computer browser (Playwright) via host service",
}


def _update_state(**fields) -> None:
    with _state_lock:
        _page_state.update(fields)


def get_state() -> dict:
    with _state_lock:
        state = dict(_page_state)
    screenshot = state.get("screenshot_path")
    return {
        "url": state.get("current_url"),
        "current_url": state.get("current_url"),
        "title": state.get("title"),
        "text_excerpt": state.get("text_excerpt"),
        "engine": state.get("engine"),
        "engine_detail": state.get("engine_detail"),
        "screenshot_path": screenshot,
        "has_preview": bool(screenshot and Path(screenshot).is_file()),
        "browser_service": browser_service_url(),
    }


# ---------------------------------------------------------------------------
# Public operations (used by the tools in tools.py and by tests directly)
# ---------------------------------------------------------------------------


def navigate(url: str) -> dict:
    url = str(url or "").strip()
    if not re.match(r"^https?://", url):
        return {"ok": False, "error": "invalid_url", "url": url}
    result = _post_browse(url)
    if not result.get("ok"):
        return {**result, "url": url, "engine": "playwright"}
    screenshot = result.get("screenshot")
    screenshot_path = None
    if screenshot and str(screenshot).startswith("data:"):
        import base64

        try:
            data = str(screenshot).split(",", 1)[1]
            path = _preview_path()
            path.write_bytes(base64.b64decode(data))
            screenshot_path = str(path)
        except Exception as exc:  # pragma: no cover - decoding guard
            logger.warning("Could not persist browser preview: %s", exc)
    text = result.get("text") or ""
    _update_state(
        current_url=result.get("url") or url,
        title=result.get("title"),
        text_excerpt=text[:2000] or None,
        screenshot_path=screenshot_path,
        engine="playwright",
        engine_detail="AEGIS Computer browser (Playwright) via host service",
    )
    return {
        "ok": True,
        "url": result.get("url") or url,
        "title": result.get("title"),
        "engine": "playwright",
        "engine_detail": "AEGIS Computer browser (Playwright) via host service",
        "text": text[:20000],
        "text_excerpt": text[:2000],
        "screenshot_path": screenshot_path,
        "browser_binary": result.get("browserBinary"),
    }


def screenshot(url: str) -> dict:
    url = str(url or "").strip()
    if not re.match(r"^https?://", url):
        return {"ok": False, "error": "invalid_url", "url": url}
    result = _post_browse(url)
    if not result.get("ok"):
        return {**result, "url": url, "engine": "playwright"}
    screenshot = result.get("screenshot")
    out_path = None
    if screenshot and str(screenshot).startswith("data:"):
        import base64

        try:
            data = str(screenshot).split(",", 1)[1]
            out_path = Path(os.environ.get("AEGIS_WORKSPACE", ".")) / "screenshot.png"
            out_path.write_bytes(base64.b64decode(data))
        except Exception as exc:  # pragma: no cover - decoding guard
            return {"ok": False, "error": f"screenshot_failed:{type(exc).__name__}", "url": url}
    return {
        "ok": True,
        "url": url,
        "engine": "playwright",
        "path": str(out_path) if out_path else None,
    }


def click(x, y, button: str = "left") -> dict:
    """Interactive browser control moved to the AEGIS Computer surface."""
    return {
        "ok": False,
        "error": "cdp_unavailable",
        "detail": (
            "Interactive browser input (click/type) runs in the AEGIS "
            "Computer surface, not in the daemon. Ask Aegis to open the "
            "Computer area, or use the read-only browser fetch tools."
        ),
        "engine": "playwright",
        "last_pointer": {"x": x, "y": y, "action": "click"},
    }


def type_text(selector: str | None, text: str) -> dict:
    return {
        "ok": False,
        "error": "cdp_unavailable",
        "detail": (
            "Interactive browser input (click/type) runs in the AEGIS "
            "Computer surface, not in the daemon. Ask Aegis to open the "
            "Computer area, or use the read-only browser fetch tools."
        ),
        "engine": "playwright",
    }


# ---------------------------------------------------------------------------
# HTTP router (main.py includes this via its tolerant import hook)
# ---------------------------------------------------------------------------

router = APIRouter()


@router.get("/api/browser/state")
def api_browser_state():
    return {"ok": True, **get_state()}


@router.get("/api/browser/preview")
def api_browser_preview():
    with _state_lock:
        screenshot = _page_state.get("screenshot_path")
    if screenshot and Path(screenshot).is_file():
        return FileResponse(screenshot, media_type="image/png")
    fallback = _preview_path()
    if fallback.is_file():
        return FileResponse(str(fallback), media_type="image/png")
    return JSONResponse({"error": "no_preview"}, status_code=404)


@router.post("/api/browser/serve")
def api_browser_serve(body: dict = Body(default_factory=dict)):
    """The browser service is managed by the host; report its availability."""
    return {
        "ok": True,
        "engine": "playwright",
        "managed": "host",
        "url": browser_service_url(),
        "configured": bool(browser_service_url() and browser_service_secret()),
    }
