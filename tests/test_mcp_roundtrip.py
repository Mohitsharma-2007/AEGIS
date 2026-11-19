#!/usr/bin/env python3
"""MCP round-trip proof — BOTH directions, real stdio, official SDK.

Direction 1 (AEGIS as MCP client):
    McpManager spawns tests/mcp_test_server.py (an independent FastMCP
    server that imports no AEGIS code) over stdio, lists its tools,
    and calls echo / add through the manager's sync API.

Direction 2 (AEGIS as MCP server):
    This script acts as a raw MCP client (SDK ClientSession) against
    ``python -m aegis_daemon.mcp_server`` running with a temp AEGIS_HOME,
    lists its tools, and does a memory remember -> recall round-trip
    plus a system.info call.

Usage (from the aegis-one root):
    daemon/.venv/bin/python tests/test_mcp_roundtrip.py

Prints PASS/FAIL lines and exits 0 only if every check passes.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DAEMON_DIR = ROOT / "services" / "daemon"
sys.path.insert(0, str(DAEMON_DIR))

RESULTS: list[tuple[str, bool]] = []


def record(name: str, ok: bool, detail: str = "") -> bool:
    RESULTS.append((name, bool(ok)))
    line = f"{'PASS' if ok else 'FAIL'}: {name}"
    if detail:
        line += f" — {detail}"
    print(line, flush=True)
    return bool(ok)


def result_text(call_result) -> str:
    parts = []
    for item in getattr(call_result, "content", []) or []:
        if getattr(item, "type", None) == "text":
            parts.append(str(getattr(item, "text", "")))
    return "\n".join(parts)


def result_json(call_result):
    """Best-effort structured view of a CallToolResult: structuredContent
    first, else JSON parsed from the text content."""
    structured = getattr(call_result, "structuredContent", None)
    if isinstance(structured, dict):
        if set(structured) == {"result"} and isinstance(structured["result"], dict):
            return structured["result"]
        return structured
    text = result_text(call_result)
    try:
        return json.loads(text)
    except (ValueError, TypeError):
        return None


# ---------------------------------------------------------------------------
# Direction 1: AEGIS McpManager -> foreign test server
# ---------------------------------------------------------------------------

def direction_client() -> None:
    from aegis_daemon.mcp_client import McpManager

    home = Path(tempfile.mkdtemp(prefix="aegis-mcp-client-"))
    manager = McpManager(home=home)
    try:
        entry = manager.add_server({
            "name": "test",
            "command": sys.executable,
            "args": [str(Path(__file__).resolve().parent / "mcp_test_server.py")],
            "env_names": [],
        })
        record("client: connect to test server ok",
               entry.get("status") == "connected",
               f"status={entry.get('status')} error={entry.get('error')}")

        tools = manager.list_imported_tools()
        names = [t["name"] for t in tools]
        record("client: tools/list contains mcp.test.echo and mcp.test.add",
               "mcp.test.echo" in names and "mcp.test.add" in names,
               f"tools={names}")
        echo_decl = next((t for t in tools if t["name"] == "mcp.test.echo"), {})
        record("client: imported tool carries description + inputSchema",
               bool(echo_decl.get("description"))
               and "text" in (echo_decl.get("inputSchema") or {}).get("properties", {}),
               f"echo={echo_decl}")

        echo_res = manager.call_tool("mcp.test.echo", {"text": "hello aegis"})
        record("client: call mcp.test.echo returns the text",
               echo_res.get("ok") is True
               and "hello aegis" in (echo_res.get("text") or ""),
               f"result={echo_res}")

        add_res = manager.call_tool("mcp.test.add", {"a": 2, "b": 3})
        value = add_res.get("value")
        if value is None and add_res.get("text"):
            try:
                value = json.loads(add_res["text"])
            except ValueError:
                value = None
        record("client: call mcp.test.add(2, 3) == 5",
               add_res.get("ok") is True and value is not None and float(value) == 5.0,
               f"result={add_res}")

        decls = manager.register_into([])
        decl_names = [d["name"] for d in decls]
        record("client: register_into produces _decl-shaped declarations",
               set(decl_names) == {"mcp.test.echo", "mcp.test.add"}
               and all({"name", "description", "scopes", "risk", "reversible",
                        "confirmation", "arguments"} <= set(d) for d in decls),
               f"decls={decl_names}")

        status = manager.status()
        test_status = next((s for s in status if s["name"] == "test"), {})
        record("client: status() reports connected + tool_count == 2",
               test_status.get("status") == "connected"
               and test_status.get("tool_count") == 2,
               f"status={test_status}")
    finally:
        manager.shutdown()
    record("client: clean shutdown", manager._thread is None)


# ---------------------------------------------------------------------------
# Direction 2: raw MCP client -> AEGIS MCP server
# ---------------------------------------------------------------------------

async def _direction_server() -> None:
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import get_default_environment, stdio_client

    home = tempfile.mkdtemp(prefix="aegis-mcp-server-")
    env = dict(get_default_environment())
    env.update({
        "AEGIS_HOME": home,
        "PYTHONPATH": str(DAEMON_DIR),
        "PATH": os.environ.get("PATH", ""),
        "HOME": os.environ.get("HOME", ""),
    })
    params = StdioServerParameters(
        command=sys.executable,
        args=["-m", "aegis_daemon.mcp_server"],
        env=env,
        cwd=str(DAEMON_DIR),
    )
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()

            listed = await session.list_tools()
            names = [t.name for t in listed.tools]
            expected = {"memory.remember", "memory.recall", "memory.forget",
                        "graph.query", "system.info", "file.list", "file.read"}
            record("server: tools/list exposes the safe subset",
                   expected <= set(names), f"tools={names}")

            info_res = await session.call_tool("system.info", {})
            info = result_json(info_res)
            record("server: call system.info returns host info",
                   not info_res.isError and isinstance(info, dict)
                   and info.get("ok") is True and bool(info.get("platform")),
                   f"info={str(info)[:200]}")

            secret = "MCP roundtrip marker: Zephyr wants quantum widgets"
            rem_res = await session.call_tool(
                "memory.remember", {"text": secret, "source": "mcp-test"})
            rem = result_json(rem_res)
            record("server: call memory.remember ok",
                   not rem_res.isError and isinstance(rem, dict)
                   and rem.get("ok") is True and bool(rem.get("capture_id")),
                   f"remember={str(rem)[:200]}")

            rec_res = await session.call_tool(
                "memory.recall", {"query": "What does Zephyr want?"})
            rec = result_json(rec_res)
            blob = json.dumps(rec, default=str) if rec is not None else result_text(rec_res)
            record("server: call memory.recall finds the remembered text",
                   not rec_res.isError and "quantum widgets" in blob,
                   f"recall={blob[:300]}")


def direction_server() -> None:
    asyncio.run(_direction_server())
    record("server: clean shutdown", True)


def main() -> int:
    print("== Direction 1: AEGIS McpManager -> foreign MCP server (stdio) ==",
          flush=True)
    try:
        direction_client()
    except Exception as exc:
        record("client: direction completed without exception", False,
               f"{type(exc).__name__}: {exc}")

    print("== Direction 2: raw MCP client -> AEGIS MCP server (stdio) ==",
          flush=True)
    try:
        direction_server()
    except Exception as exc:
        record("server: direction completed without exception", False,
               f"{type(exc).__name__}: {exc}")

    passed = sum(1 for _n, ok in RESULTS if ok)
    total = len(RESULTS)
    print(f"MCP ROUNDTRIP: {passed}/{total} passed", flush=True)
    return 0 if total > 0 and passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
