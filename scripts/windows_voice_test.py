"""Live check for the Aegis Windows Voice Bridge.

Opens a session against the bridge, waits until it is ready, then pushes a
command through the pipeline (the same path the Windows recogniser uses) and
reports every event and audio frame that comes back.

Usage:
    python scripts/windows_voice_test.py
    python scripts/windows_voice_test.py --command "open settings"
    python scripts/windows_voice_test.py --speak            # use the microphone
"""

import argparse
import asyncio
import json
import sys
import time

import httpx
import websockets

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = "http://127.0.0.1:8767"
WS = "ws://127.0.0.1:8767/ws"
DEFAULT_COMMAND = "open settings"


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--command", default=DEFAULT_COMMAND)
    parser.add_argument(
        "--speak",
        action="store_true",
        help="listen through the microphone instead of pushing a command",
    )
    parser.add_argument("--timeout", type=float, default=45.0)
    args = parser.parse_args()

    async with httpx.AsyncClient(timeout=30.0) as client:
        health = (await client.get(f"{BASE}/health")).json()
        print("health:", json.dumps({k: health.get(k) for k in ("ok", "available", "language", "commandCount", "privacyBlocked", "listening")}))
        if not health.get("available"):
            print("the Windows speech engine is not available on this machine")
            return 2
        if health.get("privacyBlocked"):
            print("note: Windows speech privacy is still off; the microphone path will fail until it is on")

        events: list[dict] = []
        transcripts: list[str] = []
        replies: list[str] = []
        actions: list[dict] = []
        audio_bytes = 0
        errors: list[str] = []
        ready = asyncio.Event()

        async with websockets.connect(WS, max_size=None) as socket:

            async def receive() -> None:
                nonlocal audio_bytes
                while True:
                    try:
                        message = await asyncio.wait_for(socket.recv(), timeout=args.timeout)
                    except (asyncio.TimeoutError, websockets.ConnectionClosed):
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
                    if kind == "ready":
                        ready.set()
                    elif kind == "transcription":
                        transcripts.append(event.get("text", ""))
                        print("heard:", event.get("text"))
                    elif kind == "text":
                        replies.append(event.get("text", ""))
                    elif kind == "action":
                        actions.append(event)
                        print("action:", event.get("action"), event.get("command", ""))
                    elif kind == "status":
                        print("status:", event.get("state"))
                    elif kind == "error":
                        errors.append(event.get("error", ""))
                        print("error:", event.get("error"))

            receiver = asyncio.create_task(receive())
            try:
                await asyncio.wait_for(ready.wait(), timeout=30)
            except asyncio.TimeoutError:
                print("the session never became ready")
                receiver.cancel()
                return 2

            if args.speak:
                print("speak now…")
                await asyncio.sleep(8)
            else:
                response = await client.post(
                    f"{BASE}/api/simulate", json={"text": args.command}
                )
                print("simulate:", response.json())
                await asyncio.sleep(6)

            receiver.cancel()

    print("--- result ---")
    print("transcripts:", transcripts)
    print("replies:", replies)
    print("actions:", actions)
    print("audio bytes:", audio_bytes)
    print("events:", len(events))
    if errors:
        print("errors:", errors)
    # A command produces an action, a question produces a spoken answer.
    ok = bool(transcripts) and bool(actions or replies or audio_bytes)
    print("PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
