"""Memory engine: captures, hybrid RAG, and a scoped knowledge graph.

Historical STAIR tables/functions remain for compatibility with old data, but
new writes use captures, RAG chunks, and graph relations only. Law 1:
provenance or it didn't happen—every memory hangs off a capture, recall cites
capture ids, and recall abstains below the relevance floor.
"""
from __future__ import annotations

import hashlib
import json
import math
import re
import time
import uuid

from . import embeddings
from .db import Store

ABSTAIN_THRESHOLD = 0.08
ABSTAIN_MESSAGE = "I don't know — no memory matches that closely enough to cite."


def _now() -> float:
    return time.time()


def _capture_id(text: str, source: str = "user", scope_id: str = "") -> str:
    identity = json.dumps([source, scope_id, text], ensure_ascii=False, separators=(",", ":"))
    return "cap_" + hashlib.sha256(identity.encode("utf-8")).hexdigest()[:16]


def _chunk_text(text: str) -> list[str]:
    text = text.strip()
    if len(text) <= 1000:
        return [text] if text else []
    chunks: list[str] = []
    current = ""
    for para in re.split(r"\n\s*\n", text):
        if len(current) + len(para) + 2 <= 1000:
            current = (current + "\n\n" + para) if current else para
        else:
            if current:
                chunks.append(current)
            while len(para) > 1000:
                chunks.append(para[:1000])
                para = para[1000:]
            current = para
    if current:
        chunks.append(current)
    return chunks


# --------------------------------------------------------------------------
# L1 + L2 write path
# --------------------------------------------------------------------------

def create_capture(store: Store, text: str, kind: str = "note",
                   trust: str = "trusted", source: str = "user",
                   make_memory: bool = True, scope_id: str = "") -> dict:
    scope_id = str(scope_id or "").strip()[:160]
    cap_id = _capture_id(text, source, scope_id)
    existing = store.query_one("SELECT id,tombstoned FROM captures WHERE id=?", (cap_id,))
    ts = _now()
    if existing is None:
        store.execute(
            "INSERT INTO captures(id,text,kind,trust,source,ts,tombstoned,scope_id) VALUES(?,?,?,?,?,?,0,?)",
            (cap_id, text, kind, trust, source, ts, scope_id or None),
        )
        for idx, chunk_text in enumerate(_chunk_text(text)):
            chunk_id = f"{cap_id}_chunk_{idx}"
            store.execute(
                "INSERT OR IGNORE INTO chunks(id,capture_id,text,embedding) VALUES(?,?,?,?)",
                (chunk_id, cap_id, chunk_text, json.dumps(embeddings.embed(chunk_text))),
            )
            store.execute(
                "INSERT INTO chunks_fts(chunk_id,capture_id,text) VALUES(?,?,?)",
                (chunk_id, cap_id, chunk_text),
            )
    elif bool(existing["tombstoned"]):
        # An explicit re-save restores the same scoped capture instead of
        # creating a new memory that remains hidden behind a tombstone.
        store.execute("UPDATE captures SET tombstoned=0,ts=? WHERE id=?", (ts, cap_id))
    memory_id = None
    if make_memory:
        row = store.query_one(
            "SELECT id FROM memories WHERE capture_id=? AND tombstoned=0", (cap_id,))
        if row is None:
            memory_id = "mem_" + uuid.uuid4().hex[:16]
            store.execute(
                "INSERT INTO memories(id,capture_id,text,importance,usage_count,ts,tombstoned)"
                " VALUES(?,?,?,?,0,?,0)",
                (memory_id, cap_id, text, 1.0, ts),
            )
        else:
            memory_id = row["id"]
    # Do not populate the retired STAIR tree for new captures.
    edges = extract_edges(store, cap_id, text, ts)
    chunk_count = store.query_one(
        "SELECT COUNT(*) AS count FROM chunks WHERE capture_id=?", (cap_id,)
    )
    return {"capture_id": cap_id, "memory_id": memory_id, "edges": edges,
            "chunks_created": int(chunk_count["count"] if chunk_count else 0), "ts": ts}


# --------------------------------------------------------------------------
# L1 captures (read side)
# --------------------------------------------------------------------------

def _capture_dict(row, include_text: bool = True) -> dict:
    out = {"id": row["id"], "capture_id": row["id"], "kind": row["kind"],
           "trust": row["trust"], "source": row["source"], "ts": row["ts"],
           "tombstoned": bool(row["tombstoned"])}
    try:
        out["scope_id"] = row["scope_id"]
    except (KeyError, IndexError, TypeError):
        out["scope_id"] = None
    if include_text:
        out["text"] = row["text"]
    else:
        out["text"] = (row["text"] or "")[:200]
        out["text_truncated"] = len(row["text"] or "") > 200
    return out


def list_captures(store: Store, limit: int = 50) -> dict:
    limit = max(1, min(int(limit or 50), 500))
    # Deleted (tombstoned) captures stay in the database for audit but must not
    # be listed, otherwise a memory the owner removed keeps showing up.
    rows = store.query(
        "SELECT * FROM captures WHERE tombstoned=0 ORDER BY ts DESC, rowid DESC LIMIT ?",
        (limit,))
    captures = [_capture_dict(r, include_text=False) for r in rows]
    total_row = store.query_one(
        "SELECT COUNT(*) AS n FROM captures WHERE tombstoned=0")
    return {"ok": True, "captures": captures, "count": len(captures),
            "total": int(total_row["n"]) if total_row else len(captures)}


