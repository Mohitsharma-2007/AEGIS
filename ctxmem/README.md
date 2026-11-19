# Aegis Context Memory

A SQL-based knowledge graph for the Aegis desktop app. Indexes all source files,
functions, relationships, keywords, and issues to enable fast, accurate debugging
with minimal LLM hallucination.

## Database

- **File:** `D:\Aegis 2\ctxmem\context_memory.db` (SQLite)
- **Schema:** `D:\Aegis 2\ctxmem\schema.sql`
- **Indexed:** 516 files, 2,776 functions, 17,395 keywords, 21 issues

## CLI Tool

```bash
# Show database statistics
python cli.py stats

# Search files by keyword
python cli.py keyword voice
python cli.py keyword mail
python cli.py keyword computer
python cli.py keyword notification

# Show file details, functions, and linked issues
python cli.py file App.tsx
python cli.py file computer-service.ts
python cli.py file mailbox.ts

# Show issue details and linked files
python cli.py issue C1
python cli.py issue F1
python cli.py issue U1

# List all issues (optionally filtered)
python cli.py issues
python cli.py issues --status open
python cli.py issues --category security
python cli.py issues --severity critical

# Mark an issue as fixed and record the change
python cli.py fix C1 --who "developer" \
  --summary "Replaced template literal PowerShell with whitelisted commands" \
  --files "computer-service.ts" \
  --notes "Added command whitelist, removed user input interpolation"

# Show relationship graph for a file
python cli.py graph computer-service.ts

# List unwanted/old files that can be removed
python cli.py unwanted
```

## Workflow for Fixing Issues

1. **Find the issue:** `python cli.py issues --severity critical`
2. **See details:** `python cli.py issue C1`
3. **See linked files:** Check the "Linked Files" section in issue output
4. **Examine a file:** `python cli.py file computer-service.ts`
5. **Fix the code** in the source file
6. **Record the fix:** `python cli.py fix C1 --who "yourname" --files "computer-service.ts" --summary "..."`

## Indexer

Re-index the codebase after major changes:

```bash
python indexer.py
```

Re-seed issues after updating DEEP_ANALYSIS_ISSUES.md:

```bash
python seed_issues.py
```

## Tables

| Table | Purpose |
|-------|---------|
| `files` | Every source file with path, category, description |
| `functions` | Functions, classes, components defined in each file |
| `relationships` | Import/call edges between files |
| `keywords` | Searchable keywords extracted from content |
| `file_keywords` | Many-to-many: files ↔ keywords |
| `issues` | Audit issues (functionality, UI, security, memory, core) |
| `issue_files` | Many-to-many: issues ↔ files with role (primary/secondary/fix) |
| `fix_history` | Log of fixes applied to issues |
| `query_log` | CLI query history for analytics |
