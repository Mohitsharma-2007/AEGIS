"""WhatsApp tools (W-FIX 3d) — a thin client over the Baileys sidecar.

The sidecar (opendots/src/whatsapp) owns the WhatsApp Web protocol
session (QR pairing, auth state in the gitignored .aegis-data dir).
The daemon never speaks the protocol itself: it calls the sidecar's
localhost HTTP API with the shared secret, so every WhatsApp action
still passes through THIS module's tool declarations — permission
broker, mode gates, confirmation policy and the tool-call log all
apply exactly like any other daemon tool.

Configuration (environment):
  AEGIS_WHATSAPP_URL     sidecar base URL (default http://127.0.0.1:4312)
  WHATSAPP_SECRET        shared secret header value
  WHATSAPP_SECRET_FILE   path to the secret file the start scripts
                         generate (default <aegis root>/.aegis-data/
                         whatsapp-secret, then ~/.aegis-data fallback)
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from pathlib import Path


def _base_url() -> str:
    return (os.environ.get("AEGIS_WHATSAPP_URL") or "http://127.0.0.1:4312").rstrip("/")


def _secret() -> str | None:
    direct = os.environ.get("WHATSAPP_SECRET")
    if direct:
        return direct.strip()
    candidates = []
    explicit = os.environ.get("WHATSAPP_SECRET_FILE")
    if explicit:
        candidates.append(Path(explicit))
    # Daemon cwd is services/aegis-daemon under the aegis root.
    candidates.append(Path(__file__).resolve().parents[3] / ".aegis-data" / "whatsapp-secret")
    candidates.append(Path.home() / ".aegis-data" / "whatsapp-secret")
    for path in candidates:
        try:
            value = path.read_text(encoding="utf-8").strip()
        except OSError:
            continue
        if value:
            return value
    return None


def _call(method: str, path: str, payload: dict | None = None) -> dict:
    secret = _secret()
    if not secret:
        return {"ok": False, "error": "whatsapp_not_configured",
                "detail": "No WhatsApp sidecar secret found (WHATSAPP_SECRET / secret file). Start Aegis via start.sh/start.ps1 so the sidecar is supervised."}
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = urllib.request.Request(
        f"{_base_url()}{path}", data=data, method=method,
        headers={"content-type": "application/json", "x-aegis-whatsapp-secret": secret})
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        try:
            body = json.loads(exc.read().decode("utf-8"))
        except Exception:
            body = {}
        return {"ok": False, "error": f"whatsapp_sidecar_http_{exc.code}",
                "detail": body.get("error") or exc.reason}
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        return {"ok": False, "error": "whatsapp_sidecar_unreachable",
                "detail": f"{_base_url()} — {exc.__class__.__name__}: {exc}"}


def whatsapp_status(store, args) -> dict:
    result = _call("GET", "/status")
    if result.get("ok") is False and "error" in result:
        return result
    return {"ok": True, **result}


def whatsapp_read(store, args) -> dict:
    limit = args.get("limit") or 20
    chat = args.get("chat") or args.get("jid") or ""
    query = f"?limit={int(limit)}"
    if chat:
        from urllib.parse import quote
        query += f"&chat={quote(str(chat))}"
    result = _call("GET", f"/messages{query}")
    if result.get("ok") is False and "error" in result:
        return result
    return {"ok": True, **result}


def whatsapp_send(store, args) -> dict:
    to = str(args.get("to") or args.get("jid") or "").strip()
    text = str(args.get("text") or args.get("message") or "").strip()
    if not to or not text:
        return {"ok": False, "error": "invalid_args",
                "detail": "whatsapp.send needs 'to' (phone number or chat JID) and 'text'."}
    result = _call("POST", "/send", {"to": to, "text": text})
    if result.get("ok") is False and "error" in result:
        return result
    return {"ok": True, **result}