def get_capture(store: Store, capture_id: str) -> dict:
    row = store.query_one("SELECT * FROM captures WHERE id=?", (capture_id,))
    if row is None:
        return {"ok": False, "error": "capture_not_found", "capture_id": capture_id}
    return {"ok": True, "capture": _capture_dict(row), **_capture_dict(row)}


def remember(store: Store, text: str, source: str = "user",
             scope_id: str = "", category: str = "note") -> dict:
    text = (text or "").strip()
    if not text:
        return {"ok": False, "error": "empty_text"}
    category = category if category in {"personal", "task", "document", "preference", "note"} else "note"
    created = create_capture(store, text, kind=category, trust="trusted", source=source,
                             scope_id=scope_id)
    return {
        "ok": True,
        "capture_id": created["capture_id"],
        "memory_id": created["memory_id"],
        "id": created["memory_id"],
        "text": text,
        "source": source,
        "scope_id": scope_id or None,
        "category": category,
        "edges_created": len(created["edges"]),
        "chunks_created": created["chunks_created"],
    }


# --------------------------------------------------------------------------
# L4 graph extraction (regex rules; rule name recorded on every edge)
# --------------------------------------------------------------------------

_CAP_NAME = r"[A-Z][A-Za-z0-9]*(?:\s+[A-Z][A-Za-z0-9]*)*"
_USER_VALUE = r"(.+?)(?=[;\n]|(?<=[.!?])\s+|$)"

_EDGE_RULES = [
    # Explicit first-person task and profile statements are normalized to the
    # owner entity so recall can connect the task to other project facts.
    ("user_working_on_rule", re.compile(r"\bI(?:'m| am)\s+working on\s+" + _USER_VALUE, re.IGNORECASE), "working_on"),
    ("user_researching_rule", re.compile(r"\bI(?:'m| am)\s+researching\s+" + _USER_VALUE, re.IGNORECASE), "researching"),
    ("user_opened_rule", re.compile(r"\bI\s+opened\s+" + _USER_VALUE, re.IGNORECASE), "opened"),
    ("user_preference_rule", re.compile(r"\bI\s+prefer\s+" + _USER_VALUE, re.IGNORECASE), "prefers"),
    ("user_identity_rule", re.compile(r"\bmy\s+(name|gmail|email|portfolio)\s+is\s+(.+?)(?=[;\n]|(?<=[.!?])\s+|$)", re.IGNORECASE), "has"),
    ("wants_rule", re.compile(rf"({_CAP_NAME})\s+wants\s+([^\.;\n]+)"), "wants"),
    ("owns_rule", re.compile(rf"({_CAP_NAME})\s+owns\s+([^\.;\n]+)"), "owns"),
    ("is_rule", re.compile(rf"({_CAP_NAME})\s+is\s+([^\.;\n]+)"), "is"),
    ("generic_wants_rule", re.compile(r"\b([a-zA-Z][a-zA-Z0-9]*)\s+wants\s+([^\.;\n]+)"), "wants"),
]
_CAP_PHRASE_RE = re.compile(r"\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+|[A-Z][a-z]+)\b")


def _ensure_entity(store: Store, name: str) -> None:
    name = name.strip()
    if name:
        store.execute("INSERT OR IGNORE INTO entities(name) VALUES(?)", (name,))


def extract_edges(store: Store, capture_id: str, text: str, ts: float) -> list[dict]:
    created: list[dict] = []
    seen: set[tuple] = set()
    for rule_name, pattern, relation in _EDGE_RULES:
        for match in pattern.finditer(text):
            subj = match.group(1).strip()
            obj = match.group(match.lastindex or 2).strip().rstrip(".")
            if rule_name in {"user_working_on_rule", "user_researching_rule"}:
                obj = re.split(r"\s+and\s+I\b", obj, maxsplit=1, flags=re.IGNORECASE)[0].strip()
            if rule_name == "user_identity_rule":
                obj = f"{match.group(1).strip().lower()}: {obj}"
            if rule_name.startswith("user_"):
                subj = "User"
            # Avoid capturing lead-ins like "that Acme" / "Remember Acme".
            subj = re.sub(r"^(that|remember|and|the)\s+", "", subj, flags=re.IGNORECASE)
            if not subj or not obj or len(obj) > 120:
                continue
            key = (subj.lower(), relation, obj.lower())
            if key in seen:
                continue
            seen.add(key)
            dup = store.query_one(
                "SELECT id FROM edges WHERE lower(subj)=lower(?) AND relation=?"
                " AND lower(obj)=lower(?) AND capture_id=?",
                (subj, relation, obj, capture_id))
            if dup is not None:
                continue
            _ensure_entity(store, subj)
            store.execute(
                "INSERT INTO edges(subj,relation,obj,valid_from,valid_to,rule,capture_id)"
                " VALUES(?,?,?,?,NULL,?,?)",
                (subj, relation, obj, ts, rule_name, capture_id),
            )
            created.append({"subj": subj, "subject": subj, "relation": relation,
                            "obj": obj, "object": obj, "rule": rule_name,
                            "extraction_rule": rule_name, "capture_id": capture_id})
        if created and rule_name.endswith("_rule") and not rule_name.startswith("generic"):
            # Prefer specific capitalised rules; still allow later rules for
            # other sentences, so do not break — the seen-set dedupes.
            pass
    for phrase in _CAP_PHRASE_RE.findall(text):
        _ensure_entity(store, phrase)
    return created


