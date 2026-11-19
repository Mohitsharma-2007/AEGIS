#!/usr/bin/env python3
"""W-MEM live connector tests: OpenAlex + GitHub daemon tools.

These are LIVE tests (network, no API keys) — nothing is mocked. If
the network is blocked at run time the checks fail with the real
error recorded, by design.

  1. openalex.search_works "attention is all you need" returns the
     real Transformer paper with cited_by_count > 0, and a capture
     with openalex provenance is stored for it.
  2. openalex.work returns details incl. a reconstructed abstract.
  3. openalex.search_authors returns real authors.
  4. github.repo on CopilotKit/OpenDots returns real metadata.
  5. github.commits returns a non-empty analysis.
  6. github.tree / github.file return real content.

Exit code 0 when every check passes. Prints "CONNECTORS: n/n passed".
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

PORT = 8975
BASE = f"http://127.0.0.1:{PORT}"
APP_DIR = Path(__file__).resolve().parent.parent / "services" / "daemon"

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


def http_request(method: str, path: str, body=None, timeout: float = 45.0):
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


def http_get(path: str, timeout: float = 45.0):
    return http_request("GET", path, timeout=timeout)


def http_post(path: str, body: dict, timeout: float = 45.0):
    return http_request("POST", path, body=body, timeout=timeout)


def call_tool(tool: str, arguments: dict | None = None) -> dict:
    _s, payload, _raw = http_post("/api/tool",
                                  {"tool": tool, "arguments": arguments or {}})
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


def main() -> int:
    tmpdir = tempfile.mkdtemp(prefix="aegis-connectors-")
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
        # network.get scope lives in Browser mode.
        http_post("/api/mode", {"mode": "Browser"})

        # --- OpenAlex --------------------------------------------------
        search = call_tool("openalex.search_works",
                           {"query": "attention is all you need", "limit": 5})
        results = search.get("results") or []
        paper = next((r for r in results
                      if "attention is all you need"
                      in str(r.get("title") or "").lower()), None)
        record("1a. openalex.search_works: real Transformer paper, citations > 0",
               bool(search.get("ok") and paper
                    and (paper.get("cited_by_count") or 0) > 0),
               dumps(paper)[:260] if paper else dumps(search)[:260])
        _s, caps, _r = http_get("/api/memory/captures?limit=50")
        cap_list = (caps or {}).get("captures") or []
        prov_caps = [c for c in cap_list
                     if str(c.get("source") or "").startswith("openalex:")]
        record("1b. openalex: results stored as captures with openalex provenance",
               bool(paper and paper.get("capture_id")
                    and any(c.get("id") == paper.get("capture_id")
                            and str(c.get("source")) == f"openalex:{paper.get('id')}"
                            for c in prov_caps)),
               f"provenance_captures={len(prov_caps)}")
        if paper:
            work = call_tool("openalex.work", {"id": paper.get("id")})
            abstract = str(work.get("abstract") or "")
            record("2. openalex.work: details + reconstructed abstract",
                   bool(work.get("ok") and len(abstract) > 100
                        and "transformer" in abstract.lower()),
                   f"abstract[:160]={abstract[:160]!r}")
        else:
            record("2. openalex.work: details + reconstructed abstract", False,
                   "no paper from check 1a to fetch")
        authors = call_tool("openalex.search_authors",
                            {"query": "Geoffrey Hinton", "limit": 5})
        author_results = authors.get("results") or []
        record("3. openalex.search_authors: real authors returned",
               bool(authors.get("ok") and author_results
                    and any((a.get("works_count") or 0) > 0
                            for a in author_results)),
               dumps(author_results[0])[:220] if author_results
               else dumps(authors)[:220])

        # --- GitHub ------------------------------------------------------
        repo = call_tool("github.repo", {"repo": "CopilotKit/OpenDots"})
        record("4. github.repo: real metadata for CopilotKit/OpenDots",
               bool(repo.get("ok")
                    and repo.get("full_name") == "CopilotKit/OpenDots"
                    and repo.get("default_branch")
                    and isinstance(repo.get("languages"), dict)
                    and len(repo.get("languages") or {}) > 0),
               dumps({k: repo.get(k) for k in
                      ("full_name", "default_branch", "stars", "language",
                       "rate_limit")})[:300])
        commits = call_tool("github.commits",
                            {"repo": "CopilotKit/OpenDots", "per_page": 20})
        analysis = commits.get("analysis") or {}
        record("5. github.commits: non-empty analysis (total/by_author/by_week)",
               bool(commits.get("ok")
                    and (analysis.get("total_in_page") or 0) > 0
                    and analysis.get("by_author")
                    and analysis.get("by_iso_week")),
               dumps(analysis)[:300])
        tree = call_tool("github.tree", {"repo": "CopilotKit/OpenDots"})
        record("6a. github.tree: real file tree entries",
               bool(tree.get("ok") and (tree.get("count") or 0) > 0),
               f"count={tree.get('count')} truncated={tree.get('truncated')}")
        file_result = call_tool("github.file",
                                {"repo": "CopilotKit/OpenDots", "path": "README.md"})
        record("6b. github.file: README content fetched + decoded",
               bool(file_result.get("ok")
                    and len(str(file_result.get("content") or "")) > 100),
               f"size={file_result.get('size')} "
               f"content[:80]={str(file_result.get('content') or '')[:80]!r}")
        # Broker + action log: the calls above must be in /api/log.
        _s, log, _r = http_get("/api/log?limit=100")
        log_blob = dumps(log)
        record("7. broker log: connector calls are in the action log",
               "openalex.search_works" in log_blob and "github.repo" in log_blob,
               "")
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
    print(f"CONNECTORS: {passed}/{len(RESULTS)} passed", flush=True)
    return 0 if RESULTS and passed == len(RESULTS) else 1


if __name__ == "__main__":
    sys.exit(main())
