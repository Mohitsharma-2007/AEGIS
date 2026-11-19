#!/usr/bin/env python3
"""
Aegis UI Analysis - Extracts CSS classes, properties, components, and relationships
from all styling files and adds them to the Context Memory database.
"""

import re
import sqlite3
from pathlib import Path

DB_PATH = Path(r"D:\Aegis 2\ctxmem\context_memory.db")

# CSS files to analyze
CSS_FILES = [
    Path(r"D:\Aegis 2\aegis\apps\host\src\client\style.css"),
    Path(r"D:\Aegis 2\aegis\apps\host\src\client\visual-ui.css"),
    Path(r"D:\Aegis 2\aegis\apps\desktop\desktop-ui\src\notch.css"),
]

# Component files that reference CSS classes
COMPONENT_FILES = [
    Path(r"D:\Aegis 2\aegis\apps\host\src\client\App.tsx"),
    Path(r"D:\Aegis 2\aegis\apps\host\src\client\Chat.tsx"),
    Path(r"D:\Aegis 2\aegis\apps\host\src\client\InlineVoiceBar.tsx"),
    Path(r"D:\Aegis 2\aegis\apps\host\src\client/AgentMailPanel.tsx"),
    Path(r"D:\Aegis 2\aegis\apps\host\src\client/AgentsWorkspace.tsx"),
    Path(r"D:\Aegis 2\aegis\apps\host\src\client/MemoryPanel.tsx"),
    Path(r"D:\Aegis 2\aegis\apps\host\src\client/PenBoardPanel.tsx"),
    Path(r"D:\Aegis 2\aegis\apps\host\src\client/VisualCards.tsx"),
    Path(r"D:\Aegis 2\aegis\apps\desktop\desktop-ui\src\NotchApp.tsx"),
]


def extract_css_classes(content: str) -> dict:
    """Extract CSS classes and their properties from CSS content."""
    classes = {}
    
    # Match .classname { ... } blocks
    # Handle nested selectors like .parent .child, .parent > .child, .parent:hover
    pattern = r'([.#][\w\-]+(?:[.#][\w\-]+|\[[^\]]+\]|:[\w\-]+(?:\([^)]*\))?|\s*[>+~\s]\s*[.#][\w\-]+)*)\s*\{([^}]*)\}'
    
    for m in re.finditer(pattern, content, re.DOTALL):
        selector = m.group(1).strip()
        properties = m.group(2).strip()
        
        # Parse properties
        props = {}
        for prop_m in re.finditer(r'([\w\-]+)\s*:\s*([^;]+);', properties):
            prop_name = prop_m.group(1).strip()
            prop_value = prop_m.group(2).strip()
            props[prop_name] = prop_value
        
        # Handle custom properties (CSS variables)
        for var_m in re.finditer(r'(--[\w\-]+)\s*:\s*([^;]+);', properties):
            var_name = var_m.group(1).strip()
            var_value = var_m.group(2).strip()
            props[var_name] = var_value
        
        classes[selector] = props
    
    return classes


def extract_css_variables(content: str) -> dict:
    """Extract CSS custom properties from :root or any scope."""
    variables = {}
    # Match --var: value;
    for m in re.finditer(r'(--[\w\-]+)\s*:\s*([^;]+);', content):
        variables[m.group(1).strip()] = m.group(2).strip()
    return variables


def extract_class_references(content: str) -> list:
    """Extract CSS class names referenced in TSX/TS/JS files."""
    classes = []
    # Match className="..." or className={...}
    for m in re.finditer(r'className\s*=\s*["\']([^"\']+)["\']', content):
        class_list = m.group(1).split()
        classes.extend(class_list)
    # Match className={`...`}
    for m in re.finditer(r'className\s*=\s*\{`([^`]+)`\}', content):
        class_list = m.group(1).split()
        classes.extend(class_list)
    return classes