def graph_query(store: Store, entity: str, scope_id: str | None = None) -> dict:
    entity = (entity or "").strip()
    sql = (
        "SELECT e.*, c.source AS capture_source, c.ts AS capture_ts, c.scope_id AS scope_id "
        "FROM edges e JOIN captures c ON c.id=e.capture_id AND c.tombstoned=0 "
        "JOIN memories m ON m.capture_id=c.id AND m.tombstoned=0 "
        "WHERE (lower(e.subj)=lower(?) OR lower(e.obj)=lower(?))")
    params: tuple = (entity, entity)
    if scope_id:
        sql += " AND c.scope_id=?"
        params += (scope_id,)
    sql += " ORDER BY e.id"
    rows = store.query(
        sql, params)
    current, history = [], []
    for row in rows:
        edge = _edge_dict(row)
        (current if row["valid_to"] is None else history).append(edge)
    return {"ok": True, "entity": entity, "scope_id": scope_id,
            "edges": current, "current": current, "history": history}


def _edge_dict(row) -> dict:
    result = {
        "id": row["id"], "subj": row["subj"], "subject": row["subj"],
        "relation": row["relation"], "obj": row["obj"], "object": row["obj"],
        "valid_from": row["valid_from"], "valid_to": row["valid_to"],
        "rule": row["rule"], "extraction_rule": row["rule"],
        "capture_id": row["capture_id"],
    }
    for key in ("capture_source", "capture_ts", "scope_id"):
        try:
            value = row[key]
        except (KeyError, IndexError, TypeError):
            continue
        if value is not None:
            result[key] = value
    return result


def all_graph(store: Store) -> dict:
    rows = store.query(
        "SELECT e.*, c.source AS capture_source, c.ts AS capture_ts, c.scope_id AS scope_id "
        "FROM edges e JOIN captures c ON c.id=e.capture_id AND c.tombstoned=0 "
        "JOIN memories m ON m.capture_id=c.id AND m.tombstoned=0 ORDER BY e.id")
    edges = [_edge_dict(r) for r in rows]
    names = sorted({str(edge[k]).strip() for edge in edges for k in ("subj", "obj") if edge[k]})
    entities = [{"id": name.casefold(), "name": name} for name in names]
    return {"entities": entities, "edges": edges}


# --------------------------------------------------------------------------
# L3 STAIR tree
# --------------------------------------------------------------------------

_HEADING_RE = re.compile(r"^(#{1,6})\s+(.*)$")
# Numbered section headings in plain text / extracted PDF text:
# "1 Introduction", "2.1 Participants", "3. Methods" (level = dot depth).
_NUMBERED_HEADING_RE = re.compile(
    r"^(\d+(?:\.\d+)*)\.?\s+([A-Z][A-Za-z0-9 ,\-()/'&]{1,80})$")
# Short ALL-CAPS or Title-Case lines are heading heuristics of last
# resort for extracted text (PDF fallback); kept conservative.
_KNOWN_SECTION_TITLES = {
    "abstract", "introduction", "background", "related work", "methods",
    "methodology", "materials and methods", "experiments", "results",
    "discussion", "conclusion", "conclusions", "references",
    "acknowledgements", "acknowledgments", "appendix",
}


def _detect_headings(lines: list[str]) -> list[tuple[int, str, int]]:
    """STAIR indexing (Kumar et al., arXiv:2609.03874): the retrieval
    units are the document's OWN Table-of-Contents entries, never
    length-based chunks. Headings come from, in priority order per
    line: Markdown ATX (``#``..``######``), Setext underlines
    (``===``/``---``), numbered section titles (``2.1 Methods``), and
    known research-section titles standing alone on a line. Returns
    [(level, title, line_no)]."""
    headings: list[tuple[int, str, int]] = []
    consumed: set[int] = set()
    for i, raw in enumerate(lines):
        if i in consumed:
            continue
        line = raw.strip()
        if not line:
            continue
        m = _HEADING_RE.match(line)
        if m:
            headings.append((len(m.group(1)), m.group(2).strip(), i))
            continue
        # Setext: a text line underlined by === (H1) or --- (H2).
        if i + 1 < len(lines) and len(line) <= 100:
            under = lines[i + 1].strip()
            if re.fullmatch(r"={3,}", under) or re.fullmatch(r"-{3,}", under):
                headings.append((1 if under.startswith("=") else 2, line, i))
                consumed.add(i + 1)
                continue
        m = _NUMBERED_HEADING_RE.match(line)
        if m:
            level = m.group(1).count(".") + 1
            headings.append((level, m.group(2).strip(), i))
            continue
        if line.lower() in _KNOWN_SECTION_TITLES and len(line) <= 40:
            headings.append((1, line, i))
    return headings


