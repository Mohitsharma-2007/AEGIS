"""Voice inference follows the provider selected in the Aegis host."""
from __future__ import annotations

import json
import os
import unittest
from unittest.mock import patch

from aegis_daemon.voice_pipeline import _voice_llm_config


class _Response:
    def __init__(self, value: dict):
        self.payload = json.dumps(value).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self, _limit: int):
        return self.payload


class VoiceProviderTests(unittest.TestCase):
    def test_reads_active_local_model_from_host_and_uses_ollama_key(self):
        host_response = _Response({
            "providerId": "local",
            "model": "granite4.1:3b-q3_K_S",
            "baseUrl": "http://127.0.0.1:11434/v1",
        })
        env = {
            "AEGIS_HOST_URL": "http://127.0.0.1:4310",
            "AEGIS_PROVIDER": "groq",
            "LLM_BASE_URL": "",
            "LLM_API_KEY": "",
            "GROQ_API_KEY": "",
            "OLLAMA_API_KEY": "",
            "LLM_MODEL": "",
        }
        with patch.dict(os.environ, env, clear=False), patch(
            "urllib.request.urlopen", return_value=host_response
        ):
            self.assertEqual(
                _voice_llm_config(),
                ("http://127.0.0.1:11434/v1", "ollama", "granite4.1:3b-q3_K_S"),
            )

    def test_local_fallback_does_not_require_openai_or_groq_key(self):
        env = {
            "AEGIS_PROVIDER": "local",
            "AEGIS_MODEL": "qwen3.5:0.8b",
            "AEGIS_HOST_URL": "http://127.0.0.1:4310",
            "LLM_BASE_URL": "",
            "LLM_API_KEY": "",
            "GROQ_API_KEY": "",
            "OLLAMA_API_KEY": "",
            "OLLAMA_BASE_URL": "http://127.0.0.1:11434/v1",
            "LLM_MODEL": "",
        }
        with patch.dict(os.environ, env, clear=False), patch(
            "urllib.request.urlopen", side_effect=OSError("host not ready")
        ):
            self.assertEqual(
                _voice_llm_config(),
                ("http://127.0.0.1:11434/v1", "ollama", "qwen3.5:0.8b"),
            )


if __name__ == "__main__":
    unittest.main()
