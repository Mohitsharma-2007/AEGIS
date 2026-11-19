#!/usr/bin/env python3
"""
Aegis Context Memory CLI
Query the knowledge graph to find files, functions, relationships, and issues.
Supports keyword search, file lookup, issue tracking, and fix updates.
"""

import sqlite3
import sys
import argparse
from pathlib import Path
from datetime import datetime

DB_PATH = Path(r"D:\Aegis 2\ctxmem\context_memory.db")


def get_conn():
    return sqlite3.connect(str(DB_PATH))


def cmd_keyword(args):
    """Search files by keyword."""
    conn = get_conn()
    cur = conn.cursor()
    kw = args.keyword.lower()

    cur.execute(
        """SELECT f.path, f.category, f.extension, f.description, k.frequency
           FROM files f
           JOIN file_keywords fk ON f.id = fk.file_id
           JOIN keywords k ON fk.keyword_id = k.id
           WHERE k.keyword = ?
           ORDER BY k.frequency DESC, f.path""",
        (kw,)
    )
    rows = cur.fetchall()

    if not rows:
        print(f"No files found for keyword: '{kw}'")
    else:
        print(f"\nFiles containing keyword '{kw}' ({len(rows)}):")
        print("-" * 100)
        for path, category, ext, desc, freq in rows:
            print(f"  [{category:8s}] {path:70s} ({ext}) freq={freq}")

    # Log query
    cur.execute(
        "INSERT INTO query_log (query, query_type, results_count) VALUES (?, ?, ?)",
        (kw, 'keyword', len(rows))
    )
    conn.commit()
    conn.close()


def cmd_file(args):
    """Show details about a specific file and its relationships."""
    conn = get_conn()
    cur = conn.cursor()

    # Search by path (partial match) - try both forward and backslash separators
    search_term = args.file.replace('/', '\\')
    cur.execute(
        "SELECT id, path, category, extension, line_count, description, purpose, logic_summary, debug_flow, status FROM files WHERE path LIKE ? OR relative_path LIKE ? OR abs_path LIKE ?",
        (f'%{search_term}%', f'%{search_term}%', f'%{search_term}%')
    )
    rows = cur.fetchall()

    if not rows:
        print(f"No file found matching: '{args.file}'")
        conn.close()
        return

    if len(rows) > 1 and not args.all:
        print(f"Multiple files found ({len(rows)}). Use --all to see all, or be more specific:")
        for fid, path, cat, ext, lines, desc, *_ in rows:
            print(f"  {path:70s} ({cat})")
        conn.close()
        return

    for fid, path, cat, ext, lines, desc, purpose, logic, debug, status in rows:
        print(f"\n{'='*100}")
        print(f"FILE: {path}")
        print(f"Category: {cat} | Extension: {ext} | Lines: {lines} | Status: {status}")
        if desc:
            print(f"Description: {desc}")
        if purpose:
            print(f"Purpose: {purpose}")
        if logic:
            print(f"Logic: {logic}")
        if debug:
            print(f"Debug Flow: {debug}")

        # Functions
        cur.execute(
            "SELECT name, type, signature, start_line FROM functions WHERE file_id = ? ORDER BY start_line",
            (fid,)
        )
        fns = cur.fetchall()
        if fns:
            print(f"\n  Functions/Classes ({len(fns)}):")
            for name, ftype, sig, start in fns:
                print(f"    - {name} ({ftype}) line {start}")

        # Keywords
        cur.execute(
            """SELECT k.keyword FROM keywords k
               JOIN file_keywords fk ON k.id = fk.keyword_id
               WHERE fk.file_id = ? ORDER BY k.frequency DESC LIMIT 10""",
            (fid,)
        )
        kws = [r[0] for r in cur.fetchall()]
        if kws:
            print(f"\n  Keywords: {', '.join(kws)}")

        # Relationships (outgoing)
        cur.execute(
            """SELECT f2.path, r.rel_type, r.description
               FROM relationships r
               JOIN files f2 ON r.to_file_id = f2.id
               WHERE r.from_file_id = ?""",
            (fid,)
        )
        outgoing = cur.fetchall()
        if outgoing:
            print(f"\n  Links TO ({len(outgoing)}):")
            for to_path, rel_type, desc in outgoing:
                print(f"    --> {to_path} [{rel_type}]")

        # Relationships (incoming)
        cur.execute(
            """SELECT f1.path, r.rel_type, r.description
               FROM relationships r
               JOIN files f1 ON r.from_file_id = f1.id
               WHERE r.to_file_id = ?""",
            (fid,)
        )
        incoming = cur.fetchall()
        if incoming:
            print(f"\n  Links FROM ({len(incoming)}):")
            for from_path, rel_type, desc in incoming:
                print(f"    <-- {from_path} [{rel_type}]")

        # Issues linked to this file
        cur.execute(
            """SELECT i.issue_id, i.category, i.severity, i.title, i.status, ifc.role
               FROM issues i
               JOIN issue_files ifc ON i.id = ifc.issue_id
               WHERE ifc.file_id = ?""",
            (fid,)
        )
        issues = cur.fetchall()
        if issues:
            print(f"\n  Issues ({len(issues)}):")
            for iid, cat, sev, title, status, role in issues:
                print(f"    [{iid}] {title} [{cat}/{sev}] status={status} role={role}")

    # Log query
    cur.execute(
        "INSERT INTO query_log (query, query_type, results_count) VALUES (?, ?, ?)",
        (args.file, 'file', len(rows))
    )
    conn.commit()
    conn.close()


