"""Persisted daemon settings (JSON file under AEGIS_HOME).

Two settings matter:

``provenance_strict`` (default False). When False (the AEGIS ONE
default) AEGIS converses like a normal assistant and only
cites/abstains around stored-memory answers. When True,
factual/memory questions with no stored evidence get the classic
strict abstention response.

``rag_enabled`` (default True). When True, chat turns retrieve memory
context (L2 hybrid RAG) and inject it into the answer pipeline. When
False, turns do NOT retrieve/inject memory context at all — captures
are still recorded, and the explicit recall tools (``memory.recall``
etc.) still work when invoked directly; only the automatic per-turn
retrieval is off.

The file is ``<AEGIS_HOME>/settings.json`` so it survives restarts.
Reads are cheap (the file is tiny) and always hit disk, so a value
written by POST /api/settings is visible to every later turn without a
restart. A corrupt or missing file falls back to the defaults.
"""
from __future__ import annotations

import json
import threading
from pathlib import Path

from .db import aegis_home

_DEFAULTS: dict = {"provenance_strict": False, "rag_enabled": True}
_LOCK = threading.Lock()


def settings_path() -> Path:
    return aegis_home() / "settings.json"


def load_settings() -> dict:
    """Current settings: defaults merged with the JSON file on disk."""
    settings = dict(_DEFAULTS)
    try:
        raw = settings_path().read_text(encoding="utf-8")
        data = json.loads(raw)
        if isinstance(data, dict):
            for key in _DEFAULTS:
                if key in data:
                    settings[key] = bool(data[key])
    except (OSError, ValueError):
        pass
    return settings


# Alias with the name callers most naturally reach for.
get_settings = load_settings


def update_settings(updates: dict) -> dict:
    """Merge known settings keys, persist atomically, return the result."""
    with _LOCK:
        settings = load_settings()
        for key in _DEFAULTS:
            if isinstance(updates, dict) and key in updates:
                settings[key] = bool(updates[key])
        path = settings_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(settings, indent=2), encoding="utf-8")
        tmp.replace(path)
        return settings


def provenance_strict() -> bool:
    return bool(load_settings().get("provenance_strict", False))


def set_provenance_strict(value: bool) -> dict:
    return update_settings({"provenance_strict": bool(value)})


def rag_enabled() -> bool:
    return bool(load_settings().get("rag_enabled", True))


def set_rag_enabled(value: bool) -> dict:
    return update_settings({"rag_enabled": bool(value)})
