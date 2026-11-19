#!/usr/bin/env python3
"""Build ui-components.html with embedded CSS class data for file:// protocol."""

import sqlite3
import json
from pathlib import Path

DB_PATH = Path(r"D:\Aegis 2\ctxmem\context_memory.db")
TEMPLATE_PATH = Path(r"D:\Aegis 2\ctxmem\ui_components_template.html")
OUTPUT_PATH = Path(r"D:\Aegis 2\ctxmem\ui-components.html")

conn = sqlite3.connect(str(DB_PATH))
conn.row_factory = sqlite3.Row
cur = conn.cursor()

cur.execute("""
    SELECT uc.id, uc.selector, uc.file_source, uc.is_component, uc.is_pseudo,
           GROUP_CONCAT(cp.property || ':' || cp.value, '; ') as properties
    FROM ui_classes uc
    LEFT JOIN css_properties cp ON uc.id = cp.class_id
    GROUP BY uc.id
""")

css_classes = []
for css in cur.fetchall():
    src = css['file_source'] or ''
    props = css['properties'] or ''
    css_classes.append({
        'selector': css['selector'] or '',
        'file_source': src,
        'is_component': bool(css['is_component']),
        'is_pseudo': bool(css['is_pseudo']),
        'properties': [p.strip() for p in props.split(';') if p.strip()],
    })

conn.close()

css_json = json.dumps(css_classes, ensure_ascii=False)

html_template = TEMPLATE_PATH.read_text(encoding='utf-8')

html = html_template.replace(
    '// EMBEDDED_CSS_DATA_PLACEHOLDER',
    f'const EMBEDDED_CSS_CLASSES = {css_json};'
)

OUTPUT_PATH.write_text(html, encoding='utf-8')
print(f"Built ui-components.html with {len(css_classes)} CSS classes")
print(f"Output size: {len(html) / 1024:.1f} KB")
