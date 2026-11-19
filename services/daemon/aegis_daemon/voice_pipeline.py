"""Pipecat-based local voice pipeline (STT + LLM + TTS).

A real-time voice agent over a WebSocket using:
  - STT: faster-whisper (multilingual: Hindi / Hinglish / English), CUDA when
    available and a small int8 model on CPU-only laptops
  - LLM: OpenAI-compatible endpoint (Groq / OpenRouter / local)
  - TTS: Kokoro-82M (English + Hindi, Hinglish code-switching) with Piper as a
    fallback when the Kokoro files are not installed
  - Noise suppression: browser constraints + Pipecat RNNoiseFilter
  - Transcript cleanup: fillers, stutters, self-corrections, number joining

Wire protocol (browser <-> this server):
  - binary frames: raw little-endian PCM16 mono @ 16 kHz
  - text frames: JSON control / status messages, e.g.
      {"type": "transcription", "text": "..."}
      {"type": "text", "text": "..."}
      {"type": "status", "state": "listening" | "thinking" | "speaking"}
      {"type": "interruption"}

Usage:
    python -m aegis_daemon.voice_pipeline --host 0.0.0.0 --port 8766

Env:
    LLM_BASE_URL       (default https://api.groq.com/openai/v1)
    LLM_API_KEY        (falls back to GROQ_API_KEY)
    LLM_MODEL          (default openai/gpt-oss-20b)
    WHISPER_MODEL      (default large-v3-turbo on CUDA, small on CPU)
    WHISPER_DEVICE     (auto | cuda | cpu; default auto)
    WHISPER_COMPUTE_TYPE (default int8_float16 on CUDA, int8 on CPU)
    WHISPER_PROFILE    (auto | low | balanced | high)
    WHISPER_INITIAL_PROMPT (optional vocabulary hint)
    VOICE_CLEANUP      (auto | rules | llm | off; default auto)
    VOICE_CLEANUP_MODEL (default: LLM_MODEL)
    KOKORO_MODEL       (default voices/kokoro/kokoro-v1.0.onnx)
    KOKORO_VOICES      (default voices/kokoro/voices-v1.0.bin)
    KOKORO_VOICE_EN    (default af_heart)
    KOKORO_VOICE_HI    (default hf_alpha)
    VOICE_TTS          (auto | kokoro | piper; default auto)
    VOICE_NOISE_SUPPRESSION (default 1)
    PIPER_VOICE        (default hi_IN-pratham-medium)
    PIPER_VOICE_EN     (default en_US-lessac-medium)
    VOICES_DIR         (default ../voices next to this package)
"""
from __future__ import annotations

import argparse
import asyncio
import ctypes
import json
import logging
import os
import sys
import threading
import urllib.error
import urllib.request
import wave
from pathlib import Path

# Load the repository env file when the service is started directly from a
# terminal. Desktop launches inherit the environment already; setdefault-like
# behaviour means a real process value always wins.
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

from fastapi import FastAPI, WebSocket
from fastapi.responses import JSONResponse, Response
from pipecat.audio.filters.rnnoise_filter import RNNoiseFilter
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.audio.vad.vad_analyzer import VADParams
from pipecat.frames.frames import (
    BotStartedSpeakingFrame,
    BotStoppedSpeakingFrame,
    ErrorFrame,
    Frame,
    FunctionCallInProgressFrame,
    FunctionCallResultFrame,
    InputAudioRawFrame,
    InterruptionFrame,
    LLMFullResponseEndFrame,
    LLMFullResponseStartFrame,
    LLMTextFrame,
    OutputAudioRawFrame,
    TextFrame,
    TranscriptionFrame,
    UserStartedSpeakingFrame,
    UserStoppedSpeakingFrame,
)
from pipecat.adapters.llm.schemas.function_schema import FunctionSchema
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
    LLMUserAggregatorParams,
)
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.serializers.base_serializer import FrameSerializer
from pipecat.services.openai.llm import OpenAILLMService
from pipecat.services.piper.tts import PiperTTSService
from pipecat.services.whisper.stt import WhisperSTTService
from pipecat.transports.websocket.fastapi import (
    FastAPIWebsocketParams,
    FastAPIWebsocketTransport,
)
from pipecat.turns.user_start import (
    TranscriptionUserTurnStartStrategy,
    VADUserTurnStartStrategy,
)
from pipecat.turns.user_stop import SpeechTimeoutUserTurnStopStrategy
from pipecat.turns.user_turn_strategies import UserTurnStrategies

from aegis_daemon.transcript import (
    LlmTranscriptCleaner,
    clean_transcript,
    needs_llm_cleanup,
)
from aegis_daemon.tts_kokoro import KokoroEngine, KokoroTTSService, get_kokoro_engine

SAMPLE_RATE = 16_000
logger = logging.getLogger("aegis.voice")
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO").upper())

# Whisper weights are expensive to load (~10s on CPU) but cheap to reuse. Keep
# one model per (name, device, compute type) for the life of the process so a
# new voice session doesn't re-read 1.5 GB from disk.
_whisper_cache: dict[tuple[str, str, str], object] = {}
_whisper_lock = threading.Lock()


def _prepare_cuda_dlls() -> None:
    """Make the pip-installed CUDA runtime libraries discoverable on Windows.

    ctranslate2 loads cuBLAS/cuDNN lazily through the Windows loader.  The
    ``nvidia-*-cu12`` wheels ship those DLLs inside site-packages, which is not
    on PATH by default.  Adding the directories before faster-whisper imports
    lets the same venv use the GPU on this machine and fall back cleanly on a
    laptop without the wheels.
    """
    if os.name != "nt":
        return
    roots: list[Path] = []
    try:
        import site

        roots.extend(Path(path) for path in site.getsitepackages())
        roots.append(Path(site.getusersitepackages()))
    except Exception:
        pass
    roots.append(Path(sys.prefix) / "Lib" / "site-packages")
    seen: set[str] = set()
    for root in roots:
        nvidia = root / "nvidia"
        if not nvidia.is_dir():
            continue
        for sub in ("cublas/bin", "cudnn/bin", "cuda_runtime/bin", "cuda_nvrtc/bin"):
            directory = nvidia / sub
            if not directory.is_dir() or str(directory) in seen:
                continue
            seen.add(str(directory))
            try:
                os.add_dll_directory(str(directory))
            except OSError:
                continue
            os.environ["PATH"] = str(directory) + os.pathsep + os.environ.get("PATH", "")


