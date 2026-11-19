"""Tool catalogue, implementations, permission broker, and tool forging.

Dispatch order (never reordered): resolve tool -> kill switch -> mode
scopes -> confirmation (voice always refused) -> execute -> log.
Every attempt is written to the append-only tool_calls log.
"""
from __future__ import annotations

import hashlib
import html
import json
import os
import platform
import re
import shutil
import subprocess
import time
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

from . import embeddings, memory as memory_mod
from .db import Store
from .modes import scopes_for
from .state import STATE


# ---------------------------------------------------------------------------
# Declarations
# ---------------------------------------------------------------------------

def _decl(name, description, scopes, risk, reversible, confirmation, args):
    return {
        "name": name, "tool": name, "description": description,
        "scopes": scopes, "risk": risk, "reversible": reversible,
        "confirmation": confirmation, "confirmation_policy": confirmation,
        "arguments": args,
    }


DECLARATIONS: list[dict] = [
    _decl("memory.remember", "Write a capture + memory with provenance",
          ["memory.write"], "low", True, "never",
          {"text": "string", "source": "string?", "scope_id": "string?",
           "category": "personal|task|document|preference|note?"}),
    _decl("memory.recall", "Hybrid retrieval with abstention floor",
          ["memory.read"], "low", True, "never", {"query": "string"}),
    _decl("memory.forget", "Tombstone a memory (capture stays auditable)",
          ["memory.write"], "medium", True, "always",
          {"memory_id": "string?", "id": "string?", "capture_id": "string?"}),
    _decl("memory.update", "Rewrite an existing memory's text (task-related correction)",
          ["memory.write"], "medium", True, "never",
          {"memory_id": "string?", "id": "string?", "capture_id": "string?",
           "text": "string"}),
    _decl("graph.query", "Current + historical graph edges for an entity",
          ["memory.read"], "low", True, "never",
          {"entity": "string", "scope_id": "string?"}),
    _decl("tree.address", "Pick the STAIR leaf for a query",
          ["memory.read"], "low", True, "never", {"query": "string"}),
    # Research connectors (research_connectors.py): read-only public
    # APIs over network.get, exactly the browser.fetch gating pattern.
    # Every OpenAlex result is stored as a provenance capture.
    _decl("openalex.search_works", "Search OpenAlex works by title/keyword; results stored as provenance captures",
          ["network.get"], "low", True, "never",
          {"query": "string", "limit": "int?"}),
    _decl("openalex.work", "OpenAlex work details incl. reconstructed abstract; stored as a provenance capture",
          ["network.get"], "low", True, "never", {"id": "string", "work": "string?"}),
    _decl("openalex.search_authors", "Search OpenAlex authors; results stored as provenance captures",
          ["network.get"], "low", True, "never",
          {"query": "string", "limit": "int?"}),
    _decl("github.repo", "GitHub repo metadata + languages + default branch (plain REST, optional GITHUB_TOKEN env)",
          ["network.get"], "low", True, "never",
          {"repo": "string", "owner": "string?", "name": "string?"}),
    _decl("github.tree", "GitHub repo file tree (recursive optional, truncated honestly)",
          ["network.get"], "low", True, "never",
          {"repo": "string", "ref": "string?", "recursive": "bool?"}),
    _decl("github.commits", "GitHub commits list + analysis (by author, by ISO week, recent messages)",
          ["network.get"], "low", True, "never",
          {"repo": "string", "per_page": "int?", "since": "string?", "until": "string?"}),
    _decl("github.file", "Fetch a GitHub repo file via the contents API (base64-decoded, size-capped)",
          ["network.get"], "low", True, "never",
          {"repo": "string", "path": "string", "ref": "string?"}),
    # WhatsApp (W-FIX 3d): the Baileys sidecar owns the protocol
    # session; these tools proxy it through the broker like everything
    # else. Sending is high risk and confirms EVERY call.
    _decl("whatsapp.status", "WhatsApp connection state of the paired sidecar (disconnected / QR-ready / connected)",
          ["network.get"], "low", True, "never", {}),
    _decl("whatsapp.read", "Read recent WhatsApp messages seen by the paired sidecar (optionally one chat)",
          ["network.get", "whatsapp.read"], "medium", True, "once_per_session",
          {"chat": "string?", "limit": "int?"}),
    _decl("whatsapp.send", "Send a WhatsApp message from the user's paired account via the sidecar",
          ["whatsapp.send"], "high", False, "always",
          {"to": "string", "text": "string"}),
    _decl("file.list", "List files under the workspace root",
          ["file.read"], "low", True, "never", {"path": "string?"}),
    _decl("file.search", "Search file names and contents under the workspace root",
          ["file.read"], "low", True, "never", {"query": "string"}),
    _decl("file.read", "Read a file under the workspace root",
          ["file.read"], "low", True, "once_per_session", {"path": "string"}),
    _decl("file.write", "Write a file under the workspace root",
          ["file.write"], "medium", True, "always",
          {"path": "string", "content": "string"}),
    _decl("file.append", "Append to a file under the workspace root",
          ["file.write"], "medium", True, "always",
          {"path": "string", "content": "string"}),
    _decl("system.info", "Real host information (platform, CPU, memory, disk)",
          ["system.info"], "low", True, "never", {}),
    _decl("browser.fetch", "Fetch a page as text (AEGIS Computer browser / Playwright via the host when configured, else urllib, labelled)",
          ["network.get", "browser.fetch"], "medium", True, "once_per_session",
          {"url": "string"}),
    _decl("browser.screenshot", "Screenshot a page via the AEGIS Computer browser (Playwright)",
          ["browser.screenshot"], "medium", True, "always", {"url": "string"}),
    _decl("browser.navigate", "Navigate the AEGIS Computer browser (Playwright) and capture a preview",
          ["browser.control"], "medium", True, "once_per_session",
          {"url": "string"}),
    _decl("browser.click", "Click at page coordinates in the AEGIS Computer browser (host surface)",
          ["browser.control"], "medium", True, "once_per_session",
          {"x": "int", "y": "int", "button": "string?"}),
    _decl("browser.type", "Type text into the AEGIS Computer browser (host surface)",
          ["browser.control"], "medium", True, "once_per_session",
          {"text": "string", "selector": "string?"}),
    # CUA desktop control (cua.py -> agent-desktop): Operator mode only via the
    # cua.control scope, high risk, not reversible. Every action reads the OS
    # accessibility tree, acts on a stable @ref and re-snapshots to verify, so
    # typing/clicking never injects physical input. Click/type/key are
    # state-changing, so they confirm EVERY call; snapshot/move/scroll are
    # once_per_session.
    _decl("cua.snapshot", "Snapshot the desktop accessibility tree; returns @refs for actionable elements",
          ["cua.control"], "low", True, "never", {"app": "string?"}),
    _decl("cua.move", "Point the agent cursor at (x, y); the overlay draws it (no OS input is injected)",
          ["cua.control"], "high", False, "once_per_session",
          {"x": "int", "y": "int"}),
    _decl("cua.click", "Click a desktop element by @ref (or at x,y to resolve the ref first)",
          ["cua.control"], "high", False, "always",
          {"ref": "string?", "x": "int?", "y": "int?", "button": "string?", "clicks": "int?"}),
    _decl("cua.type", "Set the value of a text field by @ref (or the focused field) via agent-desktop",
          ["cua.control"], "high", False, "always", {"text": "string", "ref": "string?"}),
    _decl("cua.key", "Press a key or chord (e.g. 'enter', 'ctrl+l') on the real desktop",
          ["cua.control"], "high", False, "always", {"key": "string"}),
    _decl("cua.scroll", "Scroll the desktop with agent-desktop (clicks, or deltaY pixels)",
          ["cua.control"], "high", False, "once_per_session",
          {"clicks": "int?", "deltaY": "int?", "x": "int?", "y": "int?"}),
    _decl("cua.drag", "Not supported by agent-desktop; use snapshot + click/set-value on a ref",
          ["cua.control"], "high", False, "always",
          {"fromX": "int?", "fromY": "int?", "toX": "int?", "toY": "int?", "points": "array?", "button": "string?"}),
    _decl("window.list", "List all top-level desktop windows",
          ["cua.control"], "low", True, "never", {}),
    _decl("window.switch", "Switch to, restore, and focus a window by title, hwnd, or process",
          ["cua.control"], "medium", False, "always",
          {"hwnd": "int?", "title": "string?", "process": "string?", "maximize": "bool?"}),
    _decl("os.notify", "Desktop notification via notify-send",
          ["notify"], "low", True, "never", {"message": "string", "title": "string?"}),
    _decl("os.clipboard_read", "Read the clipboard (xclip/xsel/wl-paste)",
          ["clipboard.read"], "low", True, "never", {}),
    _decl("os.clipboard_write", "Write the clipboard (xclip/xsel/wl-copy)",
          ["clipboard.write"], "medium", True, "always", {"text": "string"}),
    _decl("os.screenshot", "Capture the screen (scrot/gnome-screenshot/import)",
          ["screen.capture"], "medium", False, "always", {"path": "string?"}),
    _decl("os.launch", "Launch an allowlisted app by name (never a raw command)",
          ["launch"], "high", False, "always", {"app": "string"}),
    _decl("os.open_url", "Open a URL with the system handler",
          ["open_url"], "medium", True, "always", {"url": "string"}),
]

