#!/usr/bin/env python3
"""Generate lean graph-data.json - only files, issues, CSS classes for performance."""

import sqlite3
import json
import math
from pathlib import Path

DB_PATH = Path(r"D:\Aegis 2\ctxmem\context_memory.db")
OUTPUT_PATH = Path(r"D:\Aegis 2\ctxmem\graph-data.json")


def get_color(category):
    colors = {
        'server': '#3b82f6', 'client': '#10b981', 'desktop': '#f59e0b',
        'docs': '#8b5cf6', 'root': '#64748b', 'shared': '#ec4899',
        'security': '#ef4444', 'memory': '#06b6d4', 'ui': '#84cc16',
        'functionality': '#0ea5e9', 'core': '#f97316',
        'scripts': '#14b8a6', 'services': '#f59e0b', 'tests': '#8b5cf6'
    }
    return colors.get(category, '#64748b')


def generate_data():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    nodes = []
    edges = []

    # Get all Aegis source files
    cur.execute("""
        SELECT id, path, abs_path, relative_path, extension, size_bytes,
               line_count, category, description, status
        FROM files
        WHERE is_unwanted = 0
        ORDER BY path
    """)
    files = cur.fetchall()

    file_id_to_node = {}
    n = len(files)
    radius = 450
    center_x, center_y = 600, 400

    for i, f in enumerate(files):
        angle = (2 * math.pi * i) / n
        x = center_x + radius * math.cos(angle)
        y = center_y + radius * math.sin(angle)

        node = {
            'id': f'file_{f["id"]}',
            'label': Path(f['path']).name,
            'full_path': f['abs_path'],
            'relative_path': f['relative_path'],
            'category': f['category'] or 'root',
            'extension': f['extension'] or '',
            'line_count': f['line_count'] or 0,
            'description': f['description'] or '',
            'status': f['status'] or 'active',
            'size_bytes': f['size_bytes'] or 0,
            'x': x,
            'y': y,
            'fx': x,
            'fy': y,
        }
        nodes.append(node)
        file_id_to_node[f['id']] = node['id']

    # Get functions per file (for info panel, not as separate nodes)
    file_functions = {}
    cur.execute("SELECT id, file_id, name, type, signature, start_line FROM functions")
    for fn in cur.fetchall():
        fid = fn['file_id']
        if fid not in file_functions:
            file_functions[fid] = []
        file_functions[fid].append({
            'name': fn['name'],
            'type': fn['type'] or 'function',
            'signature': fn['signature'] or '',
            'start_line': fn['start_line'] or 0,
        })

    # Get CSS classes per file (match by file_source path)
    file_css = {}
    cur.execute("""
        SELECT uc.id, uc.selector, uc.file_source, uc.is_component,
               GROUP_CONCAT(cp.property || ':' || cp.value, '; ') as properties
        FROM ui_classes uc
        LEFT JOIN css_properties cp ON uc.id = cp.class_id
        GROUP BY uc.id
    """)
    # Build a lookup from file_source path to file_id
    path_to_fid = {}
    for f in files:
        path_to_fid[f['abs_path']] = f['id']
        path_to_fid[f['relative_path']] = f['id']

    for css in cur.fetchall():
        src = css['file_source'] or ''
        fid = path_to_fid.get(src)
        if not fid:
            # Try matching by basename
            src_name = Path(src).name if src else ''
            for f in files:
                if Path(f['path']).name == src_name:
                    fid = f['id']
                    break
        if fid:
            if fid not in file_css:
                file_css[fid] = []
            props = css['properties'] or ''
            file_css[fid].append({
                'selector': css['selector'] or '',
                'properties': props,
                'is_component': bool(css['is_component']),
            })

    # Get issues
    cur.execute("SELECT id, issue_id, category, severity, title, description, root_cause, fix, status, priority, effort FROM issues")
    issues = cur.fetchall()

    for issue in issues:
        issue_node = {
            'id': f'issue_{issue["id"]}',
            'label': issue['issue_id'],
            'full_issue_id': issue['issue_id'],
            'category': issue['category'] or 'functionality',
            'severity': issue['severity'] or 'medium',
            'title': issue['title'] or '',
            'description': issue['description'] or '',
            'root_cause': issue['root_cause'] or '',
            'fix': issue['fix'] or '',
            'status': issue['status'] or 'open',
            'priority': issue['priority'] or 5,
            'effort': issue['effort'] or 'medium',
            'x': 1150,
            'y': 100 + (len(nodes) * 25) % 500,
            'fx': None,
            'fy': None,
        }
        nodes.append(issue_node)

        cur.execute("SELECT file_id, role FROM issue_files WHERE issue_id = ?", (issue['id'],))
        for ifile in cur.fetchall():
            fid = ifile['file_id']
            if fid in file_id_to_node:
                edges.append({
                    'from': issue_node['id'],
                    'to': file_id_to_node[fid],
                    'type': ifile['role'] or 'related',
                    'description': f"Issue {issue['issue_id']} - {ifile['role']}"
                })

    # Get relationships between files
    cur.execute("SELECT from_file_id, to_file_id, rel_type, description FROM relationships")
    for rel in cur.fetchall():
        from_id = file_id_to_node.get(rel['from_file_id'])
        to_id = file_id_to_node.get(rel['to_file_id'])
        if from_id and to_id:
            edges.append({
                'from': from_id,
                'to': to_id,
                'type': rel['rel_type'] or 'imports',
                'description': rel['description'] or ''
            })

    # Store functions and CSS in node metadata for info panel
    for node in nodes:
        if node['id'].startswith('file_'):
            fid = int(node['id'].split('_')[1])
            node['functions'] = file_functions.get(fid, [])
            node['css_classes'] = file_css.get(fid, [])

    data = {
        'nodes': nodes,
        'edges': edges,
        'stats': {
            'total_files': len(files),
            'total_functions': sum(len(f) for f in file_functions.values()),
            'total_issues': len(issues),
            'total_css_classes': sum(len(c) for c in file_css.values()),
            'total_relationships': len(edges)
        }
    }

    with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    conn.close()
    print(f"Generated {OUTPUT_PATH}")
    print(f"Nodes: {len(nodes)}, Edges: {len(edges)}")
    print(f"Files: {len(files)}, Functions: {data['stats']['total_functions']}, Issues: {len(issues)}, CSS: {data['stats']['total_css_classes']}")


if __name__ == '__main__':
    generate_data()