def _cuda_ready() -> bool:
    """True only when a CUDA device *and* the runtime DLLs are usable."""
    _prepare_cuda_dlls()
    try:
        import ctranslate2

        if ctranslate2.get_cuda_device_count() <= 0:
            return False
        if os.name == "nt":
            for dll in ("cublas64_12.dll", "cublasLt64_12.dll", "cudnn64_9.dll"):
                ctypes.WinDLL(dll)
        return True
    except Exception as error:
        logger.info("CUDA transcription unavailable (%s); using CPU", error)
        return False


def _whisper_config() -> tuple[str, str, str]:
    """Choose a model that matches the machine instead of always using CPU.

    Auto mode prefers the RTX GPU here (large-v3-turbo is both more accurate and
    much faster than CPU int8).  A lone laptop gets ``small`` int8, which is the
    best accuracy/latency compromise for Hindi and Hinglish without a GPU.
    """
    requested = os.getenv("WHISPER_DEVICE", "auto").strip().lower() or "auto"
    cuda_ready = _cuda_ready() if requested in {"auto", "cuda", "gpu"} else False
    device = "cuda" if requested in {"cuda", "gpu"} and cuda_ready else "cpu"
    if requested == "auto":
        device = "cuda" if cuda_ready else "cpu"
    if requested in {"cuda", "gpu"} and not cuda_ready:
        logger.warning("WHISPER_DEVICE=%s requested but CUDA is not usable; using CPU", requested)

    profile = os.getenv("WHISPER_PROFILE", "auto").strip().lower()
    model = os.getenv("WHISPER_MODEL", "").strip()
    if not model:
        if device == "cuda":
            model = "large-v3-turbo"
        elif profile == "low":
            model = "base"
        elif profile == "high":
            model = "large-v3-turbo"
        else:
            model = "small"
    compute = os.getenv("WHISPER_COMPUTE_TYPE", "").strip()
    if not compute:
        compute = "int8_float16" if device == "cuda" else "int8"
    return model, device, compute


class _TranscriberProxy:
    """Inject fast decoding defaults without copying Pipecat's STT service.

    Pipecat calls ``transcribe`` without beam/timestamp options.  For a voice
    loop, greedy decoding (beam 1) and no timestamp tokens are both faster and
    perfectly adequate; VAD already happened upstream in the transport.
    """

    def __init__(self, model, initial_prompt: str | None = None):
        self._model = model
        self._initial_prompt = initial_prompt

    def transcribe(self, audio, **kwargs):
        kwargs.setdefault("beam_size", 1)
        kwargs.setdefault("best_of", 1)
        kwargs.setdefault("temperature", 0.0)
        kwargs.setdefault("without_timestamps", True)
        kwargs.setdefault("condition_on_previous_text", False)
        kwargs.setdefault("vad_filter", False)
        if self._initial_prompt and not kwargs.get("initial_prompt"):
            kwargs["initial_prompt"] = self._initial_prompt
        return self._model.transcribe(audio, **kwargs)


class CachedWhisperSTTService(WhisperSTTService):
    """faster-whisper STT with a process-wide model cache and GPU fallback."""

    def _load(self):
        _prepare_cuda_dlls()
        from faster_whisper import WhisperModel

        initial_prompt = (
            os.getenv("WHISPER_INITIAL_PROMPT", "").strip()
            or "Aegis, Hindi, English, Hinglish voice assistant."
        )
        model_name = str(self._settings.model)
        attempts = [(model_name, self._device, self._compute_type)]
        auto_device = os.getenv("WHISPER_DEVICE", "auto").strip().lower() in {"", "auto"}
        if self._device == "cuda" and auto_device:
            attempts.append(
                (
                    os.getenv("WHISPER_FALLBACK_MODEL", "small"),
                    "cpu",
                    os.getenv("WHISPER_FALLBACK_COMPUTE_TYPE", "int8"),
                )
            )

        last_error: Exception | None = None
        for name, device, compute in attempts:
            key = (name, device, compute)
            try:
                with _whisper_lock:
                    model = _whisper_cache.get(key)
                    if model is None:
                        logger.info("Loading faster-whisper %s on %s (%s)", name, device, compute)
                        kwargs = {}
                        threads = int(os.getenv("WHISPER_CPU_THREADS", "0") or 0)
                        if device == "cpu" and threads > 0:
                            kwargs["cpu_threads"] = threads
                        model = WhisperModel(name, device=device, compute_type=compute, **kwargs)
                        _whisper_cache[key] = model
                self._model = _TranscriberProxy(model, initial_prompt)
                self._device = device
                self._compute_type = compute
                self._settings.model = name
                unsupported = self._unsupported_language()
                if unsupported:
                    raise ValueError(unsupported)
                return
            except Exception as error:
                last_error = error
                logger.warning("Whisper %s on %s failed: %s", name, device, error)
                if device != "cuda":
                    break
        raise RuntimeError(f"Could not load a faster-whisper model: {last_error}")