DECL_BY_NAME = {d["name"]: d for d in DECLARATIONS}

# Aliases the UI / brief use.
ALIASES = {
    "memory.search": "memory.recall",
    "clipboard.read": "os.clipboard_read",
    "clipboard.write": "os.clipboard_write",
    "os.clipboard.read": "os.clipboard_read",
    "os.clipboard.write": "os.clipboard_write",
    "os.notify_send": "os.notify",
    "notify": "os.notify",
    "system_info": "system.info",
}


def declarations() -> list[dict]:
    return [dict(d) for d in DECLARATIONS]


# ---------------------------------------------------------------------------
# Workspace path safety
# ---------------------------------------------------------------------------

class PathRefused(Exception):
    def __init__(self, error: str):
        super().__init__(error)
        self.error = error


def resolve_workspace_path(store: Store, raw: str | None) -> Path:
    root = store.workspace.resolve()
    rel = (raw or "").strip()
    if rel in ("", ".", "/"):
        return root
    candidate = Path(rel)
    if candidate.is_absolute():
        resolved = candidate.resolve()
        try:
            rel_parts = resolved.relative_to(root).parts
        except ValueError:
            raise PathRefused("path_outside_workspace")
    else:
        rel_parts = candidate.parts
        resolved = (root / candidate).resolve()
        try:
            resolved.relative_to(root)
        except ValueError:
            raise PathRefused("traversal_refused")
    for part in rel_parts:
        if part.startswith("."):
            raise PathRefused("dotfile_refused")
    return resolved


# ---------------------------------------------------------------------------
# Tool implementations. Each returns a dict; ok/error set by the broker.
# ---------------------------------------------------------------------------

def _arg(args: dict, *names, default=None):
    for name in names:
        if args.get(name) not in (None, ""):
            return args[name]
    return default


def _tool_remember(store, args):
    return memory_mod.remember(store, _arg(args, "text", "content", default=""),
                               source=_arg(args, "source", default="user"),
                               scope_id=_arg(args, "scope_id", default=""),
                               category=_arg(args, "category", default="note"))