def cmd_issue(args):
    """Show issue details and linked files."""
    conn = get_conn()
    cur = conn.cursor()

    cur.execute(
        """SELECT id, issue_id, category, severity, title, description,
                  root_cause, fix, status, priority, effort, created_at, updated_at, fixed_at
           FROM issues WHERE issue_id = ? OR title LIKE ?""",
        (args.issue, f'%{args.issue}%')
    )
    row = cur.fetchone()

    if not row:
        print(f"No issue found: '{args.issue}'")
        conn.close()
        return

    (iid, iid_code, cat, sev, title, desc, root, fix, status, prio,
     effort, created, updated, fixed) = row

    print(f"\n{'='*100}")
    print(f"ISSUE: {iid_code}")
    print(f"Category: {cat} | Severity: {sev} | Status: {status} | Priority: {prio} | Effort: {effort}")
    print(f"Title: {title}")
    print(f"Created: {created} | Updated: {updated}" + (f" | Fixed: {fixed}" if fixed else ""))
    if desc:
        print(f"\nDescription: {desc}")
    if root:
        print(f"\nRoot Cause: {root}")
    if fix:
        print(f"\nFix: {fix}")

    # Linked files
    cur.execute(
        """SELECT f.path, f.category, ifc.role
           FROM issue_files ifc
           JOIN files f ON ifc.file_id = f.id
           WHERE ifc.issue_id = ?
           ORDER BY ifc.role, f.path""",
        (iid,)
    )
    files = cur.fetchall()
    if files:
        print(f"\nLinked Files ({len(files)}):")
        for path, cat, role in files:
            print(f"  [{role:10s}] {path} ({cat})")

    # Fix history
    cur.execute(
        """SELECT fh.change_type, fh.change_summary, fh.fixed_at, fh.fixed_by, fh.notes, f.path
           FROM fix_history fh
           JOIN files f ON fh.file_id = f.id
           WHERE fh.issue_id = ?
           ORDER BY fh.fixed_at""",
        (iid,)
    )
    history = cur.fetchall()
    if history:
        print(f"\nFix History ({len(history)}):")
        for ctype, summary, ftime, fby, notes, fpath in history:
            print(f"  [{ftime}] {ctype} on {fpath}: {summary}" + (f" | {notes}" if notes else ""))

    # Log query
    cur.execute(
        "INSERT INTO query_log (query, query_type, results_count) VALUES (?, ?, ?)",
        (args.issue, 'issue', 1)
    )
    conn.commit()
    conn.close()


