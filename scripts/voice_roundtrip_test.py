"""Live round-trip check for the local Pipecat voice pipeline.

Synthesises a question with the pipeline's own TTS, streams it to the
WebSocket as raw PCM16 at 16 kHz exactly like the browser does, and reports
every status / transcription / reply / audio frame it receives.

Usage:
    python scripts/voice_roundtrip_test.py
    python scripts/voice_roundtrip_test.py --language hi --text "नमस्ते, आप कैसे हैं?"
"""
import argparse
import asyncio
import audioop
import json
import sys
import time
import urllib.request
import wave

import websockets

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = "http://127.0.0.1:8766"
WS = "ws://127.0.0.1:8766/ws"

DEFAULT_TEXT = "What is the capital of India? Answer in one short sentence."


def synth(text: str, language: str) -> bytes:
    request = urllib.request.Request(
        BASE + "/api/tts",
        data=json.dumps({"text": text, "language": language}).encode("utf-8"),
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        data = response.read()
    path = "voice-question.wav"
    with open(path, "wb") as handle:
        handle.write(data)
    with wave.open(path, "rb") as wav:
        print(
            f"tts: {len(data)} bytes, {wav.getframerate()} Hz, "
            f"{wav.getnchannels()} ch, {wav.getsampwidth() * 8} bit",
            flush=True,
        )
        pcm = wav.readframes(wav.getnframes())
        rate = wav.getframerate()
    if rate != 16000:
        pcm, _ = audioop.ratecv(pcm, 2, 1, rate, 16000, None)
        print(f"resampled to 16000 Hz: {len(pcm)} bytes", flush=True)
    # The browser streams microphone audio continuously; add a second of
    # trailing silence so VAD sees the end of speech exactly like a live call.
    pcm += b"\x00\x00" * 16000
    return pcm


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--text", default=DEFAULT_TEXT)
    parser.add_argument("--language", default="en")
    args = parser.parse_args()

    pcm = synth(args.text, args.language)
    events = []
    transcripts = []
    replies = []
    audio_bytes = 0
    saw_speaking = False
    listening_before_audio = asyncio.Event()
    listening_after_reply = False
    started = time.time()

    async with websockets.connect(WS, max_size=None) as ws:
        async def receive():
            nonlocal audio_bytes, saw_speaking, listening_after_reply
            while True:
                try:
                    message = await asyncio.wait_for(ws.recv(), timeout=90)
                except asyncio.TimeoutError:
                    return
                except websockets.ConnectionClosed:
                    return
                if isinstance(message, bytes):
                    audio_bytes += len(message)
                    continue
                try:
                    event = json.loads(message)
                except json.JSONDecodeError:
                    continue
                events.append(event)
                kind = event.get("type")
                if kind == "status":
                    state = event.get("state")
                    print(f"[{time.time() - started:6.1f}s] status {state}", flush=True)
                    if state == "listening":
                        if not saw_speaking:
                            listening_before_audio.set()
                        elif transcripts:
                            listening_after_reply = True
                    elif state == "speaking":
                        saw_speaking = True
                elif kind == "transcription":
                    transcripts.append(event.get("text", ""))
                    print(f"[{time.time() - started:6.1f}s] heard: {event.get('text')}", flush=True)
                elif kind == "text":
                    replies.append(event.get("text", ""))
                elif kind == "error":
                    print(f"[{time.time() - started:6.1f}s] ERROR {event}", flush=True)

        receiver = asyncio.create_task(receive())

        # The service signals "listening" once the models are warm.  There is
        # no LLM greeting any more, so the audio can go out immediately.
        try:
            await asyncio.wait_for(listening_before_audio.wait(), timeout=90)
        except asyncio.TimeoutError:
            print("timed out waiting for the pipeline to be ready", flush=True)
            receiver.cancel()
            return 2

        print("streaming question audio…", flush=True)
        chunk = 640  # 20 ms of PCM16 mono at 16 kHz
        for offset in range(0, len(pcm), chunk):
            await ws.send(pcm[offset : offset + chunk])
            await asyncio.sleep(0.02)
        print(
            f"[{time.time() - started:6.1f}s] audio sent; waiting for transcription and reply",
            flush=True,
        )

        deadline = time.time() + 90
        while time.time() < deadline:
            if transcripts and replies and listening_after_reply:
                break
            await asyncio.sleep(0.5)
        await asyncio.sleep(1.5)
        receiver.cancel()

    print("--- result ---", flush=True)
    print("transcripts:", transcripts, flush=True)
    print("reply:", "".join(replies)[:600], flush=True)
    print("audio bytes received:", audio_bytes, flush=True)
    print("events:", len(events), flush=True)
    ok = bool(transcripts) and bool(replies) and audio_bytes > 0
    print("PASS" if ok else "FAIL", flush=True)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
