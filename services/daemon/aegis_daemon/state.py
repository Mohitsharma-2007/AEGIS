"""Process-wide mutable daemon state (mode, kill switch, events, activity)."""
from __future__ import annotations

import threading
import time

from .modes import DEFAULT_MODE


class AppState:
    def __init__(self) -> None:
        self.state: str = "idle"  # "idle" | "stopped"
        self.mode: str = DEFAULT_MODE
        self.session_confirmed: set[str] = set()
        self.pending_events: list[dict] = []
        self.last_activity: float = time.time()
        self.last_consolidation: float = 0.0
        self.lock = threading.Lock()

    @property
    def stopped(self) -> bool:
        return self.state == "stopped"

    def touch(self) -> None:
        self.last_activity = time.time()

    def push_event(self, event: dict) -> None:
        with self.lock:
            self.pending_events.append(event)

    def drain_events(self) -> list[dict]:
        with self.lock:
            events = list(self.pending_events)
            self.pending_events.clear()
            return events


# Single shared instance used by main/tools/brain/consolidation.
STATE = AppState()
