"""Aegis Windows Voice Bridge — command-only voice access on Windows 11.

Windows Voice Access is an accessibility feature, not an API: it cannot be
called from another application.  The speech engine underneath it *is* public
(``Windows.Media.SpeechRecognition``), and this service is the "custom API for
Windows" that puts it behind a clean HTTP/WebSocket contract:

``GET  /health``          - what the platform can do right now
``GET  /api/commands``    - the command vocabulary Aegis understands
``GET  /api/voices``      - installed Windows voices
``POST /api/recognize``   - listen for a single command
``POST /api/execute``     - run a command without a microphone
``POST /api/synthesize``  - Windows text-to-speech (WAV bytes)
``WS   /ws``              - a live session: commands in, spoken answers out

Every request that needs speech goes through the Windows engine, and only
Aegis consumes it.  The live session runs a Pipecat pipeline:

    WindowsCommandSTTService -> CleanTranscripts -> CommandGate
        -> aggregator -> language model -> Kokoro TTS -> client

``CommandGate`` is where the command-only rule lives: a recognised command is
turned into an action (open a surface, drive AEGIS Computer, change a
setting) and spoken confirmation, and it never reaches the language model.
Only spoken questions ("ask Aegis …") are handed to the model.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys
from pathlib import Path
from typing import Any, Awaitable, Callable

try:
    from dotenv import load_dotenv

    for _env_path in (
        Path(__file__).resolve().parents[3] / ".env.local",
        Path(__file__).resolve().parents[4] / ".env.local",
    ):
        if _env_path.exists():
            load_dotenv(_env_path, override=False)
except Exception:  # pragma: no cover - dotenv is optional
    pass

import httpx
from fastapi import FastAPI, WebSocket
from fastapi.responses import JSONResponse, Response
from pipecat.frames.frames import (
    BotStartedSpeakingFrame,
    BotStoppedSpeakingFrame,
    ErrorFrame,
    Frame,
    InterruptionFrame,
    LLMFullResponseEndFrame,
    LLMFullResponseStartFrame,
    LLMTextFrame,
    TranscriptionFrame,
    TTSSpeakFrame,
    UserStartedSpeakingFrame,
    UserStoppedSpeakingFrame,
)
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
    LLMUserAggregatorParams,
)
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.utils.time import time_now_iso8601
from pipecat.services.openai.llm import OpenAILLMService

from aegis_daemon import win_commands
from aegis_daemon.transcript import LlmTranscriptCleaner, needs_llm_cleanup
from aegis_daemon.tts_kokoro import KokoroTTSService, get_kokoro_engine
from aegis_daemon.voice_pipeline import CleanTranscripts, RawAudioSerializer
from aegis_daemon.win_commands import VoiceCommand
from aegis_daemon.win_speech import (
    PRIVACY_HELP,
    WindowsSpeechEngine,
    is_privacy_error,
)
from aegis_daemon.win_stt import WindowsCommandSTTService

logger = logging.getLogger("aegis.windows_bridge")
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO").upper())

SAMPLE_RATE = 16_000

SYSTEM_PROMPT = (
    "You are Aegis, a warm, concise voice operating system. The user's "
    "message is a cleaned speech transcript: fillers, stutters and "
    "self-corrections have already been resolved, so honour the final value "
    "they said and never resurrect a value they corrected. Treat every "
    "multi-digit number as one number (5006 is five thousand and six, not 5, "
    "00, 6). Match the language of the user's latest message. If they spoke "
    "English, reply in English; if they spoke Hindi, reply in Hindi; if they "
    "mixed Hindi and English (Hinglish), reply in natural Hinglish. Never "
    "switch to a different language on your own. When replying in Hindi or "
    "Hinglish, write Hindi words in Devanagari script and keep English "
    "technical terms in Latin script so the local voice can pronounce each "
    "part naturally. Keep spoken answers short (1-3 sentences) unless asked "
    "for detail. Never claim an action happened unless it did. You share the "
    "desktop with the AEGIS Computer surface (screen, browser, files, "
    "terminal, activity). If the user asks you to control the computer, "
    "browser, files or terminal, tell them the action needs the AEGIS "
    "Computer surface and offer to open it; never claim you clicked, typed "
    "or navigated unless the surface confirmed it."
)


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------


def _host_url() -> str:
    return (
        os.getenv("AEGIS_HOST_URL")
        or os.getenv("AEGIS_API_URL")
        or "http://127.0.0.1:4310"
    ).rstrip("/")


def _llm_settings() -> dict[str, Any]:
    base = os.getenv("LLM_BASE_URL", "https://api.groq.com/openai/v1")
    key = os.getenv("LLM_API_KEY") or os.getenv("GROQ_API_KEY", "")
    model = os.getenv("LLM_MODEL", "openai/gpt-oss-20b")
    return {"base": base, "key": key, "model": model}


def _language() -> str:
    return (os.getenv("WINDOWS_BRIDGE_LANGUAGE", "en-US") or "en-US").strip()


def _dictation_enabled() -> bool:
    value = (os.getenv("WINDOWS_BRIDGE_DICTATION", "1") or "1").strip().lower()
    return value not in {"0", "false", "off", "no"}


# ---------------------------------------------------------------------------
# Actions
# ---------------------------------------------------------------------------


class ActionSink:
    """Where a resolved command is delivered."""

    async def ui(self, action: str, payload: dict[str, Any]) -> None:  # pragma: no cover
        raise NotImplementedError

    async def computer(self, action: str, payload: dict[str, Any]) -> None:  # pragma: no cover
        raise NotImplementedError

    async def voice(self, action: str, payload: dict[str, Any]) -> None:  # pragma: no cover
        raise NotImplementedError

    async def host(
        self, method: str, path: str, body: dict[str, Any]
    ) -> tuple[bool, str]:  # pragma: no cover
        raise NotImplementedError


class HttpActionSink(ActionSink):
    """Collects actions for a plain HTTP request."""

    def __init__(self) -> None:
        self.actions: list[dict[str, Any]] = []
        self.messages: list[str] = []

    async def ui(self, action: str, payload: dict[str, Any]) -> None:
        self.actions.append({"type": "ui", "action": action, **payload})

    async def computer(self, action: str, payload: dict[str, Any]) -> None:
        self.actions.append({"type": "computer", "action": action, **payload})

    async def voice(self, action: str, payload: dict[str, Any]) -> None:
        self.actions.append({"type": "voice", "action": action, **payload})

    async def host(
        self, method: str, path: str, body: dict[str, Any]
    ) -> tuple[bool, str]:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.request(
                    method, f"{_host_url()}{path}", json=body or None
                )
            ok = response.status_code < 400
            return ok, f"HTTP {response.status_code}"
        except Exception as error:
            return False, f"{type(error).__name__}: {error}"


class WebSocketActionSink(ActionSink):
    """Forwards actions to the running Aegis window."""

    def __init__(self, websocket: WebSocket) -> None:
        self._websocket = websocket

    async def _send(self, payload: dict[str, Any]) -> None:
        try:
            await self._websocket.send_json(payload)
        except Exception:
            # The peer may have closed; the pipeline stops on its own.
            pass

    async def ui(self, action: str, payload: dict[str, Any]) -> None:
        await self._send({"type": "action", "action": action, **payload})

    async def computer(self, action: str, payload: dict[str, Any]) -> None:
        await self._send(
            {"type": "action", "action": "computer", "command": action, **payload}
        )

    async def voice(self, action: str, payload: dict[str, Any]) -> None:
        await self._send({"type": "action", "action": "voice", "command": action})

    async def host(
        self, method: str, path: str, body: dict[str, Any]
    ) -> tuple[bool, str]:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.request(
                    method, f"{_host_url()}{path}", json=body or None
                )
            ok = response.status_code < 400
            if not ok:
                await self._send(
                    {"type": "error", "error": f"{path} returned {response.status_code}"}
                )
            return ok, f"HTTP {response.status_code}"
        except Exception as error:
            message = f"{type(error).__name__}: {error}"
            await self._send({"type": "error", "error": message})
            return False, message


# ---------------------------------------------------------------------------
# Pipeline pieces
# ---------------------------------------------------------------------------


class WindowsCommandSource(FrameProcessor):
    """Pipeline head for the bridge.

    The microphone belongs to the Windows engine, so this processor only
    exists to give the pipeline a valid source.
    """

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        await self.push_frame(frame, direction)


class CommandGate(FrameProcessor):
    """Turn recognised commands into actions instead of prompts.

    A command never reaches the language model: it is executed locally and
    confirmed out loud.  Only a spoken question is handed on.
    """

    def __init__(
        self,
        sink: ActionSink,
        *,
        stt: WindowsCommandSTTService | None = None,
        on_transcription: Callable[[str], Awaitable[None]] | None = None,
        dictation: bool = True,
    ):
        super().__init__()
        self._sink = sink
        self._stt = stt
        self._on_transcription = on_transcription
        self._dictation = dictation

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if not isinstance(frame, TranscriptionFrame):
            await self.push_frame(frame, direction)
            return

        text = frame.text
        if self._on_transcription:
            await self._on_transcription(text)
        command = win_commands.resolve(text)
        if command is None:
            # Not a command (for example dictation): let the model answer.
            await self.push_frame(frame, direction)
            return
        if command.intent == "ask":
            await self._handle_ask(direction)
            return
        await self._handle_command(command, direction)

    async def _handle_command(self, command: VoiceCommand, direction: FrameDirection):
        payload = dict(command.payload)
        action = str(payload.get("action", ""))
        reply = command.reply
        if command.intent == "ui":
            await self._sink.ui(action, payload)
        elif command.intent == "computer":
            await self._sink.computer(action, payload)
        elif command.intent == "voice":
            await self._sink.voice(action, payload)
            if action == "help":
                reply = win_commands.describe()
        elif command.intent == "host":
            ok, message = await self._sink.host(
                str(payload.get("method", "GET")),
                str(payload.get("path", "/api/state")),
                dict(payload.get("body", {})),
            )
            if not ok and not reply:
                reply = "That did not work."

        if reply:
            await self.push_frame(
                TTSSpeakFrame(text=reply, append_to_context=False), direction
            )

    async def _handle_ask(self, direction: FrameDirection) -> None:
        """Capture one spoken question and hand it to the model."""
        if not self._dictation or self._stt is None:
            await self.push_frame(
                TTSSpeakFrame(
                    text="Dictation is not available on this machine.",
                    append_to_context=False,
                ),
                direction,
            )
            return
        await self.push_frame(
            TTSSpeakFrame(text="What should I ask?", append_to_context=False),
            direction,
        )
        try:
            text = await self._stt.capture_dictation()
        except Exception as error:  # pragma: no cover - runtime failure
            logger.warning("Dictation capture failed: %s", error)
            text = None
        if not text:
            await self.push_frame(
                TTSSpeakFrame(text="I did not catch that.", append_to_context=False),
                direction,
            )
            return
        if self._on_transcription:
            await self._on_transcription(text)
        await self.push_frame(UserStartedSpeakingFrame(), direction)
        await self.push_frame(
            TranscriptionFrame(
                text=text,
                user_id="windows",
                timestamp=time_now_iso8601(),
                finalized=True,
            ),
            direction,
        )
        await self.push_frame(UserStoppedSpeakingFrame(), direction)


class BridgeEventTap(FrameProcessor):
    """Send status, transcript and reply events to the client."""

    def __init__(self, websocket: WebSocket) -> None:
        super().__init__()
        self._websocket = websocket

    async def _send(self, payload: dict[str, Any]) -> None:
        try:
            await self._websocket.send_json(payload)
        except Exception:
            pass

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if isinstance(frame, LLMTextFrame):
            await self._send({"type": "text", "text": frame.text})
        elif isinstance(frame, LLMFullResponseStartFrame):
            await self._send({"type": "response-start"})
        elif isinstance(frame, LLMFullResponseEndFrame):
            await self._send({"type": "response-end"})
        elif isinstance(frame, BotStartedSpeakingFrame):
            await self._send({"type": "status", "state": "speaking"})
        elif isinstance(frame, BotStoppedSpeakingFrame):
            await self._send({"type": "status", "state": "listening"})
        elif isinstance(frame, InterruptionFrame):
            await self._send({"type": "interruption"})
        elif isinstance(frame, ErrorFrame):
            await self._send({"type": "error", "error": str(frame.error)})
        await self.push_frame(frame, direction)


# ---------------------------------------------------------------------------
# The service
# ---------------------------------------------------------------------------


class WindowsBridge:
    """Owns the engine and builds one Pipecat pipeline per session."""

    def __init__(self) -> None:
        self.engine = WindowsSpeechEngine(language=_language())
        self._sessions: dict[int, dict[str, Any]] = {}
        self._next_session = 0
        self._privacy_blocked = False

    @property
    def sessions(self) -> int:
        return len(self._sessions)

    @property
    def privacy_blocked(self) -> bool:
        """True once Windows refused recognition over the privacy policy."""
        return self._privacy_blocked

    def note_error(self, error: BaseException) -> None:
        if is_privacy_error(error):
            self._privacy_blocked = True

    def register_session(self, websocket: WebSocket, stt: Any) -> int:
        self._next_session += 1
        self._sessions[self._next_session] = {
            "websocket": websocket,
            "stt": stt,
        }
        return self._next_session

    def unregister_session(self, session_id: int) -> None:
        self._sessions.pop(session_id, None)

    async def simulate(self, text: str) -> bool:
        """Push a command into the live session as if it had been spoken."""
        for session in list(self._sessions.values()):
            stt = session.get("stt")
            if stt is not None:
                await stt.emit_text(text)
                return True
        return False

    async def status(self) -> dict[str, Any]:
        info = await self.engine.status()
        llm = _llm_settings()
        info.update(
            {
                "service": "aegis-windows-voice",
                "mode": "commands",
                "dictation": _dictation_enabled(),
                "llmModel": llm["model"],
                "llmBase": llm["base"],
                "llmConfigured": bool(llm["key"]),
                "hostUrl": _host_url(),
                "sessions": self.sessions,
                "commandCount": len(win_commands.COMMANDS),
                "privacyBlocked": self._privacy_blocked,
                "privacyHelp": PRIVACY_HELP if self._privacy_blocked else "",
                "listening": any(
                    bool(session.get("stt") and session["stt"].running)
                    for session in self._sessions.values()
                ),
                "lastStatus": self.engine.last_status,
            }
        )
        return info

    async def recognize_once(self, timeout: float = 8.0) -> dict[str, Any]:
        """Listen for one command and describe what it means."""
        try:
            result = await self.engine.recognize_once(timeout=timeout)
        except Exception as error:
            self.note_error(error)
            if is_privacy_error(error):
                return {
                    "ok": False,
                    "text": "",
                    "error": PRIVACY_HELP,
                    "action": "open-privacy-settings",
                }
            return {
                "ok": False,
                "text": "",
                "error": f"{type(error).__name__}: {error}",
            }
        if result is None:
            return {
                "ok": False,
                "text": "",
                "error": "No command was heard.",
                "lastStatus": self.engine.last_status,
            }
        command = win_commands.resolve(result.text)
        return {
            "ok": True,
            "text": result.text,
            "confidence": result.confidence,
            "intent": command.intent if command else "unknown",
            "action": dict(command.payload).get("action", "") if command else "",
            "reply": command.reply if command else "",
        }

    async def execute(self, text: str, sink: ActionSink) -> dict[str, Any]:
        """Run a command that was typed instead of spoken."""
        command = win_commands.resolve(text)
        if command is None:
            return {"ok": False, "error": f"Unknown command: {text}"}
        gate = CommandGate(sink)
        await gate._handle_command(command, FrameDirection.DOWNSTREAM)
        return {
            "ok": True,
            "text": text,
            "intent": command.intent,
            "action": dict(command.payload).get("action", ""),
            "reply": command.reply,
        }


bridge = WindowsBridge()


def build_pipeline(websocket: WebSocket):
    """Assemble the Pipecat pipeline for one live session."""
    from pipecat.transports.websocket.fastapi import (
        FastAPIWebsocketParams,
        FastAPIWebsocketTransport,
    )

    llm = _llm_settings()
    cleanup_mode = (os.getenv("VOICE_CLEANUP", "auto") or "auto").strip().lower()
    llm_cleaner = None
    remote_llm = not any(
        host in llm["base"] for host in ("127.0.0.1", "localhost", "0.0.0.0")
    )
    if cleanup_mode in {"auto", "llm"} and llm["key"] and remote_llm:
        llm_cleaner = LlmTranscriptCleaner(
            base_url=llm["base"],
            api_key=llm["key"],
            model=os.getenv("VOICE_CLEANUP_MODEL", llm["model"]),
            timeout=float(os.getenv("VOICE_CLEANUP_TIMEOUT", "3.0")),
        )

    transport_params = FastAPIWebsocketParams(
        # The Windows engine owns the microphone, so no audio comes in.
        audio_in_enabled=False,
        audio_out_enabled=True,
        audio_out_sample_rate=SAMPLE_RATE,
        serializer=RawAudioSerializer(),
    )
    transport = FastAPIWebsocketTransport(
        websocket=websocket,
        params=transport_params,
    )

    stt = WindowsCommandSTTService(bridge.engine, win_commands.phrases())
    context = LLMContext()
    user_agg, assistant_agg = LLMContextAggregatorPair(
        context,
        user_params=LLMUserAggregatorParams(
            vad_analyzer=None,
        ),
    )

    llm_service = OpenAILLMService(
        api_key=llm["key"] or "not-configured",
        base_url=llm["base"],
        model=llm["model"],
    )

    kokoro = get_kokoro_engine()
    if kokoro is not None:
        tts: Any = KokoroTTSService(kokoro)
        tts_name = "kokoro"
    else:
        from pipecat.services.piper.tts import PiperTTSService

        voices_dir = Path(
            os.getenv("VOICES_DIR")
            or (Path(__file__).resolve().parent.parent / "voices")
        )
        voice_id = os.getenv("PIPER_VOICE_EN", "en_US-lessac-medium")
        tts = PiperTTSService(model_path=str(voices_dir / f"{voice_id}.onnx"))
        tts_name = "piper"

    sink = WebSocketActionSink(websocket)

    async def on_transcription(text: str) -> None:
        try:
            await websocket.send_json({"type": "transcription", "text": text})
        except Exception:
            pass

    gate = CommandGate(
        sink,
        stt=stt,
        on_transcription=on_transcription,
        dictation=_dictation_enabled(),
    )

    pipeline = Pipeline(
        [
            transport.input(),
            stt,
            CleanTranscripts(llm_cleaner=llm_cleaner),
            gate,
            user_agg,
            llm_service,
            # The tap sits after the model so it can report the answer, and
            # before the voice so it can report when Aegis starts and stops
            # talking.
            BridgeEventTap(websocket),
            tts,
            transport.output(),
            assistant_agg,
        ]
    )
    return pipeline, transport, context, {
        "tts": tts_name,
        "stt": stt,
        "commands": len(win_commands.COMMANDS),
        "llmModel": llm["model"],
    }


async def run_session(websocket: WebSocket) -> None:
    pipeline, transport, context, info = await asyncio.to_thread(
        build_pipeline, websocket
    )
    task = PipelineTask(
        pipeline,
        params=PipelineParams(allow_interruptions=True),
    )
    session_id = bridge.register_session(websocket, info.get("stt"))

    async def watchdog() -> None:
        """Keep trying to listen.

        Windows blocks recognition until the user accepts the speech privacy
        statement.  The session stays alive and starts listening as soon as
        the setting is switched on.
        """
        stt = info.get("stt")
        while True:
            await asyncio.sleep(8)
            if stt is None or stt.running:
                continue
            try:
                if await stt.retry_start():
                    await websocket.send_json(
                        {"type": "status", "state": "listening"}
                    )
            except Exception as error:  # pragma: no cover - defensive
                logger.debug("Windows recognition retry failed: %s", error)

    watcher = asyncio.create_task(watchdog())

    @transport.event_handler("on_client_connected")
    async def on_connected(transport, client):
        context.add_message({"role": "system", "content": SYSTEM_PROMPT})
        try:
            await websocket.send_json({"type": "status", "state": "warming"})
            await websocket.send_json(
                {"type": "ready", "commands": win_commands.command_summary()}
            )
            await websocket.send_json({"type": "status", "state": "listening"})
        except Exception:
            pass

    @transport.event_handler("on_client_disconnected")
    async def on_disconnected(transport, client):
        await task.cancel()

    runner = PipelineRunner()
    try:
        await runner.run(task)
    except Exception as error:  # pragma: no cover - runtime failure
        bridge.note_error(error)
        message = (
            PRIVACY_HELP
            if is_privacy_error(error)
            else f"{type(error).__name__}: {error}"
        )
        logger.warning("Windows voice session stopped: %s", message)
        try:
            await websocket.send_json({"type": "error", "error": message})
        except Exception:
            pass
    finally:
        watcher.cancel()
        bridge.unregister_session(session_id)


def create_app() -> FastAPI:
    app = FastAPI(title="Aegis Windows Voice Bridge")

    @app.get("/health")
    async def health():
        try:
            info = await bridge.status()
        except Exception as error:  # pragma: no cover - defensive
            info = {"ok": False, "error": f"{type(error).__name__}: {error}"}
        return {"ok": bool(info.get("available")), **info}

    @app.get("/")
    async def root():
        return await health()

    @app.get("/api/commands")
    async def commands():
        return {
            "commands": win_commands.command_summary(),
            "phrases": win_commands.phrases(),
        }

    @app.get("/api/voices")
    async def voices():
        try:
            found = await bridge.engine.voices()
        except Exception as error:
            return JSONResponse(
                {"error": f"{type(error).__name__}: {error}"}, status_code=503
            )
        return {
            "voices": [
                {"id": voice.id, "name": voice.name, "language": voice.language}
                for voice in found
            ]
        }

    @app.post("/api/recognize")
    async def recognize(payload: dict | None = None):
        timeout = 8.0
        if isinstance(payload, dict):
            try:
                timeout = float(payload.get("timeout", timeout))
            except (TypeError, ValueError):
                pass
        try:
            return await bridge.recognize_once(timeout=timeout)
        except Exception as error:
            return JSONResponse(
                {"ok": False, "error": f"{type(error).__name__}: {error}"},
                status_code=503,
            )

    @app.post("/api/execute")
    async def execute(payload: dict | None = None):
        text = ""
        if isinstance(payload, dict):
            text = str(payload.get("text", "") or "").strip()
        if not text:
            return JSONResponse({"error": "Text is required."}, status_code=400)
        sink = HttpActionSink()
        result = await bridge.execute(text, sink)
        result["actions"] = sink.actions
        return result

    @app.post("/api/synthesize")
    async def synthesize(payload: dict | None = None):
        text = ""
        voice_id = None
        if isinstance(payload, dict):
            text = str(payload.get("text", "") or "").strip()
            voice_id = payload.get("voice")
        if not text:
            return JSONResponse({"error": "Text is required."}, status_code=400)
        try:
            audio = await bridge.engine.synthesize(text, voice_id)
        except Exception as error:
            return JSONResponse(
                {"error": f"{type(error).__name__}: {error}"}, status_code=503
            )
        return Response(
            content=audio,
            media_type="audio/wav",
            headers={"Cache-Control": "no-store"},
        )

    @app.post("/api/simulate")
    async def simulate(payload: dict | None = None):
        """Push a command into the live session as if it had been spoken."""
        text = ""
        if isinstance(payload, dict):
            text = str(payload.get("text", "") or "").strip()
        if not text:
            return JSONResponse({"error": "Text is required."}, status_code=400)
        delivered = await bridge.simulate(text)
        return {"ok": delivered, "text": text, "sessions": bridge.sessions}

    @app.post("/api/accept-privacy")
    async def accept_privacy():
        """Show the Windows speech consent dialog once.

        Windows keeps one per-user choice for "speech, inking & typing".
        Accepting it there unlocks the speech recognition API everywhere.
        """
        try:
            accepted = await bridge.engine.request_privacy_acceptance(timeout=180)
        except Exception as error:
            bridge.note_error(error)
            return JSONResponse(
                {"ok": False, "error": f"{type(error).__name__}: {error}"},
                status_code=503,
            )
        if accepted:
            bridge._privacy_blocked = False
        return {"ok": accepted, "privacyBlocked": bridge.privacy_blocked}

    @app.post("/api/open-privacy-settings")
    async def open_privacy_settings():
        """Open the Windows page that holds the speech privacy switch."""
        page = "ms-settings:privacy-speechtyping"
        try:
            os.startfile(page)  # noqa: S606 - Windows shell protocol
        except Exception as error:  # pragma: no cover - platform specific
            return JSONResponse(
                {"ok": False, "error": f"{type(error).__name__}: {error}"},
                status_code=503,
            )
        return {"ok": True, "opened": page, "help": PRIVACY_HELP}

    @app.websocket("/ws")
    async def ws(websocket: WebSocket):
        await websocket.accept()
        try:
            await run_session(websocket)
        except Exception as error:  # pragma: no cover - runtime failure
            logger.exception("Windows voice session failed")
            try:
                await websocket.send_json(
                    {"type": "error", "error": f"{type(error).__name__}: {error}"}
                )
            except Exception:
                pass

    return app


def main() -> None:
    import uvicorn

    parser = argparse.ArgumentParser(description="Aegis Windows Voice Bridge")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8767)
    args = parser.parse_args()
    uvicorn.run(create_app(), host=args.host, port=args.port)


if __name__ == "__main__":
    main()