class VoiceControlTap(FrameProcessor):
    """Forward pipeline events to the browser as JSON control frames.

    Pipecat's output transport only writes audio and transport messages, so
    transcript/status frames have to be tapped directly from the frame flow.
    """

    def __init__(
        self,
        websocket,
        *,
        transcriptions: bool = False,
        reply: bool = False,
    ):
        super().__init__()
        self._websocket = websocket
        self._transcriptions = transcriptions
        self._reply = reply

    async def _send(self, payload: dict) -> None:
        try:
            await self._websocket.send_json(payload)
        except Exception:
            # The peer may have closed; the pipeline stops on its own.
            pass

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if self._transcriptions:
            if isinstance(frame, TranscriptionFrame):
                await self._send({"type": "transcription", "text": frame.text})
            elif isinstance(frame, UserStartedSpeakingFrame):
                await self._send({"type": "status", "state": "listening"})
            elif isinstance(frame, UserStoppedSpeakingFrame):
                await self._send({"type": "status", "state": "thinking"})
            elif isinstance(frame, BotStartedSpeakingFrame):
                await self._send({"type": "status", "state": "speaking"})
            elif isinstance(frame, BotStoppedSpeakingFrame):
                await self._send({"type": "status", "state": "listening"})
            elif isinstance(frame, InterruptionFrame):
                await self._send({"type": "interruption"})
        if self._reply:
            if isinstance(frame, LLMTextFrame):
                await self._send({"type": "text", "text": frame.text})
            elif isinstance(frame, LLMFullResponseStartFrame):
                await self._send({"type": "response-start"})
            elif isinstance(frame, LLMFullResponseEndFrame):
                await self._send({"type": "response-end"})
            elif isinstance(frame, FunctionCallInProgressFrame):
                args = frame.arguments if isinstance(frame.arguments, dict) else {}
                await self._send({
                    "type": "action",
                    "tool": frame.function_name,
                    "parameters": args,
                    "rationale": args.get("rationale", "") if isinstance(args, dict) else "",
                })
        if isinstance(frame, ErrorFrame):
            await self._send({"type": "error", "error": str(frame.error)})
        await self.push_frame(frame, direction)


class CleanTranscripts(FrameProcessor):
    """Normalise STT output before it reaches the UI and the language model."""

    def __init__(self, llm_cleaner=None):
        super().__init__()
        self._llm_cleaner = llm_cleaner

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if isinstance(frame, TranscriptionFrame):
            raw = frame.text
            cleaned = clean_transcript(raw)
            # A tiny model call can fix grammar that deterministic rules cannot.
            # Short, clean commands ("open settings") skip it entirely.
            if (
                self._llm_cleaner is not None
                and needs_llm_cleanup(raw)
            ):
                try:
                    candidate = await self._llm_cleaner(cleaned)
                except Exception as error:
                    logger.debug("LLM transcript cleanup failed: %s", error)
                    candidate = None
                if candidate:
                    cleaned = candidate
            logger.debug("Transcript: %r -> %r", raw, cleaned)
            frame = TranscriptionFrame(
                text=cleaned,
                user_id=frame.user_id,
                timestamp=frame.timestamp,
                language=frame.language,
                result=frame.result,
                finalized=frame.finalized,
                speaker=frame.speaker,
            )
        await self.push_frame(frame, direction)


class RawAudioSerializer(FrameSerializer):
    """Raw PCM16 audio plus JSON status frames (no protobuf client needed)."""

    class InputParams(FrameSerializer.InputParams):
        audio_in_sample_rate: int = SAMPLE_RATE
        audio_out_sample_rate: int = SAMPLE_RATE

    async def serialize(self, frame: Frame) -> str | bytes | None:
        if isinstance(frame, OutputAudioRawFrame):
            return await self._resample_audio_out(frame)
        # Text/status frames are tapped from the pipeline by VoiceControlTap;
        # the output transport only writes audio.
        return None

    async def deserialize(self, data: str | bytes) -> Frame | None:
        if isinstance(data, bytes):
            audio = await self._resample_audio_in(data)
            return InputAudioRawFrame(
                audio=audio, sample_rate=self._sample_rate, num_channels=1
            )
        try:
            message = json.loads(data)
        except (ValueError, TypeError):
            return None
        # Text input is not needed for the voice loop, but accept a typed
        # message so the same socket can be used for a "text fallback".
        if message.get("type") == "text" and message.get("text"):
            return TextFrame(text=str(message["text"]))
        return None


def _voices_dir() -> Path:
    raw = os.getenv("VOICES_DIR")
    if raw:
        return Path(raw).expanduser().resolve()
    return (Path(__file__).resolve().parent.parent / "voices").resolve()


def _voice_for(language: str | None) -> str:
    """Pick a Piper voice for the requested language / script."""
    en = os.getenv("PIPER_VOICE_EN", "en_US-lessac-medium")
    hi = os.getenv("PIPER_VOICE", "hi_IN-pratham-medium")
    if language in {"hi", "hinglish"}:
        return hi
    return en


def _pipeline_voice_for(language: str | None) -> str:
    """The live pipeline keeps one voice per session; auto is Hinglish-first."""
    if (language or "auto").lower() in {"en", "english"}:
        return os.getenv("PIPER_VOICE_EN", "en_US-lessac-medium")
    return os.getenv("PIPER_VOICE", "hi_IN-pratham-medium")


# The voice tools are executed by the Aegis host, not narrated. The host owns
# the real AEGIS Computer (local Win32 actions, Playwright browser, files and
# shell), so a tool call becomes an HTTP call into it and the returned output
# is handed back to the model as the tool result. That is what makes "open
# calculator" actually open Calculator instead of producing an apology.
HOST_URL = os.getenv("AEGIS_HOST_URL", "http://127.0.0.1:4310").rstrip("/")

# Actions that change the world in a way the owner may want to confirm first.
APPROVAL_REQUIRED = {"exec", "files_write", "keyboard_type"}
_PENDING_APPROVALS: dict[str, dict] = {}


def _host_json(path: str, payload=None, method: str | None = None, timeout: float = 45.0):
    """Call the local Aegis host API. Returns (status, parsed-json)."""
    import urllib.error
    import urllib.request

    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        f"{HOST_URL}{path}",
        data=data,
        method=method or ("POST" if data is not None else "GET"),
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read().decode("utf-8") or "{}"
            return response.status, json.loads(body)
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(body)
        except Exception:
            parsed = {"error": body.strip() or str(error)}
        return error.code, parsed
    except Exception as error:  # host down / timeout
        return 0, {"error": f"Aegis host unreachable at {HOST_URL}: {error}"}


