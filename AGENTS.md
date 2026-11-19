# Aegis Context Memory — Agent Instructions

This project uses **@aegis/context-memory**, a SQL-based knowledge graph for fast, accurate debugging with minimal LLM hallucination.

## 📍 Location

- **Database:** `D:\Aegis 2\ctxmem\context_memory.db` (SQLite)
- **CLI:** `D:\Aegis 2\ctxmem\cli.py` (Python) or `npx @aegis/context-memory` (JS)
- **Indexer:** `D:\Aegis 2\ctxmem\indexer.py` / `D:\Aegis 2\ctxmem\index.js`
- **Schema:** `D:\Aegis 2\ctxmem\schema.sql`
- **Visual Graph:** `D:\Aegis 2\ctxmem\graph.html` (open in browser)

---

## 🚀 Quick Start for Coding Agents

### Before making any changes:

```bash
# 1. Check what issues exist
python cli.py issues --severity critical

# 2. See issue details (root cause, fix, linked files)
python cli.py issue C1

# 3. Examine linked files
python cli.py file computer-service.ts

# 4. See relationship graph
python cli.py graph computer-service.ts
```

### After making changes:

```bash
# Record the fix in the database
python cli.py fix C1 --who "yourname" \
  --summary "Brief description of what was fixed" \
  --files "computer-service.ts" \
  --notes "Additional context"
```

### When token limit is exceeded (agent stops mid-task):

```bash
# 1. Reload issue context
python cli.py issue <ISSUE_ID>

# 2. Re-examine current state of modified files
python cli.py file <changed-file.ts>

# 3. Re-establish relationship context
python cli.py graph <file.ts>

# 4. Continue from where you left off
```

All context is persisted in SQLite and survives agent restarts.

---

## 📊 Database Contents

| Table | Count | Purpose |
|-------|-------|---------|
| `files` | 516 | Every source file with path, category, description |
| `functions` | 2,776 | Functions, classes, components in each file |
| `relationships` | 50 | Import/call edges between files |
| `keywords` | 17,395 | Searchable keywords from content |
| `ui_classes` | 1,575 | CSS classes from style.css, visual-ui.css, notch.css |
| `css_properties` | 6,116 | CSS properties for each class |
| `css_variables` | 39 | CSS custom properties (design tokens) |
| `issues` | 21 | Audit issues (security, memory, UI, functionality, core) |
| `issue_files` | 40 | Issue → file links with role (primary/secondary/fix) |
| `fix_history` | 8 | Log of fixes applied |

---

## 🐛 Current Issues (8 Fixed, 13 Open)

### ✅ Fixed Issues

| ID | Severity | Title | Files Fixed |
|----|----------|-------|-------------|
| C1 | critical | PowerShell script injection | `computer-service.ts` |
| C2 | critical | exec() arbitrary command execution | `computer-service.ts` |
| C3 | high | Mail sender spoofing | `mail-routes.ts` |
| C8 | high | ELECTRON_RUN_AS_NODE not unset | `start.ps1`, `start.sh` |
| F1 | high | Voice switches to text while listening | `App.tsx` |
| F7 | high | TTS speaks punctuation/markdown | `read-aloud.ts` |
| C5 | medium | Memory leak: taskStatuses unbounded | `App.tsx` |
| U2 | medium | Sidebar layout shift | `style.css` |

### 🔴 Open Critical/High Issues

| ID | Severity | Title | Primary File |
|----|----------|-------|-------------|
| C4 | high | Memory leak: WebSocket/AudioContext not cleaned | `useLocalVoice.ts` |
| C7 | medium | No CSP nonce for penboard inline scripts | `app-origin.ts` |
| F2 | high | Microphone not released when leaving voice mode | `useLocalVoice.ts` |
| F4 | high | Mail report not sent on host restart | `mail-orchestrator.ts` |

### 🟡 Open Medium Issues

