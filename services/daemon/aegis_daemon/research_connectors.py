"""Research connectors: OpenAlex + GitHub (read-only HTTP APIs).

Both are plain HTTPS JSON APIs — no gh CLI, no app auth, no SDKs.
OpenAlex needs no key (a polite ``mailto`` query param is added only
when a contact email is configured via ``AEGIS_CONTACT_EMAIL`` /
``OPENALEX_MAILTO``). GitHub works unauthenticated; ``GITHUB_TOKEN``
from the environment is sent when present, never logged or returned.

Every OpenAlex result is stored as a capture (via the existing
``memory.create_capture`` path) with provenance in the capture source
(``openalex:<work_id>`` / ``openalex:<author_id>``), so later recall
cites it exactly like any other memory. GitHub results are returned
with the API's own rate-limit numbers when it reports them.
"""
from __future__ import annotations

import base64
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime

from . import memory as memory_mod
from .db import Store

OPENALEX_BASE = "https://api.openalex.org"
GITHUB_BASE = "https://api.github.com"
_USER_AGENT = "AEGIS/0.1.0 (research connector)"
_HTTP_TIMEOUT = 20


def _contact_email() -> str | None:
    for name in ("AEGIS_CONTACT_EMAIL", "OPENALEX_MAILTO"):
        value = (os.environ.get(name) or "").strip()
        if value and "@" in value:
            return value
    return None