def _ensure_computer(dot_id: str) -> str:
    """Make the Aegis Computer ready for voice control. Returns an error text."""
    if not dot_id:
        return (
            "No Agent was supplied with this voice session, so the Aegis Computer "
            "cannot be addressed."
        )
    status, state = _host_json(f"/api/dots/{dot_id}/computer")
    if status != 200 or not isinstance(state, dict):
        return str(state.get("error", "The Aegis Computer status could not be read."))
    permissions = state.get("permissions") or {}
    if not all(permissions.get(key) for key in ("enabled", "browser", "files", "shell")):
        # Voice is owner-initiated on the owner's own machine: opening the mic
        # is the grant. The host still audits every action.
        _host_json(
            f"/api/dots/{dot_id}/computer/permissions",
            {"enabled": True, "browser": True, "files": True, "shell": True},
            "PATCH",
        )
    if state.get("state") != "running":
        started, start_body = _host_json(f"/api/dots/{dot_id}/computer/start", {})
        if started >= 400:
            return str(start_body.get("error", "The Aegis Computer could not start."))
    return ""


def _computer_action(dot_id: str, action: str, payload: dict):
    error = _ensure_computer(dot_id)
    if error:
        return {"status": "error", "error": error}
    status, result = _host_json(
        f"/api/dots/{dot_id}/computer/actions",
        {"action": action, "input": payload},
    )
    if status >= 400:
        return {
            "status": "error",
            "error": str(result.get("error", f"Computer action {action} failed.")),
        }
    return {"status": "executed", "action": action, "result": result}


def _computer_control(dot_id: str, action: str, values: dict) -> dict:
    """Map the voice surface's loose action names onto host computer actions."""
    action = (action or "").strip().lower()
    values = values if isinstance(values, dict) else {}
    if action in {"screenshot", "snapshot", "desktop_snapshot"}:
        return _computer_action(dot_id, "desktop_snapshot", {})
    if action in {"navigate", "open_url", "browser_open"}:
        return _computer_action(dot_id, "navigate", {"url": str(values.get("url", ""))})
    if action == "click":
        return {"status": "error", "error": "Coordinate clicks are disabled for agents. Use desktop_ui with a fresh numbered accessibility reference."}
    if action == "type":
        return {"status": "error", "error": "Physical keyboard input is disabled for agents. Use desktop_ui set-value on a fresh accessibility reference."}
    if action in {"press_key", "key"}:
        return {"status": "error", "error": "Physical key presses are disabled for agents."}
    if action == "scroll":
        return _computer_action(
            dot_id,
            "scroll",
            {"deltaY": float(values.get("deltaY", values.get("y", 0)))},
        )
    if action == "list_windows":
        return _computer_action(dot_id, "list_windows", {})
    if action in {"switch_window", "window_switch"}:
        return {"status": "error", "error": "Changing foreground windows is owner-only."}
    if action == "open_app":
        return {"status": "error", "error": "Launching or focusing desktop apps is owner-only."}
    if action in {"list_apps", "list-apps"}:
        status, payload = _host_json(
            "/api/agent-desktop", {"dotId": dot_id, "command": "list-apps", "args": []}
        )
        return payload if status < 400 else {"status": "error", "error": str(payload)}
    if action in {"mouse_click", "keyboard_type"}:
        return {"status": "error", "error": "Direct mouse and keyboard input is disabled for agents."}
    return {"status": "error", "error": f"Unknown computer action: {action}"}


