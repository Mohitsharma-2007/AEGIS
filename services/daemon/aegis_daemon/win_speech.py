"""Windows speech engine wrapper — the engine behind Windows Voice Access.

Windows *Voice Access* is an accessibility shell feature: it has no public API
a third-party application can call, and its own vocabulary is hard-wired to
screen navigation.  The speech engine it is built on *is* public, though: the
WinRT ``Windows.Media.SpeechRecognition`` and
``Windows.Media.SpeechSynthesis`` APIs.  This module wraps that engine so
Aegis can drive it for command-only access:

* :meth:`WindowsSpeechEngine.recognize_once` - hear a single command
* :meth:`WindowsSpeechEngine.start_continuous` - a live command loop
* :meth:`WindowsSpeechEngine.synthesize` - Windows TTS rendered to WAV bytes

Command-only access uses ``SpeechRecognitionListConstraint``: Windows matches
the utterance against a fixed vocabulary, so the recogniser never returns free
text and never wastes time on dictation.  Optional dictation (one spoken
question, then back to commands) uses ``SpeechRecognitionTopicConstraint``.

Everything runs on a dedicated worker thread with its own COM apartment and
event loop: WinRT objects are apartment-bound, and the HTTP server must never
be blocked by the recogniser.
"""

from __future__ import annotations

import asyncio
import logging
import threading
from dataclasses import dataclass
from typing import Any, Callable, Iterable

logger = logging.getLogger("aegis.windows_speech")


class WindowsSpeechUnavailable(RuntimeError):
    """Raised when the Windows speech stack cannot be used on this machine."""


# 0x80045509: "The speech privacy policy was not accepted prior to
# attempting a speech recognition."  Windows requires the user to accept the
# "Speech, inking & typing" privacy statement once; until then every
# recognition call fails, no matter which application makes it.
PRIVACY_ERROR_HRESULT = 0x80045509

PRIVACY_HELP = (
    "Windows speech recognition is blocked by the system privacy setting. "
    "Open Settings > Time & language > Speech > 'Speech, inking & typing "
    "privacy settings', turn on 'Get to know me', then try again."
)


def is_privacy_error(error: BaseException | None) -> bool:
    """True when an error is the Windows speech privacy policy gate."""
    if error is None:
        return False
    text = str(error).lower()
    if "privacy policy" in text or "privacy" in text and "speech" in text:
        return True
    winerror = getattr(error, "winerror", None)
    if isinstance(winerror, int):
        return (winerror & 0xFFFFFFFF) == PRIVACY_ERROR_HRESULT
    return False


@dataclass(frozen=True)
class WindowsVoice:
    """One installed Windows text-to-speech voice."""

    id: str
    name: str
    language: str
    gender: str


@dataclass(frozen=True)
class RecognitionResult:
    """A single utterance produced by the Windows recogniser."""

    text: str
    confidence: float
    status: str


def _import_error() -> str | None:
    """Return a human readable reason when the WinRT packages are missing."""
    try:
        import winrt.runtime  # noqa: F401
        import winrt.windows.globalization  # noqa: F401
        import winrt.windows.media.speechrecognition  # noqa: F401
        import winrt.windows.media.speechsynthesis  # noqa: F401
        import winrt.windows.storage.streams  # noqa: F401
    except Exception as error:  # pragma: no cover - depends on the machine
        return f"{type(error).__name__}: {error}"
    return None


