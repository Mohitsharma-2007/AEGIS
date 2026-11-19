# Aegis local services

This folder contains the Python services behind Aegis:

- the memory/MCP daemon (`aegis_daemon`, port 8765),
- the local Pipecat voice pipeline (`aegis_daemon.voice_pipeline`, port 8766), and
- the Windows Voice Bridge (`aegis_daemon.windows_bridge`, port 8767).

Everything below is for the voice pipeline. The desktop app starts it
automatically when port 8766 is down; run it by hand while developing.

## Requirements

- Windows 10/11 (the launchers and CUDA DLL handling are Windows-first)
- Python 3.11 (`py -3.11 -m venv .venv311`)
- A microphone; a GPU is optional

```powershell
cd services\daemon
py -3.11 -m venv .venv311
.\.venv311\Scripts\python.exe -m pip install -r requirements.txt
```

### Optional: NVIDIA GPU

`WHISPER_DEVICE=auto` uses CUDA when both a device and the runtime DLLs are
usable, and falls back to CPU otherwise. Install the wheels that provide the
DLLs when you have a supported GPU:

```powershell
.\.venv311\Scripts\python.exe -m pip install -r requirements-cuda.txt
```

## Models

```powershell
.\install_voice_models.ps1
```

This downloads:

| Model | Size | Purpose |
| --- | --- | --- |
| Kokoro-82M int8 ONNX | ~92 MB | English + Hindi TTS (CPU) |
| Kokoro-82M full ONNX | ~327 MB | TTS with an accelerated ONNX runtime |
| `voices-v1.0.bin` | ~28 MB | Kokoro voice pack (`af_heart`, `hf_alpha`, ...) |
| Piper `en_US-lessac-medium` | ~63 MB | TTS fallback |
| Piper `hi_IN-pratham-medium` | ~64 MB | TTS fallback |

Speech-to-text weights are downloaded by `faster-whisper` on first use:

- CUDA: `large-v3-turbo`, `int8_float16` (accurate Hindi/Hinglish, ~1s)
- CPU: `small`, `int8` (the portable default; expect a few seconds on a slow
  laptop)

Override with `WHISPER_MODEL`, `WHISPER_DEVICE` and `WHISPER_COMPUTE_TYPE`.

## Run

```powershell
.\run_voice.cmd                 # http://127.0.0.1:8766
.\run_voice.cmd --port 8766
```

Health and TTS are plain HTTP:

```powershell
curl http://127.0.0.1:8766/health
curl -X POST http://127.0.0.1:8766/api/tts `
  -H "Content-Type: application/json" `
  -d '{"text":"नमस्ते, मैं एजिस हूँ। Hello!","language":"auto"}'
```

The browser connects to `/ws` with raw PCM16 mono at 16 kHz. The host proxies
`/api/voice/pipeline` and `/api/voice/tts` to this service.

## Voice pipeline behaviour

- **Noise suppression**: the browser requests `noiseSuppression`,
  `echoCancellation` and `autoGainControl`; the server also runs Pipecat's
  `RNNoiseFilter` on microphone input when `pyrnnoise` is installed.
- **VAD**: Silero, tuned for 350 ms of trailing silence so replies feel quick
  without cutting off a normal pause.
- **Transcript cleanup**: deterministic rules remove fillers, stutters, false
  starts and numeric self-corrections (`500, not 500, 600, not 600, 200` →
  `200`), re-join split digits (`5 0 0 6` → `5006`) and fix common grammar.
  Long or disfluent non-question transcripts may get one small-LLM polish pass;
  questions are never sent to the cleaner, so it cannot answer them.
- **No LLM greeting**: the UI shows “Listening” as soon as models are warm.
- **Language-aware TTS**: Kokoro splits mixed text by script, so Hindi words use
  `hf_alpha` and English words use `af_heart` in the same sentence.

## Environment

All values are optional; the defaults are chosen for a local desktop install.

| Variable | Default | Meaning |
| --- | --- | --- |
| `LLM_BASE_URL` | `https://api.groq.com/openai/v1` | OpenAI-compatible chat endpoint |
| `LLM_API_KEY` | falls back to `GROQ_API_KEY` | API key |
| `LLM_MODEL` | `openai/gpt-oss-20b` | Reply model |
| `WHISPER_MODEL` | CUDA `large-v3-turbo`, CPU `small` | STT model |
| `WHISPER_DEVICE` | `auto` | `auto`, `cuda`, `cpu` |
| `WHISPER_COMPUTE_TYPE` | CUDA `int8_float16`, CPU `int8` | ctranslate2 compute type |
| `WHISPER_PROFILE` | `auto` | `low` (base), `balanced` (small), `high` |
| `WHISPER_LANGUAGE` | empty | Pin `en`/`hi`; empty auto-detects (best for Hinglish) |
| `VOICE_STT_TTFS` | `0.5` | Advertised speech-end→transcript P99 used by turn detection |
| `VOICE_CLEANUP` | `auto` | `auto`, `rules`, `llm`, `off` |
| `VOICE_CLEANUP_MODEL` | `LLM_MODEL` | Model used for the optional polish pass |
| `VOICE_TTS` | `auto` | `auto`, `kokoro`, `piper` |
| `VOICE_NOISE_SUPPRESSION` | `1` | Set `0` to disable RNNoise |
| `KOKORO_MODEL` | int8 file under `voices/kokoro` | Override model path |
| `KOKORO_VOICES` | `voices/kokoro/voices-v1.0.bin` | Voice pack path |
| `KOKORO_VOICE_EN` | `af_heart` | English voice |
| `KOKORO_VOICE_HI` | `hf_alpha` | Hindi voice |
| `KOKORO_SPEED` | `1.0` | Speech rate |
| `PIPER_VOICE` / `PIPER_VOICE_EN` | `hi_IN-pratham-medium` / `en_US-lessac-medium` | Piper fallback voices |
| `VOICES_DIR` | `services/daemon/voices` | Model directory |

