#!/usr/bin/env python3
"""A tiny INDEPENDENT stdio MCP server used to prove AEGIS's MCP client
interop. It is the "foreign" server: it deliberately imports NOTHING from
aegis_daemon — only the official MCP Python SDK's FastMCP.

Tools:
    echo(text) -> the same text back
    add(a, b)  -> a + b

Run directly:  python3 tests/mcp_test_server.py   (speaks MCP on stdio)
"""
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("test", log_level="ERROR")


@mcp.tool(description="Return the given text unchanged")
def echo(text: str) -> str:
    return text


@mcp.tool(description="Add two numbers and return the sum")
def add(a: float, b: float) -> float:
    # Return an int-looking value for whole sums so clients see 5, not 5.0.
    total = a + b
    return int(total) if float(total).is_integer() else total


if __name__ == "__main__":
    mcp.run(transport="stdio")
