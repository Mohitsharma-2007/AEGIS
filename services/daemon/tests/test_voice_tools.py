"""Tests for voice pipeline tool schemas and relaxed voice confirmation policies."""
from __future__ import annotations

import asyncio
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock

from aegis_daemon.db import Store
from aegis_daemon.state import STATE
from aegis_daemon.tools import dispatch
from aegis_daemon.voice_pipeline import get_voice_tool_schemas


class FakeParams:
    def __init__(self, function_name: str, arguments: dict):
        self.function_name = function_name
        self.arguments = arguments
        self.result = None

    async def result_callback(self, result):
        self.result = result


class TestVoiceTools(unittest.TestCase):
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
        if self.orig_aegis_home is not None:
            os.environ["AEGIS_HOME"] = self.orig_aegis_home
        else:
            os.environ.pop("AEGIS_HOME", None)
        try:
            self.temp_dir.cleanup()
        except Exception:
            pass

    def test_tool_schemas_registered(self):
        mock_ws = AsyncMock()
        schemas = get_voice_tool_schemas(mock_ws)
        names = {s.name for s in schemas}
        self.assertIn("computer_control", names)
        self.assertIn("desktop_ui", names)
        self.assertIn("recall_memory", names)
        self.assertIn("browser_navigate", names)
        self.assertIn("shell_execute", names)
        self.assertIn("ui_navigate", names)

        for s in schemas:
            self.assertTrue(s.name)
            self.assertTrue(s.description)
            self.assertIsInstance(s.properties, dict)
            self.assertIsInstance(s.required, list)
            self.assertIsNotNone(s.handler)

    def test_voice_tool_handler_dispatches_action(self):
        mock_ws = AsyncMock()
        schemas = get_voice_tool_schemas(mock_ws)
        schema_map = {s.name: s for s in schemas}

        comp_schema = schema_map["computer_control"]
        params = FakeParams("computer_control", {
            "action": "screenshot",
            "params": {"format": "png"},
            "rationale": "Taking a snapshot of the active window",
        })

        asyncio.run(comp_schema.handler(params))

        # Check websocket sent action frame and tool-result frame
        self.assertEqual(mock_ws.send_json.call_count, 2)
        action_call = mock_ws.send_json.call_args_list[0][0][0]
        result_call = mock_ws.send_json.call_args_list[1][0][0]
        self.assertEqual(action_call["type"], "action")
        self.assertEqual(action_call["tool"], "computer_control")
        self.assertEqual(action_call["parameters"]["action"], "screenshot")
        self.assertEqual(result_call["type"], "tool-result")

        # Check result_callback was called
        self.assertIsNotNone(params.result)
        self.assertIn("status", params.result)

    def test_desktop_ui_voice_tool_dispatches_audited_accessibility_request(self):
        from unittest.mock import patch
        mock_ws = AsyncMock()
        schemas = {s.name: s for s in get_voice_tool_schemas(mock_ws, dot_id="dot-123")}
        params = FakeParams("desktop_ui", {
            "command": "click", "args": ["@s1:7"], "label": "Choose settings",
            "rationale": "Select the numbered settings control",
        })
        with patch("aegis_daemon.voice_pipeline._host_json", return_value=(200, {"ok": True})) as host:
            asyncio.run(schemas["desktop_ui"].handler(params))
        host.assert_called_once_with("/api/agent-desktop", {
            "dotId": "dot-123", "command": "click", "args": ["@s1:7"],
            "label": "Choose settings",
        })
        self.assertEqual(params.result, {"ok": True})

    def test_voice_computer_control_rejects_physical_mouse_and_keyboard(self):
        from unittest.mock import patch
        from aegis_daemon.voice_pipeline import _computer_control
        with patch("aegis_daemon.voice_pipeline._computer_action") as host:
            for action, values in (("click", {"x": 400, "y": 300}), ("type", {"text": "hi"}), ("press_key", {"key": "Enter"})):
                result = _computer_control("dot-123", action, values)
                self.assertEqual(result["status"], "error")
            host.assert_not_called()

    def test_voice_tool_handler_recall_memory_dispatches_store(self):
        from aegis_daemon import memory
        # Seed a test memory into the database
        memory.remember(self.store, "Alpha secret key is 98765")

        mock_ws = AsyncMock()
        schemas = get_voice_tool_schemas(mock_ws)
        schema_map = {s.name: s for s in schemas}

        recall_schema = schema_map["recall_memory"]
        params = FakeParams("recall_memory", {
            "query": "Alpha secret key",
            "rationale": "Retrieve Alpha key",
        })

        asyncio.run(recall_schema.handler(params))

        # Check websocket sent action frame and tool-result frame
        self.assertEqual(mock_ws.send_json.call_count, 2)
        action_call = mock_ws.send_json.call_args_list[0][0][0]
        result_call = mock_ws.send_json.call_args_list[1][0][0]
        self.assertEqual(action_call["type"], "action")
        self.assertEqual(action_call["tool"], "recall_memory")
        self.assertEqual(action_call["parameters"]["query"], "Alpha secret key")
        self.assertEqual(result_call["type"], "tool-result")

        # Check result callback was invoked without error
        self.assertIsNotNone(params.result)
        self.assertEqual(params.result["status"], "executed")
        self.assertEqual(params.result["query"], "Alpha secret key")
        self.assertNotIn("detail", params.result, f"ImportError or execution failure: {params.result.get('detail')}")

        # Check memory recall output structure
        recall_res = params.result.get("result", {})
        self.assertTrue(recall_res.get("ok"), f"recall should succeed: {recall_res}")
        self.assertFalse(recall_res.get("abstained"), "recall should find matching memory")
        mem_texts = [r.get("text") for r in recall_res.get("results", [])]
        self.assertTrue(any("Alpha secret key is 98765" in t for t in mem_texts), f"Memory text not found in results: {mem_texts}")

    def test_voice_confirmation_relaxed_for_safe_and_readonly_tools(self):
        # 1. system.info (low risk, read-only) with voice
        res = dispatch(self.store, "system.info", {}, confirmation_source="voice")
        self.assertTrue(res.get("ok"), f"system.info should succeed from voice: {res}")

        # 2. memory.recall (low risk, read-only) with voice
        res = dispatch(self.store, "memory.recall", {"query": "hello"}, confirmation_source="voice")
        self.assertTrue(res.get("ok"), f"memory.recall should succeed from voice: {res}")

        # 3. file.read (once_per_session, low risk) with voice
        test_file = self.store.workspace / "test.txt"
        test_file.write_text("sample content", encoding="utf-8")
        res = dispatch(self.store, "file.read", {"path": "test.txt"}, confirmation_source="voice")
        self.assertTrue(res.get("ok"), f"file.read should succeed from voice: {res}")
        self.assertEqual(res.get("content"), "sample content")

        # 4. file.write (medium risk, always policy) without keyboard confirmation -> voice refusal
        res = dispatch(self.store, "file.write", {"path": "fail.txt", "content": "blocked"},
                       confirmation_source="voice")
        self.assertFalse(res.get("ok"))
        self.assertEqual(res.get("error"), "voice_confirmation_refused")

        # 5. session-confirmed once_per_session tool allows voice
        STATE.session_confirmed.add("whatsapp.read")
        res = dispatch(self.store, "whatsapp.read", {}, confirmation_source="voice")
        # whatsapp.read reaches implementation (which returns ok=False only because sidecar isn't connected, but NOT voice_confirmation_refused)
        self.assertNotEqual(res.get("error"), "voice_confirmation_refused", f"session-confirmed tool should not be voice_confirmation_refused: {res}")


if __name__ == "__main__":
    unittest.main()