## Tests

```powershell
.\.venv311\Scripts\python.exe -m unittest discover -s tests -p "test_*.py"
.\.venv311\Scripts\python.exe ..\..\..\scripts\voice_roundtrip_test.py
```

The round-trip script synthesises a question, streams it over `/ws`, and
checks that a transcript, a reply and audio frames come back. Add
`--language hi --text "..."` to test Hindi.

---

# Windows Voice Bridge

Windows **Voice Access** is an accessibility feature, not an API: no third
party application can call it, and its own vocabulary is fixed to screen
navigation. The speech engine underneath it *is* public
(`Windows.Media.SpeechRecognition` / `Windows.Media.SpeechSynthesis`), so
Aegis talks to that engine through a small local service — the Windows Voice
Bridge — and only Aegis consumes what it hears.

```powershell
.\.venv311\Scripts\python.exe -m pip install -r requirements-windows.txt
.\run_windows_voice.cmd          # http://127.0.0.1:8767
```

### What it does

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | Engine status: languages, voices, privacy state, model |
| `GET /api/commands` | The command vocabulary Aegis understands |
| `GET /api/voices` | Installed Windows voices |
| `POST /api/recognize` | Listen for a single command |
| `POST /api/execute` | Run a command without a microphone |
| `POST /api/synthesize` | Windows text-to-speech (WAV bytes) |
| `POST /api/simulate` | Push a command into the live session (testing) |
| `POST /api/open-privacy-settings` | Open the Windows speech privacy page |
| `WS /ws` | Live session: commands in, spoken answers out |

### Command-only access

Commands are compiled into a `SpeechRecognitionListConstraint`, so Windows
matches the utterance against a fixed vocabulary and never returns free text:
a command can never be mistaken for a question. The vocabulary lives in
`aegis_daemon/win_commands.py` and covers the Aegis surfaces (`open
settings`, `open browser`, `new chat`, …), the AEGIS Computer navigation that
mirrors Voice Access (`click`, `scroll down`, `press enter`, `copy`, …), the
voice session itself (`stop speaking`, `mute`, `repeat that`) and a few server
actions (`pause aegis`).

A recognised command never reaches the language model: `CommandGate` performs
it (UI action, computer action, server call) and speaks a short confirmation
through Kokoro. Only the spoken question after *“ask Aegis”* is handed to the
model.

### The Pipecat pipeline

```
WindowsCommandSTTService -> CleanTranscripts -> CommandGate
    -> aggregator -> OpenAI-compatible LLM -> Kokoro TTS -> client
```

`WindowsCommandSTTService` is a normal Pipecat STT service: it publishes
`TranscriptionFrame`s, advertises its own latency and lets the rest of the
pipeline stay unchanged. The Windows engine runs on a dedicated worker thread
with its own COM apartment, so the HTTP server is never blocked by the
recogniser.

### Windows requirements

- Windows 11 (the engine reports **en-US only** unless a Hindi
  (`hi-IN`) speech language pack is installed — the command vocabulary is
  English by design).
- The *speech, inking & typing* privacy switch must be on
  (Settings → Time & language → Speech → *Speech, inking & typing privacy
  settings* → “Get to know me”). Command recognition through a continuous
  session works with it on; the one-shot `/api/recognize` path needs it.
- The desktop app starts the bridge automatically on Windows.

### Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `WINDOWS_BRIDGE_LANGUAGE` | `en-US` | Recognition language |
| `WINDOWS_BRIDGE_DICTATION` | `1` | Allow one spoken question after “ask Aegis” |
| `WINDOWS_VOICE_URL` | `http://127.0.0.1:8767` | Where the host looks for the bridge |
| `AEGIS_HOST_URL` | `http://127.0.0.1:4310` | Aegis server the bridge calls |

The bridge uses the same `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL`
variables as the voice pipeline, so both surfaces answer with the same
model. For a local, offline model use Ollama or LM Studio:

```powershell
# .env.local
LLM_BASE_URL=http://127.0.0.1:11434/v1
LLM_API_KEY=ollama
LLM_MODEL=qwen3:8b
```

Qwen3 is the strongest Hinglish model that runs on a laptop.

### Tests

```powershell
.\.venv311\Scripts\python.exe ..\..\..\scripts\windows_voice_test.py
.\.venv311\Scripts\python.exe ..\..\..\scripts\windows_voice_test.py --speak
```

