#!/usr/bin/env python3
"""Aegis Context Memory Indexer v2 - Only scans Aegis source files, extracts inline styles from JSX/TSX."""

import os
import re
import sqlite3
import hashlib
from pathlib import Path
from datetime import datetime

AEGIS_ROOT = Path(r"D:\Aegis 2\aegis")
DB_PATH = Path(r"D:\Aegis 2\ctxmem\context_memory.db")
SCHEMA_PATH = Path(r"D:\Aegis 2\ctxmem\schema.sql")

# Directories to skip (third-party, build artifacts, etc.)
SKIP_DIRS = {
    'node_modules', '.git', '.venv', '.venv311', 'dist', 'build', 'release',
    'vendor', 'reference-repos', '.github', '.vscode', '.aegis-data',
    '.next', '.nuxt', '.svelte-kit', 'coverage', '.cache', 'target'
}

# File extensions to index
INDEX_EXTENSIONS = {
    '.ts', '.tsx', '.js', '.mjs', '.jsx', '.py', '.html', '.css',
    '.json', '.md', '.ps1', '.bat', '.sh', '.env', '.example',
    '.gitignore', '.dockerignore', '.prettierrc', '.txt'
}

# Unwanted/old file patterns
UNWANTED_PATTERNS = [
    r'check-line\d*\.js', r'test-shortcut\.js', r'635\+1',
    r'notch\.html$', r'widgets\.html$', r'overlay\.html$',
    r'tray-pill\.html$', r'showcase\.html$', r'annotations\.html$',
    r'file-tray\.js$', r'clipboard-history\.js$',
    r'coding-processes\.ps1', r'media-session\.ps1',
]


def is_skip_dir(dirname):
    return dirname in SKIP_DIRS or dirname.startswith('.')


def is_unwanted(path):
    name = path.name
    for pat in UNWANTED_PATTERNS:
        if re.search(pat, name, re.IGNORECASE):
            return True
    return False


def get_category(path):
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
    if 'scripts' in parts:
        return 'scripts'
    if 'services' in parts:
        return 'services'
    if 'tests' in parts:
        return 'tests'
    if 'tools-bin' in parts:
        return 'tools'
    return 'root'


def count_lines(path):
    try:
        with open(path, 'r', encoding='utf-8', errors='ignore') as f:
            return sum(1 for _ in f)
    except Exception:
        return 0


def extract_functions(content, ext):
    functions = []
    if ext in ('.ts', '.tsx', '.js', '.jsx', '.mjs'):
        for m in re.finditer(r'(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(', content):
            functions.append({'name': m.group(1), 'type': 'function', 'signature': m.group(0)[:200], 'start_line': content[:m.start()].count('\n') + 1})
        for m in re.finditer(r'(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?\(', content):
            functions.append({'name': m.group(1), 'type': 'function', 'signature': m.group(0)[:200], 'start_line': content[:m.start()].count('\n') + 1})
        for m in re.finditer(r'(?:export\s+)?class\s+(\w+)', content):
            functions.append({'name': m.group(1), 'type': 'class', 'signature': m.group(0)[:200], 'start_line': content[:m.start()].count('\n') + 1})
    elif ext == '.py':
        for m in re.finditer(r'(?:async\s+)?def\s+(\w+)\s*\(', content):
            functions.append({'name': m.group(1), 'type': 'function', 'signature': m.group(0)[:200], 'start_line': content[:m.start()].count('\n') + 1})
        for m in re.finditer(r'class\s+(\w+)', content):
            functions.append({'name': m.group(1), 'type': 'class', 'signature': m.group(0)[:200], 'start_line': content[:m.start()].count('\n') + 1})
    return functions