def _tool_recall(store, args):
    result = memory_mod.recall(store, _arg(args, "query", "q", "text", default=""))
    result.setdefault("answer", None)
    if result.get("abstained"):
        result["answer"] = memory_mod.ABSTAIN_MESSAGE
    return result


def _tool_forget(store, args):
    return memory_mod.forget(
        store,
        memory_id=_arg(args, "memory_id", "id"),
        capture_id=_arg(args, "capture_id"))


def _tool_update_memory(store, args):
    return memory_mod.update_memory(
        store,
        memory_id=_arg(args, "memory_id", "id"),
        capture_id=_arg(args, "capture_id"),
        text=_arg(args, "text", "content"))


def _tool_openalex_search_works(store, args):
    from . import research_connectors as research_mod
    try:
        limit = int(_arg(args, "limit", "per_page", default=10))
    except (TypeError, ValueError):
        limit = 10
    try:
        return research_mod.openalex_search_works(
            store, str(_arg(args, "query", "q", "search", default="")), limit=limit)
    except ValueError as exc:
        return {"ok": False, "error": f"openalex_failed:{exc}"}


def _tool_openalex_work(store, args):
    from . import research_connectors as research_mod
    try:
        return research_mod.openalex_work(
            store, str(_arg(args, "id", "work", "work_id", "doi", default="")))
    except ValueError as exc:
        return {"ok": False, "error": f"openalex_failed:{exc}"}


def _tool_openalex_search_authors(store, args):
    from . import research_connectors as research_mod
    try:
        limit = int(_arg(args, "limit", "per_page", default=10))
    except (TypeError, ValueError):
        limit = 10
    try:
        return research_mod.openalex_search_authors(
            store, str(_arg(args, "query", "q", "search", default="")), limit=limit)
    except ValueError as exc:
        return {"ok": False, "error": f"openalex_failed:{exc}"}


def _research_guard(fn, store, args):
    try:
        return fn(store, args)
    except ValueError as exc:
        return {"ok": False, "error": f"github_failed:{exc}"}


def _tool_github_repo(store, args):
    from . import research_connectors as research_mod
    return _research_guard(research_mod.github_repo, store, args)


def _tool_github_tree(store, args):
    from . import research_connectors as research_mod
    return _research_guard(research_mod.github_tree, store, args)


def _tool_github_commits(store, args):
    from . import research_connectors as research_mod
    return _research_guard(research_mod.github_commits, store, args)


def _tool_github_file(store, args):
    from . import research_connectors as research_mod
    return _research_guard(research_mod.github_file, store, args)


def _tool_graph(store, args):
    return memory_mod.graph_query(store, _arg(args, "entity", "query", "name", default=""),
                                  _arg(args, "scope_id", default=None))


def _tool_tree(store, args):
    return memory_mod.tree_address(store, _arg(args, "query", "q", "text", default=""))


def _tool_file_list(store, args):
    target = resolve_workspace_path(store, _arg(args, "path", default=""))
    if not target.exists():
        return {"ok": False, "error": "not_found", "path": _arg(args, "path", default="")}
    if target.is_file():
        return {"ok": True, "path": str(target), "entries": [
            {"name": target.name, "type": "file", "size": target.stat().st_size}]}
    entries = []
    for child in sorted(target.iterdir(), key=lambda p: p.name):
        if child.name.startswith("."):
            continue
        entries.append({"name": child.name,
                        "type": "dir" if child.is_dir() else "file",
                        "size": child.stat().st_size if child.is_file() else None})
    return {"ok": True, "path": str(target.relative_to(store.workspace.resolve()))
            if target != store.workspace.resolve() else "",
            "entries": entries, "count": len(entries)}


def _tool_file_search(store, args):
    query = str(_arg(args, "query", "q", "text", "pattern", default="")).lower()
    if not query:
        return {"ok": False, "error": "empty_query"}
    root = store.workspace.resolve()
    matches = []
    for path in root.rglob("*"):
        rel_parts = path.relative_to(root).parts
        if any(p.startswith(".") for p in rel_parts) or path.is_dir():
            continue
        rel = str(path.relative_to(root))
        snippet = None
        if query in rel.lower():
            snippet = ""
        else:
            try:
                content = path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            idx = content.lower().find(query)
            if idx < 0:
                continue
            snippet = content[max(0, idx - 40):idx + len(query) + 40]
        matches.append({"path": rel, "snippet": snippet})
        if len(matches) >= 50:
            break
    return {"ok": True, "query": query, "matches": matches, "count": len(matches),
            "results": matches}


def _tool_file_read(store, args):
    target = resolve_workspace_path(store, _arg(args, "path", default=""))
    if not target.exists() or not target.is_file():
        return {"ok": False, "error": "not_found", "path": _arg(args, "path", default="")}
    content = target.read_text(encoding="utf-8", errors="replace")
    return {"ok": True, "path": _arg(args, "path", default=""), "content": content,
            "text": content, "size": len(content.encode("utf-8"))}


def _tool_file_write(store, args, append=False):
    rel = _arg(args, "path", default="")
    target = resolve_workspace_path(store, rel)
    content = _arg(args, "content", "text", default="")
    target.parent.mkdir(parents=True, exist_ok=True)
    if append:
        with target.open("a", encoding="utf-8") as fh:
            fh.write(str(content))
    else:
        target.write_text(str(content), encoding="utf-8")
    return {"ok": True, "path": rel, "bytes_written": len(str(content).encode("utf-8")),
            "size": target.stat().st_size}


def _tool_file_append(store, args):
    return _tool_file_write(store, args, append=True)


