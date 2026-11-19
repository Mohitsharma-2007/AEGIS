"""Idle consolidation: dedupe identical memories, promote well-used ones."""
from __future__ import annotations

import re
import threading
import time

from .db import Store
from .state import STATE


def _normalise(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip().lower())


def consolidate(store: Store) -> dict:
    rows = store.query("SELECT * FROM memories WHERE tombstoned=0 ORDER BY ts ASC")
    total_before = len(rows)
    groups: dict[str, list] = {}
    for row in rows:
        groups.setdefault(_normalise(row["text"]), []).append(row)
    deduped = 0
    for _key, group in groups.items():
        if len(group) < 2:
            continue
        keep = max(group, key=lambda r: (float(r["importance"] or 0.0),
                                         -(r["ts"] or 0.0)))
        for row in group:
            if row["id"] != keep["id"]:
                store.execute(
                    "UPDATE memories SET tombstoned=1 WHERE id=?", (row["id"],))
                deduped += 1
    promoted = 0
    for row in store.query(
            "SELECT * FROM memories WHERE tombstoned=0 AND usage_count>=2"):
        store.execute(
            "UPDATE memories SET importance=importance+0.5 WHERE id=?", (row["id"],))
        promoted += 1
    total = store.query_one(
        "SELECT COUNT(*) AS n FROM memories WHERE tombstoned=0")["n"]
    report = {"deduped": deduped, "promoted": promoted,
              "total": int(total), "total_before": total_before}
    return report


def start_idle_worker(store: Store) -> threading.Thread:
    """Background loop: consolidate once per idle period (30s without
    activity) and emit a consolidation event on the pending-events queue."""

    def _run() -> None:
        while True:
            time.sleep(5)
            idle_for = time.time() - STATE.last_activity
            if idle_for >= 30 and STATE.last_consolidation < STATE.last_activity:
                STATE.last_consolidation = time.time()
                try:
                    report = consolidate(store)
                except Exception as exc:  # logged via event, never swallowed
                    STATE.push_event({"type": "consolidation",
                                      "error": f"{type(exc).__name__}: {exc}"})
                    continue
                STATE.push_event({"type": "consolidation", "report": report})

    thread = threading.Thread(target=_run, name="aegis-consolidation", daemon=True)
    thread.start()
    return thread