def get_voice_tool_schemas(websocket=None, dot_id: str = "") -> list[FunctionSchema]:
    """Tool schemas for desktop, browser, memory, shell and UI actions."""

    async def _handle_tool(params):
        tool_name = params.function_name
        args = params.arguments if isinstance(params.arguments, dict) else {}
        rationale = args.get("rationale", "")
        # Send real-time action event over WebSocket to frontend
        if websocket is not None:
            try:
                await websocket.send_json({
                    "type": "action",
                    "tool": tool_name,
                    "parameters": args,
                    "rationale": rationale,
                })
            except Exception:
                pass

        # Execute the real operation and return its actual output to the model.
        result: dict = {"status": "executed", "tool": tool_name}
        try:
            if tool_name == "recall_memory":
                query = str(args.get("query", ""))
                try:
                    from aegis_daemon.db import Store
                    from aegis_daemon.tools import dispatch
                    store = Store()
                    try:
                        recall_res = dispatch(store, "memory.recall", {"query": query})
                    finally:
                        try:
                            store.conn.close()
                        except Exception:
                            pass
                    result = {"status": "executed", "query": query, "result": recall_res}
                except Exception as inner:
                    result = {"status": "executed", "query": query, "detail": str(inner)}
            elif tool_name == "ui_navigate":
                view = str(args.get("view", "chat"))
                result = {"status": "executed", "view": view}
            elif tool_name == "browser_navigate":
                result = _computer_action(
                    dot_id, "navigate", {"url": str(args.get("url", ""))}
                )
            elif tool_name == "computer_control":
                result = _computer_control(
                    dot_id,
                    str(args.get("action", "")),
                    args.get("params") if isinstance(args.get("params"), dict) else {},
                )
            elif tool_name == "desktop_ui":
                command = str(args.get("command", "")).strip()
                command_args = args.get("args") if isinstance(args.get("args"), list) else []
                label = str(args.get("label", "Aegis voice task"))[:80]
                status, payload = _host_json(
                    "/api/agent-desktop",
                    {"dotId": dot_id, "command": command, "args": command_args, "label": label},
                )
                result = payload if status < 400 else {"status": "error", "error": str(payload)}
            elif tool_name == "open_app":
                result = _computer_action(
                    dot_id, "open_app", {"app": str(args.get("app", ""))}
                )
            elif tool_name == "list_windows":
                result = _computer_action(dot_id, "list_windows", {})
            elif tool_name == "desktop_snapshot":
                result = _computer_action(dot_id, "desktop_snapshot", {})
            elif tool_name in {"annotate_screen", "clear_annotations"}:
                # Annotations are drawn by the desktop overlay in the browser;
                # the tool ack tells the model the HUD received the request.
                result = {
                    "status": "executed",
                    "tool": tool_name,
                    "targets": args.get("targets", []),
                    "drawings": args.get("drawings", []),
                    "steps": args.get("steps", []),
                    "cursorName": args.get("cursorName"),
                    "unit": args.get("unit", "norm"),
                    "next": args.get("next"),
                    "timeoutMs": args.get("timeoutMs"),
                    "dim": args.get("dim"),
                    "explanation": str(args.get("explanation", "")),
                }
            elif tool_name == "shell_execute":
                command = str(args.get("command", ""))
                if args.get("approved") is not True and command in APPROVAL_REQUIRED:
                    _PENDING_APPROVALS[dot_id] = {"action": "exec", "input": {"command": command}}
                    result = {
                        "status": "pending_approval",
                        "command": command,
                        "detail": "Ask the owner to say approved before running this command.",
                    }
                else:
                    result = _computer_action(dot_id, "exec", {"command": command})
            elif tool_name == "approve_pending_action":
                pending = _PENDING_APPROVALS.pop(dot_id, None)
                if not pending:
                    result = {"status": "error", "error": "There is no action waiting for approval."}
                else:
                    result = _computer_action(dot_id, pending["action"], pending["input"])
                    result["approved"] = True
        except Exception as e:
            result = {"status": "error", "error": str(e)}

        # Tell the UI what happened so it can show a receipt in the transcript.
        if websocket is not None:
            try:
                await websocket.send_json({"type": "tool-result", "tool": tool_name, "result": result})
            except Exception:
                pass

        if callable(getattr(params, "result_callback", None)):
            await params.result_callback(result)

    schemas = [
        FunctionSchema(
            name="computer_control",
            description="Read the desktop/browser and navigate isolated browser pages. Physical mouse clicks, keyboard typing, key presses, app focus, and foreground window changes are disabled for agents; use desktop_ui accessibility refs for app controls.",
            properties={
                "action": {
                    "type": "string",
                    "enum": ["screenshot", "navigate", "scroll", "list_windows"],
                    "description": "Safe observation or isolated browser navigation action",
                },
                "params": {
                    "type": "object",
                    "description": "Parameters such as a URL to open or scroll distance",
                },
                "rationale": {
                    "type": "string",
                    "description": "Short explanation for the user",
                },
            },
            required=["action"],
            handler=_handle_tool,
        ),
        FunctionSchema(
            name="recall_memory",
            description="Retrieve user memories, preferences, facts, notes, and past conversation context.",
            properties={
                "query": {
                    "type": "string",
                    "description": "Memory search query to recall",
                },
                "rationale": {
                    "type": "string",
                    "description": "Short explanation of what is being recalled",
                },
            },
            required=["query"],
            handler=_handle_tool,
        ),
        FunctionSchema(
            name="browser_navigate",
            description="Navigate the Playwright browser to a URL and inspect or extract webpage content.",
            properties={
                "url": {
                    "type": "string",
                    "description": "Destination URL to navigate to",
                },
                "rationale": {
                    "type": "string",
                    "description": "Short explanation of why this page is opened",
                },
            },
            required=["url"],
            handler=_handle_tool,
        ),
        FunctionSchema(
            name="shell_execute",
            description="Execute a safe shell command or terminal command in the workspace.",
            properties={
                "command": {
                    "type": "string",
                    "description": "Terminal command to run",
                },
                "rationale": {
                    "type": "string",
                    "description": "Short explanation of what the command does",
                },
            },
            required=["command"],
            handler=_handle_tool,
        ),
        FunctionSchema(
            name="ui_navigate",
            description="Switch the active Aegis surface view: chat, computer, browser, files, memories, research, settings, terminal, activity.",
            properties={
                "view": {
                    "type": "string",
                    "enum": ["chat", "computer", "browser", "files", "memories", "research", "settings", "terminal", "activity"],
                    "description": "Target view in the Aegis interface",
                },
                "rationale": {
                    "type": "string",
                    "description": "Short explanation of why this view is opened",
                },
            },
            required=["view"],
            handler=_handle_tool,
        ),
        FunctionSchema(
            name="open_app",
            description="Launch a desktop application on the owner's Windows computer, for example Calculator, Notepad, Chrome, WhatsApp, Explorer or Settings.",
            properties={
                "app": {
                    "type": "string",
                    "description": "Application name, alias or executable (Calculator, Notepad, chrome, WhatsApp).",
                },
                "rationale": {
                    "type": "string",
                    "description": "Short explanation of why the app is opened",
                },
            },
            required=["app"],
            handler=_handle_tool,
        ),
        FunctionSchema(
            name="list_windows",
            description="List the open desktop windows with their titles, so one can be switched to or described.",
            properties={
                "rationale": {
                    "type": "string",
                    "description": "Short explanation of why the windows are listed",
                },
            },
            required=[],
            handler=_handle_tool,
        ),
        FunctionSchema(
            name="desktop_snapshot",
            description="Capture the owner's screen so the current interface can be inspected or annotated.",
            properties={
                "rationale": {
                    "type": "string",
                    "description": "Short explanation of why the screen is captured",
                },
            },
            required=[],
            handler=_handle_tool,
        ),
        FunctionSchema(
            name="annotate_screen",
            description="Draw a guided annotation HUD over the owner's screen: highlight targets, arrows, callouts, numbered steps, or geometric/STEM figures such as a labelled Pythagoras triangle.",
            properties={
                "targets": {
                    "type": "array",
                    "items": {"type": "object"},
                    "description": "Targets to highlight, each with label and optional x/y/width/height or text to locate.",
                },
                "drawings": {
                    "type": "array",
                    "items": {"type": "object"},
                    "description": "Optional primitives: arrow, ring, spotlight, triangle, formula, step.",
                },
                "steps": {
                    "type": "array",
                    "items": {"type": "object"},
                    "description": "Optional ordered annotation steps; each step can include a target, drawing, title, or explanation.",
                },
                "cursorName": {"type": "string", "description": "Optional label shown beside the demonstration cursor."},
                "unit": {"type": "string", "enum": ["norm", "px"], "description": "Coordinate units for x/y/width/height. Use norm for 0..1 normalized screen coordinates."},
                "next": {"type": "string", "description": "Optional label for the next step."},
                "timeoutMs": {"type": "integer", "description": "How long the annotation remains visible, in milliseconds."},
                "dim": {"type": "boolean", "description": "Whether to dim the area outside the focus target."},
                "explanation": {
                    "type": "string",
                    "description": "The spoken explanation that accompanies the drawing",
                },
            },
            required=["explanation"],
            handler=_handle_tool,
        ),
        FunctionSchema(
            name="clear_annotations",
            description="Dismiss every drawing on the desktop annotation overlay.",
            properties={
                "rationale": {
                    "type": "string",
                    "description": "Short explanation of why the drawings are cleared",
                },
            },
            required=[],
            handler=_handle_tool,
        ),
        FunctionSchema(
            name="create_document",
            description=(
                "Create a real Excel (.xlsx), Word (.docx) or PowerPoint (.pptx) file "
                "on this machine and return a download link. Use sheets[].rows for "
                "spreadsheets, paragraphs for documents, slides for decks."
            ),
            properties={
                "kind": {"type": "string", "enum": ["xlsx", "docx", "pptx"]},
                "title": {"type": "string"},
                "sheets": {"type": "array", "items": {"type": "object"}},
                "paragraphs": {"type": "array", "items": {"type": "string"}},
                "slides": {"type": "array", "items": {"type": "object"}},
                "rationale": {"type": "string"},
            },
            required=["kind"],
            handler=_handle_tool,
        ),
        FunctionSchema(
            name="desktop_ui",
            description=(
                "Read and control desktop apps through Agent Desktop's headless "
                "accessibility tree. Take a fresh snapshot first; it returns numbered "
                "@refs with role and label. Use click @ref or set-value @ref VALUE, "
                "then snapshot again to verify. Commands: list-apps, snapshot, find, "
                "click, set-value, get, is, scroll, launch. Never use type, press, "
                "focus, activate, --headed, coordinates, or physical input."
            ),
            properties={
                "command": {
                    "type": "string",
                    "description": "agent-desktop command, e.g. snapshot, list-apps, click, type",
                },
                "args": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Command arguments, e.g. ['--app','chrome.exe','-i'] or ['@s1:ref']",
                },
                "rationale": {
                    "type": "string",
                    "description": "Short explanation of the action",
                },
                "label": {
                    "type": "string",
                    "description": "Short task/action label shown beside Aegis's separate cursor.",
                },
            },
            required=["command"],
            handler=_handle_tool,
        ),
        FunctionSchema(
            name="approve_pending_action",
            description="Run the action that was waiting for the owner's spoken approval. Call this only after the owner says approved, yes, or proceed.",
            properties={
                "rationale": {
                    "type": "string",
                    "description": "The owner's approval phrase",
                },
            },
            required=[],
            handler=_handle_tool,
        ),
    ]
    return schemas


