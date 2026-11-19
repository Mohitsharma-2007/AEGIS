#!/usr/bin/env python3
"""W-MEM tests: four-layer memory HTTP surface, RAG toggle, STAIR.

Starts the daemon as a subprocess against a throwaway AEGIS_HOME
(AEGIS_NO_LLM=1, like tests/smoke_daemon.py) and checks:

  A. L1 captures list/get over HTTP; L2 search; L3 tree browse +
     leaf-title addressing; L4 graph nodes/edges + per-entity query.
  B. STAIR: the fixture research paper (tests/fixtures/sample_paper.md)
     builds tree nodes carrying its REAL section titles + title paths;
     a "Methods" query returns the Methods section's own content (not
     its subsections) via tree.address; "Participants" returns the
     leaf subsection.
  C. PDF ingestion: a stdlib-built PDF (no outline) is ingested via
     heading heuristics; when pypdf is importable, an outlined PDF is
     ingested via its own bookmark ToC.
  D. RAG toggle: ON -> a chat turn uses a remembered fact with
     citations; OFF -> the same turn contains NO retrieved context
     (checked on the /api/message pipeline output, no live LLM);
     explicit memory.recall still returns the fact while OFF;
     captures still record while OFF.

Exit code 0 when every check passes. Prints "MEMORY-RAG: n/n passed".
"""

from __future__ import annotations

import base64
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import zlib
from pathlib import Path

PORT = 8973
BASE = f"http://127.0.0.1:{PORT}"
APP_DIR = Path(__file__).resolve().parent.parent / "services" / "daemon"
FIXTURE = Path(__file__).resolve().parent / "fixtures" / "sample_paper.md"

RESULTS: list[tuple[str, bool, str]] = []


def record(name: str, ok: bool, detail: str = "") -> bool:
    RESULTS.append((name, bool(ok), detail))
    print(f"{'PASS' if ok else 'FAIL'}: {name}" + (f" — {detail}" if detail else ""),
          flush=True)
    return bool(ok)


def dumps(obj) -> str:
    try:
        return json.dumps(obj, default=str)
    except Exception:
        return str(obj)


