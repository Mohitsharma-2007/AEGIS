# Aegis

> A personal, voice-first, local-first desktop agent for Windows — one application, one agent identity, one memory, one permission system, many engines underneath.

Aegis converses normally, browses the web with two engines, controls the computer, remembers everything with provenance, forges repeated actions into fast tools, does research with citations, draws and explains visually, and controls the Windows desktop. It is built as a single product — not a bundle of demos — by combining real open-source codebases into one host UI, one agent identity, one memory, and one permission system.

---

## Contents

- [1. What Aegis Is](#1-what-aegis-is)
- [2. Owner's Machine & Target Environment](#2-owners-machine--target-environment)
- [3. Architecture — Components & How They Run](#3-architecture--components--how-they-run)
- [4. What We Are Building — Functionality Specification](#4-what-we-are-building--functionality-specification)
- [5. Finance Clone Specification](#5-finance-clone-specification)
- [6. Voice & TTS — Making It Smarter](#6-voice--tts--making-it-smarter)
- [7. Annotation Functionality (Pen Board / Screen Annotation)](#7-annotation-functionality--pen-board--screen-annotation)
- [8. Agent Desktop — Whole-Laptop Control](#8-agent-desktop--whole-laptop-control)
- [9. References & Sources — Open-Source Integrations](#9-references--sources--open-source-integrations)
- [10. How We Are Making It — Build & Run](#10-how-we-are-making-it--build--run)
- [11. Test Baseline & Release Gates](#11-test-baseline--release-gates)
- [12. Known Problems & Decision Gates](#12-known-problems--decision-gates)
- [13. Practicality — What This Means For You](#13-practicality--what-this-means-for-you)

---

## 1. What Aegis Is

**Aegis is a Jarvis-class personal agent.** It runs on one Windows laptop (AMD Ryzen 7 260 + NVIDIA RTX 5050 8 GB, 16 GB DDR5, Windows 11) and is **voice-first**: talk normally, get normal answers back. Strict cite-or-abstain provenance is a **toggle, OFF by default**, so it never abstains on greetings or general chat.

**Speed is the main goal:** an action the agent performs successfully three times is forged into a reusable tool (tool forging) so repeats run fast and cheap. Permissions gate tools — a tool category whose permission is OFF is not offered to the model at all; screenshots/computer actions happen only when the user's request needs them. Irreversible actions require keyboard confirmation (voice confirmation is refused by design). Honesty over theatre — unavailable features say so in the UI; nothing is faked.

Providers are OpenCode-style: endpoints/model catalogues come from models.dev, hard-configured in code; the user only pastes API keys into `.env.local` (never in chat, never committed, never logged). No AI-generated images or video — mascots and branding are code/SVG only.

Engineering rules: work only inside the merged repos' own code; `start.ps1` / `start.bat` must remain pure ASCII; tests must never regress below the recorded baseline; log every file change in `MODIFICATIONS.md`.

---

## 2. Owner's Machine & Target Environment

| Item | Value |
|------|-------|
| CPU/GPU | AMD Ryzen 7 260 (NPU 16 TOPS, Radeon 780M iGPU) + NVIDIA RTX 5050 8 GB (115 W) |
| RAM | 16 GB DDR5-5600 |
| OS | Windows 11 (PowerShell 5.1 present; **no Bun**, no Docker by default) |
| Profile | "P-LEAN": small local models only; cloud planner via providers |
| NPU verdict | **16 TOPS < 40 TOPS Copilot+ bar** → Windows Copilot Runtime / Phi Silica APIs are NOT eligible. On-device acceleration route = Windows ML / ONNX Runtime with DirectML on RTX 5050 + 780M, or Foundry Local. Do not promise Copilot+ APIs. |

---

## 3. Architecture — Components & How They Run

Base decision (owner, 13 Nov 2026): **OpenDots + openmuse combined** is the host product, rebranded **Aegis**; the other brief repos contribute code/behaviour as noted below. Upstream originals are kept read-only.

| Component | Origin | Role | Port |
|-----------|--------|------|------|
| Host app (UI + API) | CopilotKit / OpenDots, modified | The one UI: chat, tray views, settings, connections | :4310 |
| Aegis daemon | Project daemon (Python/FastAPI) | Memory (4-layer), tools, MCP server, permission broker, tool forging, research connectors | :8765 |
| Browser service | OpenDots browser module | AEGIS Computer (Playwright) sessions | :4311 |
| Obscura | h4ckf0r0day/obscura | Second browser engine (CDP); automatic bypass when Playwright fails | :9222 |
| OpenCode harness | anomalyco/opencode v2.2.7, vendored in `opencode/` | Second agent harness (coding/agent runs, MCP plugins); standalone binary — no Bun required | :4096 |
| openmuse sidecar | CopilotKit/openmuse | Extra integrations/computer surface — blocked by its own code demanding a CopilotKit Intelligence key | :8788 (optional) |
| WhatsApp sidecar | Project (Baileys) → reworked (Task W2) | WhatsApp Web-style QR pairing + messaging tools | :4312 |
| Research app | CopilotKit/open-research-ANA, vendored, NOT wired | LangGraph research canvas; needs OpenAI/Tavily/LangSmith/Copilot Cloud keys | — |

**Behaviour-level merges:**
- **OpenBot** → governance/approvals via daemon permission broker + audit trail (visible in Tools & Plugins).
- **OpenDuet** → proactive companion behaviour (brief, routines, approvals) running natively, surfaced in the **Companion** tray view.
- **CopilotKit** (library) → AG-UI runtime + generative UI in chat.

**The one UI (14 tray entries, all functional):**
Conversation · AEGIS Computer · Browser · Harness · Memory · Files · Terminal · Activity · Research · Connections · Tools & Plugins · Companion · Agents · Settings. Sidebar shows **ONE Aegis agent**; OpenDots surface presets are grouped under it as "Surfaces (11)". Agents spawn on demand.

**Memory (daemon, SQLite, 4 layers):**
L1 **Captures** (raw, with provenance: source + id) → L2 **Hybrid RAG** (vector + lexical; `rag_enabled` setting, default ON — OFF means chat turns carry no retrieved context, captures still record, explicit recall still answers) → L3 **STAIR tree** (Structure-Aware Information Retrieval: the document's own heading/ToC structure is the index; leaf-title addressing, `title_path`; PDF outline-first ingestion) → L4 **Temporal graph** (entities/relations over time). Memory tab exposes captures, RAG search, STAIR tree, graph.

**Providers:**
models.dev catalogue (vendored snapshot + live refresh; 238 providers merged), Mohit's six pinned as favourites: **OpenRouter (default)**, Groq, NVIDIA NIM, Conduit, TokenHarbor, Vercel AI Gateway. Paste key in `.env.local` → models auto-load → pick in Settings. OpenAI-compatible and Anthropic-compatible endpoints supported (Anthropic wired via `@tanstack/ai-anthropic`; unproven live — no key yet).

**Browsers:**
Engine param `auto | playwright | obscura`. Auto = Playwright first (launch ladder: bundled Chromium → full build → system Edge channel → Chrome channel → custom path; start scripts auto-install Chromium on first run); any failure retries via Obscura CDP. Results are labelled with the engine that served them. "Ego Lite" (third browser) is **later, by owner's order — do not build it**.

**How it starts:**
`start.bat` (double-click) → `start.ps1` / `start.sh`: load `.env.local` → ensure Playwright Chromium → fetch OpenCode standalone binary if missing → start daemon, browser service, obscura, WhatsApp sidecar, harness sidecar → host app on :4310.

---

## 4. What We Are Building — Functionality Specification

### Host App (`apps/host`) — UI + Agent Runtime (port 4310)

**Chat surface:** CopilotKit-powered conversation with local provider failover, provider/model selection persisted in settings, breadcrumbs, adaptive polling (3s → ×1.7 → max 20s), offline banner with retry. Message persistence so history survives reload.

**Generative-UI tool (`show_visual`):** The model sends a closed, strict, bounded visual spec (chart line/area/bar, stats, table, timeline, callout, progress, gallery, code — up to 6 blocks) and the app renders it with animated SVG/HTML components inline in chat. Specs persist (`thread_visuals`) and redraw after reload.

**Browser card:** Renders a live page preview as soon as the URL is known (scanning bar + skeleton), not after tool completion. The AEGIS Computer pane opens automatically when browsing starts.

**Research brief:** Appears inline in chat (heading, body, sources, links) with its real captured screenshot, and the pane auto-switches to the Brief tab.

**Files surface:** Source-of-truth listing grouped by chat thread and generated/uploaded files, sorted by recency, dual grouping (By Thread / By Type), category pills, live search, bounded previews (64 KB text), DOCX/ODT text extraction via jszip, PDF/image previews, strict UTF-8 decoding (mislabeled binaries show "unavailable" instead of garbage), generated raw/sse/audit/trace artifacts hidden by default with a toggle.

**Memory surface:** Two tiers — short-term (working context) and long-term (durable knowledge) — with a `tier` column, per-document toggle, All/long/short filters; daemon recall returns best-matching chunk snippets (capped 1,200 chars, `is_snippet` flag); host unified search returns excerpts with term-based scores (not flat 1.0); raw capture IDs hidden behind source labels.

**Agents surface:** Rebuilt around mail, not a task board — **Queries** (orchestrator mail threads: read/reply/delete, unread counts, composer sends task mail), **Team** (roster capability cards for Aegis, RFI, Sentinel, Filo, Memo, Operator), **Harness** (native engine status, runtimes, tool set, MCP server enable/disable).

**Integrations surface:** Connections & Sidecars (WhatsApp QR pairing/status), Ecosystem Connectors grid (Microsoft Office 365 COM, Google Workspace OAuth, Slack Bot/Webhook, Windows Voice Access), Marketplace, MCP Tools & Plugins, OAuth — WhatsApp is a permission-gated chat tool inside the conversation, not a standalone page.

**Settings:** provider/model/permissions/appearance, environment accordion, assistant cards, live theme switching (system/light/dark).

### Desktop Shell (`apps/desktop`) — Electron app (connects to host :4310)

**Notch** (React/TSX rebuilt surface): Screen-top island, 300 × 38 collapsed → 620 × 300 expanded. Always interactive (no click-through), grows to shelf only when opened. Click to toggle instantly, hover to expand after dwell delay. Quick actions (Talk/Open app), `/call <widget>` ask bar, tabs (Workspace / Live / Agents), Today's tasks, Focus timer, Notepad, Events, File tray (drop → import → Use/Remove), generative quick cards (weather/media/timer/system/agents/notes/ask), settings panel (placement, compact/expanded size, radius, gap, border/shadow, hover/close delay). CSS-variable geometry; no width transitions; the window never sweeps sideways or stalls on repeated clicks; hover does not resize the native window.

**Tray:** Click-only flyout (no hover pop), stays hidden while the app window is foreground; returns only when minimized/hidden; avatar unread badge (caps at 9+); dynamic icon per agent state.

**Mutual exclusivity:** App focused → notch and tray flyout step aside; app blurred/minimized → notch returns; tray stays available for reopen. Voice auto-open of the notch is suppressed while the app is foreground.

**Annotations / Pen Board** (`public/penboard.html` `?wb=1`): Full-screen transparent click-through teaching layer — hand-drawn pen strokes with cursor riding the tip, labels, callouts, step captions, scripted demos (Pythagoras theorem with a² + b² = c² squares). Integrated in-app as modal overlay via `PenBoardPanel.tsx` with toolbar (Pythagoras / Shapes / Clear). Slash commands `/draw <topic>` and `/whiteboard` open it. Frontend tool `aegis_penboard({ demo: "pyth" | "shapes" })` lets the model open the board and run a demo.

**Annotations (`annotations.html`):** Screen annotation layer — the agent's own cursor glides to a control and highlights it, or draws diagrams stroke by stroke; window transparent, click-through, always-on-top at screen-saver level; host sends `{ steps: [...] }` payloads with targets (bboxes/points), drawings (pythagoras/triangle/arrow/line/rect/circle/ellipse/polygon/highlight/angle/point/text/formula), captions, key caps.

---

## 5. Finance Clone Specification

Build three fully functional clones with proper API routes, rate-limit handling, and honest cloud behaviour so nothing gets IP-banned or cloud-banned:

**Google Finance Clone:**
- Live quotes with price change, previous close, day range, 52-week range, volume
- Watchlist with symbol search
- Historical chart data
- Proper API routes with polite rate limiting and backoff
- Honest empty/error states — no sample data, no fake numbers

**Yahoo Finance Clone:**
- Live quotes with price change, previous close, day range, 52-week range, volume
- Watchlist with symbol search
- Historical chart data
- Proper API routes with polite rate limiting and backoff
- Honest empty/error states — no sample data, no fake numbers

**Google News Clone:**
- Category-based news search (AI, markets, cyber, general)
- Live articles with title, URL, time, source
- Proper API routes with polite rate limiting and backoff
- Honest empty/error states — no sample data, no fake articles

**General finance/news rules:** Use public RSS/REST endpoints only, respect rate limits with exponential backoff, never scrape proprietary finance products or their protected implementation/content, label sources and time, deduplicate results, and mark anything date-dependent as potentially stale.

---

## 6. Voice & TTS — Making It Smarter

The TTS must **not** speak punctuation, markdown artifacts, or raw syntax (question marks, `**$`, `#`, `*`, `_`, `~`, `` ` ``, `>`, `+`, `-`, `[`, `]`, `(`, `)`, `?`, `!`, `:`) to make voice smarter:

- **Sentence segmentation:** Split on real sentence boundaries before sending to TTS; never feed raw markdown or chat markup to the synthesizer.
- **Punctuation stripping for speech:** Strip `**`, `*`, `_`, `~`, `#`, `` ` ``, `>`, `+`, `-`, `[`, `]`, `(`, `)`, `?`, `!`, `:` from spoken output unless semantically meaningful.
- **SSML/prosody control:** Use SSML marks for pauses, emphasis, rate, and pitch so the voice sounds natural, not robotic.
- **Local STT/TTS backend:** faster-whisper STT + kokoro TTS (local), with the option to route through an OpenAI-compatible voice pipeline when configured.
- **Voice activity detection:** Semantic VAD so the mic only opens when speech is present; stop listening when silence is detected.
- **Interruption and mute:** The user can interrupt TTS mid-sentence; mute toggles the mic without dropping the session.
- **Task-continuation:** Voice turns persist to the current thread so a spoken conversation continues across reloads.
- **Error honesty:** If the voice pipeline is unavailable, say so in the UI instead of silently failing.

Voice calls use the provider configured by `VOICE_API_KEY` / `VOICE_MODEL` / `VOICE_NAME`. Local STT/TTS (whisper.cpp, kokoro) is used. The host also gained a matching "Local model (Ollama / LM Studio)" provider entry, so the same model can be selected for regular chat turns.

---

## 7. Annotation Functionality — Pen Board / Screen Annotation

The annotation engine (`annotations.html`, integrated in-app as `public/penboard.html` with `?wb=1`) is a **full-screen, transparent, click-through teaching layer**. It is not a chat overlay — it draws on top of any window at screen-saver level, never steals focus, and never intercepts clicks it doesn't own.

**What it draws:**
- Hand-drawn pen strokes with a cursor that rides the pen tip (jittered, springy motion)
- Labels, callouts, step badges ("Step 1 of 3"), and a typewriter caption bar
- Scripted demos — e.g. the Pythagoras theorem: draw a right triangle (a=4, b=3), build a square on each side, animate `a² = 16`, `b² = 9`, `c² = 25`, conclude `a² + b² = c²`. Also a Blender "how do I render" walkthrough and a primitive gallery (arrow, box, circle, polygon, highlight, angle, text)

**How it is driven:** The host sends a payload `{ steps: [ { explanation, targets: [{bbox, label, note, keys, click}], drawings: [{type, ...}], next, waitMs, keep, clear } ] }`. Targets use bboxes (CSS pixels or 0–1/0–1000 normalized), drawings use `pythagoras`/`triangle`/`arrow`/`line`/`rect`/`circle`/`ellipse`/`polygon`/`highlight`/`angle`/`point`/`text`/`formula`/`label`. The page only draws; the host locates the button (UI Automation `BoundingRectangle` is exact; vision-model boxes are approximate) and sends its rectangle. Each `explanation` is spoken with TTS as the step starts.

**In-app integration:** `PenBoardPanel.tsx` renders the engine in a modal overlay with a toolbar (Pythagoras / Shapes / Clear). Slash commands `/draw <topic>` and `/whiteboard` open it. The model has a frontend tool `aegis_penboard({ demo: 'pyth' | 'shapes' })` so it can open the board and run a demo without the user touching anything.

---

## 8. Agent Desktop — Whole-Laptop Control

The desktop shell (`apps/desktop`, Electron) is the wrapper around the host app. It does **not** reimplement the agent — it hosts the host app's web UI on `http://127.0.0.1:4310` and adds desktop-native surfaces:

- **Main window:** Loads the Aegis host (chat, agents, files, memory, research, integrations, settings, companion)
- **Notch:** Screen-top island; collapsed = 300 × 38 (always interactive, no click-through), expanded = 620 × 300 shelf. Clickable island, hover-to-expand, `/call` ask bar, file tray (drop → import → Use), generative cards, settings panel
- **Tray:** Click-only flyout; avatar unread badge; dynamic icon per agent state; hidden when the app is foreground, returns when minimized/hidden
- **Mutual exclusivity:** App focused → notch + tray flyout step aside; app blurred/minimized → notch returns; tray always available for reopen
- **Voice OS:** One shell session shared by chat and desktop surfaces; Talk/Stop from tray/notch toggles the same session; actual phase/mute/error state is broadcast to desktop surfaces (not optimistic UI)

**AEGIS Computer** (inside the host, port 4310): Live screen, control handoff, and permissions — Browser, Files, Terminal, Activity each have their own sidebar surface. It opens from the header monitor button (or `/computer`) into the chat-side preview pane, so working on a task never takes the owner away from the thread that asked for it.

**Agent Desktop integration:** Covers semantic UIA actions with fresh numbered refs, permission boundaries, and end-to-end browser/native-app tasks. Read-only UIA tree verified (113 controls). Semantic mutation and browser task remain open tasks.

---

## 9. References & Sources — Open-Source Integrations

Open-source reference repos cloned into `reference-repos/` and studied for **patterns only** — never copied as dependencies. Aegis does not vendor multiple competing agent runtimes into the desktop process. Each reference was checked for license, security boundary, Windows support, resource use, and overlap with the existing host and `aegis-orchestrator` before any pattern was adopted:

| Repo | Pattern Taken |
|------|-------------|
| [n8n-io/nod](https://github.com/n8n-io/nod) | `delegate` tool: in-process subagents with self-contained instructions, per-child working dir (`.nod/runs/<runId>`), reply-as-untrusted-tool-result; `ExecutionScope` (thread→session→turn→run→parentRun→browser) lineage; single trust checker — subagents never ask the owner, they bubble questions back to the parent |
| [cosmicstack-labs/mercury-agent](https://github.com/cosmicstack-labs/mercury-agent) | Durable queue + mail store (SQLite→JSON fallback, leases, DLQ, idempotency keys); `DurableMail` per-bot mailbox (enqueue/drain); append-only owner inbox `inbox.jsonl` + separate read-marks file, rotation caps; `bot_send` fire-and-forget vs task delegation with delivery receipts; spawn-time frozen child permission context; fail-closed auto-deny for non-interactive agents; hard caps enforced at write |
| [google-research/harness2](https://github.com/google-research/harness2) | Subagents as Markdown files (`sub_agents/<name>/AGENT.md`, frontmatter `mode: subagent` + `description:`); validated, advertised in the prompt, invoked via a `task` tool; propose→probe→compose recursion with versioned evidence tree and promotion gates; domain/worker concurrency controls; no mailbox/approval layer |
| [croffasia/itsaplan](https://github.com/croffasia/itsaplan) | Agents as team-scoped rows acting under per-project roles (intersection of role + tool keys); `agent_run` queue with status vs execution state, leases, backoff, terminal failed, instance (default 5) + workspace concurrency limits under advisory locks; typed notification inbox with `readAt`/snooze/actor; state-transition and @mention dispatch; per-attempt transcript caps |

**Memory design references** (design only, not dependencies):
- [microsoft/graphrag](https://github.com/microsoft/graphrag) — graph extraction selectively for document collections; source chunk IDs and exact provenance
- [microsoft/multi-agent-reference-architecture](https://github.com/microsoft/multi-agent-reference-architecture) — separate compact durable semantic facts from searchable episodic history; scope memory by person/project/session; provenance and lifecycle auditable
- [google/adk-python](https://github.com/google/adk-python) — narrow ingest/search interface; SQLite/FTS local baseline; session ingestion explicit, idempotent, scoped by application/user

Research connectors (OpenAlex, GitHub, Yahoo Finance, keyless web/image search) are live HTTP-API tools in the daemon, not MCP endpoints — OpenDots Connections are per-Dot MCP Streamable-HTTP registrations requiring live tool discovery, so registering them as Connections would require deep surgery in forbidden territory; they are surfaced via the daemon-link glue instead.

---

## 10. How We Are Making It — Build & Run

**Merged codebases** (base trees, full copies minus node_modules/.git/dist/data):
- `opendots/` ← CopilotKit/OpenDots @ 46eaf96 (MIT) — the host product, rebranded Aegis
- `openmuse/` ← CopilotKit/openmuse @ a4944f4 (MIT) — integrations/computer surface patterns
- `services/aegis-daemon/` — the AEGIS Python daemon (memory/services layer)
- `tools-bin/` ← obscura 0.2.6 release binaries (Apache-2.0) — second browser engine

**Restructure:** `opendots → apps/host`, `opencode → vendor/opencode`, `openmuse → vendor/openmuse`, `open-research-ana → vendor/open-research-ana`, `services/aegis-daemon → services/daemon`, five markdown docs → `docs/`, Tauri `desktop/` deleted and replaced by Electron shell at `apps/desktop`.

**Build/test commands:**
```sh
cd aegis/apps/host
npm run typecheck   # tsc --noEmit
npm run build       # vite build + tsc server
npm test            # vitest
cd apps/desktop
npm run pack        # electron-builder --dir (or asar repack if builder binary fails)
```

---

## 11. Test Baseline & Release Gates

| Suite | Result |
|-------|--------|
| Host Vitest | 89 files / 517 tests pass |
| Desktop tests | 28/28 pass |
| Host typecheck | Clean |
| Host production build | Pass |
| Host lint | Pass |

**Release status: NOT READY.** Live microphone turn, end-to-end Explorer/browser drag/drop, memory quality, integrations, idle/active resource budgets, multi-monitor/DPI, and installer smoke checks still need evidence before the production gate can pass.

---

## 12. Known Problems & Decision Gates

| Item | Detail |
|------|--------|
| OpenAlex API quota | Shared/egress IP exhaustion (429s) → custom scraper planned |
| GitHub rate limit | 60 req/hr unauthenticated; owner adds `GITHUB_TOKEN` to `.env.local` |
| WhatsApp pairing | QR pairing needs owner's phone on their network; Baileys sidecar at :4312 |
| openmuse sidecar | Blocked by its own code requiring CopilotKit Intelligence key |
| Local models (0.8B–3B) | Not reliably agentic — return conversational text instead of tool calls; `qwen3.5:4b` pull in progress |
| Provider accounts | OpenRouter `:free`-only until topped up; Conduit key rejected (401); TokenHarbor no balance (402); Vercel gateway needs credit card (403); no Anthropic key; Groq free tier 8k TPM |
| Electron desktop | Windows desktop build not yet packaged; start via `npm start` dev shell |

---

## 13. Practicality — What This Means For You

Aegis is built to run **on your machine today**:

- **Windows 11**, AMD Ryzen 7 260, NVIDIA RTX 5050 8 GB, 16 GB DDR5 — no Copilot+ APIs promised (16 TOPS NPU is below the 40 TOPS bar); acceleration via Windows ML / ONNX Runtime with DirectML on the RTX 5050 + 780M, or Foundry Local
- **Local-first:** Everything runs on your laptop; nothing is sent to external providers except the LLM calls you explicitly configure with your own API keys in `.env.local` (placeholders only in the repo — you must supply real keys and rotate them)
- **Voice-first:** Talk to Aegis normally; it talks back through the local voice pipeline (kokoro TTS + faster-whisper STT), not through a hosted Realtime API
- **One app, not a bundle of demos:** Chat, files, memory, research, agents, integrations, desktop shell — all reachable from one sidebar, one conversation thread, one mailbox system

---

*This document is the single source of truth for recreating Aegis. It contains no chat history, no screenshots, and no conversation transcripts — only functionality, references, sources, and build instructions.*

---

## GitHub Repository

**Repository:** https://github.com/Mohitsharma-2007/AEGIS

**What is pushed:** Only `README.md` and source code. All docs, build artifacts, data, secrets, logs, and node_modules are excluded via `.gitignore`.

**To push:**
```sh
cd D:\Aegis 2
git init
git add .
git commit -m "Initial commit: Aegis desktop app with UI fixes"
git remote add origin https://github.com/Mohitsharma-2007/AEGIS.git
git branch -M main
git push -u origin main
```

**What stays local (not pushed):**
- `node_modules/` — dependencies
- `dist/`, `build/`, `release/` — build outputs
- `.env`, `.env.local` — API keys and secrets
- `.aegis-data/` — runtime data (daemon DB, browser secrets, WhatsApp auth)
- `logs/` — application logs
- `ctxmem/context_memory.db` — local Context Memory knowledge graph
- `*.log`, `*.err.log`, `*.out.log` — log files
- `*.bak`, `*.tmp` — backup and temp files