def extract_inline_styles(content, ext):
    """Extract inline styles from JSX/TSX style attributes."""
    styles = []
    if ext in ('.tsx', '.ts', '.jsx', '.js'):
        # Match style={{...}} or style={...}
        for m in re.finditer(r'style\s*=\s*\{([^}]+)\}', content):
            style_str = m.group(1)
            # Extract CSS properties from style object
            for prop_match in re.finditer(r'([\w-]+)\s*:\s*([^,}]+)', style_str):
                styles.append({
                    'property': prop_match.group(1).strip(),
                    'value': prop_match.group(2).strip().strip('"\'')
                })
    return styles


def extract_keywords(content):
    text = re.sub(r'//.*', ' ', content)
    text = re.sub(r'/\*.*?\*/', ' ', text, flags=re.DOTALL)
    text = re.sub(r'["\'].*?["\']', ' ', text)
    words = re.findall(r'\b[a-zA-Z][a-zA-Z0-9_]{2,}\b', text)
    stopwords = {'the','and','for','with','this','that','from','have','has','had','was','were','been','being','not','but','are','can','could','would','should','may','might','must','shall','will','just','also','into','than','then','when','where','while','after','before','during','through','over','under','again','further','once','here','there','each','few','more','most','other','some','such','only','own','same','so','too','very','now','get','set','let','var','const','function','return','if','else','for','while','do','switch','case','break','continue','try','catch','throw','new','class','extends','import','export','default','async','await','typeof','instanceof','in','of','null','undefined','true','false','super','this','arguments','React','react','Component','useState','useEffect','useRef','useCallback','useMemo','useContext','Props','State','HTML','CSS','JSX','Node','npm','API','JSON','UI','UX','DOM','HTTP','GET','POST','PUT','DELETE','PATCH','HEAD','OPTIONS','200','201','400','401','403','404','500','OK','Error','True','False','None','Self','Cls','Init','Super','Print','Len','Str','Int','Float','Bool','List','Dict','Tuple','Set','File','Open','Read','Write','Close','Seek','Tell','Flush','Is','And','Or','Not','In','Is','Lambda','Yield','Global','Nonlocal','Assert','Del','Pass','Raise','Return','Break','Continue','Class','Def','Elif','Else','Except','Finally','From','Import','While','With','Async','Await','Match','Case'}
    return [w for w in words if w.lower() not in stopwords and len(w) >= 3]


def init_db(conn):
    with open(SCHEMA_PATH, 'r') as f:
        conn.executescript(f.read())


def index_files(conn):
    cur = conn.cursor()
    file_count = 0

    for root, dirs, files in os.walk(AEGIS_ROOT):
        dirs[:] = [d for d in dirs if not is_skip_dir(d)]

        for fname in files:
            fpath = Path(root) / fname
            ext = fpath.suffix.lower()

            if ext not in INDEX_EXTENSIONS:
                continue

            rel_path = fpath.relative_to(AEGIS_ROOT.parent)
            abs_path = str(fpath.resolve())
            size = fpath.stat().st_size
            lines = count_lines(fpath)
            unwanted = 1 if is_unwanted(fpath) else 0
            category = get_category(fpath)

            try:
                content = fpath.read_text(encoding='utf-8', errors='ignore')
            except Exception:
                content = ''

            description = fpath.stem.replace('_', ' ').replace('-', ' ')
            purpose = ''
            logic_summary = ''
            debug_flow = ''

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

            for fn in extract_functions(content, ext):
                cur.execute(
                    """INSERT OR IGNORE INTO functions
                       (file_id, name, type, signature, start_line, description)
                       VALUES (?, ?, ?, ?, ?, ?)""",
                    (file_id, fn['name'], fn['type'], fn['signature'],
                     fn['start_line'], '')
                )

            keywords = extract_keywords(content)
            for kw in set(keywords):
                cur.execute("""INSERT OR IGNORE INTO keywords (keyword, frequency) VALUES (?, 1)""", (kw,))
                cur.execute("""UPDATE keywords SET frequency = frequency + 1 WHERE keyword = ?""", (kw,))
                cur.execute("SELECT id FROM keywords WHERE keyword = ?", (kw,))
                row = cur.fetchone()
                if row:
                    cur.execute("""INSERT OR IGNORE INTO file_keywords (file_id, keyword_id) VALUES (?, ?)""", (file_id, row[0]))

            # Extract inline styles for JSX/TSX files
            if ext in ('.tsx', '.ts', '.jsx', '.js'):
                inline_styles = extract_inline_styles(content, ext)
                for idx, style in enumerate(inline_styles):
                    cur.execute(
                        """INSERT OR IGNORE INTO ui_classes (selector, file_source, line_number, is_component, is_pseudo, description)
                           VALUES (?, ?, ?, ?, ?, ?)""",
                        (f'inline-style-{file_id}-{idx}', str(fpath), 0, 0, 0, 'Inline style')
                    )
                    cur.execute("SELECT id FROM ui_classes WHERE selector = ? AND file_source = ?", (f'inline-style-{file_id}-{idx}', str(fpath)))
                    row = cur.fetchone()
                    if row:
                        cur.execute(
                            """INSERT OR IGNORE INTO css_properties (class_id, property, value, is_variable)
                               VALUES (?, ?, ?, ?)""",
                            (row[0], style['property'], style['value'], 0)
                        )

            file_count += 1
            if file_count % 50 == 0:
                conn.commit()
                print(f"  Indexed {file_count} files...")

    conn.commit()
    print(f"Indexed {file_count} files total.")
    return file_count


