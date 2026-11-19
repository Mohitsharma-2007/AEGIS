#!/usr/bin/env python3
"""Build graph.html with embedded data for file:// protocol."""

import json
from pathlib import Path

DB_PATH = Path(r"D:\Aegis 2\ctxmem\graph-data.json")
TEMPLATE_PATH = Path(r"D:\Aegis 2\ctxmem\graph_template.html")
OUTPUT_PATH = Path(r"D:\Aegis 2\ctxmem\graph.html")

with open(DB_PATH, 'r', encoding='utf-8') as f:
    data = json.load(f)

nodes_json = json.dumps(data['nodes'], ensure_ascii=False)
edges_json = json.dumps(data['edges'], ensure_ascii=False)
stats_json = json.dumps(data['stats'], ensure_ascii=False)

html_template = TEMPLATE_PATH.read_text(encoding='utf-8')

html = html_template.replace(
    '// EMBEDDED_DATA_PLACEHOLDER',
    f'const EMBEDDED_NODES = {nodes_json};\nconst EMBEDDED_EDGES = {edges_json};\nconst EMBEDDED_STATS = {stats_json};'
)

OUTPUT_PATH.write_text(html, encoding='utf-8')
print(f"Built graph.html with {len(data['nodes'])} nodes, {len(data['edges'])} edges")
print(f"Output size: {len(html) / 1024 / 1024:.1f} MB")