def _insert_sections(store: Store, capture_id: str, doc_title: str,
                     sections: list[tuple[int, str, str]]) -> list[dict]:
    """Insert [(level, title, body)] as tree nodes. Each body is ONLY
    the text directly under its heading (up to the next heading of any
    level), so a leaf node's content is exactly its section's content
    — the STAIR leaf-addressing contract. Every node carries its full
    section title path (``Doc > Methods > Participants``)."""
    nodes: list[dict] = []
    stack: list[tuple[int, str, str]] = []  # (level, node_id, title)
    for level, title, body in sections:
        node_id = "tree_" + uuid.uuid4().hex[:16]
        while stack and stack[-1][0] >= level:
            stack.pop()
        parent_id = stack[-1][1] if stack else None
        title_path = " > ".join([t for _l, _i, t in stack] + [title])
        store.execute(
            "INSERT INTO tree_nodes(id,doc_title,leaf_title,level,parent_id,capture_id,text)"
            " VALUES(?,?,?,?,?,?,?)",
            (node_id, doc_title, title, level, parent_id, capture_id, body),
        )
        nodes.append({"id": node_id, "doc_title": doc_title, "leaf_title": title,
                      "title": title, "level": level, "parent_id": parent_id,
                      "title_path": title_path,
                      "capture_id": capture_id, "text": body})
        stack.append((level, node_id, title))
    if nodes:
        leaf_ids = {n["parent_id"] for n in nodes} - {None}
        for node in nodes:
            node["is_leaf"] = node["id"] not in leaf_ids
    return nodes


def build_tree(store: Store, capture_id: str, text: str) -> list[dict]:
    lines = text.splitlines()
    headings = _detect_headings(lines)
    if not headings:
        return []
    doc_title = headings[0][1]
    sections: list[tuple[int, str, str]] = []
    for idx, (level, title, line_no) in enumerate(headings):
        end = headings[idx + 1][2] if idx + 1 < len(headings) else len(lines)
        # Body starts after the heading line (and its Setext underline).
        start = line_no + 1
        if start < end and re.fullmatch(r"(={3,}|-{3,})", lines[start].strip()):
            start += 1
        body = "\n".join(lines[start:end]).strip()
        sections.append((level, title, body))
    return _insert_sections(store, capture_id, doc_title, sections)


def _tree_rows(store: Store) -> list[dict]:
    rows = store.query(
        "SELECT t.* FROM tree_nodes t JOIN captures c ON c.id=t.capture_id AND c.tombstoned=0 "
        "JOIN memories m ON m.capture_id=c.id AND m.tombstoned=0 ORDER BY t.rowid")
    by_id = {r["id"]: r for r in rows}
    parents = {r["parent_id"] for r in rows if r["parent_id"]}

    def title_path(row) -> str:
        parts, seen = [], set()
        cur = row
        while cur is not None and cur["id"] not in seen:
            seen.add(cur["id"])
            parts.append(cur["leaf_title"])
            cur = by_id.get(cur["parent_id"])
        return " > ".join(reversed(parts))

    return [{"id": r["id"], "doc_title": r["doc_title"], "leaf_title": r["leaf_title"],
             "title": r["leaf_title"], "level": r["level"], "parent_id": r["parent_id"],
             "title_path": title_path(r), "is_leaf": r["id"] not in parents,
             "capture_id": r["capture_id"], "text": r["text"]} for r in rows]


def tree_address(store: Store, query: str) -> dict:
    """Structure-aware lookup: resolve the query to the most specific
    LEAF section by title match and return only that section's
    content. Exact leaf-title matches beat partial token overlap;
    deeper (more specific) titles beat shallow ones on ties."""
    query = (query or "").strip()
    q_lower = query.lower()
    q_tokens = set(embeddings.tokenise(query))
    if not q_tokens:
        return {"ok": True, "abstained": True, "result": None, "node": None}
    best, best_key = None, None
    for node in _tree_rows(store):
        title = (node["leaf_title"] or "").strip()
        if not title:
            continue
        title_lower = title.lower()
        title_tokens = set(embeddings.tokenise(title))
        overlap = len(q_tokens & title_tokens)
        if title_lower == q_lower or title_lower in q_lower:
            score, exact = 1.0, 1
        elif overlap:
            score, exact = overlap / max(1, len(title_tokens)), 0
        else:
            continue
        # Rank: exact title, then leaf, then token score, then depth,
        # then longer (more specific) title.
        key = (exact, 1 if node["is_leaf"] else 0, score,
               node["level"] or 0, len(title_tokens))
        if best_key is None or key > best_key:
            best_key, best = key, node
    if best is None:
        return {"ok": True, "abstained": True, "result": None, "node": None}
    node = {**best, "score": best_key[2] if not best_key[0] else 1.0}
    return {"ok": True, "abstained": False, "result": node, "node": node,
            "capture_id": best["capture_id"], "score": node["score"],
            "leaf_title": best["leaf_title"], "title": best["title"],
            "title_path": best["title_path"], "is_leaf": best["is_leaf"],
            "doc_title": best["doc_title"], "text": best["text"],
            "level": best["level"], "parent_id": best["parent_id"]}


