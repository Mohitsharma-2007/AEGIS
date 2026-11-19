#!/usr/bin/env python3
"""
Aegis Context Memory Indexer
Scans the Aegis codebase, extracts files, functions, relationships, and keywords,
and populates the SQLite knowledge graph database.
"""

import os
import re
import sqlite3
import hashlib
from pathlib import Path
from datetime import datetime

# --- Configuration ---
AEGIS_ROOT = Path(r"D:\Aegis 2\aegis")
DB_PATH = Path(r"D:\Aegis 2\ctxmem\context_memory.db")
SCHEMA_PATH = Path(r"D:\Aegis 2\ctxmem\schema.sql")

# Directories to skip
SKIP_DIRS = {
    'node_modules', '.git', '.venv311', '.aegis-data',
    'dist', 'build', 'release', 'vendor', 'reference-repos',
    '.github', '.vscode'
}

# File extensions to index
INDEX_EXTENSIONS = {
    '.ts', '.tsx', '.js', '.mjs', '.jsx', '.py', '.html', '.css',
    '.json', '.md', '.ps1', '.bat', '.sh', '.env', '.example',
    '.gitignore', '.dockerignore', '.prettierrc', '.txt'
}

# Unwanted/old file patterns
UNWANTED_PATTERNS = [
    r'check-line\d*\.js',
    r'test-shortcut\.js',
    r'635\+1',
    r'notch\.html$',           # replaced by NotchApp.tsx
    r'widgets\.html$',
    r'overlay\.html$',
    r'tray-pill\.html$',
    r'showcase\.html$',
    r'annotations\.html$',     # integrated into penboard
    r'file-tray\.js$',
    r'clipboard-history\.js$',
    r'coding-processes\.ps1',
    r'media-session\.ps1',
]


def is_unwanted(path: Path) -> bool:
    name = path.name
    for pat in UNWANTED_PATTERNS:
        if re.search(pat, name, re.IGNORECASE):
            return True
    return False


def get_category(path: Path) -> str:
    parts = path.parts
    if 'apps/host/src/server' in str(path) or '\\apps\\host\\src\\server' in str(path):
        return 'server'
    if 'apps/host/src/client' in str(path) or '\\apps\\host\\src\\client' in str(path):
        return 'client'
    if 'apps/host/src/shared' in str(path) or '\\apps\\host\\src\\shared' in str(path):
        return 'shared'
    if 'apps/desktop' in str(path) or '\\apps\\desktop' in str(path):
        return 'desktop'
    if 'docs' in parts:
        return 'docs'
    return 'root'


def count_lines(path: Path) -> int:
    try:
        with open(path, 'r', encoding='utf-8', errors='ignore') as f:
            return sum(1 for _ in f)
    except Exception:
        return 0


def extract_functions(content: str, ext: str) -> list:
    """Extract function/class/component definitions from source code."""
    functions = []
    if ext in ('.ts', '.tsx', '.js', '.jsx', '.mjs'):
        # Export function declarations
        for m in re.finditer(
            r'(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(',
            content
        ):
            functions.append({
                'name': m.group(1),
                'type': 'function',
                'signature': m.group(0)[:200],
                'start_line': content[:m.start()].count('\n') + 1,
            })
        # const arrow functions
        for m in re.finditer(
            r'(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?\(',
            content
        ):
            functions.append({
                'name': m.group(1),
                'type': 'function',
                'signature': m.group(0)[:200],
                'start_line': content[:m.start()].count('\n') + 1,
            })
        # Class declarations
        for m in re.finditer(
            r'(?:export\s+)?class\s+(\w+)',
            content
        ):
            functions.append({
                'name': m.group(1),
                'type': 'class',
                'signature': m.group(0)[:200],
                'start_line': content[:m.start()].count('\n') + 1,
            })
        # React components (function returning JSX)
        for m in re.finditer(
            r'(?:export\s+)?(?:default\s+)?function\s+(\w+)\s*\([^)]*\)\s*\{',
            content
        ):
            if 'return' in content[m.start():m.start()+500]:
                functions.append({
                    'name': m.group(1),
                    'type': 'component',
                    'signature': m.group(0)[:200],
                    'start_line': content[:m.start()].count('\n') + 1,
                })
    elif ext == '.py':
        for m in re.finditer(
            r'(?:async\s+)?def\s+(\w+)\s*\(',
            content
        ):
            functions.append({
                'name': m.group(1),
                'type': 'function',
                'signature': m.group(0)[:200],
                'start_line': content[:m.start()].count('\n') + 1,
            })
        for m in re.finditer(
            r'class\s+(\w+)',
            content
        ):
            functions.append({
                'name': m.group(1),
                'type': 'class',
                'signature': m.group(0)[:200],
                'start_line': content[:m.start()].count('\n') + 1,
            })
    return functions