def main():
    conn = sqlite3.connect(str(DB_PATH))
    cur = conn.cursor()
    
    # Create UI-specific tables if they don't exist
    cur.executescript("""
        CREATE TABLE IF NOT EXISTS ui_classes (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            selector        TEXT NOT NULL UNIQUE,
            file_source     TEXT NOT NULL,
            line_number     INTEGER,
            is_component    INTEGER DEFAULT 0,
            is_pseudo       INTEGER DEFAULT 0,
            is_media_query  INTEGER DEFAULT 0,
            description     TEXT
        );
        
        CREATE INDEX IF NOT EXISTS idx_ui_classes_selector ON ui_classes(selector);
        CREATE INDEX IF NOT EXISTS idx_ui_classes_file ON ui_classes(file_source);
        
        CREATE TABLE IF NOT EXISTS css_properties (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            class_id        INTEGER NOT NULL,
            property        TEXT NOT NULL,
            value           TEXT NOT NULL,
            is_variable     INTEGER DEFAULT 0,
            FOREIGN KEY (class_id) REFERENCES ui_classes(id) ON DELETE CASCADE
        );
        
        CREATE INDEX IF NOT EXISTS idx_css_properties_class ON css_properties(class_id);
        CREATE INDEX IF NOT EXISTS idx_css_properties_prop ON css_properties(property);
        
        CREATE TABLE IF NOT EXISTS css_variables (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            variable        TEXT NOT NULL UNIQUE,
            value           TEXT NOT NULL,
            file_source     TEXT NOT NULL,
            scope           TEXT DEFAULT ':root',
            FOREIGN KEY (file_source) REFERENCES ui_classes(file_source)
        );
        
        CREATE INDEX IF NOT EXISTS idx_css_variables_var ON css_variables(variable);
        
        CREATE TABLE IF NOT EXISTS ui_component_usage (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            component_file  TEXT NOT NULL,
            class_selector  TEXT NOT NULL,
            usage_count     INTEGER DEFAULT 1,
            FOREIGN KEY (component_file) REFERENCES ui_classes(file_source)
        );
        
        CREATE INDEX IF NOT EXISTS idx_ui_component_usage_file ON ui_component_usage(component_file);
        CREATE INDEX IF NOT EXISTS idx_ui_component_usage_class ON ui_component_usage(class_selector);
    """)
    
    total_classes = 0
    total_props = 0
    
    for css_file in CSS_FILES:
        if not css_file.exists():
            print(f"Skipping missing file: {css_file}")
            continue
        
        content = css_file.read_text(encoding='utf-8', errors='ignore')
        classes = extract_css_classes(content)
        variables = extract_css_variables(content)
        
        print(f"\n=== {css_file.name} ===")
        print(f"Classes found: {len(classes)}")
        print(f"Variables found: {len(variables)}")
        
        # Insert CSS variables
        for var_name, var_value in variables.items():
            cur.execute(
                """INSERT OR IGNORE INTO css_variables (variable, value, file_source, scope)
                   VALUES (?, ?, ?, ?)""",
                (var_name, var_value, str(css_file), ':root')
            )
        
        # Insert classes and properties
        for selector, props in classes.items():
            is_pseudo = 1 if ':' in selector and not selector.startswith(':root') else 0
            is_component = 1 if selector.startswith('.') and not any(p in selector for p in [':', '[', '>']) else 0
            
            cur.execute(
                """INSERT OR IGNORE INTO ui_classes (selector, file_source, line_number, is_component, is_pseudo, description)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (selector, str(css_file), content[:content.find(selector)].count('\n') + 1,
                 is_component, is_pseudo, f"CSS class from {css_file.name}")
            )
            
            cur.execute("SELECT id FROM ui_classes WHERE selector = ? AND file_source = ?", (selector, str(css_file)))
            row = cur.fetchone()
            if row:
                class_id = row[0]
                for prop_name, prop_value in props.items():
                    is_var = 1 if prop_name.startswith('--') else 0
                    cur.execute(
                        """INSERT OR IGNORE INTO css_properties (class_id, property, value, is_variable)
                           VALUES (?, ?, ?, ?)""",
                        (class_id, prop_name, prop_value, is_var)
                    )
                    total_props += 1
                total_classes += 1
    
    conn.commit()
    
    # Analyze component files for class usage
    print("\n=== Component Class Usage Analysis ===")
    for comp_file in COMPONENT_FILES:
        if not comp_file.exists():
            continue
        content = comp_file.read_text(encoding='utf-8', errors='ignore')
        refs = extract_class_references(content)
        
        for ref in refs:
            # Clean up the reference
            ref = ref.strip().strip('"').strip("'")
            if not ref or ref.startswith('{') or ref.startswith('"'):
                continue
            
            cur.execute(
                """INSERT OR IGNORE INTO ui_component_usage (component_file, class_selector, usage_count)
                   VALUES (?, ?, 1)""",
                (str(comp_file), ref)
            )
    
    conn.commit()
    print(f"\nTotal UI classes indexed: {total_classes}")
    print(f"Total CSS properties indexed: {total_props}")
    print(f"Database: {DB_PATH}")
    
    conn.close()


if __name__ == '__main__':
    main()