def cmd_issues(args):
    """List all issues, optionally filtered by status/category."""
    conn = get_conn()
    cur = conn.cursor()

    query = """SELECT issue_id, category, severity, title, status, priority, effort FROM issues"""
    params = []
    conditions = []

    if args.status:
        conditions.append("status = ?")
        params.append(args.status)
    if args.category:
        conditions.append("category = ?")
        params.append(args.category)
    if args.severity:
        conditions.append("severity = ?")
        params.append(args.severity)

    if conditions:
        query += " WHERE " + " AND ".join(conditions)
    query += " ORDER BY priority ASC, issue_id ASC"

    cur.execute(query, params)
    rows = cur.fetchall()

    if not rows:
        print("No issues found.")
    else:
        print(f"\nIssues ({len(rows)}):")
        print("-" * 100)
        print(f"{'ID':8s} {'Category':14s} {'Severity':10s} {'Status':12s} {'Pri':4s} {'Effort':8s} Title")
        print("-" * 100)
        for iid, cat, sev, title, status, prio, effort in rows:
            print(f"{iid:8s} {cat:14s} {sev:10s} {status:12s} {prio:<4d} {effort:8s} {title}")

    conn.close()


def cmd_fix(args):
    """Mark an issue as fixed and record the change."""
    conn = get_conn()
    cur = conn.cursor()

    # Find issue
    cur.execute("SELECT id, status FROM issues WHERE issue_id = ?", (args.issue,))
    row = cur.fetchone()
    if not row:
        print(f"Issue not found: {args.issue}")
        conn.close()
        return

    iid, current_status = row

    # Update issue status
    cur.execute(
        """UPDATE issues SET status = 'fixed', updated_at = ?, fixed_at = ?, fixed_by = ?
           WHERE id = ?""",
        (datetime.now().isoformat(), datetime.now().isoformat(), args.who or 'cli', iid)
    )

    # Record fix history for each file
    if args.files:
        for fpath in args.files:
            # Normalize path separators
            search_term = fpath.replace('/', '\\')
            frow = None
            for pattern in [f'%{search_term}%', f'%\\{search_term}']:
                cur.execute("SELECT id FROM files WHERE path LIKE ? OR relative_path LIKE ? OR abs_path LIKE ?",
                            (pattern, pattern, pattern))
                frow = cur.fetchone()
                if frow:
                    break
            if frow:
                cur.execute(
                    """INSERT INTO fix_history
                       (issue_id, file_id, change_type, change_summary, fixed_by, notes)
                       VALUES (?, ?, ?, ?, ?, ?)""",
                    (iid, frow[0], 'edited', args.summary or 'Fixed via CLI', args.who or 'cli', args.notes or '')
                )
            else:
                print(f"  Warning: File not found in DB: {fpath}")

    conn.commit()
    print(f"Issue {args.issue} marked as FIXED (was: {current_status}).")
    conn.close()


def cmd_graph(args):
    """Show relationship graph for a file (neighbors)."""
    conn = get_conn()
    cur = conn.cursor()

    cur.execute("SELECT id, path FROM files WHERE path LIKE ?", (f'%{args.file}%',))
    rows = cur.fetchall()

    if not rows:
        print(f"No file found: '{args.file}'")
        conn.close()
        return

    if len(rows) > 1:
        print(f"Multiple files found. Use --all or be more specific:")
        for fid, path in rows:
            print(f"  {path}")
        conn.close()
        return

    fid, fpath = rows[0]
    print(f"\nGraph for: {fpath}")
    print("=" * 100)

    # Outgoing
    cur.execute(
        """SELECT f2.path, r.rel_type FROM relationships r
           JOIN files f2 ON r.to_file_id = f2.id
           WHERE r.from_file_id = ?""",
        (fid,)
    )
    out = cur.fetchall()
    if out:
        print(f"\nOUTGOING ({len(out)}):")
        for path, rel in out:
            print(f"  --> {path} [{rel}]")

    # Incoming
    cur.execute(
        """SELECT f1.path, r.rel_type FROM relationships r
           JOIN files f1 ON r.from_file_id = f1.id
           WHERE r.to_file_id = ?""",
        (fid,)
    )
    inn = cur.fetchall()
    if inn:
        print(f"\nINCOMING ({len(inn)}):")
        for path, rel in inn:
            print(f"  <-- {path} [{rel}]")

    conn.close()


