#!/usr/bin/env node
/**
 * @aegis/context-memory — init
 * Initialize Context Memory in any project directory.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PROJECT_ROOT = process.argv[2] || process.cwd();

function init() {
  console.log('=== @aegis/context-memory init ===');
  console.log(`Project: ${PROJECT_ROOT}\n`);

  // Check if better-sqlite3 is available
  try {
    require.resolve('better-sqlite3');
    console.log('[OK] better-sqlite3 is installed');
  } catch {
    console.log('[INSTALL] Installing better-sqlite3...');
    execSync('npm install better-sqlite3', { cwd: PROJECT_ROOT, stdio: 'inherit' });
  }

  // Create .aegis-context-memory directory for config
  const cmDir = path.join(PROJECT_ROOT, '.aegis-context-memory');
  if (!fs.existsSync(cmDir)) {
    fs.mkdirSync(cmDir, { recursive: true });
    console.log(`[CREATED] ${cmDir}`);
  }

  // Create .aegis-context-memory-config.json
  const config = {
    projectRoot: PROJECT_ROOT,
    dbPath: path.join(PROJECT_ROOT, '.aegis-context-memory.db'),
    indexedAt: new Date().toISOString(),
    version: '1.0.0'
  };
  fs.writeFileSync(
    path.join(cmDir, 'config.json'),
    JSON.stringify(config, null, 2)
  );
  console.log(`[CREATED] ${path.join(cmDir, 'config.json')}`);

  // Create AGENTS.md (instruction file for coding agents)
  const agentsMd = `# Aegis Context Memory — Agent Instructions

This project uses @aegis/context-memory, a SQL-based knowledge graph for fast, accurate debugging.

## Quick Commands

### Index the codebase
\`\`\bash
npx @aegis/context-memory init
node indexer.js
\`\`\`

### Query the knowledge graph
\`\`\bash
# Find files by keyword
npx @aegis/context-memory keyword voice

# Show file details and linked issues
npx @aegis/context-memory file computer-service.ts

# List issues by severity
npx @aegis/context-memory issues --severity critical

# Show database statistics
npx @aegis/context-memory stats
\`\`\`

### Record a fix
\`\`\bash
python cli.py fix C1 --who "yourname" --files "computer-service.ts" --summary "Fixed powerShell injection"
\`\`\`

## How to Use This Tool

1. **Before making changes**: Run \`cli.py issue <ID>\` to see the root cause, linked files, and fix notes.
2. **After making changes**: Run \`cli.py fix <ID> --files "file1.ts" --summary "..."\` to record the fix.
3. **When stuck**: Run \`cli.py graph <file.ts>\` to see the relationship graph.
4. **When token limit exceeded**: Use the safe context adjustment (see below).

## Safe Context Adjustment (Token Limit Recovery)

If a coding agent stops mid-task due to token limits:

1. Save your progress: Note which issue ID you were working on and what files you changed.
2. On resume: Run \`cli.py issue <ID>\` to reload the issue context.
3. Run \`cli.py file <changed-file>\` to re-examine the current state of modified files.
4. Run \`cli.py graph <file.ts>\` to re-establish relationship context.
5. Continue from where you left off — all context is persisted in the SQLite database.

## Database Location

The SQLite database is stored at: \`.aegis-context-memory.db\`

All context (files, functions, relationships, issues, fix history) is persisted here
and survives agent restarts, token limit resets, and session interruptions.

## Adding New Issues

Edit \`DEEP_ANALYSIS_ISSUES.md\` then run:
\`\`\bash
python seed_issues.py
\`\`\`

## Re-indexing After Changes

After significant code changes, re-index:
\`\`\bash
node indexer.js
\`\`\`
`;
  fs.writeFileSync(path.join(PROJECT_ROOT, 'AGENTS.md'), agentsMd);
  console.log(`[CREATED] ${path.join(PROJECT_ROOT, 'AGENTS.md')}`);

  console.log('\n=== Init Complete ===');
  console.log('Next steps:');
  console.log('  1. Run: node indexer.js  (to build the knowledge graph)');
  console.log('  2. Run: npx @aegis/context-memory stats  (to verify)');
  console.log('  3. Read: AGENTS.md  (for agent instructions)');
}

init();
