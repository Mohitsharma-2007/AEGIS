"""Pipecat STT service backed by the Windows speech engine.

Windows Voice Access drives its own recogniser and exposes no API, but the
engine underneath it does.  This service plugs that engine into a Pipecat
pipeline exactly like a cloud STT service: it publishes ``TranscriptionFrame``
objects, announces its own latency through ``STTMetadataFrame`` and lets the
rest of the pipeline (cleanup, language model, TTS) stay unchanged.

Because the engine is command-only, the text it produces is always one of the
phrases in the compiled vocabulary.
"""

from __future__ import annotations

import asyncio
import logging
from typing import AsyncGenerator, Sequence

from pipecat.frames.frames import (
    CancelFrame,
    EndFrame,
    ErrorFrame,
    StartFrame,
    TranscriptionFrame,
    UserStartedSpeakingFrame,
    UserStoppedSpeakingFrame,
)
from pipecat.services.stt_service import STTService
from pipecat.utils.time import time_now_iso8601

from aegis_daemon.win_speech import RecognitionResult, WindowsSpeechEngine

logger = logging.getLogger("aegis.windows_stt")

# The Windows recogniser decides the turn boundary itself, so the "speech end
# to final transcript" delay is only the time the engine needs to match the
# phrase it already heard.
TTFS_P99 = 0.35


class WindowsCommandSTTService(STTService):
    """STT service that listens with the Windows speech engine."""

    def __init__(
        self,
        engine: WindowsSpeechEngine,
        commands: Sequence[str],
        *,
        ttfs_p99_latency: float = TTFS_P99,
        **kwargs,
    ):
        super().__init__(
            audio_passthrough=False,
            sample_rate=16_000,
            ttfs_p99_latency=ttfs_p99_latency,
            **kwargs,
        )
        self._engine = engine
        self._commands = list(commands)
        self._loop: asyncio.AbstractEventLoop | None = None
        self._running = False
        self._error: str | None = None

    @property
    def commands(self) -> list[str]:
        return list(self._commands)

    @property
    def running(self) -> bool:
        """True while the Windows recogniser is listening."""
        return self._running

    @property
    def error(self) -> str | None:
        """The last error that stopped the recogniser (if any)."""
        return self._error

    async def run_stt(self, audio: bytes) -> AsyncGenerator[Frame | None, None]:
        """Not used: the Windows engine owns the microphone.

        Transcripts arrive through the recogniser callback, not through audio
        frames, so this generator stays empty.
        """
        if False:  # pragma: no cover - keeps this an async generator
            yield None

    async def setup(self, setup):
        await super().setup(setup)
        self._loop = asyncio.get_running_loop()

    async def start(self, frame: StartFrame):
        await super().start(frame)
        self._loop = asyncio.get_running_loop()
        await self._start_recogniser()

    async def _start_recogniser(self) -> bool:
        """Start listening; a failure must not kill the whole session.

        Windows refuses recognition until the user accepts the "speech,
        inking & typing" privacy statement, so the service keeps the pipeline
        alive and retries until the setting is switched on.
        """
        if self._running:
            return True
        try:
            await self._engine.start_continuous(
                self._on_result, commands=self._commands
            )
        except Exception as error:
            self._error = f"{type(error).__name__}: {error}"
            logger.warning("Windows recognition is not available yet: %s", self._error)
            await self.push_frame(ErrorFrame(error=self._error))
            return False
        self._error = None
        self._running = True
        logger.info(
            "WindowsCommandSTTService started with %d commands", len(self._commands)
        )
        return True

    async def retry_start(self) -> bool:
        """Try again to start listening (used by the session watchdog)."""
        if self._running:
            return True
        return await self._start_recogniser()

    async def emit_text(self, text: str) -> None:
        """Publish a command as if the recogniser had heard it.

        This keeps the session testable while the Windows privacy switch is
        still off, and lets the UI replay a command.
        """
        await self._emit(RecognitionResult(text=text, confidence=1.0, status="Success"))

    async def stop(self, frame: EndFrame):
        await self._teardown()
        await super().stop(frame)

    async def cancel(self, frame: CancelFrame):
        await self._teardown()
        await super().cancel(frame)

    async def _teardown(self) -> None:
        if not self._running:
            return
        self._running = False
        try:
            await self._engine.stop_continuous()
        except Exception as error:  # pragma: no cover - shutdown race
            logger.debug("Stopping Windows recognition failed: %s", error)

    def _on_result(self, result: RecognitionResult) -> None:
        """Called on the Windows worker thread."""
        loop = self._loop
        if loop is None or loop.is_closed():
            return
        loop.call_soon_threadsafe(
            lambda: asyncio.ensure_future(self._emit(result))
        )

    async def capture_dictation(self, timeout: float = 15.0) -> str | None:
        """Capture one spoken question instead of a command.

        The command recogniser is paused for the duration and restarted
        afterwards, so the session keeps listening for commands.
        """
        await self._engine.stop_continuous()
        try:
            result = await self._engine.listen_dictation(timeout=timeout)
        finally:
            await self._engine.start_continuous(
                self._on_result, commands=self._commands
            )
        return result.text if result else None

    async def _emit(self, result: RecognitionResult) -> None:
        """Publish the command as a finished user turn."""
        try:
            await self.push_frame(UserStartedSpeakingFrame())
            await self.push_frame(
                TranscriptionFrame(
                    text=result.text,
                    user_id="windows",
                    timestamp=time_now_iso8601(),
                    language=self._engine.language,
                    finalized=True,
                )
            )
            await self.push_frame(UserStoppedSpeakingFrame())
        except Exception as error:  # pragma: no cover - defensive
            logger.warning("Could not publish the Windows command: %s", error)