def get_tree_node(store: Store, node_id: str) -> dict:
    for node in _tree_rows(store):
        if node["id"] == node_id:
            return {"ok": True, "node": node, **node}
    return {"ok": False, "error": "tree_node_not_found", "node_id": node_id}


def all_tree(store: Store) -> list[dict]:
    return _tree_rows(store)


# --------------------------------------------------------------------------
# Document ingestion (markdown / text / PDF) -> capture + STAIR tree
# --------------------------------------------------------------------------

def ingest_document(store: Store, text: str, source: str = "document",
                    kind: str = "document") -> dict:
    """Ingest markdown/text into captures and chunked RAG, without a tree index."""
    text = (text or "").strip()
    if not text:
        return {"ok": False, "error": "empty_document"}
    created = create_capture(store, text, kind=kind, trust="trusted",
                             source=source)
    return {"ok": True, "capture_id": created["capture_id"],
            "memory_id": created["memory_id"], "source": source,
            "chunks_created": created["chunks_created"],
            "tree_nodes": 0, "headings": []}


def _pdf_text_stdlib(data: bytes) -> str:
    """Last-resort PDF text extraction with the stdlib only: inflate
    FlateDecode streams and pull Tj/TJ string operands. Layout and
    font sizes are lost, so heading detection on the result is
    heuristic — callers label it as such."""
    import zlib
    texts: list[str] = []
    for match in re.finditer(rb"stream\r?\n(.*?)endstream", data, re.DOTALL):
        raw = match.group(1)
        try:
            raw = zlib.decompress(raw)
        except Exception:
            pass
        for s in re.findall(rb"\((?:[^()\\]|\\.)*\)\s*Tj", raw):
            texts.append(s[1:s.rindex(b")")].decode("latin-1", errors="replace"))
        for arr in re.findall(rb"\[(.*?)\]\s*TJ", raw, re.DOTALL):
            parts = re.findall(rb"\((?:[^()\\]|\\.)*\)", arr)
            texts.append("".join(
                p[1:-1].decode("latin-1", errors="replace") for p in parts))
        texts.append("\n")
    text = "\n".join(texts)
    return (text.replace("\\(", "(").replace("\\)", ")")
            .replace("\\\\", "\\").strip())


def extract_pdf_sections(data: bytes) -> dict:
    """Extract a PDF's sections. Outline/ToC first (PyMuPDF ``fitz``
    or ``pypdf`` when installed — the document's own bookmark tree IS
    its Table of Contents); otherwise extract text and apply heading
    heuristics. Never flat chunking alone: the result is always a
    section list (possibly a single whole-document section when no
    structure can be recovered, labelled in ``method``)."""
    # 1. PyMuPDF outline.
    try:
        import fitz  # type: ignore
        doc = fitz.open(stream=data, filetype="pdf")
        toc = doc.get_toc()  # [[level, title, page], ...]
        if toc:
            sections: list[tuple[int, str, str]] = []
            for idx, (level, title, page) in enumerate(toc):
                start = max(0, page - 1)
                end = (toc[idx + 1][2] - 1) if idx + 1 < len(toc) else doc.page_count
                body = "\n".join(doc.load_page(p).get_text()
                                 for p in range(start, max(start + 1, end))).strip()
                sections.append((int(level), str(title).strip(), body))
            return {"ok": True, "method": "pymupdf_outline",
                    "doc_title": sections[0][1], "sections": sections,
                    "text": "\n\n".join(f"{t}\n{b}" for _l, t, b in sections)}
    except ImportError:
        pass
    except Exception:
        pass
    # 2. pypdf outline.
    try:
        import io
        from pypdf import PdfReader  # type: ignore
        reader = PdfReader(io.BytesIO(data))

        def _walk(outline, level, acc):
            for item in outline:
                if isinstance(item, list):
                    _walk(item, level + 1, acc)
                else:
                    try:
                        acc.append((level, str(item.title).strip(),
                                    reader.get_destination_page_number(item)))
                    except Exception:
                        continue
            return acc

        flat = _walk(reader.outline, 1, [])
        page_texts = [(p.extract_text() or "") for p in reader.pages]
        if flat:
            sections = []
            for idx, (level, title, page) in enumerate(flat):
                end = flat[idx + 1][2] if idx + 1 < len(flat) else len(page_texts)
                body = "\n".join(page_texts[page:max(page + 1, end)]).strip()
                sections.append((level, title, body))
            section_text = "\n\n".join(
                f"{title}\n{body}".strip() for _l, title, body in sections)
            return {"ok": True, "method": "pypdf_outline",
                    "doc_title": sections[0][1], "sections": sections,
                    "text": section_text.strip()
                    or "\n".join(page_texts).strip()}
        text = "\n".join(page_texts).strip()
        method = "pypdf_text+heading_heuristics"
    except ImportError:
        text = _pdf_text_stdlib(data)
        method = "stdlib_text+heading_heuristics"
    except Exception:
        text = _pdf_text_stdlib(data)
        method = "stdlib_text+heading_heuristics"
    # 3. Heading heuristics over extracted text.
    lines = text.splitlines()
    headings = _detect_headings(lines)
    if not headings:
        return {"ok": True, "method": method + ":no_headings_found",
                "doc_title": "PDF document",
                "sections": [(1, "PDF document", text)], "text": text}
    sections = []
    for idx, (level, title, line_no) in enumerate(headings):
        end = headings[idx + 1][2] if idx + 1 < len(headings) else len(lines)
        sections.append((level, title,
                         "\n".join(lines[line_no + 1:end]).strip()))
    return {"ok": True, "method": method, "doc_title": headings[0][1],
            "sections": sections, "text": text}