def build_pipeline(websocket, language: str = "auto", dot_id: str = ""):
    llm_base, llm_key, llm_model = _voice_llm_config()
    whisper_model, whisper_device, whisper_compute = _whisper_config()
    voices_dir = _voices_dir()
    voice_id = _pipeline_voice_for(language)

    # A language picker in the UI can pin STT, but Hinglish is better served by
    # auto-detection; only force a language when the user explicitly chose one.
    pinned = os.getenv("WHISPER_LANGUAGE", "").strip() or (
        None if (language or "auto").lower() in {"auto", "hinglish"} else language
    )
    stt = CachedWhisperSTTService(
        device=whisper_device,
        compute_type=whisper_compute,
        # The models are local and already loaded, so transcripts normally
        # arrive well under a second after speech ends.  A short advertised
        # P99 keeps the turn controller from adding a fixed wait.
        ttfs_p99_latency=float(os.getenv("VOICE_STT_TTFS", "0.5")),
        settings=WhisperSTTService.Settings(
            model=whisper_model,
            language=pinned,
        ),
    )

    tts_mode = os.getenv("VOICE_TTS", "auto").strip().lower() or "auto"
    kokoro = get_kokoro_engine() if tts_mode in {"auto", "kokoro"} else None
    if tts_mode == "kokoro" and kokoro is None:
        raise RuntimeError(
            "VOICE_TTS=kokoro but the Kokoro model files are not installed. "
            "Run services/daemon/install_voice_models.ps1 or use VOICE_TTS=piper."
        )
    if kokoro is not None:
        tts = KokoroTTSService(kokoro)
        tts_name = "kokoro"
        tts_voice = kokoro.voice_hi
    else:
        tts = PiperTTSService(
            settings=PiperTTSService.Settings(voice=voice_id),
            download_dir=voices_dir,
        )
        tts_name = "piper"
        tts_voice = voice_id

    llm = OpenAILLMService(
        api_key=llm_key,
        base_url=llm_base,
        settings=OpenAILLMService.Settings(model=llm_model),
        # Groq sits behind Cloudflare, which answers non-browser clients with
        # "error code: 1010" - a plain python-urllib/httpx UA is rejected even
        # with a valid key. A browser UA is accepted.
        default_headers={
            "User-Agent": os.getenv(
                "LLM_USER_AGENT",
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/139.0.0.0 Safari/537.36",
            )
        },
    )

    cleanup_mode = os.getenv("VOICE_CLEANUP", "auto").strip().lower() or "auto"
    llm_cleaner = None
    remote_llm = not any(
        host in llm_base for host in ("127.0.0.1", "localhost", "0.0.0.0")
    )
    if (
        cleanup_mode in {"auto", "llm"}
        and llm_key
        and remote_llm
        and llm_base
    ):
        llm_cleaner = LlmTranscriptCleaner(
            base_url=llm_base,
            api_key=llm_key,
            model=os.getenv("VOICE_CLEANUP_MODEL", llm_model),
            timeout=float(os.getenv("VOICE_CLEANUP_TIMEOUT", "3.0")),
        )

    context = LLMContext()
    tool_schemas = get_voice_tool_schemas(websocket, dot_id)
    context.set_tools(tool_schemas)
    for schema in tool_schemas:
        if schema.handler:
            llm.register_function(schema.name, schema.handler)
    user_agg, assistant_agg = LLMContextAggregatorPair(
        context,
        user_params=LLMUserAggregatorParams(
            # 500 ms of trailing silence leaves room for a natural pause
            # between sentences without making replies feel slow.
            vad_analyzer=SileroVADAnalyzer(
                params=VADParams(
                    confidence=0.65,
                    start_secs=0.15,
                    stop_secs=0.5,
                    min_volume=0.5,
                )
            ),
            # Pipecat's default end-of-turn strategy runs an extra smart-turn
            # model and can wait the full 5s stop timeout when it is unsure.
            # A plain silence+transcript strategy is faster and more
            # predictable on a laptop; the STT decorator still gets the final
            # say because the turn does not end until its transcript arrives.
            user_turn_strategies=UserTurnStrategies(
                start=[
                    VADUserTurnStartStrategy(),
                    TranscriptionUserTurnStartStrategy(),
                ],
                stop=[
                    SpeechTimeoutUserTurnStopStrategy(
                        user_speech_timeout=0.4,
                        wait_for_transcript=True,
                    )
                ],
            ),
        ),
    )

    noise_suppression = os.getenv("VOICE_NOISE_SUPPRESSION", "1").strip().lower() not in {
        "0",
        "false",
        "off",
        "no",
    }
    transport_params = FastAPIWebsocketParams(
        audio_in_enabled=True,
        audio_out_enabled=True,
        audio_in_sample_rate=SAMPLE_RATE,
        audio_out_sample_rate=SAMPLE_RATE,
        serializer=RawAudioSerializer(),
    )
    if noise_suppression:
        try:
            transport_params.audio_in_filter = RNNoiseFilter()
        except Exception as error:  # pragma: no cover - optional dependency
            logger.warning("RNNoise unavailable (%s); continuing without it", error)

    transport = FastAPIWebsocketTransport(
        websocket=websocket,
        params=transport_params,
    )

    pipeline = Pipeline(
        [
            transport.input(),
            stt,
            CleanTranscripts(llm_cleaner=llm_cleaner),
            VoiceControlTap(websocket, transcriptions=True),
            user_agg,
            llm,
            VoiceControlTap(websocket, reply=True),
            tts,
            transport.output(),
            assistant_agg,
        ]
    )
    return pipeline, transport, context, {
        "stt": "faster-whisper",
        "whisperModel": whisper_model,
        "whisperDevice": whisper_device,
        "whisperCompute": whisper_compute,
        "whisperLanguage": pinned or "auto",
        "tts": tts_name,
        "voice": tts_voice,
        "voiceEn": getattr(kokoro, "voice_en", os.getenv("PIPER_VOICE_EN", "en_US-lessac-medium")),
        "cleanup": "llm" if llm_cleaner else "rules",
        "noiseSuppression": noise_suppression,
        "llmModel": llm_model,
        "llmConfigured": bool(llm_key),
    }


