"""SQLite (WAL) storage: schema creation and connection management."""
from __future__ import annotations

import os
import sqlite3
import threading
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS captures(
    id TEXT PRIMARY KEY, text TEXT NOT NULL, kind TEXT, trust TEXT,
    source TEXT, ts REAL, tombstoned INTEGER NOT NULL DEFAULT 0,
    scope_id TEXT
);
CREATE TABLE IF NOT EXISTS chunks(
    id TEXT PRIMARY KEY, capture_id TEXT NOT NULL, text TEXT NOT NULL,
    embedding TEXT
);
CREATE TABLE IF NOT EXISTS memories(
    id TEXT PRIMARY KEY, capture_id TEXT NOT NULL, text TEXT NOT NULL,
    importance REAL NOT NULL DEFAULT 1.0, usage_count INTEGER NOT NULL DEFAULT 0,
    ts REAL, tombstoned INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS tree_nodes(
    id TEXT PRIMARY KEY, doc_title TEXT, leaf_title TEXT, level INTEGER,
    parent_id TEXT, capture_id TEXT, text TEXT
);
CREATE TABLE IF NOT EXISTS entities(
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL
);
CREATE TABLE IF NOT EXISTS edges(
    id INTEGER PRIMARY KEY AUTOINCREMENT, subj TEXT, relation TEXT, obj TEXT,
    valid_from REAL, valid_to REAL, rule TEXT, capture_id TEXT
);
CREATE TABLE IF NOT EXISTS tool_calls(
    id INTEGER PRIMARY KEY AUTOINCREMENT, ts REAL, tool TEXT, args_json TEXT,
    risk TEXT, scopes TEXT, mode TEXT, status TEXT, error TEXT,
    duration_ms REAL, forged_from TEXT
);
CREATE TABLE IF NOT EXISTS learned_tools(
    id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE NOT NULL,
    name TEXT, source_tool TEXT, args_json TEXT, keywords TEXT,
    count_observations INTEGER NOT NULL DEFAULT 0,
    use_count INTEGER NOT NULL DEFAULT 0,
    risk TEXT, scopes TEXT, confirmation TEXT
);
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
    chunk_id UNINDEXED, capture_id UNINDEXED, text
);
"""


def aegis_home() -> Path:
    env = os.environ.get("AEGIS_HOME")
    if env:
        return Path(env).expanduser()
    return Path(__file__).resolve().parent.parent / "data"


class Store:
    def __init__(self, home: Path | None = None) -> None:
        self.home = Path(home) if home else aegis_home()
        self.workspace = self.home / "workspace"
        self.workspace.mkdir(parents=True, exist_ok=True)
        self.db_path = self.home / "aegis.db"
        self.lock = threading.Lock()
        self.conn = sqlite3.connect(str(self.db_path), check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        with self.lock:
            self.conn.execute("PRAGMA journal_mode=WAL")
            self.conn.executescript(SCHEMA)
            # Additive migration for databases created before scoped memory.
            capture_columns = {row[1] for row in self.conn.execute("PRAGMA table_info(captures)")}
            if "scope_id" not in capture_columns:
                self.conn.execute("ALTER TABLE captures ADD COLUMN scope_id TEXT")
            self.conn.commit()

    def execute(self, sql: str, params: tuple = ()) -> sqlite3.Cursor:
        with self.lock:
            cur = self.conn.execute(sql, params)
            self.conn.commit()
            return cur

    def query(self, sql: str, params: tuple = ()) -> list[sqlite3.Row]:
        with self.lock:
            return self.conn.execute(sql, params).fetchall()

    def query_one(self, sql: str, params: tuple = ()):
        rows = self.query(sql, params)
        return rows[0] if rows else None

    def counts(self) -> dict[str, int]:
        def count(sql: str) -> int:
            row = self.query_one(sql)
            return int(row[0]) if row else 0

        return {
            "captures": count("SELECT COUNT(*) FROM captures"),
            "memories": count("SELECT COUNT(*) FROM memories WHERE tombstoned=0"),
            "chunks": count("SELECT COUNT(*) FROM chunks"),
            "tree_nodes": count("SELECT COUNT(*) FROM tree_nodes"),
            "entities": count("SELECT COUNT(*) FROM entities"),
            "edges": count("SELECT COUNT(*) FROM edges"),
            "learned_tools": count("SELECT COUNT(*) FROM learned_tools"),
            "tool_calls": count("SELECT COUNT(*) FROM tool_calls"),
        }