def ingest_pdf(store: Store, data: bytes, source: str = "pdf") -> dict:
    """Extract PDF text and add it to capture/RAG memory without a tree index."""
    if not data:
        return {"ok": False, "error": "empty_pdf"}
    extracted = extract_pdf_sections(data)
    text = extracted.get("text") or ""
    if not text:
        return {"ok": False, "error": "pdf_text_extraction_failed",
                "method": extracted.get("method")}
    created = create_capture(store, text, kind="pdf", trust="trusted",
                             source=source, make_memory=True)
    sections = extracted.get("sections") or []
    return {"ok": True, "capture_id": created["capture_id"],
            "memory_id": created["memory_id"], "source": source,
            "method": extracted.get("method"),
            "chunks_created": created["chunks_created"], "tree_nodes": 0,
            "headings": [s[1] for s in sections]}


# --------------------------------------------------------------------------
# L2 hybrid recall: BM25 (FTS5) + vector, RRF (k=60), recency/importance
# boost, abstention floor.
# --------------------------------------------------------------------------

# Function words carry no factual content. Measuring the abstention
# relevance on ALL tokens lets a question that merely shares "what / is /
# my / the …" with a stored memory clear the floor on those words alone
# (e.g. an unanswerable "What is my hedge fund's …?" scoring ~0.22 lexical
# / ~0.30 vector against "my favourite editor is Helix") and the daemon
# then answers with an unrelated memory instead of abstaining. Relevance
# for the abstention decision is therefore measured on content tokens
# only; ranking (BM25 / RRF above) still uses the full token set. When a
# query has no content tokens at all, relevance falls back to the full
# token set, exactly as before.
_STOPWORDS = frozenset("""
a an the is are was were be been being am do does did doing have has had
having what who whom whose when where why how which that this these those
there here my your his her its our their mine yours ours theirs i you he
she it we they me him us them of for to in on at by with from as and or
but if then than so such no not s t under over about into through during
before after can could should would will shall may might tell please
recall remember know
""".split())


def _content_tokens(tokens: list[str]) -> list[str]:
    return [tok for tok in tokens if tok not in _STOPWORDS]