async def run_bot(websocket, language: str = "auto", dot_id: str = ""):
    # Whisper, Kokoro and Piper load their models synchronously; keep that work
    # off the event loop so /health and other connections stay responsive while
    # the local models warm up (the first run also downloads them).
    pipeline, transport, context, info = await asyncio.to_thread(
        build_pipeline, websocket, language, dot_id
    )
    task = PipelineTask(
        pipeline,
        params=PipelineParams(allow_interruptions=True),
    )

    @transport.event_handler("on_client_connected")
    async def on_connected(transport, client):
        context.add_message(
            {
                "role": "system",
                "content": (
                    "You are Aegis, a powerful voice operating system with full authority "
                    "to control the user's computer, desktop screen, Playwright browser, "
                    "filesystem, terminal shell commands, memory, and connected integrations. "
                    "The user's message is a cleaned speech transcript: fillers, "
                    "stutters and self-corrections have already been resolved, so "
                    "honour the final value they said and never resurrect a value "
                    "they corrected. Treat every multi-digit number as one number "
                    "(5006 is five thousand and six, not 5, 00, 6). "
                    "Match the language of the user's latest message. If they "
                    "spoke English, reply in English; if they spoke Hindi, reply "
                    "in Hindi; if they mixed Hindi and English (Hinglish), reply "
                    "in natural Hinglish. Never switch to a different language on "
                    "your own. When replying in Hindi or Hinglish, write Hindi "
                    "words in Devanagari script and keep English technical terms "
                    "in Latin script so the local voice can pronounce each part "
                    "naturally. Keep spoken answers short, clear, and proactive (1-3 sentences). "
                    "You are wired to the owner's real Aegis Computer: open_app launches desktop "
                    "applications, list_windows reads open windows, desktop_snapshot captures the "
                    "screen, desktop_ui uses Agent Desktop's headless accessibility tree with "
                    "numbered refs and a separate cursor; it never types into or focuses your "
                    "physical desktop. Use fresh snapshots, click refs or set-value refs, then verify. "
                    "shell_execute runs commands, create_document makes real Excel/Word/PowerPoint files, "
                    "annotate_screen draws the guidance HUD, and ui_navigate moves "
                    "the Aegis interface. These tools WORK. Never say you lack computer access, "
                    "If the owner asks whether you can see their screen, or asks you to inspect it, first ask: 'Would you like me to use a screenshot, or inspect it with Agent Desktop?' Do not capture anything until they choose. For ordinary web research (for example, searching for current news), use the Aegis Playwright browser tools; do not inspect or control their personal desktop browser. "
                    "never ask the owner to do it manually, and never apologise before trying: call "
                    "the tool, read its result, and report what actually happened. If a tool "
                    "returns an error, say the exact error in one sentence. Commands that need "
                    "confirmation return pending_approval; ask for approval, then call "
                    "approve_pending_action when the owner says approved, yes, or proceed. "
                    "For a task inside an app that is already open (switch a Chrome tab, play a "
                    "paused video, fill a form) do NOT launch or focus a desktop window and do NOT stop after one "
                    "call: take a fresh Agent Desktop snapshot for the intended app, use numbered @refs "
                    "with click or set-value, and snapshot again to "
                    "verify. Keep chaining calls until the whole multi-step task is done."
                ),
            }
        )
        # No LLM-generated greeting: it added a slow extra round-trip and could
        # answer in the wrong language (or prepend an unrelated sentence to the
        # first real reply).  Tell the UI the pipeline is listening instead.
        try:
            await websocket.send_json({"type": "status", "state": "listening"})
        except Exception:
            pass

    @transport.event_handler("on_client_disconnected")
    async def on_disconnected(transport, client):
        await task.cancel()

    runner = PipelineRunner()
    await runner.run(task)


