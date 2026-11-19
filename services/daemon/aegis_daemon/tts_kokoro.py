"""Kokoro-82M text-to-speech for English + Hindi (Hinglish aware).

Kokoro is an 82M-parameter, Apache-2.0 TTS model.  It is small enough to run on
a laptop CPU, yet its English voices are markedly more natural than Piper's
robotic formant output.  This module:

* loads the ONNX model once per process and shares it across sessions;
* switches between an English and a Hindi voice based on the script of each
  phrase, so "नमस्ते, I am Aegis" is pronounced by the right voice for each part;
* exposes both a Pipecat TTS service (streaming voice replies) and a plain
  ``synthesize_pcm`` helper (Settings "Test voice", read-aloud).

Piper remains the fallback when the Kokoro files are not installed, so the
application keeps working on machines that only have the older voices.
"""

from __future__ import annotations

import asyncio
import logging
import os
import threading
from pathlib import Path
from typing import AsyncIterator

import numpy as np

from pipecat.frames.frames import ErrorFrame
from pipecat.services.settings import TTSSettings
from pipecat.services.tts_service import TTSService

logger = logging.getLogger(__name__)

SAMPLE_RATE = 24_000
_SILENCE_SECS = 0.06


def _voices_dir() -> Path:
    raw = os.getenv("VOICES_DIR")
    if raw:
        return Path(raw).expanduser().resolve()
    return (Path(__file__).resolve().parent.parent / "voices").resolve()


def _segment_kind(char: str) -> str | None:
    if "\u0900" <= char <= "\u097F":
        return "hi"
    if char.isascii() and char.isalpha():
        return "en"
    return None


def split_script_segments(text: str) -> list[tuple[str, str]]:
    """Split text into (segment, language) runs by script.

    ``नमस्ते Aegis, how are you?`` becomes three runs so the Hindi voice reads
    the Hindi words and the English voice reads the English words.  Digits and
    punctuation stay with the surrounding run.
    """
    value = (text or "").strip()
    if not value:
        return []
    runs: list[tuple[str, str]] = []
    current: list[str] = []
    current_kind: str | None = None

    def flush() -> None:
        nonlocal current, current_kind
        segment = "".join(current).strip()
        if segment and any(ch.isalpha() for ch in segment):
            runs.append((segment, current_kind or "en"))
        current = []
        current_kind = None

    for char in value:
        kind = _segment_kind(char)
        if kind and current_kind and kind != current_kind:
            flush()
        if kind and not current_kind:
            current_kind = kind
        current.append(char)
    flush()
    return runs


