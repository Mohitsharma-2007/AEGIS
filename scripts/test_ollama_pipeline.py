#!/usr/bin/env python3
"""
AEGIS — local Ollama pipeline verification harness.

Checks, on this machine, that the minimum-VRAM model ladder is actually usable:

  1. Ollama CLI + API reachable
  2. Installed models listed
  3. Text throughput: time-to-first-token and decode tokens/sec per model
  4. Tool-calling conformance against an AEGIS-style tool schema
  5. Vision: describe a generated image (no external assets needed)

Pure standard library — no pip install required.

Usage
-----
    python scripts/test_ollama_pipeline.py                 # quick status + installed models
    python scripts/test_ollama_pipeline.py --bench         # throughput for installed models
    python scripts/test_ollama_pipeline.py --all           # bench + tools + vision
    python scripts/test_ollama_pipeline.py --bench --models qwen3.5:0.8b functiongemma:270m
    python scripts/test_ollama_pipeline.py --all --require-tokps 100

Exit codes: 0 ok · 1 target not met · 2 Ollama unreachable.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import platform
import shutil
import struct
import subprocess
import sys
import time
import urllib.error
import urllib.request
import zlib

HOST = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434").rstrip("/")
RESULTS_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "docs",
    "model-bench-results.json",
)

# Model ladder from docs/AEGIS_MODEL_ROSTER.md (min-VRAM order).
LADDER = [
    ("router", "functiongemma:270m", 301),
    ("supervisor", "qwen3.5:0.8b", 1250),
    ("embedding", "qwen3-embedding:0.6b", 639),
    ("vision", "qwen3-vl:2b", 1900),
    ("agentic", "granite4.1:3b-q3_K_S", 1600),
]

BENCH_PROMPT = (
    "You are Aegis, a desktop assistant. In two short sentences, explain what you "
    "can do with the screen, the clipboard and local memory."
)

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "screen_get_active_window",
            "description": "Return the title and process name of the focused window.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "browser_search",
            "description": "Search the web in the user's browser.",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string", "description": "search terms"}},
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "memory_retrieve",
            "description": "Recall stored memories about the user.",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string"}},
                "required": ["query"],
            },
        },
    },
]

TOOL_CASE = ("What is open on my screen right now?", "screen_get_active_window")


# --------------------------------------------------------------------------- #
# transport
# --------------------------------------------------------------------------- #
def _post(path: str, payload: dict, timeout: int = 180):
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        HOST + path, data=data, headers={"Content-Type": "application/json"}
    )
    return urllib.request.urlopen(req, timeout=timeout)


def _get(path: str, timeout: int = 10):
    return urllib.request.urlopen(HOST + path, timeout=timeout)


def api_tags() -> list[dict]:
    with _get("/api/tags") as r:
        return json.loads(r.read().decode("utf-8")).get("models", [])


def cli_version() -> str | None:
    exe = shutil.which("ollama")
    if not exe:
        return None
    try:
        out = subprocess.run(
            [exe, "--version"], capture_output=True, text=True, timeout=20
        )
        return (out.stdout or out.stderr).strip() or None
    except Exception:
        return None


# --------------------------------------------------------------------------- #
# benchmarks
# --------------------------------------------------------------------------- #
def chat(model: str, messages: list[dict], tools=None, stream=False, options=None):
    payload = {"model": model, "messages": messages, "stream": stream}
    if tools:
        payload["tools"] = tools
    if options:
        payload["options"] = options
    return _post("/api/chat", payload)


def bench(model: str, prompt: str = BENCH_PROMPT, num_predict: int = 96) -> dict:
    """Stream one completion; measure TTFT and decode speed."""
    messages = [{"role": "user", "content": prompt}]
    options = {"num_predict": num_predict, "temperature": 0}
    started = time.perf_counter()
    ttft = None
    text_parts: list[str] = []
    final: dict = {}
    try:
        with chat(model, messages, stream=True, options=options) as resp:
            for raw in resp:
                line = raw.decode("utf-8", "replace").strip()
                if not line:
                    continue
                try:
                    chunk = json.loads(line)
                except json.JSONDecodeError:
                    continue
                msg = chunk.get("message") or {}
                piece = msg.get("content") or ""
                if piece:
                    if ttft is None:
                        ttft = time.perf_counter() - started
                    text_parts.append(piece)
                if chunk.get("done"):
                    final = chunk
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", "replace")[:300]
        return {"model": model, "ok": False, "error": f"HTTP {exc.code}: {body}"}
    except Exception as exc:  # noqa: BLE001
        return {"model": model, "ok": False, "error": f"{type(exc).__name__}: {exc}"}

    wall = time.perf_counter() - started
    eval_count = final.get("eval_count") or 0
    eval_ns = final.get("eval_duration") or 0
    load_ns = final.get("load_duration") or 0
    prompt_count = final.get("prompt_eval_count") or 0
    prompt_ns = final.get("prompt_eval_duration") or 0
    tok_s = (eval_count / (eval_ns / 1e9)) if eval_ns else (
        (eval_count / wall) if wall else 0.0
    )
    return {
        "model": model,
        "ok": bool(text_parts or eval_count),
        "ttft_ms": round((ttft or wall) * 1000),
        "wall_ms": round(wall * 1000),
        "prompt_tokens": prompt_count,
        "prompt_tok_s": round(prompt_count / (prompt_ns / 1e9), 1) if prompt_ns else None,
        "decode_tokens": eval_count,
        "tok_s": round(tok_s, 1),
        "load_ms": round(load_ns / 1e6),
        "sample": " ".join(text_parts)[:160],
    }


def tool_test(model: str) -> dict:
    """Does the model emit a well-formed call for the expected tool?"""
    messages = [
        {
            "role": "system",
            "content": (
                "You are Aegis. Use exactly one tool when it applies. "
                "Never invent tools that are not in the list."
            ),
        },
        {"role": "user", "content": TOOL_CASE[0]},
    ]
    try:
        with chat(model, messages, tools=TOOLS, stream=False) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", "replace")[:300]
        return {"model": model, "ok": False, "error": f"HTTP {exc.code}: {body}"}
    except Exception as exc:  # noqa: BLE001
        return {"model": model, "ok": False, "error": f"{type(exc).__name__}: {exc}"}

    calls = ((data.get("message") or {}).get("tool_calls")) or []
    names, bad_args = [], []
    for call in calls:
        fn = call.get("function") or {}
        names.append(fn.get("name") or "")
        args = fn.get("arguments")
        if isinstance(args, str):
            try:
                json.loads(args)
            except json.JSONDecodeError:
                bad_args.append(fn.get("name"))
        elif args is not None and not isinstance(args, dict):
            bad_args.append(fn.get("name"))

    hit = TOOL_CASE[1] in names
    return {
        "model": model,
        "ok": hit and not bad_args,
        "expected": TOOL_CASE[1],
        "called": names,
        "invalid_json_args": bad_args,
        "reply": ((data.get("message") or {}).get("content") or "")[:120],
    }


# --------------------------------------------------------------------------- #
# vision
# --------------------------------------------------------------------------- #
def make_png(width: int = 64, height: int = 64) -> bytes:
    """Red/blue checkerboard — obvious to any working VLM."""
    raw = bytearray()
    for y in range(height):
        raw.append(0)  # filter: none
        for x in range(width):
            raw += bytes((220, 40, 40)) if ((x // 16) + (y // 16)) % 2 == 0 else bytes(
                (40, 60, 220)
            )

    def chunk(tag: bytes, data: bytes) -> bytes:
        body = tag + data
        return (
            struct.pack(">I", len(data))
            + body
            + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )


def vision_test(model: str) -> dict:
    png_b64 = base64.b64encode(make_png()).decode("ascii")
    messages = [
        {
            "role": "user",
            "content": "Describe the colours and pattern in this image in one sentence.",
            "images": [png_b64],
        }
    ]
    started = time.perf_counter()
    try:
        with chat(model, messages, stream=False) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", "replace")[:300]
        return {"model": model, "ok": False, "error": f"HTTP {exc.code}: {body}"}
    except Exception as exc:  # noqa: BLE001
        return {"model": model, "ok": False, "error": f"{type(exc).__name__}: {exc}"}

    text = ((data.get("message") or {}).get("content") or "").strip()
    low = text.lower()
    colours = [c for c in ("red", "blue") if c in low]
    return {
        "model": model,
        "ok": bool(text) and len(colours) > 0,
        "latency_ms": round((time.perf_counter() - started) * 1000),
        "colours_detected": colours,
        "reply": text[:200],
    }


# --------------------------------------------------------------------------- #
# reporting
# --------------------------------------------------------------------------- #
def hr(title: str = "") -> None:
    print("-" * 72)
    if title:
        print(title)
        print("-" * 72)


def main() -> int:
    ap = argparse.ArgumentParser(description="AEGIS Ollama pipeline verification")
    ap.add_argument("--models", nargs="*", default=None, help="override model list")
    ap.add_argument("--bench", action="store_true", help="run throughput benchmark")
    ap.add_argument("--tools", action="store_true", help="run tool-call conformance")
    ap.add_argument("--vision", action="store_true", help="run vision check")
    ap.add_argument("--all", action="store_true", help="bench + tools + vision")
    ap.add_argument("--require-tokps", type=float, default=None)
    ap.add_argument("--json-out", default=RESULTS_PATH)
    args = ap.parse_args()

    if args.all:
        args.bench = args.tools = args.vision = True

    hr("AEGIS local model verification")
    print(f"host      : {platform.node()} ({platform.system()} {platform.release()})")
    print(f"python    : {platform.python_version()}")
    ver = cli_version()
    print(f"ollama cli: {ver or 'NOT FOUND on PATH'}")

    try:
        installed = api_tags()
    except Exception as exc:  # noqa: BLE001
        print(f"ollama api: UNREACHABLE at {HOST} ({type(exc).__name__})")
        print()
        print("Fix: install Ollama (https://ollama.com/download/windows), then")
        print("     ollama serve            # or launch the tray app")
        print("     ollama pull functiongemma:270m")
        print("     ollama pull qwen3.5:0.8b")
        return 2

    names = [m.get("name", "") for m in installed]
    print(f"ollama api: OK — {len(names)} model(s) installed")
    if names:
        for entry in installed:
            size_gb = (entry.get("size") or 0) / 1e9
            details = entry.get("details") or {}
            print(
                f"  - {entry.get('name'):32s} {size_gb:5.2f} GB  "
                f"{(details.get('parameter_size') or '?'):>6s}  {details.get('quantization_level') or ''}"
            )

    if names:
        missing = [tag for _, tag, _ in LADDER if not any(
            n == tag or n.split(":")[0] == tag.split(":")[0] and n.endswith(tag.split(":")[1])
            for n in names
        )]
        if missing:
            print("\nnot pulled yet:")
            for tag in missing:
                print(f"  ollama pull {tag}")

    if not args.bench and not args.tools and not args.vision:
        hr()
        print("status-only run. add --all to benchmark, test tools and vision.")
        return 0

    targets = args.models or names
    if not targets:
        print("\nnothing installed to test.")
        return 2

    # Embedding models cannot chat and :cloud models are remote; only
    # pull/health checks apply to them here.
    def _local_chat(m: str) -> bool:
        low = m.lower()
        return "embed" not in low and not low.endswith(":cloud")

    chattable = [m for m in targets if _local_chat(m)]
    skipped = [m for m in targets if m not in chattable]
    if skipped:
        print(f"\nskipping chat tests for non-local/embedding models: {', '.join(skipped)}")
    targets = chattable

    results: dict = {"host": platform.node(), "when": time.strftime("%Y-%m-%d %H:%M:%S"),
                     "models": list(targets), "bench": [], "tools": [], "vision": []}

    if args.bench:
        hr("throughput (single stream, temperature 0)")
        print(f"{'model':34s} {'ttft':>8s} {'tok/s':>8s} {'tokens':>7s} {'load':>7s}")
        for model in targets:
            res = bench(model)
            results["bench"].append(res)
            if res.get("ok"):
                print(
                    f"{model:34s} {res['ttft_ms']:>6d}ms {res['tok_s']:>8.1f} "
                    f"{res['decode_tokens']:>7d} {res['load_ms']:>5d}ms"
                )
            else:
                print(f"{model:34s} FAILED — {res.get('error', 'unknown')}")

        ok = [r for r in results["bench"] if r.get("ok")]
        if ok:
            ranking = sorted(ok, key=lambda r: r["tok_s"], reverse=True)
            print("\nranked by decode speed:")
            for i, r in enumerate(ranking, 1):
                print(f"  {i}. {r['model']:32s} {r['tok_s']:>7.1f} tok/s  ttft {r['ttft_ms']}ms")
            results["ranking"] = [r["model"] for r in ranking]

    if args.tools:
        hr("tool-call conformance")
        for model in targets:
            res = tool_test(model)
            results["tools"].append(res)
            mark = "PASS" if res.get("ok") else "FAIL"
            print(f"{mark}  {model:32s} called={res.get('called')} "
                  f"expected={res.get('expected')} err={res.get('error', '')}")

    if args.vision:
        hr("vision")
        for model in targets:
            res = vision_test(model)
            if res.get("error") and "not support" in res["error"].lower():
                print(f"SKIP {model:32s} no vision support")
                continue
            results["vision"].append(res)
            mark = "PASS" if res.get("ok") else "FAIL"
            print(f"{mark}  {model:32s} {res.get('latency_ms', '?')}ms "
                  f"colours={res.get('colours_detected')} {res.get('error', '')}")

    if args.json_out:
        try:
            os.makedirs(os.path.dirname(args.json_out), exist_ok=True)
            with open(args.json_out, "w", encoding="utf-8") as fh:
                json.dump(results, fh, indent=2)
            hr()
            print(f"results written: {args.json_out}")
        except OSError as exc:
            print(f"could not write results: {exc}")

    if args.require_tokps is not None:
        slow = [r for r in results["bench"] if r.get("ok") and r["tok_s"] < args.require_tokps]
        fast = [r for r in results["bench"] if r.get("ok") and r["tok_s"] >= args.require_tokps]
        hr()
        print(f"target {args.require_tokps:g} tok/s: {len(fast)} met, {len(slow)} below")
        for r in slow:
            print(f"  below: {r['model']} {r['tok_s']} tok/s")
        return 1 if slow else 0

    return 0


if __name__ == "__main__":
    sys.exit(main())
