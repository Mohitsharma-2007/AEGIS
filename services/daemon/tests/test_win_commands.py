"""Tests for the Windows command vocabulary and its routing."""

import unittest

from aegis_daemon import win_commands
from aegis_daemon.win_speech import is_privacy_error


class WindowsCommandTests(unittest.TestCase):
    def test_every_phrase_is_unique(self):
        seen = {}
        for command in win_commands.COMMANDS:
            key = win_commands._normalise(command.phrase)
            self.assertNotIn(key, seen, f"duplicate phrase: {command.phrase}")
            seen[key] = command

    def test_phrases_match_their_commands(self):
        for command in win_commands.COMMANDS:
            self.assertEqual(
                command,
                win_commands.resolve(command.phrase),
                f"{command.phrase!r} does not resolve to itself",
            )

    def test_resolves_with_punctuation_and_case(self):
        command = win_commands.resolve("Open Settings.")
        self.assertIsNotNone(command)
        self.assertEqual(command.intent, "ui")
        self.assertEqual(dict(command.payload)["action"], "open-settings")

    def test_resolves_with_filler_words(self):
        command = win_commands.resolve("please open the settings")
        self.assertIsNotNone(command)
        self.assertEqual(dict(command.payload)["action"], "open-settings")

    def test_unknown_phrase_is_not_a_command(self):
        self.assertIsNone(win_commands.resolve("what is the weather in Delhi"))
        self.assertIsNone(win_commands.resolve(""))
        self.assertIsNone(win_commands.resolve("   "))

    def test_ask_is_a_conversation_intent(self):
        command = win_commands.resolve("ask aegis")
        self.assertIsNotNone(command)
        self.assertEqual(command.intent, "ask")

    def test_computer_commands_mirror_voice_access(self):
        command = win_commands.resolve("scroll down")
        self.assertIsNotNone(command)
        self.assertEqual(command.intent, "computer")
        self.assertEqual(dict(command.payload)["action"], "scroll-down")

    def test_host_commands_carry_a_request(self):
        command = win_commands.resolve("pause aegis")
        self.assertIsNotNone(command)
        payload = dict(command.payload)
        self.assertEqual(command.intent, "host")
        self.assertEqual(payload["method"], "PATCH")
        self.assertEqual(payload["path"], "/api/settings")
        self.assertTrue(payload["body"]["paused"])

    def test_command_summary_is_json_friendly(self):
        summary = win_commands.command_summary()
        self.assertEqual(len(summary), len(win_commands.COMMANDS))
        for entry in summary:
            self.assertIn("phrase", entry)
            self.assertIn("intent", entry)

    def test_describe_mentions_the_main_groups(self):
        text = win_commands.describe()
        self.assertIn("open settings", text)
        self.assertIn("ui", text)


class PrivacyErrorTests(unittest.TestCase):
    def test_detects_the_windows_privacy_error(self):
        error = OSError(
            "[WinError -2147199735] The speech privacy policy was not accepted "
            "prior to attempting a speech recognition."
        )
        self.assertTrue(is_privacy_error(error))

    def test_ignores_other_errors(self):
        self.assertFalse(is_privacy_error(RuntimeError("something else")))
        self.assertFalse(is_privacy_error(None))


if __name__ == "__main__":
    unittest.main()