class WindowsSpeechEngine:
    """Thread-safe facade over the WinRT speech APIs.

    The engine owns one worker thread.  WinRT calls are scheduled onto that
    thread's event loop, so apartment rules are respected no matter which
    thread calls into the engine.
    """

    def __init__(self, language: str = "en-US"):
        self.language = language
        self._loop: asyncio.AbstractEventLoop | None = None
        self._thread: threading.Thread | None = None
        self._ready = threading.Event()
        self._shutdown = asyncio.Event()
        self._error: str | None = None
        self._recognizer: Any = None
        self._session: Any = None
        self._session_token: Any = None
        self._commands: list[str] = []
        self._mode = "commands"
        self._callback: Callable[[RecognitionResult], None] | None = None
        self._capture_next = False
        self._last_status = ""
        self._lock = threading.Lock()

    # -- lifecycle ---------------------------------------------------------

    def start(self) -> None:
        """Start the worker thread (idempotent)."""
        with self._lock:
            if self._thread and self._thread.is_alive():
                return
            self._thread = threading.Thread(
                target=self._thread_main, name="aegis-win-speech", daemon=True
            )
            self._thread.start()
        self._ready.wait(timeout=10)
        if self._error:
            raise WindowsSpeechUnavailable(self._error)

    def _thread_main(self) -> None:
        try:
            asyncio.run(self._worker_main())
        except Exception as error:  # pragma: no cover - runtime failure
            self._error = f"{type(error).__name__}: {error}"
            self._ready.set()

    async def _worker_main(self) -> None:
        missing = _import_error()
        if missing:
            self._error = (
                "The Windows speech runtime is not installed. Run "
                "pip install -r requirements-windows.txt"
            )
            self._ready.set()
            return
        from winrt.runtime import ApartmentType, init_apartment

        # WinRT objects are apartment-bound; this thread owns its own.
        init_apartment(ApartmentType.MULTI_THREADED)
        self._loop = asyncio.get_running_loop()
        self._ready.set()
        await self._shutdown.wait()

    async def _call(self, coro, timeout: float = 30.0):
        """Run a coroutine on the worker loop and await its result."""
        if self._error:
            raise WindowsSpeechUnavailable(self._error)
        self.start()
        loop = self._loop
        if loop is None:
            raise WindowsSpeechUnavailable("The Windows speech worker did not start.")
        future = asyncio.run_coroutine_threadsafe(coro, loop)
        return await asyncio.wait_for(
            asyncio.wrap_future(future), timeout=timeout
        )

    def stop(self) -> None:
        """Stop the worker thread."""
        loop = self._loop
        if loop is not None:
            try:
                loop.call_soon_threadsafe(self._shutdown.set)
            except RuntimeError:  # pragma: no cover - loop already closed
                pass

    @property
    def last_status(self) -> str:
        """The status of the most recent recognition result, if any."""
        return self._last_status

    # -- capabilities ------------------------------------------------------

    async def languages(self) -> dict[str, list[str]]:
        """Languages the platform can recognise (grammar and topic modes)."""

        async def _load() -> dict[str, list[str]]:
            from winrt.windows.media.speechrecognition import SpeechRecognizer

            def tags(values: Iterable[Any]) -> list[str]:
                return [str(item.language_tag) for item in values]

            return {
                "grammar": tags(SpeechRecognizer.supported_grammar_languages),
                "topic": tags(SpeechRecognizer.supported_topic_languages),
                "system": str(SpeechRecognizer.system_speech_language.language_tag),
            }

        return await self._call(_load())

    async def voices(self) -> list[WindowsVoice]:
        """Installed Windows text-to-speech voices."""

        async def _load() -> list[WindowsVoice]:
            from winrt.windows.media.speechsynthesis import SpeechSynthesizer

            found: list[WindowsVoice] = []
            for voice in SpeechSynthesizer.all_voices:
                found.append(
                    WindowsVoice(
                        id=str(voice.id),
                        name=str(voice.display_name),
                        language=str(voice.language),
                        gender="female" if int(voice.gender) == 1 else "male",
                    )
                )
            return found

        return await self._call(_load())

    async def compile_commands(self, commands: list[str]) -> str:
        """Compile the command vocabulary into the recogniser.

        Returns the WinRT compilation status as a string.
        """
        self._commands = list(commands)
        return await self._call(self._compile_commands(), timeout=60)

    async def _compile_commands(self) -> str:
        from winrt.windows.globalization import Language
        from winrt.windows.media.speechrecognition import (
            SpeechRecognitionListConstraint,
            SpeechRecognizer,
        )

        await self._teardown_session()
        recognizer = SpeechRecognizer(Language(self.language))
        if self._commands:
            recognizer.constraints.append(
                SpeechRecognitionListConstraint(list(self._commands))
            )
        result = await recognizer.compile_constraints_async()
        status = str(result.status)
        if "SUCCESS" not in status.upper():
            raise WindowsSpeechUnavailable(
                f"Windows could not compile the command vocabulary ({status})."
            )
        self._recognizer = recognizer
        return status

    # -- recognition -------------------------------------------------------

    async def recognize_once(self, timeout: float = 8.0) -> RecognitionResult | None:
        """Listen for a single command and return it."""
        return await self._call(self._recognize_once(timeout), timeout=timeout + 10)

    async def _recognize_once(self, timeout: float) -> RecognitionResult | None:
        from winrt.windows.globalization import Language
        from winrt.windows.media.speechrecognition import (
            SpeechRecognitionListConstraint,
            SpeechRecognizer,
        )

        await self._teardown_session()
        recognizer = SpeechRecognizer(Language(self.language))
        if self._commands:
            recognizer.constraints.append(
                SpeechRecognitionListConstraint(list(self._commands))
            )
        await recognizer.compile_constraints_async()
        self._recognizer = recognizer
        session = recognizer.continuous_recognition_session
        self._session = session
        queue: asyncio.Queue = asyncio.Queue()

        def _on_result(_sender: Any, args: Any) -> None:
            result = self._to_result(args.result)
            if result is not None:
                queue.put_nowait(result)

        session.add_result_generated(_on_result)
        await session.start_async()
        try:
            return await asyncio.wait_for(queue.get(), timeout=timeout)
        except asyncio.TimeoutError:
            return None
        finally:
            await self._teardown_session()

    async def start_continuous(
        self,
        callback: Callable[[RecognitionResult], None],
        *,
        commands: list[str] | None = None,
    ) -> None:
        """Start the live command loop.

        ``callback`` runs on the worker thread; callers must hop back to their
        own loop (the bridge does this with ``call_soon_threadsafe``).
        """
        if commands is not None:
            self._commands = list(commands)
        self._callback = callback
        await self._call(self._start_continuous(), timeout=60)

    async def _start_continuous(self) -> None:
        from winrt.windows.globalization import Language
        from winrt.windows.media.speechrecognition import (
            SpeechRecognitionListConstraint,
            SpeechRecognizer,
        )

        await self._teardown_session()
        recognizer = SpeechRecognizer(Language(self.language))
        if self._commands:
            recognizer.constraints.append(
                SpeechRecognitionListConstraint(list(self._commands))
            )
        await recognizer.compile_constraints_async()
        self._recognizer = recognizer
        session = recognizer.continuous_recognition_session
        self._session = session
        self._session_token = session.add_result_generated(self._on_result)
        await session.start_async()
        logger.info("Windows command recognition is live (%s)", self.language)

    async def stop_continuous(self) -> None:
        """Stop the live command loop."""
        await self._call(self._teardown_session(), timeout=15)

    async def _teardown_session(self) -> None:
        session = self._session
        self._session = None
        self._session_token = None
        if session is not None:
            try:
                await session.cancel_async()
            except Exception:  # pragma: no cover - best effort
                pass
        recognizer = self._recognizer
        self._recognizer = None
        if recognizer is not None:
            try:
                recognizer.close()
            except Exception:  # pragma: no cover - best effort
                pass

    def _on_result(self, _sender: Any, args: Any) -> None:
        """WinRT callback: a recognition result arrived."""
        try:
            self._last_status = str(args.result.status)
            result = self._to_result(args.result)
        except Exception as error:  # pragma: no cover - defensive
            logger.debug("Windows recognition result failed: %s", error)
            return
        if result is None:
            return
        callback = self._callback
        if callback is None:
            return
        try:
            callback(result)
        except Exception as error:  # pragma: no cover - defensive
            logger.warning("Windows command callback failed: %s", error)

    @staticmethod
    def _to_result(result: Any) -> RecognitionResult | None:
        status = str(result.status)
        if "SUCCESS" not in status.upper():
            return None
        text = str(result.text or "").strip()
        if not text:
            return None
        try:
            confidence = float(result.raw_confidence)
        except Exception:
            confidence = 0.0
        return RecognitionResult(text=text, confidence=confidence, status=status)

    # -- dictation ---------------------------------------------------------

    async def listen_dictation(
        self, topic_hint: str = "", timeout: float = 15.0
    ) -> RecognitionResult | None:
        """Capture a single free-form utterance.

        Command-only access does not need this, but it is what makes "ask
        Aegis …" work: the phrase after the command is captured as dictation
        and handed to the language model.
        """
        return await self._call(
            self._listen_dictation(topic_hint, timeout), timeout=timeout + 15
        )

    async def _listen_dictation(
        self, topic_hint: str, timeout: float
    ) -> RecognitionResult | None:
        from winrt.windows.globalization import Language
        from winrt.windows.media.speechrecognition import (
            SpeechRecognitionScenario,
            SpeechRecognitionTopicConstraint,
            SpeechRecognizer,
        )

        await self._teardown_session()
        recognizer = SpeechRecognizer(Language(self.language))
        recognizer.constraints.append(
            SpeechRecognitionTopicConstraint(
                SpeechRecognitionScenario.DICTATION, topic_hint
            )
        )
        await recognizer.compile_constraints_async()
        self._recognizer = recognizer
        session = recognizer.continuous_recognition_session
        self._session = session
        queue: asyncio.Queue = asyncio.Queue()

        def _on_result(_sender: Any, args: Any) -> None:
            result = self._to_result(args.result)
            if result is not None:
                queue.put_nowait(result)

        session.add_result_generated(_on_result)
        await session.start_async()
        try:
            return await asyncio.wait_for(queue.get(), timeout=timeout)
        except asyncio.TimeoutError:
            return None
        finally:
            await self._teardown_session()

    def request_dictation(self) -> None:
        """Ask the next utterance to be treated as free text.

        The bridge uses this after a spoken "ask Aegis" command: the very next
        utterance is captured as dictation and handed to the language model
        instead of being matched against the command vocabulary.
        """
        self._capture_next = True

    @property
    def capturing_dictation(self) -> bool:
        return self._capture_next

    def consume_dictation(self) -> bool:
        """Return (and clear) the pending dictation flag."""
        pending = self._capture_next
        self._capture_next = False
        return pending

    # -- privacy -----------------------------------------------------------

    async def request_privacy_acceptance(self, timeout: float = 120.0) -> bool:
        """Show the Windows speech consent dialog once.

        Windows keeps a single per-user "speech, inking & typing" choice.
        Accepting it there unlocks the speech recognition API for every
        application, Aegis included.
        """
        from winrt.windows.globalization import Language
        from winrt.windows.media.speechrecognition import SpeechRecognizer

        async def _show() -> bool:
            recognizer = SpeechRecognizer(Language(self.language))
            try:
                result = await recognizer.recognize_with_ui_async()
                return "SUCCESS" in str(result.status).upper()
            finally:
                try:
                    recognizer.close()
                except Exception:  # pragma: no cover - best effort
                    pass

        return await self._call(_show(), timeout=timeout)

    # -- synthesis ---------------------------------------------------------

    async def synthesize(self, text: str, voice_id: str | None = None) -> bytes:
        """Render text with the Windows voice and return WAV bytes."""
        return await self._call(self._synthesize(text, voice_id), timeout=60)

    async def _synthesize(self, text: str, voice_id: str | None) -> bytes:
        from winrt.windows.media.speechsynthesis import SpeechSynthesizer
        from winrt.windows.storage.streams import DataReader

        synth = SpeechSynthesizer()
        voices = list(SpeechSynthesizer.all_voices)
        chosen = None
        if voice_id:
            for voice in voices:
                if str(voice.id) == voice_id:
                    chosen = voice
                    break
        if chosen is None and voices:
            chosen = voices[0]
        if chosen is not None:
            synth.voice = chosen
        stream = await synth.synthesize_text_to_stream_async(text)
        size = int(stream.size)
        reader = DataReader(stream.get_input_stream_at(0))
        await reader.load_async(size)
        buffer = reader.read_buffer(size)
        return bytes(buffer)

    # -- status ------------------------------------------------------------

    async def status(self) -> dict[str, Any]:
        """Everything the UI needs to describe the Windows speech stack."""
        info: dict[str, Any] = {
            "available": False,
            "engine": "windows-media-speechrecognition",
            "language": self.language,
            "mode": "commands",
            "commands": len(self._commands),
            "error": self._error,
        }
        missing = _import_error()
        if missing:
            info["error"] = info["error"] or missing
            return info
        try:
            languages = await self.languages()
        except Exception as error:
            info["error"] = f"{type(error).__name__}: {error}"
            return info
        info["available"] = True
        info["languages"] = languages
        info["languageSupported"] = self.language in languages.get("grammar", [])
        try:
            info["voices"] = [
                {"id": voice.id, "name": voice.name, "language": voice.language}
                for voice in await self.voices()
            ]
        except Exception as error:  # pragma: no cover - defensive
            info["voices"] = []
            info["voiceError"] = f"{type(error).__name__}: {error}"
        return info