def extract_imports(content: str, ext: str) -> list:
    """Extract import statements to find file relationships."""
    imports = []
    if ext in ('.ts', '.tsx', '.js', '.jsx', '.mjs'):
        # ESM imports
        for m in re.finditer(
            r'import\s+(?:{[^}]*}|[\w*]+|[\w\s,*{}]+)\s+from\s+[\'\"]([^\'\"]+)[\'\"]',
            content
        ):
            imports.append(m.group(1))
        # Dynamic imports
        for m in re.finditer(
            r'import\([\'\"]([^\'\"]+)[\'\"]\)',
            content
        ):
            imports.append(m.group(1))
        # Require
        for m in re.finditer(
            r'require\([\'\"]([^\'\"]+)[\'\"]\)',
            content
        ):
            imports.append(m.group(1))
    elif ext == '.py':
        for m in re.finditer(
            r'(?:from\s+(\w+(?:\.\w+)*)\s+import|import\s+(\w+(?:\.\w+)*))',
            content
        ):
            mod = m.group(1) or m.group(2)
            imports.append(mod)
    return imports


def extract_keywords(content: str) -> list:
    """Extract meaningful keywords from file content."""
    # Remove code comments and strings roughly
    text = re.sub(r'//.*', ' ', content)
    text = re.sub(r'/\*.*?\*/', ' ', text, flags=re.DOTALL)
    text = re.sub(r'["\'].*?["\']', ' ', text)
    # Split on non-alphanumeric
    words = re.findall(r'\b[a-zA-Z][a-zA-Z0-9_]{2,}\b', text)
    # Filter common words
    stopwords = {
        'the', 'and', 'for', 'with', 'this', 'that', 'from', 'have',
        'has', 'had', 'was', 'were', 'been', 'being', 'not', 'but',
        'are', 'can', 'could', 'would', 'should', 'may', 'might',
        'must', 'shall', 'will', 'just', 'also', 'into', 'than',
        'then', 'when', 'where', 'while', 'after', 'before', 'during',
        'through', 'over', 'under', 'again', 'further', 'once', 'here',
        'there', 'each', 'few', 'more', 'most', 'other', 'some', 'such',
        'only', 'own', 'same', 'so', 'too', 'very', 'now', 'get', 'set',
        'let', 'var', 'const', 'function', 'return', 'if', 'else', 'for',
        'while', 'do', 'switch', 'case', 'break', 'continue', 'try',
        'catch', 'throw', 'new', 'class', 'extends', 'import', 'export',
        'default', 'async', 'await', 'typeof', 'instanceof', 'in', 'of',
        'null', 'undefined', 'true', 'false', 'super', 'this', 'arguments'
    }
    keywords = []
    for w in words:
        wl = w.lower()
        if wl not in stopwords and len(wl) >= 3:
            keywords.append(wl)
    return keywords


def init_db(conn: sqlite3.Connection):
    with open(SCHEMA_PATH, 'r') as f:
        conn.executescript(f.read())