def recall(store: Store, query: str, limit: int = 5,
           scope_id: str | None = None) -> dict:
    query = (query or "").strip()
    q_tokens = embeddings.tokenise(query)
    if not q_tokens:
        return {"ok": True, "abstained": True, "results": [], "citations": [],
                "query": query}
    # A chat may use its own task memories plus global personal/document
    # memories. A search without a scope must never reveal chat-scoped tasks.
    scope_filter = " AND (c.scope_id IS NULL OR c.scope_id=?)" if scope_id else " AND c.scope_id IS NULL"
    scope_params = (scope_id,) if scope_id else ()
    memories = store.query(
        "SELECT m.*, c.source AS cap_source, c.scope_id AS scope_id FROM memories m"
        " JOIN captures c ON c.id=m.capture_id WHERE m.tombstoned=0 AND c.tombstoned=0"
        + scope_filter, scope_params)
    if not memories:
        return {"ok": True, "abstained": True, "results": [], "citations": [],
                "query": query}
    mem_by_capture: dict[str, list] = {}
    for mem in memories:
        mem_by_capture.setdefault(mem["capture_id"], []).append(mem)

    # BM25 rank via FTS5.
    fts_query = " OR ".join(f'"{tok}"' for tok in sorted(set(q_tokens)))
    bm25_rank: dict[str, int] = {}
    try:
        rows = store.query(
            "SELECT chunks_fts.chunk_id, chunks_fts.capture_id FROM chunks_fts"
            " JOIN captures c ON c.id=chunks_fts.capture_id"
            " WHERE chunks_fts MATCH ? AND c.tombstoned=0" + scope_filter
            + " ORDER BY bm25(chunks_fts) ASC",
            (fts_query, *scope_params))
        for rank, row in enumerate(rows):
            bm25_rank.setdefault(row["capture_id"], rank)
    except Exception:
        bm25_rank = {}

    # Vector rank over chunks belonging to live memories.
    q_vec = embeddings.embed(query)
    chunk_rows = store.query(
        "SELECT * FROM chunks WHERE capture_id IN"
        " (SELECT m.capture_id FROM memories m JOIN captures c ON c.id=m.capture_id"
        " WHERE m.tombstoned=0 AND c.tombstoned=0" + scope_filter + ")",
        scope_params)
    vec_best: dict[str, float] = {}
    cap_best_chunk: dict[str, str] = {}
    for row in chunk_rows:
        text = row.get("text") or ""
        try:
            vec = json.loads(row["embedding"]) if row["embedding"] else []
        except ValueError:
            vec = []
        score = embeddings.cosine(q_vec, vec) if vec else 0.0
        cap = row["capture_id"]
        if cap not in vec_best or score > vec_best[cap]:
            vec_best[cap] = score
            if text:
                cap_best_chunk[cap] = text
    vec_rank = {cap: rank for rank, (cap, _s) in enumerate(
        sorted(vec_best.items(), key=lambda kv: kv[1], reverse=True))}

    now = _now()
    q_set = set(q_tokens)
    # Content-token view for the abstention relevance (see _STOPWORDS note
    # above). Empty when the query is all function words -> fall back to
    # the full-token relevance used previously.
    q_content = _content_tokens(q_tokens)
    q_rel_set = set(q_content) if q_content else q_set
    q_rel_vec = embeddings.embed(" ".join(q_content)) if q_content else None
    candidates: list[dict] = []
    for cap_id, mems in mem_by_capture.items():
        mem = mems[0]
        mem_all_tokens = embeddings.tokenise(mem["text"])
        if q_content:
            mem_rel_tokens = _content_tokens(mem_all_tokens) or mem_all_tokens
            mem_tokens = set(mem_rel_tokens)
            lexical = len(q_rel_set & mem_tokens) / max(1, len(q_rel_set))
            vector = max(0.0, embeddings.cosine(
                q_rel_vec, embeddings.embed(" ".join(mem_rel_tokens))))
        else:
            mem_tokens = set(mem_all_tokens)
            lexical = len(q_set & mem_tokens) / max(1, len(q_set))
            vector = max(0.0, vec_best.get(cap_id, 0.0))
        relevance = max(lexical, vector)
        rrf = 0.0
        if cap_id in bm25_rank:
            rrf += 1.0 / (60 + bm25_rank[cap_id])
        if cap_id in vec_rank:
            rrf += 1.0 / (60 + vec_rank[cap_id])
        age_days = max(0.0, (now - (mem["ts"] or now)) / 86400.0)
        recency_factor = math.exp(-age_days / 30.0)
        final = rrf * (1.0 + 0.05 * float(mem["importance"] or 0.0)
                       + 0.05 * recency_factor)
        # Return the best matching chunk snippet instead of the whole stored
        # text: RAG answers should be grounded in the relevant passage, not
        # the entire document/capture. Fall back to a capped excerpt.
        snippet = cap_best_chunk.get(cap_id)
        text = (snippet or mem["text"] or "").strip()[:1200]
        candidates.append({
            "id": mem["id"], "memory_id": mem["id"], "capture_id": cap_id,
            "text": text, "is_snippet": bool(snippet),
            "importance": mem["importance"],
            "usage_count": mem["usage_count"], "ts": mem["ts"],
            "source": mem["cap_source"], "score": final, "rrf": rrf,
            "lexical": lexical, "vector": vector, "relevance": relevance,
            "scope_id": mem["scope_id"],
        })
    candidates.sort(key=lambda c: c["score"], reverse=True)
    best_relevance = candidates[0]["relevance"] if candidates else 0.0
    if not candidates or best_relevance <= ABSTAIN_THRESHOLD:
        return {"ok": True, "abstained": True, "results": [], "citations": [],
                "query": query, "best_relevance": best_relevance}
    results = [c for c in candidates if c["relevance"] > ABSTAIN_THRESHOLD][:limit]
    for res in results:
        store.execute(
            "UPDATE memories SET usage_count=usage_count+1 WHERE id=?", (res["id"],))
        res["usage_count"] = int(res["usage_count"] or 0) + 1
    citations = list(dict.fromkeys(r["capture_id"] for r in results))
    return {"ok": True, "abstained": False, "results": results,
            "citations": citations, "query": query,
            "best_relevance": best_relevance}


def forget(store: Store, memory_id: str | None = None,
           capture_id: str | None = None) -> dict:
    target = memory_id or capture_id
    if not target:
        return {"ok": False, "error": "missing_memory_id"}
    row = store.query_one(
        "SELECT * FROM memories WHERE id=? OR capture_id=? ORDER BY tombstoned ASC",
        (target, target))
    if row is None:
        return {"ok": False, "error": "memory_not_found"}
    # Tombstone the memory only; the capture row is never deleted (L1 audit).
    store.execute("UPDATE memories SET tombstoned=1 WHERE id=?", (row["id"],))
    store.execute("UPDATE captures SET tombstoned=1 WHERE id=?", (row["capture_id"],))
    return {"ok": True, "status": "tombstoned", "tombstoned": True,
            "memory_id": row["id"], "id": row["id"],
            "capture_id": row["capture_id"]}