def http_request(method: str, path: str, body=None, timeout: float = 20.0):
    url = BASE + path
    data = None
    headers = {"Accept": "application/json"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            status = resp.status
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        status = e.code
    except Exception as e:
        return 0, None, f"{type(e).__name__}: {e}"
    try:
        parsed = json.loads(raw)
    except Exception:
        parsed = None
    return status, parsed, raw


def http_get(path: str, timeout: float = 20.0):
    return http_request("GET", path, timeout=timeout)


def http_post(path: str, body: dict, timeout: float = 20.0):
    return http_request("POST", path, body=body, timeout=timeout)


def call_tool(tool: str, arguments: dict | None = None):
    return http_post("/api/tool", {"tool": tool, "arguments": arguments or {}})


def msg(text: str) -> dict:
    _s, payload, _raw = http_post("/api/message", {"text": text})
    return payload or {}


def daemon_command() -> list[str]:
    venv_python = (APP_DIR / ".venv" / "Scripts" / "python.exe"
                    if os.name == "nt" else APP_DIR / ".venv" / "bin" / "python")
    if venv_python.exists():
        return [str(venv_python), "-m", "aegis_daemon.main"]
    return ["python3", "-m", "aegis_daemon.main"]


def wait_for_health(proc: subprocess.Popen, timeout: float = 30.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if proc.poll() is not None:
            return False
        status, _p, _r = http_get("/health", timeout=3.0)
        if status == 200:
            return True
        time.sleep(0.25)
    return False


# ---------------------------------------------------------------------------
# Minimal stdlib PDF builder (uncompressed content streams, one Tj per
# line) — exercises the daemon's no-outline fallback honestly.
# ---------------------------------------------------------------------------

def build_simple_pdf(lines: list[str]) -> bytes:
    def esc(s: str) -> str:
        return s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")

    stream_lines = ["BT /F1 12 Tf 14 TL 72 720 Td"]
    for line in lines:
        stream_lines.append(f"({esc(line)}) Tj T*")
    stream_lines.append("ET")
    stream = "\n".join(stream_lines).encode("latin-1")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        b"/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n"
        + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for i, obj in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode() + obj + b"\nendobj\n"
    xref_pos = len(out)
    out += f"xref\n0 {len(objects) + 1}\n".encode()
    out += b"0000000000 65535 f \n"
    for off in offsets:
        out += f"{off:010d} 00000 n \n".encode()
    out += (f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
            f"startxref\n{xref_pos}\n%%EOF\n").encode()
    return bytes(out)


def main() -> int:
    tmpdir = tempfile.mkdtemp(prefix="aegis-memrag-")
    env = dict(os.environ)
    env["AEGIS_HOME"] = tmpdir
    env["AEGIS_PORT"] = str(PORT)
    env["AEGIS_NO_LLM"] = "1"
    env_file = Path(tmpdir) / "smoke.env"
    env_file.write_text("", encoding="utf-8")
    env["AEGIS_ENV_FILE"] = str(env_file)
    env["AEGIS_BROWSER_URL"] = "http://127.0.0.1:4311"

    log_path = Path(tmpdir) / "daemon.log"
    log_file = open(log_path, "wb")
    proc = subprocess.Popen(daemon_command(), cwd=str(APP_DIR), env=env,
                            stdout=log_file, stderr=subprocess.STDOUT)
    try:
        if not wait_for_health(proc):
            record("startup: daemon healthy", False, f"exit={proc.poll()}")
            return finish()
        record("startup: daemon healthy", True)

        # --- settings: rag_enabled default ON, exposed in state --------
        _s, state, _r = http_get("/api/state")
        record("A1. state: rag_enabled present and default true",
               (state or {}).get("rag_enabled") is True,
               dumps(state)[:200] if state else "no state")
        _s, settings, _r = http_get("/api/settings")
        record("A2. settings API: rag_enabled present",
               (settings or {}).get("rag_enabled") is True, dumps(settings)[:160])

        # --- STAIR ingest of the fixture paper --------------------------
        paper = FIXTURE.read_text(encoding="utf-8")
        _s, ingest, _r = http_post("/api/memory/ingest",
                                   {"text": paper, "source": "test-fixture"})
        record("B1. ingest: fixture paper stored with a STAIR tree",
               bool(ingest and ingest.get("ok") and ingest.get("tree_nodes", 0) >= 9),
               dumps(ingest)[:240])

        _s, tree_payload, _r = http_get("/api/tree")
        nodes = (tree_payload or {}).get("nodes") or []
        titles = [n.get("leaf_title") for n in nodes]
        expected = ["Abstract", "Introduction", "Methods", "Participants",
                    "Procedure", "Results", "Discussion", "References"]
        record("B2. tree: nodes carry the paper's real section titles",
               all(t in titles for t in expected), f"titles={titles}")
        participants = next((n for n in nodes if n.get("leaf_title") == "Participants"), {})
        record("B3. tree: nodes carry full section title paths",
               (participants.get("title_path") or "").endswith("Methods > Participants")
               and participants.get("is_leaf") is True,
               dumps(participants)[:240])
        methods = next((n for n in nodes if n.get("leaf_title") == "Methods"), {})
        record("B4. tree: Methods node body is its own section only",
               "METHODS_MARKER" in (methods.get("text") or "")
               and "PARTICIPANTS_MARKER" not in (methods.get("text") or ""),
               (methods.get("text") or "")[:160])

        _s, addressed, _r = http_get("/api/tree/address?q=Methods")
        record("B5. tree.address: 'Methods' resolves by leaf title to Methods content",
               bool(addressed and addressed.get("leaf_title") == "Methods"
                    and "METHODS_MARKER" in (addressed.get("text") or "")
                    and not addressed.get("abstained")),
               dumps(addressed)[:240])
        _s, addressed2, _r = http_get("/api/tree/address?q=Participants")
        record("B6. tree.address: 'Participants' resolves to the leaf subsection",
               bool(addressed2 and addressed2.get("leaf_title") == "Participants"
                    and "PARTICIPANTS_MARKER" in (addressed2.get("text") or "")),
               dumps(addressed2)[:200])
        node_id = participants.get("id")
        _s, node_payload, _r = http_get(f"/api/tree/nodes/{node_id}")
        record("B7. tree node get: /api/tree/nodes/{id} returns the node",
               bool(node_payload and node_payload.get("leaf_title") == "Participants"),
               dumps(node_payload)[:160])
        _s, tool_addr, _r = call_tool("tree.address", {"query": "Methods"})
        record("B8. tool tree.address: same leaf addressing via the broker",
               bool(tool_addr and tool_addr.get("ok")
                    and "METHODS_MARKER" in dumps(tool_addr)),
               dumps(tool_addr)[:200])

        # --- L1 captures -------------------------------------------------
        _s, caps, _r = http_get("/api/memory/captures?limit=10")
        cap_list = (caps or {}).get("captures") or []
        record("A3. captures list: ingest capture present with source",
               bool(caps and caps.get("ok") and any(
                   c.get("source") == "test-fixture" for c in cap_list)),
               dumps(caps)[:240])
        capture_id = (ingest or {}).get("capture_id")
        _s, one, _r = http_get(f"/api/memory/captures/{capture_id}")
        record("A4. captures get: single capture returns full text",
               bool(one and one.get("ok") and "METHODS_MARKER" in (one.get("text") or "")),
               dumps(one)[:160])
        status, _p, _r = http_get("/api/memory/captures/cap_doesnotexist")
        record("A5. captures get: unknown id is a clean 404",
               status == 404, f"status={status}")

        # --- L4 graph -----------------------------------------------------
        call_tool("memory.remember",
                  {"text": "Acme wants net-45 payment terms from now on"})
        _s, graph, _r = http_get("/api/graph")
        entities = [e.get("name") for e in (graph or {}).get("entities") or []]
        edges = (graph or {}).get("edges") or []
        record("A6. graph: /api/graph returns entities + edges",
               "Acme" in entities and any(
                   e.get("subj") == "Acme" and e.get("relation") == "wants"
                   for e in edges),
               f"entities={entities} edges={len(edges)}")
        _s, gq, _r = http_get("/api/graph/query?entity=Acme")
        record("A7. graph query: per-entity endpoint returns Acme's edges",
               bool(gq and any(e.get("subj") == "Acme" for e in gq.get("edges") or [])),
               dumps(gq)[:200])

        # --- L2 search endpoint -------------------------------------------
        _s, search, _r = http_get("/api/memory/search?q=payment%20terms%20Acme")
        record("A8. memory search: hybrid RAG endpoint returns the fact",
               bool(search and any("net-45" in (r.get("text") or "")
                                   for r in search.get("results") or [])),
               dumps(search)[:200])

        # --- RAG toggle -----------------------------------------------------
        msg("my favourite editor is Helix")
        on_turn = msg("what is my favourite editor")
        record("D1. RAG ON: turn uses the remembered fact with citations",
               "Helix" in str(on_turn.get("answer") or "")
               and bool(on_turn.get("citations"))
               and on_turn.get("rag_enabled") is True,
               dumps(on_turn)[:240])
        _s, set_off, _r = http_post("/api/settings", {"rag_enabled": False})
        record("D2. settings: rag_enabled=false persists via the setter",
               (set_off or {}).get("rag_enabled") is False, dumps(set_off)[:160])
        _s, state_off, _r = http_get("/api/state")
        record("D3. state: rag_enabled=false reflected in GET /api/state",
               (state_off or {}).get("rag_enabled") is False, "")
        off_turn = msg("what is my favourite editor")
        record("D4. RAG OFF: turn contains NO retrieved memory context",
               "Helix" not in str(off_turn.get("answer") or "")
               and not off_turn.get("citations")
               and off_turn.get("rag_enabled") is False,
               dumps(off_turn)[:240])
        _s, recall_off, _r = call_tool("memory.recall",
                                       {"query": "What is my favourite editor?"})
        record("D5. RAG OFF: explicit memory.recall tool still returns the fact",
               "Helix" in dumps(recall_off), dumps(recall_off)[:200])
        msg("remember that my favourite keyboard is Quokka")
        _s, recall_new, _r = call_tool(
            "memory.recall", {"query": "What is my favourite keyboard?"})
        record("D6. RAG OFF: captures still record (new fact recallable)",
               "Quokka" in dumps(recall_new), dumps(recall_new)[:200])
        _s, set_on, _r = http_post("/api/settings", {"rag_enabled": True})
        on_again = msg("what is my favourite editor")
        record("D7. RAG back ON: turn uses the remembered fact again",
               (set_on or {}).get("rag_enabled") is True
               and "Helix" in str(on_again.get("answer") or ""),
               dumps(on_again)[:200])

        # --- PDF ingestion --------------------------------------------------
        pdf_lines = [
            "Sample PDF Paper",
            "1 Introduction",
            "PDF_INTRO_MARKER the introduction of the pdf sample.",
            "2 Methods",
            "PDF_METHODS_MARKER the methods of the pdf sample describe",
            "the heading heuristic extraction path.",
            "3 Results",
            "PDF_RESULTS_MARKER the results of the pdf sample.",
        ]
        pdf_bytes = build_simple_pdf(pdf_lines)
        _s, pdf_ingest, _r = http_post("/api/memory/ingest-pdf", {
            "base64": base64.b64encode(pdf_bytes).decode(),
            "source": "test-pdf"})
        record("C1. PDF ingest (no outline): sections via heading heuristics",
               bool(pdf_ingest and pdf_ingest.get("ok")
                    and "Methods" in (pdf_ingest.get("headings") or [])),
               dumps(pdf_ingest)[:260])
        _s, pdf_addr, _r = http_get("/api/tree/address?q=Methods")
        # The markdown Methods also matches; accept either doc's marker
        # only if this PDF's node exists — verify via the tree instead.
        _s, tree2, _r = http_get("/api/tree")
        pdf_nodes = [n for n in (tree2 or {}).get("nodes") or []
                     if n.get("capture_id") == (pdf_ingest or {}).get("capture_id")]
        record("C2. PDF ingest: tree nodes built for the PDF capture",
               bool(pdf_nodes) and any(
                   "PDF_METHODS_MARKER" in (n.get("text") or "") for n in pdf_nodes),
               f"nodes={[(n.get('leaf_title')) for n in pdf_nodes]}")

        try:
            from pypdf import PdfWriter
            writer = PdfWriter()
            for _ in range(3):
                writer.add_blank_page(612, 792)
            writer.add_outline_item("Outlined Paper", 0)
            writer.add_outline_item("Outlined Methods", 1)
            writer.add_outline_item("Outlined Results", 2)
            import io
            buf = io.BytesIO()
            writer.write(buf)
            _s, outlined, _r = http_post("/api/memory/ingest-pdf", {
                "base64": base64.b64encode(buf.getvalue()).decode(),
                "source": "test-pdf-outline"})
            record("C3. PDF ingest (pypdf outline): tree from the PDF's own ToC",
                   bool(outlined and outlined.get("ok")
                        and "outline" in str(outlined.get("method"))
                        and "Outlined Methods" in (outlined.get("headings") or [])),
                   dumps(outlined)[:260])
        except ImportError:
            print("NOTE: pypdf not importable in the test process; "
                  "outline-PDF check skipped (daemon-side fallback covered "
                  "by C1/C2).", flush=True)
        return finish()
    finally:
        try:
            if proc.poll() is None:
                proc.terminate()
                proc.wait(timeout=5)
        except Exception:
            pass
        log_file.close()


def finish() -> int:
    passed = sum(1 for _n, ok, _d in RESULTS if ok)
    print(f"MEMORY-RAG: {passed}/{len(RESULTS)} passed", flush=True)
    return 0 if RESULTS and passed == len(RESULTS) else 1


if __name__ == "__main__":
    sys.exit(main())