def system_info(store: Store) -> dict:
    from .providers import hardware_profile
    mem_total = None
    try:
        for line in Path("/proc/meminfo").read_text().splitlines():
            if line.startswith("MemTotal:"):
                mem_total = line.split(":", 1)[1].strip()
                break
    except OSError:
        mem_total = None
    try:
        disk = shutil.disk_usage(str(store.workspace))
        disk_info = {"total": disk.total, "used": disk.used, "free": disk.free}
    except OSError:
        disk_info = None
    gpu = gpu_info()
    hw = hardware_profile()
    return {
        "platform": platform.system(),
        "platform_release": platform.release(),
        "machine": platform.machine(),
        "python": platform.python_version(),
        "cpu_count": os.cpu_count(),
        "mem_total": mem_total,
        "disk": disk_info,
        "gpu": gpu,
        "hardware_profile": hw["profile"],
        "hardware": hw,
    }


def gpu_info() -> dict:
    exe = shutil.which("nvidia-smi")
    if not exe:
        return {"available": False,
                "detail": "no NVIDIA GPU detected via nvidia-smi "
                          "(nvidia-smi not found on this machine/VM)"}
    try:
        out = subprocess.run([exe, "--query-gpu=name,memory.total",
                              "--format=csv,noheader"],
                             capture_output=True, text=True, timeout=5)
        if out.returncode == 0 and out.stdout.strip():
            return {"available": True, "detail": out.stdout.strip()}
        return {"available": False,
                "detail": "nvidia-smi present but reported no GPU"}
    except (OSError, subprocess.SubprocessError) as exc:
        return {"available": False, "detail": f"nvidia-smi check failed: {type(exc).__name__}"}


def _tool_system_info(store, args):
    result = {"ok": True}
    result.update(system_info(store))
    return result


class _TextExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts: list[str] = []
        self._skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "noscript"):
            self._skip += 1

    def handle_endtag(self, tag):
        if tag in ("script", "style", "noscript") and self._skip:
            self._skip -= 1

    def handle_data(self, data):
        if not self._skip and data.strip():
            self.parts.append(data.strip())


def _strip_html(raw: str) -> str:
    parser = _TextExtractor()
    try:
        parser.feed(raw)
        text = " ".join(parser.parts)
    except Exception:
        text = re.sub(r"<[^>]+>", " ", html.unescape(raw))
    return re.sub(r"\s+", " ", text).strip()


def browser_engine() -> tuple[str, bool]:
    """The daemon's browser surface: the AEGIS Computer browser (Playwright)
    served by the host, or plain urllib text fetch when it is not configured."""
    from . import browser_engine as browser_engine_mod

    configured = bool(browser_engine_mod.browser_service_url() and browser_engine_mod.browser_service_secret())
    return ("playwright", configured) if configured else ("urllib", False)


def _tool_browser_fetch(store, args):
    url = str(_arg(args, "url", "href", default="")).strip()
    if not re.match(r"^https?://", url):
        return {"ok": False, "error": "invalid_url", "url": url}
    engine, has_browser = browser_engine()
    text = None
    note = "no JS executed"
    if has_browser:
        try:
            result = _tool_browser_navigate(store, {"url": url})
            if result.get("ok") and result.get("text"):
                text = result["text"]
                note = "fetched via AEGIS Computer browser (Playwright)"
            else:
                engine = "urllib"
                note = "browser service failed; urllib fallback — no JS executed"
        except Exception:
            engine = "urllib"
            note = "browser service failed; urllib fallback — no JS executed"
    if text is None:
        req = urllib.request.Request(url, headers={"User-Agent": "AEGIS/0.1.0"})
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                raw = resp.read().decode("utf-8", errors="replace")
        except Exception as exc:
            return {"ok": False, "error": f"fetch_failed:{type(exc).__name__}",
                    "url": url, "engine": engine}
        text = _strip_html(raw) if ("<" in raw and ">" in raw) else raw.strip()
    truncated = text[:20000]
    created = memory_mod.create_capture(
        store, truncated, kind="web", trust="untrusted", source=url,
        make_memory=False)
    return {"ok": True, "url": url, "engine": engine, "note": note,
            "browser_configured": has_browser, "text": truncated,
            "content": truncated, "capture_id": created["capture_id"],
            "trust": "untrusted", "bytes": len(truncated.encode("utf-8"))}


def _tool_browser_screenshot(store, args):
    url = str(_arg(args, "url", "href", default="")).strip()
    from . import browser_engine as browser_engine_mod

    if not (browser_engine_mod.browser_service_url() and browser_engine_mod.browser_service_secret()):
        return {"ok": False, "error": "browser_service_not_configured",
                "detail": "Set BROWSER_URL/BROWSER_SECRET (or AEGIS_BROWSER_URL/AEGIS_BROWSER_SECRET) in .env.local.",
                "url": url}
    return browser_engine_mod.screenshot(url)


def _tool_browser_navigate(store, args):
    from . import browser_engine as browser_engine_mod
    return browser_engine_mod.navigate(str(_arg(args, "url", "href", default="")))


def _tool_browser_click(store, args):
    from . import browser_engine as browser_engine_mod
    return browser_engine_mod.click(
        _arg(args, "x"), _arg(args, "y"),
        button=str(_arg(args, "button", default="left")))


def _tool_browser_type(store, args):
    from . import browser_engine as browser_engine_mod
    return browser_engine_mod.type_text(
        _arg(args, "selector"), _arg(args, "text", "value", default=""))


def _tool_cua_snapshot(store, args):
    return cua_mod.cua_snapshot(store, args)

def _tool_cua_move(store, args):
    from . import cua as cua_mod
    return cua_mod.cua_move(store, args)


def _tool_cua_click(store, args):
    from . import cua as cua_mod
    return cua_mod.cua_click(store, args)


def _tool_cua_type(store, args):
    from . import cua as cua_mod
    return cua_mod.cua_type(store, args)