def cmd_stats(args):
    """Show database statistics."""
    conn = get_conn()
    cur = conn.cursor()

    print("\n=== Context Memory Statistics ===")
    for table in ['files', 'functions', 'relationships', 'keywords', 'file_keywords',
                   'issues', 'issue_files', 'fix_history', 'query_log']:
        cur.execute(f"SELECT COUNT(*) FROM {table}")
        count = cur.fetchone()[0]
        print(f"  {table:20s}: {count}")

    # Files by category
    cur.execute("SELECT category, COUNT(*) FROM files GROUP BY category ORDER BY COUNT(*) DESC")
    print("\nFiles by Category:")
    for cat, count in cur.fetchall():
        print(f"  {cat:15s}: {count}")

    # Issues by status
    cur.execute("SELECT status, COUNT(*) FROM issues GROUP BY status ORDER BY status")
    print("\nIssues by Status:")
    for status, count in cur.fetchall():
        print(f"  {status:15s}: {count}")

    # Issues by severity
    cur.execute("SELECT severity, COUNT(*) FROM issues GROUP BY severity ORDER BY severity")
    print("\nIssues by Severity:")
    for sev, count in cur.fetchall():
        print(f"  {sev:15s}: {count}")

    conn.close()


def cmd_unwanted(args):
    """List unwanted/old files that can be removed."""
    conn = get_conn()
    cur = conn.cursor()

    cur.execute(
        "SELECT path, category, extension, size_bytes FROM files WHERE is_unwanted = 1 ORDER BY path"
    )
    rows = cur.fetchall()

    if not rows:
        print("No unwanted files found.")
    else:
        print(f"\nUnwanted/Old Files ({len(rows)}):")
        print("-" * 100)
        for path, cat, ext, size in rows:
            print(f"  [{cat:10s}] {path:80s} ({ext}) {size} bytes")

    conn.close()


# ============================================================
# UI-Specific Commands
# ============================================================

def cmd_ui_classes(args):
    """List UI CSS classes with their key properties."""
    conn = get_conn()
    cur = conn.cursor()

    query = """SELECT selector, file_source, is_component, is_pseudo FROM ui_classes"""
    params = []
    conditions = []

    if args.file:
        conditions.append("file_source LIKE ?")
        params.append(f'%{args.file}%')
    if args.component:
        conditions.append("is_component = 1")
    if args.pseudo:
        conditions.append("is_pseudo = 1")

    if conditions:
        query += " WHERE " + " AND ".join(conditions)
    query += " ORDER BY file_source, selector LIMIT ?"
    params.append(args.limit or 100)

    cur.execute(query, params)
    rows = cur.fetchall()

    if not rows:
        print("No UI classes found.")
    else:
        print(f"\nUI Classes ({len(rows)}):")
        print("-" * 120)
        print(f"{'Selector':45s} {'File':40s} {'Type':8s}")
        print("-" * 120)
        for selector, fsrc, is_comp, is_pseudo in rows:
            ftype = 'component' if is_comp else ('pseudo' if is_pseudo else 'class')
            fsrc_short = Path(fsrc).name
            print(f"{selector:45s} {fsrc_short:40s} {ftype:8s}")

    conn.close()


