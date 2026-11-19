"""CUA (computer-use agent) desktop control via vercel-labs/agent-desktop.

There is exactly ONE computer-use engine in AEGIS: the vendored
``agent-desktop`` CLI (``vendor/agent-desktop``, Apache-2.0, Rust). It reads the
OS accessibility tree (UI Automation on Windows, AX on macOS, AT-SPI on Linux)
and returns a JSON snapshot where every actionable element carries a stable
``@ref``. Actions are semantic: click/@ref, set-value/@ref, key, scroll.

The loop used by every tool here is the same one the host adapter uses:
**snapshot -> act on a ref -> re-snapshot to verify**. Nothing here injects
physical mouse/keyboard input through the OS accessibility tree, and
nothing captures screenshots.

If the CLI is not built, every tool returns the same loud error the host returns::

    {"ok": False, "error": "agent_desktop_missing", "detail": "<build step>"}

Safety posture still lives in tools.py declarations + dispatch: scope
``cua.control`` (Operator mode only), risk ``high``, not reversible. This module
validates request shapes and performs them; it never raises through dispatch.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

BUILD_HELP = (
    "agent-desktop binary not built. Build it once with: "
    "cd vendor/agent-desktop && cargo build --release "
    "(needs the Rust toolchain), or install the published CLI with "
    "`npm install -g agent-desktop`. Set AGENT_DESKTOP_BIN to an explicit path."
)

_SESSION = "aegis-daemon"
_STATE: dict = {"generation": 0, "elements": [], "app": None}


def _arg(args: dict, *names, default=None):
    for name in names:
        if args.get(name) not in (None, ""):
            return args[name]
    return default


def _int_coord(args: dict, *names) -> int | None:
    """Integer coordinate or None. Booleans are not coordinates; floats must
    be whole numbers (a fractional pixel is a caller bug)."""
    value = _arg(args, *names)
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, str):
        try:
            return int(value.strip())
        except ValueError:
            return None
    return None


def _coords(args: dict) -> tuple[int, int] | None:
    x = _int_coord(args, "x")
    y = _int_coord(args, "y")
    if x is None or y is None:
        return None
    return x, y


def _repo_root() -> Path:
    # services/daemon/aegis_daemon/cua.py -> aegis_daemon, daemon, services, root
    return Path(__file__).resolve().parents[3]


def _binary() -> str | None:
    exe = "agent-desktop.exe" if os.name == "nt" else "agent-desktop"
    candidates: list[Path] = []
    explicit = (os.environ.get("AGENT_DESKTOP_BIN") or "").strip()
    if explicit:
        candidates.append(Path(explicit))
    root = _repo_root()
    candidates.extend(
        [
            root / "vendor" / "agent-desktop" / "target" / "release" / exe,
            root / "vendor" / "agent-desktop" / "target" / "debug" / exe,
            root / "tools-bin" / "agent-desktop" / exe,
        ]
    )
    for candidate in candidates:
        try:
            if candidate.is_file():
                return str(candidate)
        except OSError:
            continue
    return shutil.which("agent-desktop") or shutil.which(exe)


def _missing() -> dict:
    return {"ok": False, "error": "agent_desktop_missing", "detail": BUILD_HELP}


def _run(command: str, args: list[str], timeout: float = 20.0) -> dict:
    """Run one agent-desktop command; return {"ok": True, "data": envelope}
    or an error dict. Never raises."""
    binary = _binary()
    if not binary:
        return _missing()
    argv = [binary, command, *[str(a) for a in args]]
    try:
        completed = subprocess.run(
            argv,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "agent_desktop_timeout",
                "detail": f"agent-desktop {command} timed out after {timeout:.0f}s"}
    except OSError as exc:
        return {"ok": False, "error": "agent_desktop_missing",
                "detail": f"{BUILD_HELP} ({type(exc).__name__}: {exc})"}
    output = (completed.stdout or "").strip()
    if completed.returncode != 0:
        envelope = None
        try:
            envelope = json.loads((completed.stderr or output or "null"))
        except Exception:
            envelope = None
        if isinstance(envelope, dict) and str(envelope.get("code", "")) == "STALE_REF":
            return {"ok": False, "error": "stale_ref",
                    "detail": "That ref belongs to an older snapshot; take a new snapshot."}
        detail = (completed.stderr or output or "").strip()[:800]
        return {"ok": False, "error": "agent_desktop_failed",
                "detail": detail or f"agent-desktop {command} failed"}
    try:
        data = json.loads(output)
    except Exception:
        return {"ok": False, "error": "agent_desktop_bad_output",
                "detail": (completed.stdout or "").strip()[:400]}
    if not isinstance(data, dict):
        return {"ok": False, "error": "agent_desktop_bad_output",
                "detail": "agent-desktop returned a non-object envelope"}
    return {"ok": True, "data": data}


def _normalise_elements(raw) -> list[dict]:
    elements = []
    if not isinstance(raw, list):
        return elements
    for item in raw:
        if not isinstance(item, dict):
            continue
        ref = item.get("ref")
        if not isinstance(ref, str) or not ref:
            continue
        frame = item.get("frame") if isinstance(item.get("frame"), dict) else (
            item.get("bounds") if isinstance(item.get("bounds"), dict) else None
        )
        entry = {
            "ref": ref,
            "role": item.get("role") if isinstance(item.get("role"), str) else None,
            "name": item.get("name") if isinstance(item.get("name"), str) else None,
            "value": item.get("value") if isinstance(item.get("value"), str) else None,
            "focused": bool(item.get("focused", False)),
        }
        if frame and isinstance(frame.get("x"), (int, float)) and isinstance(frame.get("y"), (int, float)):
            entry["frame"] = {
                "x": float(frame["x"]),
                "y": float(frame["y"]),
                "width": float(frame.get("width") or 0),
                "height": float(frame.get("height") or 0),
            }
        elements.append(entry)
    return elements


def _snapshot(app: str | None = None) -> dict:
    result = _run("snapshot", ["--session", _SESSION] + (["--app", app] if app else []))
    if not result["ok"]:
        return result
    _STATE["generation"] += 1
    data = result["data"]
    _STATE["elements"] = _normalise_elements(
        data.get("elements") or data.get("tree") or data.get("nodes")
    )
    if isinstance(data.get("app"), str):
        _STATE["app"] = data["app"]
    return {
        "ok": True,
        "snapshot": {
            "generation": _STATE["generation"],
            "session": _SESSION,
            "app": _STATE["app"],
            "elements": _STATE["elements"],
        },
    }


def _element_for(ref: str) -> dict | None:
    for element in _STATE["elements"]:
        if element["ref"] == ref:
            return element
    return None


def _element_at(x: int, y: int) -> dict | None:
    best = None
    best_area = None
    for element in _STATE["elements"]:
        frame = element.get("frame")
        if not frame:
            continue
        inside = (
            frame["x"] <= x <= frame["x"] + frame["width"]
            and frame["y"] <= y <= frame["y"] + frame["height"]
        )
        if not inside:
            continue
        area = max(frame["width"], 1) * max(frame["height"], 1)
        if best_area is None or area < best_area:
            best, best_area = element, area
    return best


def _signature(element: dict | None) -> str:
    if not element:
        return "missing"
    return json.dumps(
        [element.get("ref"), element.get("role"), element.get("name"),
         element.get("value"), element.get("frame")],
        sort_keys=True,
    )


def _verify(ref: str | None, before: dict | None) -> dict:
    """Re-snapshot after an action and report what changed."""
    verified = _snapshot()
    if not verified["ok"]:
        return verified
    after = _element_for(ref) if ref else None
    return {
        "ok": True,
        "verified": {
            "generation": _STATE["generation"],
            "changed": _signature(before) != _signature(after),
            "element": after,
            "cursor": (
                {
                    "x": after["frame"]["x"] + after["frame"]["width"] / 2,
                    "y": after["frame"]["y"] + after["frame"]["height"] / 2,
                }
                if after and after.get("frame") else None
            ),
        },
    }


def cua_snapshot(store, args):
    """Snapshot the accessibility tree and return refs the agent can act on."""
    app = _arg(args or {}, "app", "application")
    return _snapshot(app if isinstance(app, str) else None)


def cua_move(store, args):
    """Point the agent cursor at (x, y).

    agent-desktop has no physical pointer move, and AEGIS does not inject OS
    input. The agent cursor is drawn by the annotation overlay, so this reports
    the element under the point (if any) for the overlay to highlight.
    """
    coords = _coords(args or {})
    if coords is None:
        return {"ok": False, "error": "invalid_args",
                "detail": "cua.move requires integer x and y"}
    snapped = _snapshot()
    if not snapped["ok"]:
        return snapped
    x, y = coords
    element = _element_at(x, y)
    return {
        "ok": True,
        "action": "move",
        "x": x,
        "y": y,
        "element": element,
        "cursor": {"x": x, "y": y},
        "note": "agent-desktop drives elements by ref; the pointer is drawn by the overlay",
    }


def cua_click(store, args):
    args = args or {}
    ref = _arg(args, "ref")
    coords = _coords(args)
    if ref is None and coords is None:
        return {"ok": False, "error": "invalid_args",
                "detail": "cua.click requires a ref, or integer x and y"}
    button = str(_arg(args, "button", default="left")).lower()
    if button != "left":
        return {"ok": False, "error": "invalid_args",
                "detail": "agent-desktop clicks are left-button only; right/middle "
                          "clicking is disabled because it opens menus over the owner's desktop"}
    clicks = _int_coord(args, "clicks", "clickCount", "click_count") or 1
    if clicks != 1:
        return {"ok": False, "error": "invalid_args",
                "detail": "multi-click is disabled; take a snapshot and click the ref again"}

    snapped = _snapshot()
    if not snapped["ok"]:
        return snapped
    if ref is None:
        assert coords is not None
        element = _element_at(coords[0], coords[1])
        if element is None:
            return {"ok": False, "error": "no_element_at_point",
                    "detail": f"no actionable element at ({coords[0]}, {coords[1]}); "
                              "call cua.snapshot and click a ref instead"}
        ref = element["ref"]
    before = _element_for(str(ref))
    result = _run("click", [str(ref), "--session", _SESSION])
    if not result["ok"]:
        return result
    verified = _verify(str(ref), before)
    if not verified["ok"]:
        return verified
    return {"ok": True, "action": "click", "ref": ref,
            "result": result["data"], **verified}


def cua_type(store, args):
    args = args or {}
    text = _arg(args, "text", "value", "content")
    if not isinstance(text, str) or text == "":
        return {"ok": False, "error": "invalid_args",
                "detail": "cua.type requires a non-empty text string"}
    ref = _arg(args, "ref")
    snapped = _snapshot()
    if not snapped["ok"]:
        return snapped
    if ref is None:
        for element in _STATE["elements"]:
            if element.get("focused"):
                ref = element["ref"]
                break
    if ref is None:
        for element in _STATE["elements"]:
            role = (element.get("role") or "").lower()
            if role in ("textfield", "textbox", "combobox", "searchfield"):
                ref = element["ref"]
                break
    if ref is None:
        return {"ok": False, "error": "no_target",
                "detail": "no focused text field in the snapshot; call cua.snapshot "
                          "and pass the field's ref"}
    before = _element_for(str(ref))
    result = _run("set-value", [str(ref), text, "--session", _SESSION])
    if not result["ok"]:
        return result
    verified = _verify(str(ref), before)
    if not verified["ok"]:
        return verified
    return {"ok": True, "action": "type", "ref": ref, "length": len(text),
            "result": result["data"], **verified}


def cua_key(store, args):
    raw = _arg(args or {}, "key", "keys", "name")
    if isinstance(raw, (list, tuple)):
        keys = [str(k).strip().lower() for k in raw if str(k).strip()]
    elif isinstance(raw, str) and raw.strip():
        keys = [part.strip().lower()
                for part in raw.replace(",", "+").split("+") if part.strip()]
    else:
        keys = []
    if not keys:
        return {"ok": False, "error": "invalid_args",
                "detail": "cua.key requires a key name (e.g. 'enter') or a "
                          "chord (e.g. 'ctrl+l')"}
    chord = "+".join(keys)
    result = _run("key", [chord, "--session", _SESSION])
    if not result["ok"]:
        return result
    verified = _snapshot()
    if not verified["ok"]:
        return verified
    return {"ok": True, "action": "key", "keys": keys,
            "result": result["data"], "verified": {"generation": _STATE["generation"]}}


def cua_scroll(store, args):
    args = args or {}
    clicks = _int_coord(args, "clicks", "amount")
    if clicks is None:
        delta_y = _arg(args, "deltaY", "delta_y", "dy")
        if isinstance(delta_y, (int, float)) and not isinstance(delta_y, bool):
            clicks = int(round(float(delta_y) / 100.0))
        elif isinstance(delta_y, str):
            try:
                clicks = int(round(float(delta_y.strip()) / 100.0))
            except ValueError:
                clicks = None
    if clicks is None or clicks == 0:
        return {"ok": False, "error": "invalid_args",
                "detail": "cua.scroll requires a non-zero clicks/amount or deltaY"}
    x = _int_coord(args, "x")
    y = _int_coord(args, "y")
    if (x is None) != (y is None):
        return {"ok": False, "error": "invalid_args",
                "detail": "cua.scroll takes both x and y, or neither"}
    direction = "down" if clicks < 0 else "up"
    result = _run("scroll", ["--direction", direction, "--amount", str(abs(clicks)),
                             "--session", _SESSION])
    if not result["ok"]:
        return result
    verified = _snapshot()
    if not verified["ok"]:
        return verified
    return {"ok": True, "action": "scroll", "clicks": clicks, "x": x, "y": y,
            "result": result["data"], "verified": {"generation": _STATE["generation"]}}


def cua_drag(store, args):
    """agent-desktop has no drag gesture; refuse instead of falling back."""
    return {
        "ok": False,
        "error": "unsupported_action",
        "detail": "drag is not part of the agent-desktop tool surface; use "
                  "snapshot + click/set-value on a ref (or the app's own move handles)",
    }


# ---------------------------------------------------------------------------
# Window helpers. These use Win32 ctypes directly (window enumeration only; no
# input is injected) and only enumerate/activate windows; they never inject input.
# ---------------------------------------------------------------------------

def list_desktop_windows() -> list[dict]:
    """Enumerate top-level desktop windows via Win32 ctypes."""
    import ctypes
    if not hasattr(ctypes, "windll") or not hasattr(ctypes.windll, "user32"):
        return []
    from ctypes import wintypes
    user32 = ctypes.windll.user32
    kernel32 = ctypes.windll.kernel32
    windows = []

    WNDENUMPROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

    def enum_proc(hwnd, lparam):
        if user32.IsWindowVisible(hwnd):
            length = user32.GetWindowTextLengthW(hwnd)
            if length > 0:
                buff = ctypes.create_unicode_buffer(length + 1)
                user32.GetWindowTextW(hwnd, buff, length + 1)
                title = buff.value.strip()
                pid = wintypes.DWORD()
                user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
                proc_name = ""
                h_proc = kernel32.OpenProcess(0x1000, False, pid.value)
                if h_proc:
                    img_buf = ctypes.create_unicode_buffer(512)
                    size = wintypes.DWORD(512)
                    if kernel32.QueryFullProcessImageNameW(h_proc, 0, img_buf, ctypes.byref(size)):
                        proc_name = img_buf.value.split("\\")[-1]
                    kernel32.CloseHandle(h_proc)
                windows.append({"hwnd": int(hwnd), "title": title, "pid": int(pid.value), "process": proc_name})
        return True

    cb = WNDENUMPROC(enum_proc)
    h_default = 0
    try:
        h_default = user32.OpenDesktopW("default", 0, False, 0x0100)
    except Exception:
        h_default = 0

    if h_default:
        user32.EnumDesktopWindows(h_default, cb, 0)
        user32.CloseDesktop(h_default)
    else:
        user32.EnumWindows(cb, 0)

    return windows


def activate_window(hwnd: int, maximize: bool = True) -> bool:
    """Restore, bring to foreground, and maximize/show window via Win32 ctypes."""
    if not hwnd:
        return False
    import ctypes
    if not hasattr(ctypes, "windll") or not hasattr(ctypes.windll, "user32"):
        return False
    user32 = ctypes.windll.user32
    try:
        if user32.IsIconic(hwnd):
            user32.ShowWindow(hwnd, 9)
        elif maximize:
            user32.ShowWindow(hwnd, 3)
        else:
            user32.ShowWindow(hwnd, 5)
        user32.BringWindowToTop(hwnd)
        user32.SetForegroundWindow(hwnd)
        if maximize:
            user32.ShowWindow(hwnd, 3)
        return True
    except Exception:
        return False
