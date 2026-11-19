#!/usr/bin/env python3
"""
Generate graph-data.json from the Context Memory SQLite database.
This file is loaded by graph.html to render the interactive entity-relation graph.
"""

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
        'functionality': '#0ea5e9', 'core': '#f97316'
    }
    return colors.get(category, '#64748b')


def generate_data():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    # Get all files
    cur.execute("SELECT id, path, category, extension, line_count, description, status FROM files ORDER BY path")
    files = cur.fetchall()

    nodes = []
    edges = []
    file_id_to_node = {}

    # Create circular layout for nodes
    n = len(files)
    radius = 400
    center_x, center_y = 600, 400

    for i, f in enumerate(files):
        angle = (2 * math.pi * i) / n
        x = center_x + radius * math.cos(angle)
        y = center_y + radius * math.sin(angle)

        node = {
            'id': f'file_{f["id"]}',
            'label': Path(f['path']).name,
            'full_path': f['path'],
            'category': f['category'] or 'root',
            'extension': f['extension'] or '',
            'line_count': f['line_count'] or 0,
            'description': f['description'] or '',
            'status': f['status'] or 'active',
            'x': x,
            'y': y,
            'fx': x,
            'fy': y,
        }
        nodes.append(node)
        file_id_to_node[f['id']] = node['id']

    # Get functions
    cur.execute("SELECT id, file_id, name, type, signature, start_line FROM functions ORDER BY start_line")
    functions = cur.fetchall()

    for fn in functions:
        file_node_id = file_id_to_node.get(fn['file_id'])
        if file_node_id:
            func_node = {
                'id': f'func_{fn["id"]}',
                'label': fn['name'],
                'type': 'function',
                'func_type': fn['type'] or 'function',
                'signature': fn['signature'] or '',
                'start_line': fn['start_line'] or 0,
                'file_id': fn['file_id'],
                'x': file_id_to_node[fn['file_id']] and nodes[[n['id'] for n in nodes].index(file_id_to_node[fn['file_id']])]['x'] + 50,
                'y': file_id_to_node[fn['file_id']] and nodes[[n['id'] for n in nodes].index(file_id_to_node[fn['file_id']])]['y'] + 50,
                'fx': None,
                'fy': None,
            }
            nodes.append(func_node)
            edges.append({
                'from': file_node_id,
                'to': func_node['id'],
                'type': 'contains'
            })

    # Get relationships between files
    cur.execute("SELECT from_file_id, to_file_id, rel_type, description FROM relationships")
    relationships = cur.fetchall()

    for rel in relationships:
        from_id = file_id_to_node.get(rel['from_file_id'])
        to_id = file_id_to_node.get(rel['to_file_id'])
        if from_id and to_id:
            edges.append({
                'from': from_id,
                'to': to_id,
                'type': rel['rel_type'] or 'imports',
                'description': rel['description'] or ''
            })

    # Get issues and link them to files
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
            'x': 1100,
            'y': 300 + (len(nodes) * 20) % 400,
            'fx': None,
            'fy': None,
        }
        nodes.append(issue_node)

        # Link issue to files
        cur.execute("SELECT file_id, role FROM issue_files WHERE issue_id = ?", (issue['id'],))
        issue_files = cur.fetchall()
        for ifile in issue_files:
            file_node_id = file_id_to_node.get(ifile['file_id'])
            if file_node_id:
                edges.append({
                    'from': issue_node['id'],
                    'to': file_node_id,
                    'type': ifile['role'] or 'related',
                    'description': f"Issue {issue['issue_id']} - {ifile['role']}"
                })

    # Get CSS classes for UI styling info
    cur.execute("SELECT id, selector, file_source, is_component, is_pseudo FROM ui_classes LIMIT 100")
    css_classes = cur.fetchall()

    for css in css_classes:
        # Get properties for this class
        cur.execute("SELECT property, value, is_variable FROM css_properties WHERE class_id = ?", (css['id'],))
        props = cur.fetchall()
        prop_list = [f"{p['property']}: {p['value']}" for p in props]

        css_node = {
            'id': f'css_{css["id"]}',
            'label': css['selector'],
            'type': 'css_class',
            'file_source': css['file_source'] or '',
            'is_component': bool(css['is_component']),
            'is_pseudo': bool(css['is_pseudo']),
            'properties': prop_list[:10],  # Limit to 10 for display
            'x': 1100,
            'y': 100 + (len(nodes) * 20) % 300,
            'fx': None,
            'fy': None,
        }
        nodes.append(css_node)

        # Link CSS to source file
        cur.execute("SELECT id, path FROM files WHERE abs_path LIKE ? OR relative_path LIKE ? OR path LIKE ?",
                    (f'%{Path(css["file_source"]).name}%', f'%{Path(css["file_source"]).name}%', f'%{Path(css["file_source"]).name}%'))
        frow = cur.fetchone()
        if frow:
            file_node_id = file_id_to_node.get(frow['id'])
            if file_node_id:
                edges.append({
                    'from': file_node_id,
                    'to': css_node['id'],
                    'type': 'styles',
                    'description': 'CSS class defined in'
                })

    data = {
        'nodes': nodes,
        'edges': edges,
        'stats': {
            'total_files': len(files),
            'total_functions': len(functions),
            'total_issues': len(issues),
            'total_css_classes': len(css_classes),
            'total_relationships': len(edges)
        }
    }

    with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2)

    conn.close()
    print(f"Generated {OUTPUT_PATH}")
    print(f"Nodes: {len(nodes)}, Edges: {len(edges)}")
    print(f"Files: {len(files)}, Functions: {len(functions)}, Issues: {len(issues)}, CSS: {len(css_classes)}")


if __name__ == '__main__':
    generate_data()