def cmd_ui_class(args):
    """Show details of a specific CSS class including all properties."""
    conn = get_conn()
    cur = conn.cursor()

    cur.execute(
        """SELECT id, selector, file_source, description FROM ui_classes WHERE selector = ?""",
        (args.selector,)
    )
    row = cur.fetchone()

    if not row:
        print(f"CSS class not found: '{args.selector}'")
        conn.close()
        return

    cid, selector, fsrc, desc = row
    print(f"\nCSS Class: {selector}")
    print(f"File: {fsrc}")
    if desc:
        print(f"Description: {desc}")
    print("-" * 80)

    cur.execute(
        "SELECT property, value, is_variable FROM css_properties WHERE class_id = ? ORDER BY property",
        (cid,)
    )
    props = cur.fetchall()
    if props:
        print(f"\nProperties ({len(props)}):")
        for prop, val, is_var in props:
            var_marker = " [CSS VAR]" if is_var else ""
            print(f"  {prop:25s}: {val}{var_marker}")
    else:
        print("  (no properties defined)")

    # Find which components use this class
    cur.execute(
        """SELECT component_file, usage_count FROM ui_component_usage
           WHERE class_selector = ? ORDER BY usage_count DESC""",
        (selector,)
    )
    usages = cur.fetchall()
    if usages:
        print(f"\nUsed by ({len(usages)}):")
        for comp_file, count in usages:
            print(f"  [{count}x] {Path(comp_file).name}")

    conn.close()


def cmd_ui_vars(args):
    """List CSS custom properties (variables)."""
    conn = get_conn()
    cur = conn.cursor()

    cur.execute(
        "SELECT variable, value, file_source, scope FROM css_variables ORDER BY variable"
    )
    rows = cur.fetchall()

    if not rows:
        print("No CSS variables found.")
    else:
        print(f"\nCSS Variables ({len(rows)}):")
        print("-" * 120)
        print(f"{'Variable':35s} {'Value':50s} {'File':25s}")
        print("-" * 120)
        for var, val, fsrc, scope in rows:
            fsrc_short = Path(fsrc).name
            print(f"{var:35s} {val:50s} {fsrc_short:25s}")

    conn.close()


def cmd_ui_component(args):
    """Show which CSS classes a component file uses."""
    conn = get_conn()
    cur = conn.cursor()

    cur.execute(
        """SELECT class_selector, usage_count FROM ui_component_usage
           WHERE component_file LIKE ?
           ORDER BY usage_count DESC, class_selector""",
        (f'%{args.component}%',)
    )
    rows = cur.fetchall()

    if not rows:
        print(f"No class usage found for component: '{args.component}'")
    else:
        print(f"\nCSS Classes used by {args.component} ({len(rows)}):")
        print("-" * 80)
        print(f"{'Class Selector':45s} {'Uses':6s}")
        print("-" * 80)
        for class_sel, count in rows:
            print(f"{class_sel:45s} {count:<6d}")

    conn.close()


def cmd_ui_stats(args):
    """Show UI-specific database statistics."""
    conn = get_conn()
    cur = conn.cursor()

    print("\n=== UI & Styling Statistics ===")
    for table in ['ui_classes', 'css_properties', 'css_variables', 'ui_component_usage']:
        cur.execute(f"SELECT COUNT(*) FROM {table}")
        count = cur.fetchone()[0]
        print(f"  {table:30s}: {count}")

    # Classes by file
    cur.execute(
        "SELECT file_source, COUNT(*) FROM ui_classes GROUP BY file_source ORDER BY COUNT(*) DESC"
    )
    print("\nUI Classes by File:")
    for fsrc, count in cur.fetchall():
        print(f"  {Path(fsrc).name:40s}: {count}")

    # Most used properties
    cur.execute(
        "SELECT property, COUNT(*) as cnt FROM css_properties GROUP BY property ORDER BY cnt DESC LIMIT 15"
    )
    print("\nMost Used CSS Properties:")
    for prop, cnt in cur.fetchall():
        print(f"  {prop:25s}: {cnt}")

    # Component usage
    cur.execute(
        "SELECT component_file, COUNT(*) as cnt FROM ui_component_usage GROUP BY component_file ORDER BY cnt DESC LIMIT 10"
    )
    print("\nTop Components by CSS Class Usage:")
    for comp_file, cnt in cur.fetchall():
        print(f"  {Path(comp_file).name:40s}: {cnt} classes")

    conn.close()