def _row_field(row, key: str, default=None):
    """Read a column whether the driver returned a Row or a dict."""
    try:
        value = row[key]
    except (KeyError, IndexError, TypeError):
        return default
    return default if value is None else value


def delete_tree_node(store: Store, node_id: str) -> dict:
    """Remove a STAIR tree node and its children, tombstoning its memories.

    L1 captures stay auditable (tombstoned, never physically dropped), while
    the searchable tree and memory rows stop being returned.
    """
    row = store.query_one("SELECT * FROM tree_nodes WHERE id=?", (node_id,))
    if row is None:
        return {"ok": False, "error": "tree_node_not_found"}
    capture_id = _row_field(row, "capture_id")
    store.execute("DELETE FROM tree_nodes WHERE id=? OR parent_id=?",
                  (node_id, node_id))
    if capture_id:
        store.execute("UPDATE memories SET tombstoned=1 WHERE capture_id=?",
                      (capture_id,))
        store.execute("UPDATE captures SET tombstoned=1 WHERE id=?",
                      (capture_id,))
    return {"ok": True, "deleted": node_id, "capture_id": capture_id}


def forget_capture(store: Store, capture_id: str) -> dict:
    """Owner-driven removal of a captured memory.

    Drops the capture's STAIR nodes so it stops being retrieved, and tombstones
    the capture + memory rows (the L1 row stays for audit, never returned).
    """
    if not capture_id:
        return {"ok": False, "error": "missing_capture_id"}
    store.execute("DELETE FROM tree_nodes WHERE capture_id=?", (capture_id,))
    store.execute("UPDATE memories SET tombstoned=1 WHERE capture_id=?",
                  (capture_id,))
    store.execute("UPDATE captures SET tombstoned=1 WHERE id=?",
                  (capture_id,))
    return {"ok": True, "deleted": capture_id}


def update_tree_node(store: Store, node_id: str, leaf_title: str | None = None,
                     text: str | None = None) -> dict:
    """Rewrite a tree node's title/body and keep its memory row in sync."""
    row = store.query_one("SELECT * FROM tree_nodes WHERE id=?", (node_id,))
    if row is None:
        return {"ok": False, "error": "tree_node_not_found"}
    fields: list[str] = []
    params: list = []
    if leaf_title:
        fields.append("leaf_title=?")
        params.append(leaf_title)
    if text:
        fields.append("text=?")
        params.append(text)
    if not fields:
        return {"ok": False, "error": "nothing_to_update"}
    params.append(node_id)
    capture_id = _row_field(row, "capture_id")
    store.execute(f"UPDATE tree_nodes SET {', '.join(fields)} WHERE id=?",
                  tuple(params))
    if capture_id and text:
        store.execute("UPDATE memories SET text=? WHERE capture_id=?",
                      (text, capture_id))
        store.execute("UPDATE captures SET text=? WHERE id=?",
                      (text, capture_id))
    return {"ok": True, "updated": node_id, "capture_id": capture_id}


def update_memory(store: Store, memory_id: str | None = None,
                  capture_id: str | None = None,
                  text: str | None = None) -> dict:
    """Rewrite the text of an existing memory (agent-driven correction)."""
    target = memory_id or capture_id
    if not target:
        return {"ok": False, "error": "missing_memory_id"}
    if not text or not str(text).strip():
        return {"ok": False, "error": "missing_text"}
    row = store.query_one(
        "SELECT * FROM memories WHERE id=? OR capture_id=? ORDER BY tombstoned ASC",
        (target, target))
    if row is None:
        return {"ok": False, "error": "memory_not_found"}
    clean = str(text).strip()
    memory_id_value = _row_field(row, "id")
    capture_value = _row_field(row, "capture_id")
    store.execute("UPDATE memories SET text=? WHERE id=?", (clean, memory_id_value))
    if capture_value:
        store.execute("UPDATE captures SET text=? WHERE id=?",
                      (clean, capture_value))
        # Keep search chunks, section addresses, and graph relations in sync
        # with the edited fact. Previously only the display text changed,
        # leaving stale retrieval and graph results behind.
        store.execute("DELETE FROM chunks_fts WHERE capture_id=?", (capture_value,))
        store.execute("DELETE FROM chunks WHERE capture_id=?", (capture_value,))
        for idx, chunk_text in enumerate(_chunk_text(clean)):
            chunk_id = f"{capture_value}_chunk_{idx}"
            store.execute(
                "INSERT INTO chunks(id,capture_id,text,embedding) VALUES(?,?,?,?)",
                (chunk_id, capture_value, chunk_text, json.dumps(embeddings.embed(chunk_text))),
            )
            store.execute("INSERT INTO chunks_fts(chunk_id,capture_id,text) VALUES(?,?,?)",
                          (chunk_id, capture_value, chunk_text))
        # Remove stale historical tree rows, but do not regenerate STAIR.
        store.execute("DELETE FROM tree_nodes WHERE capture_id=?", (capture_value,))
        store.execute("DELETE FROM edges WHERE capture_id=?", (capture_value,))
        extract_edges(store, capture_value, clean, _now())
    return {"ok": True, "updated": memory_id_value, "id": memory_id_value,
            "capture_id": capture_value, "text": clean}