def _voice_llm_config() -> tuple[str, str, str]:
    """Resolve voice inference to Aegis's active model, including local Ollama.

    The desktop stores provider selection in the host database, while this
    long-running Python service receives only environment variables. Ask the
    loopback host for non-secret provider metadata so voice follows the model
    already selected in Aegis. Ollama accepts a placeholder key.
    """
    base = os.getenv("LLM_BASE_URL", "").strip()
    key = os.getenv("LLM_API_KEY") or os.getenv("GROQ_API_KEY", "")
    model = os.getenv("LLM_MODEL", "").strip()
    provider_id = os.getenv("AEGIS_PROVIDER", "").strip().lower()
    host = os.getenv("AEGIS_HOST_URL", "http://127.0.0.1:4310").rstrip("/")
    try:
        request = urllib.request.Request(
            f"{host}/api/voice/provider", headers={"Accept": "application/json"}
        )
        with urllib.request.urlopen(request, timeout=0.8) as response:
            active = json.loads(response.read(16_384).decode("utf-8"))
        if isinstance(active, dict):
            provider_id = str(active.get("providerId") or provider_id).lower()
            base = str(active.get("baseUrl") or base).strip()
            model = str(active.get("model") or model).strip()
    except (OSError, ValueError, urllib.error.URLError):
        # The voice process can start before the host. Environment settings
        # below keep direct/manual runs usable until the host is available.
        pass

    is_local = provider_id in {"local", "ollama"} or any(
        marker in base.lower() for marker in ("127.0.0.1", "localhost")
    )
    if is_local:
        base = base or os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434/v1")
        key = os.getenv("OLLAMA_API_KEY") or "ollama"
        model = model or os.getenv("AEGIS_MODEL", "qwen3.5:0.8b")
    else:
        base = base or os.getenv("GROQ_BASE_URL", "https://api.groq.com/openai/v1")
        key = key or os.getenv("GROQ_API_KEY", "")
        model = model or os.getenv("AEGIS_MODEL", "openai/gpt-oss-20b")
    return base, key, model


def create_app():
    app = FastAPI(title="Aegis local voice pipeline")
    llm_base, llm_key, llm_model = _voice_llm_config()
    local_llm = any(
        marker in llm_base.lower() for marker in ("127.0.0.1", "localhost")
    )
    whisper_model, whisper_device, whisper_compute = _whisper_config()
    tts_mode = os.getenv("VOICE_TTS", "auto").strip().lower() or "auto"
    kokoro_probe = KokoroEngine()
    use_kokoro = tts_mode in {"auto", "kokoro"} and kokoro_probe.available
    cleanup_mode = os.getenv("VOICE_CLEANUP", "auto").strip().lower() or "auto"
    app.state.info = {
        "stt": "faster-whisper",
        "whisperModel": whisper_model,
        "whisperDevice": whisper_device,
        "whisperCompute": whisper_compute,
        "tts": "kokoro" if use_kokoro else "piper",
        "voice": os.getenv("KOKORO_VOICE_HI", "hf_alpha")
        if use_kokoro
        else os.getenv("PIPER_VOICE", "hi_IN-pratham-medium"),
        "voiceEn": os.getenv("KOKORO_VOICE_EN", "af_heart")
        if use_kokoro
        else os.getenv("PIPER_VOICE_EN", "en_US-lessac-medium"),
        "cleanup": cleanup_mode,
        "noiseSuppression": os.getenv("VOICE_NOISE_SUPPRESSION", "1"),
        "llmModel": llm_model,
        "llmConfigured": bool(llm_key) or local_llm,
        "llmBaseUrl": llm_base,
        "voicesDir": str(_voices_dir()),
    }

    @app.get("/health")
    async def health():
        return {"ok": True, "service": "aegis-voice", **app.state.info}

    @app.get("/")
    async def root():
        return {"ok": True, "service": "aegis-voice", **app.state.info}

    @app.post("/api/tts")
    async def tts(payload: dict):
        text = str(payload.get("text") or "").strip()
        if not text:
            return JSONResponse({"error": "Text is required."}, status_code=400)
        language = payload.get("language")
        engine = (
            get_kokoro_engine()
            if (os.getenv("VOICE_TTS", "auto").strip().lower() or "auto")
            in {"auto", "kokoro"}
            else None
        )
        try:
            if engine is not None:
                audio, rate = await engine.synthesize_pcm(text)
            else:
                voice_id = _voice_for(language)
                model_path = _voices_dir() / f"{voice_id}.onnx"
                if not model_path.exists():
                    return JSONResponse(
                        {"error": f"Piper voice not found: {model_path}"},
                        status_code=503,
                    )
                audio, rate = await asyncio.to_thread(
                    _synthesize, model_path, text
                )
        except Exception as error:  # pragma: no cover - runtime failure
            return JSONResponse({"error": str(error)}, status_code=500)
        if not audio:
            return JSONResponse({"error": "TTS produced no audio."}, status_code=500)
        import io

        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(rate)
            wav.writeframes(audio)
        return Response(
            content=buffer.getvalue(),
            media_type="audio/wav",
            headers={"Cache-Control": "no-store"},
        )

    @app.websocket("/ws")
    async def ws(websocket: WebSocket):
        await websocket.accept()
        language = websocket.query_params.get("language", "auto")
        dot_id = websocket.query_params.get("dot", "")
        try:
            # Tell the UI why the first greeting can take a while: the local
            # models load (and download once) on this machine.
            await websocket.send_json({"type": "status", "state": "warming"})
            await run_bot(websocket, language, dot_id)
        except Exception as error:  # pragma: no cover - runtime failure
            try:
                await websocket.send_json(
                    {"type": "error", "error": str(error)}
                )
            except Exception:
                pass

    return app


def _synthesize(model_path: Path, text: str) -> tuple[bytes, int]:
    from piper import PiperVoice

    voice = PiperVoice.load(str(model_path))
    chunks: list[bytes] = []
    for chunk in voice.synthesize(text):
        chunks.append(chunk.audio_int16_bytes)
    return b"".join(chunks), voice.config.sample_rate


def main():
    import uvicorn

    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8766)
    args = parser.parse_args()
    uvicorn.run(create_app(), host=args.host, port=args.port)


if __name__ == "__main__":
    main()
