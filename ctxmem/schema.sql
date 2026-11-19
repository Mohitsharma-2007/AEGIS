-- Aegis Context Memory - SQL Knowledge Graph Schema
-- SQLite database for file relationships, issues, and fixes

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ============================================================
-- TABLE: files
-- Every source file in the Aegis project
-- ============================================================
CREATE TABLE IF NOT EXISTS files (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    path            TEXT NOT NULL UNIQUE,
    abs_path        TEXT NOT NULL,
    relative_path   TEXT NOT NULL,
    extension       TEXT NOT NULL,
    size_bytes      INTEGER DEFAULT 0,
    line_count      INTEGER DEFAULT 0,
    last_indexed    TEXT DEFAULT (datetime('now')),
    is_source       INTEGER DEFAULT 1,      -- 1 = source code, 0 = asset/vendor
    is_unwanted     INTEGER DEFAULT 0,      -- 1 = old/unwanted file
    category        TEXT,                   -- server, client, shared, desktop, docs, root
    description     TEXT,
    purpose         TEXT,
    logic_summary   TEXT,
    debug_flow      TEXT,
    status          TEXT DEFAULT 'active'   -- active, deprecated, removed
);

CREATE INDEX IF NOT EXISTS idx_files_path ON files(path);
CREATE INDEX IF NOT EXISTS idx_files_category ON files(category);
CREATE INDEX IF NOT EXISTS idx_files_extension ON files(extension);

-- ============================================================
-- TABLE: functions
-- Functions, classes, components defined in files
-- ============================================================
CREATE TABLE IF NOT EXISTS functions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id         INTEGER NOT NULL,
    name            TEXT NOT NULL,
    type            TEXT NOT NULL,          -- function, class, component, hook, constant, route
    signature       TEXT,
    start_line      INTEGER,
    end_line        INTEGER,
    description     TEXT,
    is_exported     INTEGER DEFAULT 0,
    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_functions_file ON functions(file_id);
CREATE INDEX IF NOT EXISTS idx_functions_name ON functions(name);
CREATE INDEX IF NOT EXISTS idx_functions_type ON functions(type);

-- ============================================================
-- TABLE: relationships
-- Edges between files (imports, calls, data flow, UI flow)
-- ============================================================
CREATE TABLE IF NOT EXISTS relationships (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    from_file_id    INTEGER NOT NULL,
    to_file_id      INTEGER NOT NULL,
    rel_type        TEXT NOT NULL,          -- imports, calls, renders, configures, debug_flow, data_flow, ui_flow
    description     TEXT,
    strength        INTEGER DEFAULT 1,      -- 1=weak, 5=strong
    FOREIGN KEY (from_file_id) REFERENCES files(id) ON DELETE CASCADE,
    FOREIGN KEY (to_file_id) REFERENCES files(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_relationships_from ON relationships(from_file_id);
CREATE INDEX IF NOT EXISTS idx_relationships_to ON relationships(to_file_id);
CREATE INDEX IF NOT EXISTS idx_relationships_type ON relationships(rel_type);

-- ============================================================
-- TABLE: keywords
-- Searchable keywords extracted from file content
-- ============================================================
CREATE TABLE IF NOT EXISTS keywords (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    keyword         TEXT NOT NULL UNIQUE,
    frequency       INTEGER DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_keywords_keyword ON keywords(keyword);

-- ============================================================
-- TABLE: file_keywords
-- Many-to-many: files <-> keywords
-- ============================================================
CREATE TABLE IF NOT EXISTS file_keywords (
    file_id         INTEGER NOT NULL,
    keyword_id      INTEGER NOT NULL,
    PRIMARY KEY (file_id, keyword_id),
    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE,
    FOREIGN KEY (keyword_id) REFERENCES keywords(id) ON DELETE CASCADE
);

-- ============================================================
-- TABLE: issues
-- Issues found during deep audit
-- ============================================================
CREATE TABLE IF NOT EXISTS issues (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    issue_id        TEXT NOT NULL UNIQUE,   -- e.g. F1, U1, C1, C2
    category        TEXT NOT NULL,          -- functionality, ui, security, memory, core
    severity        TEXT NOT NULL,          -- critical, high, medium, low
    title           TEXT NOT NULL,
    description     TEXT,
    root_cause      TEXT,
    fix             TEXT,
    status          TEXT DEFAULT 'open',    -- open, in_progress, fixed, verified, wontfix
    priority        INTEGER DEFAULT 5,      -- 1=highest, 10=lowest
    effort          TEXT,                   -- low, medium, high
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now')),
    fixed_at        TEXT,
    fixed_by        TEXT
);

CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status);
CREATE INDEX IF NOT EXISTS idx_issues_category ON issues(category);
CREATE INDEX IF NOT EXISTS idx_issues_severity ON issues(severity);

-- ============================================================
-- TABLE: issue_files
-- Many-to-many: issues <-> files (primary, secondary, fix)
-- ============================================================
CREATE TABLE IF NOT EXISTS issue_files (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    issue_id        INTEGER NOT NULL,
    file_id         INTEGER NOT NULL,
    role            TEXT NOT NULL,          -- primary, secondary, fix_file, related
    FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE,
    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_issue_files_issue ON issue_files(issue_id);
CREATE INDEX IF NOT EXISTS idx_issue_files_file ON issue_files(file_id);

-- ============================================================
-- TABLE: fix_history
-- Log of when issues were fixed and what changed
-- ============================================================
CREATE TABLE IF NOT EXISTS fix_history (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    issue_id        INTEGER NOT NULL,
    file_id         INTEGER NOT NULL,
    change_type     TEXT NOT NULL,          -- edited, created, deleted, refactored
    change_summary  TEXT,
    fixed_at        TEXT DEFAULT (datetime('now')),
    fixed_by        TEXT,
    notes           TEXT,
    FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE,
    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_fix_history_issue ON fix_history(issue_id);

-- ============================================================
-- TABLE: query_log
-- CLI query history for analytics
-- ============================================================
CREATE TABLE IF NOT EXISTS query_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    query           TEXT NOT NULL,
    query_type      TEXT NOT NULL,          -- keyword, file, issue, relationship, fix
    results_count   INTEGER DEFAULT 0,
    executed_at     TEXT DEFAULT (datetime('now'))
);