def _tool_cua_key(store, args):
    from . import cua as cua_mod
    return cua_mod.cua_key(store, args)


def _tool_cua_scroll(store, args):
    from . import cua as cua_mod
    return cua_mod.cua_scroll(store, args)


def _tool_cua_drag(store, args):
    from . import cua as cua_mod
    return cua_mod.cua_drag(store, args)


def _tool_window_list(store, args):
    from . import cua as cua_mod
    windows = cua_mod.list_desktop_windows()
    return {"ok": True, "windows": windows, "count": len(windows)}


def _tool_window_switch(store, args):
    from . import cua as cua_mod
    hwnd = _arg(args, "hwnd")
    title = str(_arg(args, "title", default="")).strip().lower()
    process = str(_arg(args, "process", default="")).strip().lower()
    maximize = args.get("maximize", True) is not False

    if hwnd:
        ok = cua_mod.activate_window(int(hwnd), maximize=maximize)
        return {"ok": ok, "hwnd": hwnd, "action": "switch"}

    windows = cua_mod.list_desktop_windows()
    for win in windows:
        if (title and title in (win.get("title") or "").lower()) or \
           (process and process in (win.get("process") or "").lower()):
            win_hwnd = win.get("hwnd")
            if win_hwnd and cua_mod.activate_window(win_hwnd, maximize=maximize):
                return {"ok": True, "hwnd": win_hwnd, "title": win.get("title"), "process": win.get("process"), "action": "switch"}

    return {"ok": False, "error": "window_not_found", "detail": f"No window matching title='{title}' or process='{process}'"}


def _tool_notify(store, args):
    exe = shutil.which("notify-send")
    if not exe:
        return {"ok": False, "error": "tool_unavailable",
                "detail": "notify-send not installed"}
    message = str(_arg(args, "message", "text", "body", default="AEGIS"))
    title = str(_arg(args, "title", default="AEGIS"))
    try:
        subprocess.run([exe, title, message], capture_output=True, timeout=5)
    except (OSError, subprocess.SubprocessError) as exc:
        return {"ok": False, "error": f"notify_failed:{type(exc).__name__}"}
    return {"ok": True, "message": message}


_CLIP_READ = [("wl-paste", ["wl-paste"]), ("xclip", ["xclip", "-selection", "clipboard", "-o"]),
              ("xsel", ["xsel", "--clipboard", "--output"])]
_CLIP_WRITE = [("wl-copy", ["wl-copy"]), ("xclip", ["xclip", "-selection", "clipboard"]),
               ("xsel", ["xsel", "--clipboard", "--input"])]


def _tool_clipboard_read(store, args):
    for name, cmd in _CLIP_READ:
        exe = shutil.which(name)
        if exe:
            try:
                out = subprocess.run([exe] + cmd[1:], capture_output=True,
                                     text=True, timeout=5)
                return {"ok": True, "text": out.stdout, "content": out.stdout,
                        "via": name}
            except (OSError, subprocess.SubprocessError) as exc:
                return {"ok": False, "error": f"clipboard_failed:{type(exc).__name__}"}
    return {"ok": False, "error": "tool_unavailable",
            "detail": "no clipboard tool installed (tried wl-paste, xclip, xsel)"}


def _tool_clipboard_write(store, args):
    text = str(_arg(args, "text", "content", default=""))
    for name, cmd in _CLIP_WRITE:
        exe = shutil.which(name)
        if exe:
            try:
                subprocess.run([exe] + cmd[1:], input=text, capture_output=True,
                               text=True, timeout=5)
                return {"ok": True, "text": text, "via": name}
            except (OSError, subprocess.SubprocessError) as exc:
                return {"ok": False, "error": f"clipboard_failed:{type(exc).__name__}"}
    return {"ok": False, "error": "tool_unavailable",
            "detail": "no clipboard tool installed (tried wl-copy, xclip, xsel)"}


def _tool_os_screenshot(store, args):
    rel = _arg(args, "path", default="screenshot.png")
    try:
        target = resolve_workspace_path(store, rel)
    except PathRefused as exc:
        return {"ok": False, "error": exc.error}
    target.parent.mkdir(parents=True, exist_ok=True)
    attempts = []
    if shutil.which("scrot"):
        attempts.append(["scrot", str(target)])
    if shutil.which("gnome-screenshot"):
        attempts.append(["gnome-screenshot", "-f", str(target)])
    if shutil.which("import"):
        attempts.append(["import", "-window", "root", str(target)])
    if not attempts:
        return {"ok": False, "error": "tool_unavailable",
                "detail": "no screenshot tool installed (tried scrot, gnome-screenshot, import)"}
    for cmd in attempts:
        try:
            out = subprocess.run([shutil.which(cmd[0])] + cmd[1:],
                                 capture_output=True, timeout=10)
            if out.returncode == 0 and target.exists():
                return {"ok": True, "path": str(rel), "via": cmd[0]}
        except (OSError, subprocess.SubprocessError):
            continue
    return {"ok": False, "error": "screenshot_failed"}


_LAUNCH_ALLOWLIST: dict[str, list[str]] = {
    "terminal": ["wt.exe", "powershell.exe", "cmd.exe", "gnome-terminal", "konsole", "alacritty", "kitty", "xterm"],
    "editor": ["notepad.exe", "code.cmd", "code.exe", "gedit", "kate", "code", "xed", "mousepad"],
    "notepad": ["notepad.exe"],
    "calculator": ["calc.exe", "gnome-calculator", "kcalc", "galculator"],
    "calc": ["calc.exe"],
    "paint": ["mspaint.exe"],
    "mspaint": ["mspaint.exe"],
    "browser": ["chrome.exe", "msedge.exe", "google-chrome", "firefox"],
    "chrome": ["chrome.exe", "google-chrome"],
    "edge": ["msedge.exe"],
    "msedge": ["msedge.exe"],
    "files": ["explorer.exe", "nautilus", "dolphin", "nemo", "thunar"],
    "whatsapp": ["WhatsApp.exe"],
}