def index_files(conn: sqlite3.Connection):
    """Walk the Aegis source tree and index all files."""
    cur = conn.cursor()
    file_count = 0
    seen = set()

    for root, dirs, files in os.walk(AEGIS_ROOT):
        # Skip unwanted directories
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not d.startswith('.')]

        for fname in files:
            fpath = Path(root) / fname
            ext = fpath.suffix.lower()

            if ext not in INDEX_EXTENSIONS:
                continue

            rel_path = fpath.relative_to(AEGIS_ROOT.parent)  # D:\Aegis 2\aegis\...
            abs_path = str(fpath.resolve())
            seen.add(str(fpath))
            size = fpath.stat().st_size
            lines = count_lines(fpath)
            unwanted = 1 if is_unwanted(fpath) else 0
            category = get_category(fpath)

            try:
                content = fpath.read_text(encoding='utf-8', errors='ignore')
            except Exception:
                content = ''

            # Description based on path and content
            description = fpath.stem.replace('_', ' ').replace('-', ' ')
            purpose = ''
            logic_summary = ''
            debug_flow = ''

            # Insert file
            cur.execute(
                """INSERT OR REPLACE INTO files
                   (path, abs_path, relative_path, extension, size_bytes,
                    line_count, is_source, is_unwanted, category,
                    description, purpose, logic_summary, debug_flow)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (str(fpath), abs_path, str(rel_path), ext, size,
                 lines, 1, unwanted, category, description, purpose,
                 logic_summary, debug_flow)
            )
            file_id = cur.lastrowid

            # Extract and insert functions
            for fn in extract_functions(content, ext):
                cur.execute(
                    """INSERT OR IGNORE INTO functions
                       (file_id, name, type, signature, start_line, description)
                       VALUES (?, ?, ?, ?, ?, ?)""",
                    (file_id, fn['name'], fn['type'], fn['signature'],
                     fn['start_line'], '')
                )

            # Extract and insert keywords
            keywords = extract_keywords(content)
            for kw in set(keywords):  # dedupe within file
                cur.execute(
                    """INSERT OR IGNORE INTO keywords (keyword, frequency)
                       VALUES (?, 1)""",
                    (kw,)
                )
                cur.execute(
                    """UPDATE keywords SET frequency = frequency + 1
                       WHERE keyword = ?""",
                    (kw,)
                )
                # Get keyword id
                cur.execute("SELECT id FROM keywords WHERE keyword = ?", (kw,))
                row = cur.fetchone()
                if row:
                    cur.execute(
                        """INSERT OR IGNORE INTO file_keywords (file_id, keyword_id)
                           VALUES (?, ?)""",
                        (file_id, row[0])
                    )

            file_count += 1
            if file_count % 50 == 0:
                conn.commit()
                print(f"  Indexed {file_count} files...")

    conn.commit()
    print(f"Indexed {file_count} files total.")
    return file_count, seen


def index_relationships(conn: sqlite3.Connection):
    """Build relationship edges based on imports between indexed files."""
    cur = conn.cursor()

    # Build a map of import path -> file_id
    # We need to resolve relative imports to absolute file paths
    cur.execute("SELECT id, path, extension FROM files")
    all_files = cur.fetchall()

    # Create a lookup: module name -> file_id
    module_to_file = {}
    for fid, fpath, ext in all_files:
        # Strip extension for module matching
        mod = fpath.replace('/', '.').replace('\\', '.')
        if mod.endswith(('.ts', '.tsx', '.js', '.jsx', '.mjs', '.py')):
            mod = mod.rsplit('.', 1)[0]
        module_to_file[mod] = fid
        # Also index by basename
        basename = Path(fpath).stem
        module_to_file[basename] = fid

    rel_count = 0
    for fid, fpath, ext in all_files:
        try:
            content = Path(fpath).read_text(encoding='utf-8', errors='ignore')
        except Exception:
            continue

        imports = extract_imports(content, ext)
        for imp in imports:
            # Skip external packages
            if imp.startswith('.') or imp.startswith('/'):
                # Relative import - try to resolve
                resolved = None
                for prefix in ['.', '..']:
                    if imp.startswith(prefix):
                        candidate = imp
                        # Try common extensions
                        for ext_try in ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.py']:
                            cand_path = Path(fpath).parent / (candidate + ext_try)
                            if str(cand_path) in module_to_file.values():
                                resolved = cand_path
                                break
                        break
                if resolved:
                    # Find file_id for resolved path
                    cur.execute("SELECT id FROM files WHERE abs_path = ?", (str(resolved),))
                    row = cur.fetchone()
                    if row and row[0] != fid:
                        cur.execute(
                            """INSERT OR IGNORE INTO relationships
                               (from_file_id, to_file_id, rel_type, description)
                               VALUES (?, ?, 'imports', ?)""",
                            (fid, row[0], f'{fpath} imports {resolved}')
                        )
                        rel_count += 1
            elif imp in module_to_file:
                target_id = module_to_file[imp]
                if target_id != fid:
                    cur.execute(
                        """INSERT OR IGNORE INTO relationships
                           (from_file_id, to_file_id, rel_type, description)
                           VALUES (?, ?, 'imports', ?)""",
                        (fid, target_id, f'{fpath} imports {imp}')
                    )
                    rel_count += 1

    conn.commit()
    print(f"Indexed {rel_count} relationships.")
    return rel_count


def main():
    print("=== Aegis Context Memory Indexer ===")
    print(f"Root: {AEGIS_ROOT}")
    print(f"DB: {DB_PATH}")

    DB_PATH.parent.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(str(DB_PATH))
    init_db(conn)

    print("\nIndexing files...")
    file_count, seen = index_files(conn)

    print("\nIndexing relationships...")
    rel_count = index_relationships(conn)

    # Drop rows for files that no longer exist. Without this, a deleted file stays
    # in the graph and cli.py keeps answering for it, which is worse than a miss:
    # it makes removed code look live.
    cur = conn.cursor()
    cur.execute("SELECT path FROM files")
    stale = [row[0] for row in cur.fetchall() if row[0] not in seen]
    for path in stale:
        cur.execute("DELETE FROM files WHERE path = ?", (path,))
    if stale:
        print(f"\nPruned {len(stale)} deleted files")
    conn.commit()

    print(f"\n=== Indexing Complete ===")
    print(f"Files: {file_count}")
    print(f"Relationships: {rel_count}")
    print(f"Database: {DB_PATH}")

    conn.close()


if __name__ == '__main__':
    main()