| ID | Severity | Title | Primary File |
|----|----------|-------|-------------|
| F5 | medium | Swarm task dispatch - no provider fallback | `agent-swarm.ts` |
| F6 | medium | Computer service - orphaned sessions | `computer-service.ts` |
| F8 | medium | Finance/News clones - no UI | (new components needed) |
| U1 | medium | Notch lacks glassmorphism | `notch.css` |
| U3 | medium | Voice bar optimistic state | `InlineVoiceBar.tsx` |
| U5 | medium | Widgets panel blank in browser-only | `App.tsx` |
| C6 | medium | Memory leak: event listeners not removed | `App.tsx` |
| F3 | medium | /call silent no-op | `App.tsx` |

---

## 🎨 UI Styling Reference

### CSS Files

| File | Classes | Properties | Purpose |
|------|---------|------------|---------|
| `style.css` | 1,437 | ~3,800 | Main application styles |
| `visual-ui.css` | 75 | ~600 | Generative UI charts, cards, tables |
| `notch.css` | 63 | ~400 | Desktop notch glassmorphism |

### Key CSS Variables (Design Tokens)

```
--bg: #edf1f7          - Background
--surface: #ffffff     - Card surface
--surface-raised: #f8fafc - Raised surface
--ink: #1e293b         - Text color
--muted: #64748b       - Muted text
--line: #d9e1ec        - Borders/dividers
--accent: #2563eb      - Primary accent
--accent-hover: #1d4ed8 - Accent hover
--accent-gradient: linear-gradient(120deg, #06b6d4 0%, #7c3aed 100%)
--radius: 22px         - Notch border radius
```

### CLI UI Commands

```bash
# List all CSS classes
python cli.py ui-classes

# Show details of a specific class
python cli.py ui-class .sidebar

# List CSS variables
python cli.py ui-vars

# Show classes used by a component
python cli.py ui-component App.tsx

# UI statistics
python cli.py ui-stats
```

---

## 🔒 Security Checklist (Before Any Code Change)

- [ ] No user input interpolated into PowerShell scripts
- [ ] No arbitrary `exec()` commands without whitelisting
- [ ] Mail `from` address authenticated against session token
- [ ] CSP nonces for inline scripts (penboard)
- [ ] `ELECTRON_RUN_AS_NODE` unset in start scripts
- [ ] Command whitelist for shell execution
- [ ] Dangerous shell metacharacters blocked

---

## 💾 Safe Context Adjustment

When an agent stops due to token limits, the Context Memory database preserves all context:

1. **Save progress:** Note issue ID and files changed
2. **Resume:** `python cli.py issue <ID>` → reloads full context
3. **Re-examine:** `python cli.py file <file>` → current file state
4. **Re-establish:** `python cli.py graph <file>` → relationship context
5. **Continue:** All changes recorded in `fix_history` table

---

## 📝 Rules for All Coding Agents

1. **Always check Context Memory before making changes** — `cli.py issue <ID>`
2. **Always record fixes after making changes** — `cli.py fix <ID> --files ...`
3. **Never guess at file contents** — use `cli.py file <name>` to verify
4. **Always check for linked issues** when modifying a file — file output shows linked issues
5. **Update DEEP_ANALYSIS_ISSUES.md when discovering new issues** — then run `python seed_issues.py`
6. **Re-index after significant changes** — `python indexer.py`
7. **Use the visual graph** — open `graph.html` in browser for relationship overview

---

## 🔗 File Linkage Reference

```
Voice Switch Bug:      Chat.tsx ← App.tsx ← useLocalVoice.ts ← voiceSession.tsx ← InlineVoiceBar.tsx
PowerShell Injection:  computer-service.ts ← computer-routes.ts ← App.tsx
Mail Spoofing:         mail-routes.ts ← mailbox.ts ← AgentMailPanel.tsx
Memory Leak (WS):      useLocalVoice.ts ← voiceSession.tsx ← Chat.tsx
Notch Glassmorphism:   NotchApp.tsx ← notch.css ← main.js ← ipc.ts
TTS Punctuation:       read-aloud.ts ← voiceSession.tsx ← Chat.tsx
```

---

*End of AGENTS.md — All coding agents must read this before working on the codebase.*