def _tool_launch(store, args):
    app = str(_arg(args, "app", "name", default="")).strip().lower()
    if app not in _LAUNCH_ALLOWLIST:
        # Raw commands/paths land here too: they are never allowlisted names.
        return {"ok": False, "error": "not_allowlisted", "app": app,
                "allowlist": sorted(_LAUNCH_ALLOWLIST.keys())}

    # 1. Check if an instance is already open and restore/activate it (avoiding duplicate instances)
    try:
        from .cua import list_desktop_windows, activate_window
        windows = list_desktop_windows()
        candidates = _LAUNCH_ALLOWLIST[app] + [app]
        for win in windows:
            proc = (win.get("process") or "").lower()
            title = (win.get("title") or "").lower()
            matched = False
            for cand in candidates:
                cand_clean = cand.replace(".exe", "").replace(".cmd", "").lower()
                if cand_clean in proc or cand_clean in title or cand.lower() in proc:
                    matched = True
                    break
            if matched:
                hwnd = win.get("hwnd")
                if hwnd and activate_window(hwnd, maximize=True):
                    return {
                        "ok": True,
                        "app": app,
                        "reused": True,
                        "hwnd": hwnd,
                        "pid": win.get("pid"),
                        "title": win.get("title"),
                    }
    except Exception:
        pass

    # 2. No existing instance found: launch new instance
    import sys
    for binary in _LAUNCH_ALLOWLIST[app]:
        exe = shutil.which(binary)
        if not exe and sys.platform == "win32":
            system_root = os.environ.get("SystemRoot", r"C:\Windows")
            paths_to_check = [
                os.path.join(system_root, "System32", binary),
                os.path.join(system_root, binary),
                os.path.join(os.environ.get("LOCALAPPDATA", ""), "Microsoft", "WindowsApps", binary),
                os.path.join(os.environ.get("ProgramFiles", r"C:\Program Files"), "Google", "Chrome", "Application", binary),
                os.path.join(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)"), "Microsoft", "Edge", "Application", binary),
            ]
            for p in paths_to_check:
                if os.path.isfile(p):
                    exe = p
                    break
        if exe:
            try:
                subprocess.Popen([exe], stdout=subprocess.DEVNULL,
                                 stderr=subprocess.DEVNULL)
            except OSError as exc:
                return {"ok": False, "error": f"launch_failed:{type(exc).__name__}"}
            return {"ok": True, "app": app, "binary": binary, "reused": False}
    return {"ok": False, "error": "tool_unavailable",
            "detail": f"no binary installed for allowlisted app '{app}' "
                      f"(tried {', '.join(_LAUNCH_ALLOWLIST[app])})"}


