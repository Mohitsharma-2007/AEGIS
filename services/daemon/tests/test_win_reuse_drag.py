"""Unit tests for Milestone 5: Win32 window reuse, process launch allowlist, and cua.drag."""
from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path

from aegis_daemon.db import Store
from aegis_daemon.state import STATE
from aegis_daemon.tools import DECL_BY_NAME, IMPLEMENTATIONS, _LAUNCH_ALLOWLIST, dispatch
from aegis_daemon import cua


class TestWinReuseAndDrag(unittest.TestCase):
    def setUp(self):
        STATE.state = "idle"
        STATE.mode = "Operator"
        STATE.session_confirmed.clear()
        self.temp_dir = tempfile.TemporaryDirectory()
        self.orig_aegis_home = os.environ.get("AEGIS_HOME")
        os.environ["AEGIS_HOME"] = self.temp_dir.name
        self.store = Store(Path(self.temp_dir.name))

    def tearDown(self):
        try:
            self.store.conn.close()
        except Exception:
            pass
        self.temp_dir.cleanup()
        if self.orig_aegis_home:
            os.environ["AEGIS_HOME"] = self.orig_aegis_home
        else:
            os.environ.pop("AEGIS_HOME", None)

    def test_declarations_and_implementations_registered(self):
        self.assertIn("cua.drag", DECL_BY_NAME)
        self.assertIn("window.list", DECL_BY_NAME)
        self.assertIn("window.switch", DECL_BY_NAME)

        self.assertIn("cua.drag", IMPLEMENTATIONS)
        self.assertIn("window.list", IMPLEMENTATIONS)
        self.assertIn("window.switch", IMPLEMENTATIONS)

    def test_launch_allowlist_contains_windows_apps(self):
        expected_apps = ["terminal", "editor", "notepad", "calculator", "calc", "paint", "browser", "chrome", "edge"]
        for app in expected_apps:
            self.assertIn(app, _LAUNCH_ALLOWLIST)
            binaries = _LAUNCH_ALLOWLIST[app]
            self.assertTrue(any(b.endswith(".exe") or b.endswith(".cmd") for b in binaries))

    def test_window_list_returns_list(self):
        res = dispatch(self.store, "window.list", {})
        self.assertTrue(res.get("ok"))
        self.assertIn("windows", res)
        self.assertIsInstance(res.get("windows"), list)

    def test_cua_drag_is_refused_without_physical_input_fallback(self):
        res = dispatch(self.store, "cua.drag", {}, confirmed=True, confirmation_source="keyboard")
        self.assertFalse(res.get("ok"))
        self.assertEqual(res.get("error"), "unsupported_action")
        self.assertIn("agent-desktop", res.get("detail", ""))

    def test_cua_drag_waypoints_are_not_executed(self):
        points = [[100, 100], [200, 100], [200, 200], [100, 200], [100, 100]]
        res = dispatch(self.store, "cua.drag", {"points": points, "duration": 0.05}, confirmed=True, confirmation_source="keyboard")
        self.assertFalse(res.get("ok"))
        self.assertEqual(res.get("error"), "unsupported_action")