def main():
    parser = argparse.ArgumentParser(
        description="Aegis Context Memory CLI - Knowledge Graph Query Tool"
    )
    sub = parser.add_subparsers(dest='command', help='Available commands')

    # keyword
    p = sub.add_parser('keyword', help='Search files by keyword')
    p.add_argument('keyword', help='Keyword to search for')
    p.set_defaults(func=cmd_keyword)

    # file
    p = sub.add_parser('file', help='Show file details and relationships')
    p.add_argument('file', help='File path or name (partial match)')
    p.add_argument('--all', action='store_true', help='Show all matches')
    p.set_defaults(func=cmd_file)

    # issue
    p = sub.add_parser('issue', help='Show issue details')
    p.add_argument('issue', help='Issue ID (e.g., C1) or title keyword')
    p.set_defaults(func=cmd_issue)

    # issues
    p = sub.add_parser('issues', help='List all issues')
    p.add_argument('--status', help='Filter by status (open, fixed, etc.)')
    p.add_argument('--category', help='Filter by category (functionality, ui, security, memory, core)')
    p.add_argument('--severity', help='Filter by severity (critical, high, medium, low)')
    p.set_defaults(func=cmd_issues)

    # fix
    p = sub.add_parser('fix', help='Mark an issue as fixed')
    p.add_argument('issue', help='Issue ID (e.g., C1)')
    p.add_argument('--who', help='Who fixed it')
    p.add_argument('--summary', help='Change summary')
    p.add_argument('--notes', help='Additional notes')
    p.add_argument('--files', nargs='+', help='Files that were changed')
    p.set_defaults(func=cmd_fix)

    # graph
    p = sub.add_parser('graph', help='Show relationship graph for a file')
    p.add_argument('file', help='File path or name')
    p.set_defaults(func=cmd_graph)

    # stats
    p = sub.add_parser('stats', help='Show database statistics')
    p.set_defaults(func=cmd_stats)

    # unwanted
    p = sub.add_parser('unwanted', help='List unwanted/old files')
    p.set_defaults(func=cmd_unwanted)

    # UI-specific commands
    p = sub.add_parser('ui-classes', help='List UI CSS classes')
    p.add_argument('--file', help='Filter by source file')
    p.add_argument('--component', action='store_true', help='Show only component classes')
    p.add_argument('--pseudo', action='store_true', help='Show only pseudo-classes')
    p.add_argument('--limit', type=int, default=100, help='Max results')
    p.set_defaults(func=cmd_ui_classes)

    p = sub.add_parser('ui-class', help='Show CSS class details')
    p.add_argument('selector', help='CSS class selector (e.g., .sidebar, .visual-card)')
    p.set_defaults(func=cmd_ui_class)

    p = sub.add_parser('ui-vars', help='List CSS custom properties (variables)')
    p.set_defaults(func=cmd_ui_vars)

    p = sub.add_parser('ui-component', help='Show CSS classes used by a component')
    p.add_argument('component', help='Component file name (partial match)')
    p.set_defaults(func=cmd_ui_component)

    p = sub.add_parser('ui-stats', help='Show UI statistics')
    p.set_defaults(func=cmd_ui_stats)

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        return

    if not DB_PATH.exists():
        print(f"Database not found at {DB_PATH}. Run indexer.py and analyze_ui.py first.")
        sys.exit(1)

    args.func(args)


if __name__ == '__main__':
    main()
