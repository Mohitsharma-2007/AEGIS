from __future__ import annotations

import unittest

from aegis_daemon.transcript import (
    _safe_llm_cleanup,
    clean_transcript,
    needs_llm_cleanup,
)
from aegis_daemon.tts_kokoro import split_script_segments


class TranscriptCleanupTests(unittest.TestCase):
    def test_fillers_and_stutters_are_removed(self):
        self.assertEqual(
            clean_transcript("um, uh, I I I want to open settings"),
            "I want to open settings.",
        )

    def test_hestitation_sound_a_does_not_eat_articles(self):
        self.assertEqual(
            clean_transcript("a, open a new tab"),
            "Open a new tab.",
        )
        self.assertEqual(
            clean_transcript("a apple and a table"),
            "A apple and a table.",
        )

    def test_number_is_never_split(self):
        self.assertEqual(clean_transcript("set it to 5006"), "Set it to 5006.")
        self.assertEqual(clean_transcript("set it to 5 0 0 6"), "Set it to 5006.")
        self.assertEqual(clean_transcript("set it to 5 00 6"), "Set it to 5006.")
        self.assertEqual(clean_transcript("set it to 5,006"), "Set it to 5006.")

    def test_number_self_correction_chain(self):
        self.assertEqual(
            clean_transcript("500, not 500, 600, not 600, 200"),
            "200.",
        )
        self.assertEqual(
            clean_transcript("I need 500, no, 600, no, 200 units"),
            "I need 200 units.",
        )

    def test_named_self_correction(self):
        self.assertEqual(
            clean_transcript("Send it to John, no, Mary"),
            "Send it to Mary.",
        )

    def test_hindi_text_is_preserved(self):
        self.assertEqual(
            clean_transcript("नमस्ते, मैं एजिस हूँ। आप कैसे हैं?"),
            "नमस्ते, मैं एजिस हूँ। आप कैसे हैं?",
        )

    def test_common_asr_spelling(self):
        self.assertEqual(
            clean_transcript("i dont think this is teh right way"),
            "I don't think this is the right way.",
        )

    def test_empty(self):
        self.assertEqual(clean_transcript("  "), "")

    def test_cleanup_never_answers_a_question(self):
        question = "What is the capital of India?"
        self.assertFalse(
            _safe_llm_cleanup(question, "The capital of India is New Delhi.")
        )
        self.assertFalse(
            _safe_llm_cleanup(question, "New Delhi is the capital of India?")
        )
        self.assertTrue(
            _safe_llm_cleanup(question, "What is the capital of India?")
        )
        self.assertFalse(needs_llm_cleanup(question))

    def test_hindi_question_is_not_answered(self):
        question = "राजधानी क्या है।"
        self.assertFalse(_safe_llm_cleanup(question, "राजधानी दिल्ली है।"))
        self.assertTrue(
            _safe_llm_cleanup(question, "भारत की राजधानी क्या है?")
        )

    def test_llm_cleanup_is_reserved_for_messy_speech(self):
        self.assertFalse(needs_llm_cleanup("open settings"))
        self.assertTrue(
            needs_llm_cleanup(
                "um so I I I need 500, not 500, 600, not 600, 200 units by friday"
            )
        )

    def test_tts_script_split(self):
        self.assertEqual(
            split_script_segments("नमस्ते, मैं Aegis हूँ। Hello, how can I help?"),
            [
                ("नमस्ते, मैं", "hi"),
                ("Aegis", "en"),
                ("हूँ।", "hi"),
                ("Hello, how can I help?", "en"),
            ],
        )


if __name__ == "__main__":
    unittest.main()
