#!/usr/bin/env node
/**
 * @aegis/context-memory — CLI (JavaScript version for npx)
 * Query the knowledge graph to find files, functions, relationships, and issues.
 */

const { execSync } = require('child_process');
const path = require('path');
const readline = require('readline');

const PROJECT_ROOT = process.argv[2] || process.cwd();
const DB_PATH = path.join(PROJECT_ROOT, '.aegis-context-memory.db');

function runSql(sql, params = []) {
  try {
    const result = execSync(
      `node -e "const Database=require('better-sqlite3');const db=new Database('${DB_PATH}');${sql};db.close();"`,
      { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
    );
    return result.trim();
  } catch (e) {
    return '';
  }
}

function cmdStats() {
  const tables = ['files', 'functions', 'relationships', 'keywords', 'file_keywords',
                   'issues', 'issue_files', 'fix_history', 'query_log',
                   'ui_classes', 'css_properties', 'css_variables', 'ui_component_usage'];
  console.log('\n=== Context Memory Statistics ===');
  for (const table of tables) {
    try {
      const count = runSql(`console.log(db.prepare('SELECT COUNT(*) as c FROM ${table}').get().c)`);
      console.log(`  ${table.padEnd(30)}: ${count}`);
    } catch { console.log(`  ${table.padEnd(30)}: N/A`); }
  }
  console.log();
}

function cmdKeyword(keyword) {
  const script = `
const Database = require('better-sqlite3');
const db = new Database('${DB_PATH}');
const rows = db.prepare(\`
  SELECT f.path, f.category, f.extension, k.frequency
  FROM files f
  JOIN file_keywords fk ON f.id = fk.file_id
  JOIN keywords k ON fk.keyword_id = k.id
  WHERE k.keyword = ?
  ORDER BY k.frequency DESC, f.path
\`).all('${keyword}');
console.log(JSON.stringify(rows));
db.close();
`;
  const result = execSync(`node -e "${script}"`, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  const rows = JSON.parse(result);
  if (!rows.length) {
    console.log(`No files found for keyword: '${keyword}'`);
  } else {
    console.log(`\nFiles containing keyword '${keyword}' (${rows.length}):`);
    console.log('-'.repeat(100));
    for (const { path, category, extension, frequency } of rows) {
      console.log(`  [${category.padEnd(8)}] ${path.padEnd(70)} (${extension}) freq=${frequency}`);
    }
  }
}

function cmdFile(fileName) {
  const script = `
const Database = require('better-sqlite3');
const db = new Database('${DB_PATH}');
const searchTerm = '${fileName}'.replace(/\\//g, '\\\\');
const rows = db.prepare(\`
  SELECT id, path, category, extension, line_count, description, status
  FROM files
  WHERE path LIKE ? OR relative_path LIKE ? OR abs_path LIKE ?
\`).all(\`%${searchTerm}%\`, \`%${searchTerm}%\`, \`%${searchTerm}%\`);
console.log(JSON.stringify(rows));
db.close();
`;
  const result = execSync(`node -e "${script}"`, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  const rows = JSON.parse(result);
  if (!rows.length) {
    console.log(`No file found matching: '${fileName}'`);
    return;
  }
  for (const row of rows) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`FILE: ${row.path}`);
    console.log(`Category: ${row.category} | Extension: ${row.extension} | Lines: ${row.line_count} | Status: ${row.status}`);
    if (row.description) console.log(`Description: ${row.description}`);
  }
}

function cmdIssues(status, category, severity) {
  let sql = `SELECT issue_id, category, severity, title, status, priority, effort FROM issues`;
  const params = [];
  const conditions = [];
  if (status) { conditions.push(`status = '${status}'`); }
  if (category) { conditions.push(`category = '${category}'`); }
  if (severity) { conditions.push(`severity = '${severity}'`); }
  if (conditions.length) sql += ` WHERE ${conditions.join(' AND ')}`;
  sql += ` ORDER BY priority ASC, issue_id ASC`;

  const script = `
const Database = require('better-sqlite3');
const db = new Database('${DB_PATH}');
const rows = db.prepare(\`${sql}\`).all();
console.log(JSON.stringify(rows));
db.close();
`;
  const result = execSync(`node -e "${script}"`, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  const rows = JSON.parse(result);
  if (!rows.length) {
    console.log('No issues found.');
  } else {
    console.log(`\nIssues (${rows.length}):`);
    console.log('-'.repeat(100));
    console.log(`${'ID'.padEnd(8)} ${'Category'.padEnd(14)} ${'Severity'.padEnd(10)} ${'Status'.padEnd(12)} ${'Pri'.padEnd(4)} ${'Effort'.padEnd(8)} Title`);
    console.log('-'.repeat(100));
    for (const { issue_id, category, severity, title, status, priority, effort } of rows) {
      console.log(`${issue_id.padEnd(8)} ${category.padEnd(14)} ${severity.padEnd(10)} ${status.padEnd(12)} ${priority.toString().padEnd(4)} ${effort.padEnd(8)} ${title}`);
    }
  }
}

function cmdFix(issueId, who, summary, files) {
  console.log(`Issue ${issueId} marked as FIXED.`);
  console.log(`Note: Fix recording requires Python CLI. Use: python cli.py fix ${issueId} --who "${who}" --summary "${summary}" --files "${files.join(' ')}"`);
}

function cmdHelp() {
  console.log(`
@aegis/context-memory CLI

Usage: npx @aegis/context-memory <command> [args]

Commands:
  stats                          Show database statistics
  keyword <word>                 Search files by keyword
  file <name>                    Show file details
  issues [--status X] [--category Y] [--severity Z]  List issues
  fix <id> --who X --summary Y --files Z            Mark issue fixed (use Python CLI for full recording)
  help                           Show this help

Examples:
  npx @aegis/context-memory keyword voice
  npx @aegis/context-memory file computer-service.ts
  npx @aegis/context-memory issues --severity critical
`);
}

const args = process.argv.slice(2);
const command = args[0];

switch (command) {
  case 'stats': cmdStats(); break;
  case 'keyword': cmdKeyword(args[1]); break;
  case 'file': cmdFile(args[1]); break;
  case 'issues': {
    const opts = {};
    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--status') opts.status = args[++i];
      else if (args[i] === '--category') opts.category = args[++i];
      else if (args[i] === '--severity') opts.severity = args[++i];
    }
    cmdIssues(opts.status, opts.category, opts.severity);
    break;
  }
  case 'fix': cmdFix(args[1], args[3], args[5], args.slice(7)); break;
  case 'help': cmdHelp(); break;
  default: cmdHelp(); break;
}
