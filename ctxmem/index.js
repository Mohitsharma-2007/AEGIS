#!/usr/bin/env node
/**
 * @aegis/context-memory — Indexer (JavaScript version for npx)
 * Scans a project directory and builds a SQLite knowledge graph.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PROJECT_ROOT = process.argv[2] || process.cwd();
const DB_PATH = path.join(PROJECT_ROOT, '.aegis-context-memory.db');

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.venv', 'dist', 'build', 'release', 'vendor',
  'reference-repos', '.github', '.vscode', '.next', '.nuxt', '.svelte-kit',
  'coverage', '.cache', 'target'
]);

const INDEX_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.mjs', '.jsx', '.py', '.html', '.css',
  '.json', '.md', '.ps1', '.bat', '.sh', '.env', '.txt'
]);

function isSkipDir(dir) {
  return SKIP_DIRS.has(dir) || dir.startsWith('.');
}

function getCategory(filePath) {
  const parts = filePath.split(path.sep);
  if (parts.includes('server')) return 'server';
  if (parts.includes('client')) return 'client';
  if (parts.includes('shared')) return 'shared';
  if (parts.includes('desktop')) return 'desktop';
  if (parts.includes('docs')) return 'docs';
  return 'root';
}

function countLines(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return content.split('\n').length;
  } catch { return 0; }
}

function extractFunctions(content, ext) {
  const functions = [];
  if (['.ts', '.tsx', '.js', '.jsx', '.mjs'].includes(ext)) {
    // Function declarations
    const funcRegex = /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/g;
    let m;
    while ((m = funcRegex.exec(content)) !== null) {
      functions.push({ name: m[1], type: 'function', signature: m[0].slice(0, 200) });
    }
    // Arrow functions
    const arrowRegex = /(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?\(/g;
    while ((m = arrowRegex.exec(content)) !== null) {
      functions.push({ name: m[1], type: 'function', signature: m[0].slice(0, 200) });
    }
    // Classes
    const classRegex = /(?:export\s+)?class\s+(\w+)/g;
    while ((m = classRegex.exec(content)) !== null) {
      functions.push({ name: m[1], type: 'class', signature: m[0].slice(0, 200) });
    }
  } else if (ext === '.py') {
    const funcRegex = /(?:async\s+)?def\s+(\w+)\s*\(/g;
    let m;
    while ((m = funcRegex.exec(content)) !== null) {
      functions.push({ name: m[1], type: 'function', signature: m[0].slice(0, 200) });
    }
    const classRegex = /class\s+(\w+)/g;
    while ((m = classRegex.exec(content)) !== null) {
      functions.push({ name: m[1], type: 'class', signature: m[0].slice(0, 200) });
    }
  }
  return functions;
}

function extractKeywords(content) {
  const text = content
    .replace(/\/\/.*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/["'].*?["']/g, ' ');
  const words = text.match(/\b[a-zA-Z][a-zA-Z0-9_]{2,}\b/g) || [];
  const stopwords = new Set([
    'the','and','for','with','this','that','from','have','has','had','was',
    'were','been','being','not','but','are','can','could','would','should',
    'may','might','must','shall','will','just','also','into','than','then',
    'when','where','while','after','before','during','through','over','under',
    'again','further','once','here','there','each','few','more','most',
    'other','some','such','only','own','same','so','too','very','now','get',
    'set','let','var','const','function','return','if','else','for','while',
    'do','switch','case','break','continue','try','catch','throw','new',
    'class','extends','import','export','default','async','await','typeof',
    'instanceof','in','of','null','undefined','true','false','super','this',
    'arguments','React','react','Component','useState','useEffect','useRef',
    'useCallback','useMemo','useContext','Props','State','HTML','CSS','JSX',
    'Node','npm','API','JSON','UI','UX','DOM','HTTP','GET','POST','PUT',
    'DELETE','PATCH','HEAD','OPTIONS','200','201','400','401','403','404',
    '500','OK','Error','True','False','None','Self','Cls','Init','Super',
    'Print','Len','Str','Int','Float','Bool','List','Dict','Tuple','Set',
    'File','Open','Read','Write','Close','Seek','Tell','Flush','Is',
    'And','Or','Not','In','Is','Lambda','Yield','Global','Nonlocal',
    'Assert','Del','Pass','Raise','Return','Break','Continue','Class',
    'Def','Elif','Else','Except','Finally','From','Import','While',
    'With','Async','Await','Match','Case','TypeVar','Generic','Protocol',
    'AbstractMethod','Override','Final','Literal','TypedDict','NamedTuple',
    'Dataclass','Field','Private','Public','Protected','Static','ClassMethod',
    'Property','Getter','Setter','Decorator','Wrapper','Asyncio','Await',
    'Coroutine','Task','Future','Event','Lock','Queue','Semaphore','Condition',
    'Thread','Process','Pool','Executor','Subprocess','Pipe','Socket',
    'Address','Port','Host','Server','Client','Request','Response','Header',
    'Body','Cookie','Session','Cache','Token','Auth','Login','Logout',
    'Register','Verify','Validate','Sanitize','Escape','Encode','Decode',
    'Parse','Serialize','Deserialize','Stringify','Parse','Stringify',
    'Mapping','Filter','Reduce','Sort','Reverse','Slice','Join','Split',
    'Replace','Strip','Lstrip','Rstrip','Lower','Upper','Title','Capitalize',
    'Swapcase','Startswith','Endswith','Find','Rfind','Index','Rindex',
    'Count','Isalpha','Isdigit','Isalnum','Isspace','Islower','Isupper',
    'Istitle','Isnumeric','Isdecimal','Format','Center','Ljust','Rjust',
    'Zfill','Expandtabs','Maketrans','Translate','Partition','Rpartition',
    'Splitlines','Decode','Encode','Error','Warning','Info','Debug','Critical',
    'Exception','Traceback','Warning','UserWarning','DeprecationWarning',
    'SyntaxError','TypeError','ValueError','KeyError','IndexError',
    'AttributeError','NameError','ImportError','ModuleNotFoundError',
    'FileNotFoundError','PermissionError','TimeoutError','ConnectionError',
    'OSError','IOError','RuntimeError','StopIteration','GeneratorExit',
    'KeyboardInterrupt','SystemExit','ArithmeticError','FloatingPointError',
    'OverflowError','ZeroDivisionError','AssertionError','BufferError',
    'EOFError','UnicodeError','UnicodeDecodeError','UnicodeEncodeError',
    'UnicodeTranslateError','LookupError','ReferenceError','RecursionError',
    'IndentationError','TabError','UnboundLocalError','NotImplementedError',
    'BlockingIOError','ChildProcessError','ConnectionAbortedError',
    'ConnectionRefusedError','ConnectionResetError','InterruptedError',
    'IsADirectoryError','NotADirectoryError','ProcessLookupError'
  ]);
  return words.filter(w => !stopwords.has(w.toLowerCase()));
}

function initDb(db) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL UNIQUE,
      abs_path TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      extension TEXT NOT NULL,
      size_bytes INTEGER DEFAULT 0,
      line_count INTEGER DEFAULT 0,
      last_indexed TEXT DEFAULT (datetime('now')),
      is_source INTEGER DEFAULT 1,
      is_unwanted INTEGER DEFAULT 0,
      category TEXT,
      description TEXT,
      purpose TEXT,
      logic_summary TEXT,
      debug_flow TEXT,
      status TEXT DEFAULT 'active'
    );
    CREATE INDEX IF NOT EXISTS idx_files_path ON files(path);
    CREATE INDEX IF NOT EXISTS idx_files_category ON files(category);

    CREATE TABLE IF NOT EXISTS functions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      signature TEXT,
      start_line INTEGER,
      description TEXT,
      is_exported INTEGER DEFAULT 0,
      FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_functions_file ON functions(file_id);
    CREATE INDEX IF NOT EXISTS idx_functions_name ON functions(name);

    CREATE TABLE IF NOT EXISTS relationships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_file_id INTEGER NOT NULL,
      to_file_id INTEGER NOT NULL,
      rel_type TEXT NOT NULL,
      description TEXT,
      strength INTEGER DEFAULT 1,
      FOREIGN KEY (from_file_id) REFERENCES files(id) ON DELETE CASCADE,
      FOREIGN KEY (to_file_id) REFERENCES files(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_relationships_from ON relationships(from_file_id);
    CREATE INDEX IF NOT EXISTS idx_relationships_to ON relationships(to_file_id);

    CREATE TABLE IF NOT EXISTS keywords (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      keyword TEXT NOT NULL UNIQUE,
      frequency INTEGER DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_keywords_keyword ON keywords(keyword);

    CREATE TABLE IF NOT EXISTS file_keywords (
      file_id INTEGER NOT NULL,
      keyword_id INTEGER NOT NULL,
      PRIMARY KEY (file_id, keyword_id),
      FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE,
      FOREIGN KEY (keyword_id) REFERENCES keywords(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS issues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      issue_id TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL,
      severity TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      root_cause TEXT,
      fix TEXT,
      status TEXT DEFAULT 'open',
      priority INTEGER DEFAULT 5,
      effort TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      fixed_at TEXT,
      fixed_by TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status);
    CREATE INDEX IF NOT EXISTS idx_issues_category ON issues(category);

    CREATE TABLE IF NOT EXISTS issue_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      issue_id INTEGER NOT NULL,
      file_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE,
      FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS fix_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      issue_id INTEGER NOT NULL,
      file_id INTEGER NOT NULL,
      change_type TEXT NOT NULL,
      change_summary TEXT,
      fixed_at TEXT DEFAULT (datetime('now')),
      fixed_by TEXT,
      notes TEXT,
      FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE,
      FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ui_classes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      selector TEXT NOT NULL,
      file_source TEXT NOT NULL,
      line_number INTEGER,
      is_component INTEGER DEFAULT 0,
      is_pseudo INTEGER DEFAULT 0,
      description TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_ui_classes_selector ON ui_classes(selector);

    CREATE TABLE IF NOT EXISTS css_properties (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      class_id INTEGER NOT NULL,
      property TEXT NOT NULL,
      value TEXT NOT NULL,
      is_variable INTEGER DEFAULT 0,
      FOREIGN KEY (class_id) REFERENCES ui_classes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS css_variables (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      variable TEXT NOT NULL UNIQUE,
      value TEXT NOT NULL,
      file_source TEXT NOT NULL,
      scope TEXT DEFAULT ':root'
    );

    CREATE TABLE IF NOT EXISTS ui_component_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      component_file TEXT NOT NULL,
      class_selector TEXT NOT NULL,
      usage_count INTEGER DEFAULT 1
    );
  `);
}

function main() {
  console.log(`=== @aegis/context-memory Indexer ===`);
  console.log(`Project: ${PROJECT_ROOT}`);
  console.log(`Database: ${DB_PATH}`);

  const Database = require('better-sqlite3');
  const db = new Database(DB_PATH);
  initDb(db);

  let fileCount = 0;
  const files = [];

  // Walk directory
  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!isSkipDir(entry.name)) walk(fullPath);
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        if (INDEX_EXTENSIONS.has(ext)) {
          files.push(fullPath);
        }
      }
    }
  }
  walk(PROJECT_ROOT);

  console.log(`Found ${files.length} files to index...`);

  const insertFile = db.prepare(
    `INSERT OR REPLACE INTO files (path, abs_path, relative_path, extension, size_bytes, line_count, category)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const insertFunction = db.prepare(
    `INSERT OR IGNORE INTO functions (file_id, name, type, signature, start_line) VALUES (?, ?, ?, ?, ?)`
  );
  const insertKeyword = db.prepare(
    `INSERT OR IGNORE INTO keywords (keyword, frequency) VALUES (?, 1)`
  );
  const updateKeyword = db.prepare(
    `UPDATE keywords SET frequency = frequency + 1 WHERE keyword = ?`
  );
  const insertFileKeyword = db.prepare(
    `INSERT OR IGNORE INTO file_keywords (file_id, keyword_id) VALUES (?, ?)`
  );

  const tx = db.transaction(() => {
    for (const filePath of files) {
      const relPath = path.relative(PROJECT_ROOT, filePath);
      const ext = path.extname(filePath).toLowerCase();
      const size = fs.statSync(filePath).size;
      const lines = countLines(filePath);
      const category = getCategory(filePath);
      const isUnwanted = /(check-line|test-shortcut|635\+1|notch\.html$|widgets\.html$|overlay\.html$|tray-pill\.html$|showcase\.html$|annotations\.html$|file-tray\.js$|clipboard-history\.js$|coding-processes\.ps1|media-session\.ps1)/i.test(path.basename(filePath)) ? 1 : 0;

      const fileInfo = insertFile.run(
        filePath, filePath, relPath, ext, size, lines, category
      );
      const fileId = fileInfo.lastInsertRowid;

      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const functions = extractFunctions(content, ext);
        for (const fn of functions) {
          insertFunction.run(fileId, fn.name, fn.type, fn.signature, 0);
        }

        const keywords = extractKeywords(content);
        const seen = new Set();
        for (const kw of keywords) {
          const kwLower = kw.toLowerCase();
          if (seen.has(kwLower)) continue;
          seen.add(kwLower);
          insertKeyword.run(kwLower);
          updateKeyword.run(kwLower);
          const kwRow = db.prepare(`SELECT id FROM keywords WHERE keyword = ?`).get(kwLower);
          if (kwRow) {
            insertFileKeyword.run(fileId, kwRow.id);
          }
        }
      } catch { /* skip unreadable files */ }

      fileCount++;
      if (fileCount % 50 === 0) console.log(`  Indexed ${fileCount} files...`);
    }
  });
  tx();

  console.log(`\n=== Indexing Complete ===`);
  console.log(`Files: ${fileCount}`);
  console.log(`Database: ${DB_PATH}`);
  db.close();
}

main();