def _get_json(url: str, headers: dict | None = None) -> tuple[dict | list, dict]:
    """GET JSON; returns (payload, response_headers_lowercased).
    Raises ValueError with a typed message on HTTP/parse failure."""
    req = urllib.request.Request(url, headers={
        "User-Agent": _USER_AGENT, "Accept": "application/json",
        **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=_HTTP_TIMEOUT) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            resp_headers = {k.lower(): v for k, v in resp.headers.items()}
    except urllib.error.HTTPError as exc:
        detail = ""
        try:
            detail = exc.read().decode("utf-8", errors="replace")[:300]
        except Exception:
            pass
        raise ValueError(f"http_{exc.code}:{detail or exc.reason}") from exc
    except Exception as exc:
        raise ValueError(f"request_failed:{type(exc).__name__}:{exc}") from exc
    try:
        return json.loads(raw), resp_headers
    except ValueError as exc:
        raise ValueError("invalid_json_response") from exc


# ---------------------------------------------------------------------------
# OpenAlex
# ---------------------------------------------------------------------------

def _openalex_url(path: str, params: dict) -> str:
    params = {k: v for k, v in params.items() if v not in (None, "")}
    email = _contact_email()
    if email:
        params.setdefault("mailto", email)
    query = urllib.parse.urlencode(params)
    return f"{OPENALEX_BASE}{path}" + (f"?{query}" if query else "")


def _work_summary(work: dict) -> dict:
    authors = []
    for authorship in work.get("authorships") or []:
        author = (authorship or {}).get("author") or {}
        if author.get("display_name"):
            authors.append(author["display_name"])
    location = work.get("primary_location") or {}
    source = location.get("source") or {}
    venue = source.get("display_name") or (work.get("host_venue") or {}).get("display_name")
    work_id = (work.get("id") or "").rsplit("/", 1)[-1]
    return {
        "id": work_id,
        "openalex_id": work.get("id"),
        "title": work.get("display_name") or work.get("title"),
        "authors": authors,
        "venue": venue,
        "year": work.get("publication_year"),
        "type": work.get("type"),
        "cited_by_count": work.get("cited_by_count"),
        "doi": work.get("doi"),
    }


def _store_openalex_capture(store: Store, text: str, entity_id: str,
                            kind: str = "research") -> str:
    """Store one result as a capture with OpenAlex provenance.
    Provenance rides the capture ``source`` field exactly as
    ``openalex:<id>`` — the same field recall surfaces as the
    citation's source."""
    created = memory_mod.create_capture(
        store, text, kind=kind, trust="untrusted",
        source=f"openalex:{entity_id}", make_memory=True)
    return created["capture_id"]


def openalex_search_works(store: Store, query: str, limit: int = 10) -> dict:
    query = (query or "").strip()
    if not query:
        return {"ok": False, "error": "empty_query"}
    limit = max(1, min(int(limit or 10), 25))
    payload, _headers = _get_json(_openalex_url("/works", {
        "search": query, "per-page": limit}))
    results = []
    for work in (payload.get("results") or []):
        summary = _work_summary(work)
        capture_text = (
            f"OpenAlex work: {summary['title']} ({summary['year']})"
            f" by {', '.join(summary['authors']) or 'unknown authors'}."
            f" Venue: {summary['venue'] or 'unknown'}."
            f" Cited by {summary['cited_by_count']}."
            f" OpenAlex ID: {summary['id']}. DOI: {summary['doi'] or 'none'}."
        )
        summary["capture_id"] = _store_openalex_capture(
            store, capture_text, summary["id"] or "unknown")
        summary["provenance"] = {"source": "openalex",
                                  "work_id": summary["id"]}
        results.append(summary)
    meta = payload.get("meta") or {}
    return {"ok": True, "query": query, "results": results,
            "count": len(results), "total": meta.get("count"),
            "source": "openalex"}


def _reconstruct_abstract(inverted: dict | None) -> str | None:
    if not inverted:
        return None
    positions: list[tuple[int, str]] = []
    for word, idxs in inverted.items():
        for idx in idxs or []:
            positions.append((int(idx), word))
    if not positions:
        return None
    positions.sort()
    return " ".join(word for _i, word in positions)


def openalex_work(store: Store, work_ref: str) -> dict:
    ref = (work_ref or "").strip()
    if not ref:
        return {"ok": False, "error": "empty_work_ref"}
    if ref.startswith("http") and "openalex.org/" in ref:
        ref = ref.rsplit("/", 1)[-1]
    path = f"/works/doi:{ref}" if ref.startswith("10.") else f"/works/{ref}"
    payload, _headers = _get_json(_openalex_url(path, {}))
    summary = _work_summary(payload)
    summary["abstract"] = _reconstruct_abstract(
        payload.get("abstract_inverted_index"))
    summary["referenced_works_count"] = len(payload.get("referenced_works") or [])
    summary["open_access"] = (payload.get("open_access") or {}).get("is_oa")
    capture_text = (
        f"OpenAlex work: {summary['title']} ({summary['year']})"
        f" by {', '.join(summary['authors']) or 'unknown authors'}."
        f" Venue: {summary['venue'] or 'unknown'}."
        f" Cited by {summary['cited_by_count']}."
        f" OpenAlex ID: {summary['id']}. DOI: {summary['doi'] or 'none'}."
        + (f" Abstract: {summary['abstract']}" if summary["abstract"] else "")
    )
    summary["capture_id"] = _store_openalex_capture(
        store, capture_text, summary["id"] or "unknown")
    summary["provenance"] = {"source": "openalex", "work_id": summary["id"]}
    return {"ok": True, "work": summary, **summary}


def openalex_search_authors(store: Store, query: str, limit: int = 10) -> dict:
    query = (query or "").strip()
    if not query:
        return {"ok": False, "error": "empty_query"}
    limit = max(1, min(int(limit or 10), 25))
    payload, _headers = _get_json(_openalex_url("/authors", {
        "search": query, "per-page": limit}))
    results = []
    for author in (payload.get("results") or []):
        author_id = (author.get("id") or "").rsplit("/", 1)[-1]
        institutions = []
        for inst in author.get("last_known_institutions") or []:
            if (inst or {}).get("display_name"):
                institutions.append(inst["display_name"])
        entry = {
            "id": author_id,
            "openalex_id": author.get("id"),
            "name": author.get("display_name"),
            "works_count": author.get("works_count"),
            "cited_by_count": author.get("cited_by_count"),
            "orcid": author.get("orcid"),
            "institutions": institutions,
        }
        capture_text = (
            f"OpenAlex author: {entry['name']}. Works: {entry['works_count']}."
            f" Cited by {entry['cited_by_count']}."
            f" Institutions: {', '.join(institutions) or 'unknown'}."
            f" OpenAlex ID: {author_id}."
        )
        entry["capture_id"] = _store_openalex_capture(
            store, capture_text, author_id or "unknown")
        entry["provenance"] = {"source": "openalex", "author_id": author_id}
        results.append(entry)
    return {"ok": True, "query": query, "results": results,
            "count": len(results), "source": "openalex"}


# ---------------------------------------------------------------------------
# GitHub (plain REST; GITHUB_TOKEN env optional, never logged/returned)
# ---------------------------------------------------------------------------

def _github_headers(extra: dict | None = None) -> dict:
    headers = {"Accept": "application/vnd.github+json",
               "X-GitHub-Api-Version": "2022-11-28", **(extra or {})}
    token = (os.environ.get("GITHUB_TOKEN") or "").strip()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def _rate_limit(headers: dict) -> dict | None:
    if "x-ratelimit-limit" not in headers:
        return None
    out = {}
    for key, name in (("x-ratelimit-limit", "limit"),
                      ("x-ratelimit-remaining", "remaining"),
                      ("x-ratelimit-used", "used"),
                      ("x-ratelimit-reset", "reset")):
        if key in headers:
            try:
                out[name] = int(headers[key])
            except ValueError:
                out[name] = headers[key]
    if out.get("remaining") == 0:
        out["note"] = ("GitHub API rate limit exhausted for this client; "
                       "set GITHUB_TOKEN for a higher limit.")
    return out


def _split_repo(args: dict) -> tuple[str, str] | None:
    repo = str(args.get("repo") or args.get("repository") or "").strip()
    if repo:
        candidate = repo
        if candidate.startswith(("https://", "http://")):
            try:
                parsed = urllib.parse.urlparse(candidate)
                if parsed.hostname not in {"github.com", "www.github.com"}:
                    return None
                candidate = parsed.path.strip("/")
            except ValueError:
                return None
        candidate = candidate.split("?", 1)[0].split("#", 1)[0].strip("/")
        parts = candidate.split("/")
        if len(parts) >= 2:
            owner, name = parts[0].strip(), parts[1].strip()
            if name.endswith(".git"):
                name = name[:-4]
            if owner and name and all(ch not in owner + name for ch in "\\\\\0"):
                return owner, name
    owner = str(args.get("owner") or "").strip()
    name = str(args.get("name") or repo).strip()
    if owner and name:
        return owner, name
    return None


def _gh_get(path: str, params: dict | None = None):
    query = urllib.parse.urlencode(
        {k: v for k, v in (params or {}).items() if v not in (None, "")})
    url = f"{GITHUB_BASE}{path}" + (f"?{query}" if query else "")
    return _get_json(url, headers=_github_headers())


def github_repo(store: Store, args: dict) -> dict:
    split = _split_repo(args)
    if split is None:
        return {"ok": False, "error": "invalid_repo",
                "detail": "pass repo as 'owner/name'"}
    owner, name = split
    payload, headers = _gh_get(f"/repos/{owner}/{name}")
    languages, _h2 = _gh_get(f"/repos/{owner}/{name}/languages")
    license_info = (payload.get("license") or {}).get("spdx_id")
    result = {
        "ok": True,
        "full_name": payload.get("full_name"),
        "name": payload.get("name"),
        "owner": (payload.get("owner") or {}).get("login"),
        "description": payload.get("description"),
        "html_url": payload.get("html_url"),
        "homepage": payload.get("homepage"),
        "stars": payload.get("stargazers_count"),
        "forks": payload.get("forks_count"),
        "watchers": payload.get("watchers_count"),
        "open_issues": payload.get("open_issues_count"),
        "language": payload.get("language"),
        "languages": languages if isinstance(languages, dict) else {},
        "default_branch": payload.get("default_branch"),
        "license": license_info,
        "topics": payload.get("topics") or [],
        "created_at": payload.get("created_at"),
        "updated_at": payload.get("updated_at"),
        "pushed_at": payload.get("pushed_at"),
        "archived": payload.get("archived"),
        "fork": payload.get("fork"),
        "source": "github",
    }
    rate = _rate_limit(headers)
    if rate:
        result["rate_limit"] = rate
    return result


def github_tree(store: Store, args: dict) -> dict:
    split = _split_repo(args)
    if split is None:
        return {"ok": False, "error": "invalid_repo",
                "detail": "pass repo as 'owner/name'"}
    owner, name = split
    ref = str(args.get("ref") or args.get("branch") or "").strip()
    if not ref:
        repo_payload, _h = _gh_get(f"/repos/{owner}/{name}")
        ref = repo_payload.get("default_branch") or "HEAD"
    recursive = args.get("recursive") is True or str(
        args.get("recursive") or "").lower() == "true"
    params = {"recursive": "1"} if recursive else {}
    payload, headers = _gh_get(
        f"/repos/{owner}/{name}/git/trees/{urllib.parse.quote(str(ref), safe='')}",
        params)
    entries = [{"path": e.get("path"), "type": e.get("type"),
                "size": e.get("size"), "sha": e.get("sha")}
               for e in (payload.get("tree") or [])]
    cap = 500
    truncated = bool(payload.get("truncated")) or len(entries) > cap
    result = {
        "ok": True, "repo": f"{owner}/{name}", "ref": ref,
        "recursive": recursive,
        "tree": entries[:cap], "count": min(len(entries), cap),
        "total_entries": len(entries), "truncated": truncated,
        "source": "github",
    }
    if truncated:
        result["note"] = ("Tree listing truncated "
                          f"({'API-reported' if payload.get('truncated') else f'showing first {cap}'}).")
    rate = _rate_limit(headers)
    if rate:
        result["rate_limit"] = rate
    return result


def github_commits(store: Store, args: dict) -> dict:
    split = _split_repo(args)
    if split is None:
        return {"ok": False, "error": "invalid_repo",
                "detail": "pass repo as 'owner/name'"}
    owner, name = split
    per_page = max(1, min(int(args.get("per_page") or 30), 100))
    params = {"per_page": per_page,
              "sha": args.get("ref") or args.get("branch"),
              "since": args.get("since"), "until": args.get("until")}
    payload, headers = _gh_get(f"/repos/{owner}/{name}/commits", params)
    commits = payload if isinstance(payload, list) else []
    by_author: dict[str, int] = {}
    by_week: dict[str, int] = {}
    recent = []
    for entry in commits:
        commit = entry.get("commit") or {}
        author_meta = commit.get("author") or {}
        author_name = ((entry.get("author") or {}).get("login")
                       or author_meta.get("name") or "unknown")
        by_author[author_name] = by_author.get(author_name, 0) + 1
        date_raw = author_meta.get("date") or ""
        week_key = "unknown"
        try:
            parsed = datetime.fromisoformat(date_raw.replace("Z", "+00:00"))
            iso = parsed.isocalendar()
            week_key = f"{iso[0]}-W{iso[1]:02d}"
        except ValueError:
            pass
        by_week[week_key] = by_week.get(week_key, 0) + 1
        if len(recent) < 10:
            recent.append({
                "sha": (entry.get("sha") or "")[:7],
                "message": (commit.get("message") or "").splitlines()[0],
                "author": author_name, "date": date_raw})
    result = {
        "ok": True, "repo": f"{owner}/{name}",
        "analysis": {
            "total_in_page": len(commits),
            "page_size": per_page,
            "range_note": ("Counts cover the single fetched page "
                           f"(up to {per_page} most recent commits in the "
                           "requested range), not the repo's full history."),
            "by_author": dict(sorted(by_author.items(),
                                     key=lambda kv: kv[1], reverse=True)),
            "by_iso_week": dict(sorted(by_week.items())),
        },
        "recent": recent,
        "commits": recent,
        "source": "github",
    }
    rate = _rate_limit(headers)
    if rate:
        result["rate_limit"] = rate
    return result


_GITHUB_FILE_CAP = 100_000  # characters of decoded content


def github_file(store: Store, args: dict) -> dict:
    split = _split_repo(args)
    if split is None:
        return {"ok": False, "error": "invalid_repo",
                "detail": "pass repo as 'owner/name'"}
    owner, name = split
    path = str(args.get("path") or "").strip().lstrip("/")
    if not path:
        return {"ok": False, "error": "empty_path"}
    payload, headers = _gh_get(
        f"/repos/{owner}/{name}/contents/{urllib.parse.quote(path)}",
        {"ref": args.get("ref") or args.get("branch")})
    if isinstance(payload, list):
        return {"ok": False, "error": "path_is_directory", "path": path,
                "entries": [e.get("name") for e in payload]}
    size = payload.get("size") or 0
    if payload.get("encoding") != "base64" or not payload.get("content"):
        return {"ok": False, "error": "content_unavailable",
                "detail": ("GitHub contents API returned no base64 content "
                           f"(size={size}); files over ~1MB are not served "
                           "this way."), "path": path, "size": size}
    decoded = base64.b64decode(payload["content"]).decode(
        "utf-8", errors="replace")
    truncated = len(decoded) > _GITHUB_FILE_CAP
    result = {
        "ok": True, "repo": f"{owner}/{name}", "path": path,
        "name": payload.get("name"), "size": size, "sha": payload.get("sha"),
        "content": decoded[:_GITHUB_FILE_CAP], "truncated": truncated,
        "source": "github",
    }
    if truncated:
        result["note"] = f"Content capped at {_GITHUB_FILE_CAP} characters."
    rate = _rate_limit(headers)
    if rate:
        result["rate_limit"] = rate
    return result
