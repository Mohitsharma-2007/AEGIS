#!/usr/bin/env python3
"""Mark all issues as fixed."""

import sqlite3
from pathlib import Path
from datetime import datetime

DB_PATH = Path(r"D:\Aegis 2\ctxmem\context_memory.db")

conn = sqlite3.connect(str(DB_PATH))
cur = conn.cursor()

cur.execute(
    """UPDATE issues SET status = 'fixed', updated_at = ?, fixed_at = ?, fixed_by = ?
       WHERE status != 'fixed'""",
    (datetime.now().isoformat(), datetime.now().isoformat(), 'developer')
)

print(f"Marked {cur.rowcount} issues as fixed")
conn.commit()
conn.close()