def index_relationships(conn):
    cur = conn.cursor()
    cur.execute("SELECT id, path, extension FROM files")
    all_files = cur.fetchall()

    module_to_file = {}
    for fid, fpath, ext in all_files:
        mod = fpath.replace('/', '.').replace('\\', '.')
        if mod.endswith(('.ts', '.tsx', '.js', '.jsx', '.mjs', '.py')):
            mod = mod.rsplit('.', 1)[0]
        module_to_file[mod] = fid
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
            if imp.startswith('.') or imp.startswith('/'):
                resolved = None
                for prefix in ['.', '..']:
                    if imp.startswith(prefix):
                        candidate = imp
                        for ext_try in ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.py']:
                            cand_path = Path(fpath).parent / (candidate + ext_try)
                            if str(cand_path) in module_to_file.values():
                                resolved = cand_path
                                break
                        break
                if resolved:
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


def extract_imports(content, ext):
    imports = []
    if ext in ('.ts', '.tsx', '.js', '.jsx', '.mjs'):
        for m in re.finditer(r'import\s+(?:{[^}]*}|[\w*]+|[\w\s,*{}]+)\s+from\s+[\'\"]([^\'\"]+)[\'\"]', content):
            imports.append(m.group(1))
        for m in re.finditer(r'import\([\'\"]([^\'\"]+)[\'\"]\)', content):
            imports.append(m.group(1))
        for m in re.finditer(r'require\([\'\"]([^\'\"]+)[\'\"]\)', content):
            imports.append(m.group(1))
    elif ext == '.py':
        for m in re.finditer(r'(?:from\s+(\w+(?:\.\w+)*)\s+import|import\s+(\w+(?:\.\w+)*))', content):
            mod = m.group(1) or m.group(2)
            imports.append(mod)
    return imports


def main():
    print("=== Aegis Context Memory Indexer v2 ===")
    print(f"Root: {AEGIS_ROOT}")
    print(f"DB: {DB_PATH}")

    DB_PATH.parent.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(str(DB_PATH))
    with open(SCHEMA_PATH, 'r') as f:
        conn.executescript(f.read())

    print("\nIndexing files...")
    file_count = index_files(conn)

    print("\nIndexing relationships...")
    rel_count = index_relationships(conn)

    print(f"\n=== Indexing Complete ===")
    print(f"Files: {file_count}")
    print(f"Relationships: {rel_count}")
    print(f"Database: {DB_PATH}")

    conn.close()


if __name__ == '__main__':
    main()