def _tool_open_url(store, args):
    url = str(_arg(args, "url", default="")).strip()
    if not re.match(r"^https?://", url):
        return {"ok": False, "error": "invalid_url", "url": url}
    exe = shutil.which("xdg-open")
    if not exe:
        return {"ok": False, "error": "tool_unavailable",
                "detail": "xdg-open not installed"}
    try:
        subprocess.Popen([exe, url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except OSError as exc:
        return {"ok": False, "error": f"open_url_failed:{type(exc).__name__}"}
    return {"ok": True, "url": url}


def _tool_whatsapp_status(store, args):
    from . import whatsapp_tools as wa
    return wa.whatsapp_status(store, args)


def _tool_whatsapp_read(store, args):
    from . import whatsapp_tools as wa
    return wa.whatsapp_read(store, args)


def _tool_whatsapp_send(store, args):
    from . import whatsapp_tools as wa
    return wa.whatsapp_send(store, args)


IMPLEMENTATIONS = {
    "memory.remember": _tool_remember,
    "memory.recall": _tool_recall,
    "memory.forget": _tool_forget,
    "memory.update": _tool_update_memory,
    "graph.query": _tool_graph,
    "tree.address": _tool_tree,
    "openalex.search_works": _tool_openalex_search_works,
    "openalex.work": _tool_openalex_work,
    "openalex.search_authors": _tool_openalex_search_authors,
    "github.repo": _tool_github_repo,
    "github.tree": _tool_github_tree,
    "github.commits": _tool_github_commits,
    "github.file": _tool_github_file,
    "whatsapp.status": _tool_whatsapp_status,
    "whatsapp.read": _tool_whatsapp_read,
    "whatsapp.send": _tool_whatsapp_send,
    "file.list": _tool_file_list,
    "file.search": _tool_file_search,
    "file.read": _tool_file_read,
    "file.write": _tool_file_write,
    "file.append": _tool_file_append,
    "system.info": _tool_system_info,
    "browser.fetch": _tool_browser_fetch,
    "browser.screenshot": _tool_browser_screenshot,
    "browser.navigate": _tool_browser_navigate,
    "browser.click": _tool_browser_click,
    "browser.type": _tool_browser_type,
    "cua.snapshot": _tool_cua_snapshot,
    "cua.move": _tool_cua_move,
    "cua.click": _tool_cua_click,
    "cua.type": _tool_cua_type,
    "cua.key": _tool_cua_key,
    "cua.scroll": _tool_cua_scroll,
    "cua.drag": _tool_cua_drag,
    "window.list": _tool_window_list,
    "window.switch": _tool_window_switch,
    "os.notify": _tool_notify,
    "os.clipboard_read": _tool_clipboard_read,
    "os.clipboard_write": _tool_clipboard_write,
    "os.screenshot": _tool_os_screenshot,
    "os.launch": _tool_launch,
    "os.open_url": _tool_open_url,
}


# ---------------------------------------------------------------------------
# Learned tools (forging)
# ---------------------------------------------------------------------------

def canonical_args(args: dict) -> str:
    return json.dumps(args or {}, sort_keys=True, separators=(",", ":"))


def list_learned(store: Store) -> list[dict]:
    learned = []
    for row in store.query("SELECT * FROM learned_tools ORDER BY id"):
        slug = row["slug"]
        source_tool = row["source_tool"]
        # Forging stats -- the speed value of a learned tool. ``uses`` is
        # counted from the append-only tool_calls log, not the (never
        # incremented) learned_tools.use_count column: a forged call is
        # logged either with tool=<slug> (brain's memoised path, which
        # passes log_tool_name=slug) or with forged_from=<slug> (a direct
        # call whose args matched a learned tool). Both shapes count once.
        uses_row = store.query_one(
            "SELECT COUNT(*) AS n FROM tool_calls"
            " WHERE forged_from=? OR tool=?", (slug, slug))
        uses = int(uses_row["n"]) if uses_row else 0
        # Average duration of the SOURCE tool's successful calls: what a
        # forged shortcut is measured against (and saves re-deriving).
        avg_row = store.query_one(
            "SELECT AVG(duration_ms) AS avg_ms FROM tool_calls"
            " WHERE tool=? AND status='ok'", (source_tool,))
        avg_ms = avg_row["avg_ms"] if avg_row else None
        learned.append({
            "id": row["id"], "slug": slug, "name": row["name"],
            "source_tool": source_tool,
            "args": json.loads(row["args_json"] or "{}"),
            "args_json": row["args_json"],
            "keywords": json.loads(row["keywords"] or "[]"),
            "count_observations": row["count_observations"],
            "observation_count": row["count_observations"],
            "use_count": row["use_count"], "uses": uses,
            "avg_duration_ms": (round(float(avg_ms), 3)
                                if avg_ms is not None else None),
            "risk": row["risk"],
            "scopes": json.loads(row["scopes"] or "[]"),
            "confirmation": row["confirmation"],
        })
    return learned


def _humanised_name(tool: str, args: dict) -> str:
    title = " ".join(part.capitalize() for part in re.split(r"[._]", tool) if part)
    first_value = ""
    for value in (args or {}).values():
        if isinstance(value, str) and value:
            first_value = value
            break
    if first_value:
        return f"{title}: {first_value} (forged)"
    return f"{title} (forged)"


def _maybe_forge(store: Store, tool: str, args: dict) -> dict | None:
    canon = canonical_args(args)
    row = store.query_one(
        "SELECT COUNT(*) AS n FROM tool_calls WHERE tool=? AND args_json=? AND status='ok'",
        (tool, canon))
    count = int(row["n"]) if row else 0
    if count != 3:
        return None
    existing = store.query_one(
        "SELECT * FROM learned_tools WHERE source_tool=? AND args_json=?", (tool, canon))
    if existing is not None:
        return None
    decl = DECL_BY_NAME[tool]
    slug = (re.sub(r"[^a-z0-9]+", "-", tool.lower()).strip("-")
            + "-" + hashlib.sha256(canon.encode("utf-8")).hexdigest()[:8])
    keywords = sorted({tok for value in (args or {}).values()
                       for tok in embeddings.tokenise(str(value))})
    name = _humanised_name(tool, args)
    store.execute(
        "INSERT INTO learned_tools(slug,name,source_tool,args_json,keywords,"
        "count_observations,use_count,risk,scopes,confirmation)"
        " VALUES(?,?,?,?,?,?,0,?,?,?)",
        (slug, name, tool, canon, json.dumps(keywords), count,
         decl["risk"], json.dumps(decl["scopes"]), decl["confirmation"]))
    learned = {"slug": slug, "name": name, "source_tool": tool,
               "count_observations": count, "use_count": 0}
    STATE.push_event({"type": "forge", "learned_tool": learned,
                      "slug": slug, "name": name, "tool": slug})
    return learned


def find_learned_for(store: Store, tool: str, args: dict) -> dict | None:
    canon = canonical_args(args)
    for item in list_learned(store):
        if item["source_tool"] == tool and canonical_args(item["args"]) == canon:
            return item
    return None


def match_forged(store: Store, text: str) -> dict | None:
    """Return the learned tool whose keywords best overlap the text, or None.
    Match rule: >=2 keyword tokens overlap, or all of its keywords overlap."""
    tokens = set(embeddings.tokenise(text or ""))
    if not tokens:
        return None
    best, best_overlap = None, 0
    for item in list_learned(store):
        keywords = set(item.get("keywords") or [])
        if not keywords:
            continue
        overlap = len(tokens & keywords)
        if overlap >= 2 or overlap == len(keywords):
            if overlap > best_overlap:
                best, best_overlap = item, overlap
    return best


# ---------------------------------------------------------------------------
# Permission broker / dispatch
# ---------------------------------------------------------------------------

def _log_call(store: Store, tool: str, args: dict, decl: dict | None,
              status: str, error: str | None, duration_ms: float,
              forged_from: str | None = None) -> int:
    cur = store.execute(
        "INSERT INTO tool_calls(ts,tool,args_json,risk,scopes,mode,status,error,"
        "duration_ms,forged_from) VALUES(?,?,?,?,?,?,?,?,?,?)",
        (time.time(), tool, canonical_args(args),
         decl["risk"] if decl else None,
         json.dumps(decl["scopes"]) if decl else "[]",
         STATE.mode, status, error, round(duration_ms, 3), forged_from))
    return int(cur.lastrowid)


def log_entries(store: Store, limit: int = 100) -> list[dict]:
    entries = []
    for row in store.query(
            "SELECT * FROM tool_calls ORDER BY id DESC LIMIT ?", (int(limit),)):
        try:
            scopes = json.loads(row["scopes"] or "[]")
        except ValueError:
            scopes = []
        entries.append({
            "id": row["id"], "ts": row["ts"], "time": row["ts"],
            "tool": row["tool"], "arguments": row["args_json"],
            "args_json": row["args_json"], "risk": row["risk"],
            "scopes": scopes, "mode": row["mode"], "status": row["status"],
            "error": row["error"], "duration_ms": row["duration_ms"],
            "duration": row["duration_ms"], "forged_from": row["forged_from"],
        })
    return entries


def dispatch(store: Store, tool: str, args: dict | None = None,
             confirmed: bool = False, confirmation_source: str | None = None,
             forged_from: str | None = None,
             log_tool_name: str | None = None) -> dict:
    """Run one tool call through the broker. Returns a flat result dict:
    tool result fields are merged at top level and also kept under
    ``result``."""
    STATE.touch()
    args = args or {}
    tool = ALIASES.get(tool, tool)
    log_name = log_tool_name or tool
    started = time.time()

    def _finish(payload: dict, status: str, error: str | None,
                decl: dict | None, log_forged: str | None = None) -> dict:
        duration = (time.time() - started) * 1000.0
        _log_call(store, log_name, args, decl, status, error, duration,
                  forged_from=log_forged if log_forged is not None else forged_from)
        payload.setdefault("tool", tool)
        payload.setdefault("status", status)
        payload["duration_ms"] = round(duration, 3)
        payload["mode"] = STATE.mode
        return payload

    decl = DECL_BY_NAME.get(tool)
    if decl is None:
        return _finish({"ok": False, "error": "unknown_tool", "tool": tool},
                       "error", "unknown_tool", None)

    if STATE.stopped:
        return _finish({"ok": False, "error": "state_stopped", "tool": tool},
                       "state_stopped", "state_stopped", decl)

    # Mode mask first.
    granted = scopes_for(STATE.mode)
    missing = [s for s in decl["scopes"] if s not in granted]
    if missing:
        STATE.push_event({"type": "tool", "tool": tool, "status": "mode_blocked",
                          "missing_scope": missing[0]})
        return _finish({"ok": False, "error": "mode_blocked", "tool": tool,
                        "missing_scope": missing[0], "missing_scopes": missing,
                        "scopes": decl["scopes"]},
                       "mode_blocked", "mode_blocked", decl)

    # Confirmation second. Voice confirmation is relaxed for read-only, safe, or session-confirmed tools.
    policy = decl["confirmation"]
    is_safe_or_readonly = (
        decl.get("risk") == "low"
        or all(
            ".read" in s or s in ("network.get", "system.info", "memory.read")
            for s in decl.get("scopes", [])
        )
        or (policy == "once_per_session" and tool in STATE.session_confirmed)
    )
    needs_confirmation = (
        policy == "always"
        or (policy == "once_per_session" and tool not in STATE.session_confirmed))
    if needs_confirmation:
        if confirmation_source == "voice":
            if is_safe_or_readonly or (confirmed is True and decl.get("risk") == "low"):
                pass  # Authorized / safe voice tool execution allowed
            else:
                STATE.push_event({"type": "permission", "tool": tool,
                                  "error": "voice_confirmation_refused"})
                return _finish({"ok": False, "error": "voice_confirmation_refused",
                                "tool": tool, "risk": decl["risk"],
                                "scopes": decl["scopes"],
                                "reversible": decl["reversible"],
                                "confirmation": policy},
                               "permission_pending", "voice_confirmation_refused", decl)
        elif confirmed is not True:
            STATE.push_event({"type": "permission", "tool": tool,
                              "error": "permission_required"})
            return _finish({"ok": False, "error": "permission_required",
                            "tool": tool, "risk": decl["risk"],
                            "scopes": decl["scopes"],
                            "reversible": decl["reversible"],
                            "confirmation": policy},
                           "permission_pending", "permission_required", decl)
    if confirmed is True and confirmation_source != "voice":
        STATE.session_confirmed.add(tool)

    # Execute.
    try:
        result = IMPLEMENTATIONS[tool](store, args)
        if not isinstance(result, dict):
            result = {"value": result}
    except PathRefused as exc:
        result = {"ok": False, "error": exc.error}
    except Exception as exc:  # typed, logged — never a silent pass
        result = {"ok": False, "error": f"{type(exc).__name__}: {exc}"}

    if result.get("ok") is False:
        return _finish({**result, "result": result}, "error",
                       str(result.get("error", "error")), decl)

    result.setdefault("ok", True)
    payload = {**result, "result": result}
    # Forging: count identical successes (this call is logged below, so
    # check the prospective count = logged successes + this one).
    canon = canonical_args(args)
    row = store.query_one(
        "SELECT COUNT(*) AS n FROM tool_calls WHERE tool=? AND args_json=? AND status='ok'",
        (log_name, canon))
    prospective = (int(row["n"]) if row else 0) + 1
    forged_slug_for_log = None
    if forged_from is None:
        existing_learned = find_learned_for(store, tool, args)
        if existing_learned is not None:
            payload["learned_tool"] = existing_learned["slug"]
            payload["learned"] = existing_learned
            payload["forged"] = True
            forged_slug_for_log = existing_learned["slug"]
    finished = _finish(payload, "ok", None, decl, log_forged=forged_slug_for_log)
    if forged_from is None and prospective >= 3:
        learned = _maybe_forge(store, tool, args)
        if learned is not None:
            finished["learned_tool"] = learned["slug"]
            finished["learned"] = learned
            finished["forged"] = True
            finished["forge_event"] = {"type": "forge", "learned_tool": learned}
    return finished