class KokoroEngine:
    """Process-wide Kokoro model with a small, language-aware API."""

    def __init__(
        self,
        *,
        model_path: Path | None = None,
        voices_path: Path | None = None,
        voice_en: str | None = None,
        voice_hi: str | None = None,
        speed: float | None = None,
    ):
        base = _voices_dir() / "kokoro"
        if model_path is None:
            configured = os.getenv("KOKORO_MODEL", "").strip()
            if configured:
                model_path = Path(configured)
            else:
                # The quantized ONNX model is ~3x smaller and about 35% faster
                # on CPU with no audible loss for these voices.  When an
                # accelerated onnxruntime build is present, use the full model.
                quantized = base / "kokoro-v1.0.int8.onnx"
                full = base / "kokoro-v1.0.onnx"
                try:
                    import onnxruntime as ort

                    accelerated = "CUDAExecutionProvider" in ort.get_available_providers()
                except Exception:
                    accelerated = False
                model_path = full if accelerated or not quantized.exists() else quantized
        self.model_path = model_path.expanduser()
        self.voices_path = (
            voices_path
            or Path(
                os.getenv("KOKORO_VOICES", str(base / "voices-v1.0.bin"))
            ).expanduser()
        )
        self.voice_en = voice_en or os.getenv("KOKORO_VOICE_EN", "af_heart")
        self.voice_hi = voice_hi or os.getenv("KOKORO_VOICE_HI", "hf_alpha")
        self.speed = float(speed if speed is not None else os.getenv("KOKORO_SPEED", "1.0"))
        self._kokoro = None
        self._lock = threading.Lock()
        self.error: str | None = None

    @property
    def available(self) -> bool:
        return self.error is None and self.model_path.exists() and self.voices_path.exists()

    def load(self) -> bool:
        if self._kokoro is not None:
            return True
        if not self.available:
            if self.error is None:
                self.error = (
                    f"Kokoro model not found ({self.model_path} / {self.voices_path})"
                )
            return False
        try:
            from kokoro_onnx import Kokoro

            logger.info("Loading Kokoro-82M from %s", self.model_path)
            self._kokoro = Kokoro(str(self.model_path), str(self.voices_path))
            logger.info("Kokoro-82M ready")
            return True
        except Exception as error:  # pragma: no cover - dependency/runtime failure
            self.error = f"{type(error).__name__}: {error}"
            logger.warning("Kokoro unavailable: %s", self.error)
            return False

    def _synthesize_segment(self, segment: str, language: str) -> bytes:
        if not self.load() or self._kokoro is None:
            return b""
        voice = self.voice_hi if language == "hi" else self.voice_en
        lang = "hi" if language == "hi" else "en-us"
        with self._lock:
            samples, sample_rate = self._kokoro.create(
                segment,
                voice=voice,
                speed=self.speed,
                lang=lang,
            )
        if sample_rate != SAMPLE_RATE:
            # Kokoro v1.0 always synthesises at 24 kHz; guard against a future
            # model change instead of silently playing at the wrong speed.
            logger.warning("Kokoro returned %s Hz, expected %s", sample_rate, SAMPLE_RATE)
        audio = np.asarray(samples, dtype=np.float32)
        return (np.clip(audio, -1.0, 1.0) * 32767.0).astype(np.int16).tobytes()

    async def stream_pcm(self, text: str) -> AsyncIterator[tuple[bytes, int]]:
        segments = split_script_segments(text)
        if not segments:
            return
        silence = b"\x00\x00" * int(SAMPLE_RATE * _SILENCE_SECS)
        for index, (segment, language) in enumerate(segments):
            audio = await asyncio.to_thread(self._synthesize_segment, segment, language)
            if audio:
                yield audio, SAMPLE_RATE
            if index < len(segments) - 1:
                yield silence, SAMPLE_RATE

    async def synthesize_pcm(self, text: str) -> tuple[bytes, int]:
        chunks: list[bytes] = []
        async for audio, rate in self.stream_pcm(text):
            if audio:
                chunks.append(audio)
        return b"".join(chunks), SAMPLE_RATE


_engine: KokoroEngine | None = None
_engine_lock = threading.Lock()
_engine_failed = False


def get_kokoro_engine() -> KokoroEngine | None:
    """Return the shared engine, or ``None`` when Kokoro is not installed."""
    global _engine, _engine_failed
    with _engine_lock:
        if _engine is not None:
            return _engine if _engine.load() else None
        if _engine_failed:
            return None
        candidate = KokoroEngine()
        if not candidate.available:
            logger.info("Kokoro files are not installed; using Piper")
            _engine_failed = True
            return None
        if not candidate.load():
            _engine_failed = True
            return None
        _engine = candidate
        return _engine


class KokoroTTSService(TTSService):
    """Pipecat TTS service backed by Kokoro-82M."""

    def __init__(self, engine: KokoroEngine, **kwargs):
        super().__init__(
            push_start_frame=True,
            push_stop_frames=True,
            sample_rate=SAMPLE_RATE,
            settings=TTSSettings(voice=engine.voice_en),
            **kwargs,
        )
        self._engine = engine

    def can_generate_metrics(self) -> bool:
        return True

    async def run_tts(self, text: str, context_id: str):
        try:
            await self.start_tts_usage_metrics(text)

            async def iterator() -> AsyncIterator[bytes]:
                async for audio, _rate in self._engine.stream_pcm(text):
                    yield audio

            async for frame in self._stream_audio_frames_from_iterator(
                iterator(),
                in_sample_rate=SAMPLE_RATE,
                context_id=context_id,
            ):
                await self.stop_ttfb_metrics()
                yield frame
        except Exception as error:  # pragma: no cover - runtime failure
            logger.warning("Kokoro TTS failed: %s", error)
            yield ErrorFrame(error=f"Kokoro TTS failed: {error}")
        finally:
            await self.stop_ttfb_metrics()
