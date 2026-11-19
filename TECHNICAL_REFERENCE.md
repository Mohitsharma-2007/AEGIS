# Aegis — Technical Reference & Debug Guide

> Single source of truth for manually debugging the Aegis desktop app.
> Every maintained source file is listed with: what it contains, what it links to,
> its logic/code purpose, key functions, and the runtime flow.
>
> Use this alongside `MODIFICATIONS.md` (file-by-file change log) and
> `PLANIT-STATUS.md` (execution status tracker).

---

## Table of Contents

- [Project Structure Overview](#project-structure-overview)
- [Root-Level Files](#root-level-files)
- [Docs Folder](#docs-folder)
- [Host App — Server (`apps/host/src/server`)](#host-app--server)
- [Host App — Client (`apps/host/src/client`)](#host-app--client)
- [Host App — Shared (`apps/host/src/shared`)](#host-app--shared)
- [Desktop Shell (`apps/desktop`)](#desktop-shell)
- [Desktop UI (`apps/desktop/desktop-ui/src`)](#desktop-ui)
- [Cross-File Flow Diagrams](#cross-file-flow-diagrams)
- [Debug Checklist by Symptom](#debug-checklist-by-symptom)

---

## Project Structure Overview

```
D:\Aegis 2\aegis\
├── apps/
│   ├── host/              # Node/Vite host app (UI + API server, port :4310)
│   │   ├── src/
│   │   │   ├── server/    # Hono HTTP API, mail system, swarm, harness, voice
│   │   │   ├── client/    # React frontend (chat, agents, files, memory, settings)
│   │   │   └── shared/    # TypeScript types + schemas shared client/server
│   │   └── public/        # Static assets (penboard.html)
│   └── desktop/           # Electron shell (notch, tray, window lifecycle)
│       ├── main.js
│       ├── preload.js
│       └── desktop-ui/    # Notch React/TSX build source
├── services/daemon/        # Python FastAPI daemon (memory, tools, MCP)
├── docs/                   # Plans, audits, research, handoffs
├── reference-repos/        # Third-party patterns studied (not our code)
├── vendor/                 # Third-party libraries (OpenDots, openmuse, mascot-kit)
├── scripts/                # Build/start scripts
├── data/                   # Runtime data
└── assets/                 # Brand assets
```

**Runtime ports:** Host :4310 · Daemon :8765 · Browser service :4311 · Obscura CDP :9222 · OpenCode harness :4096 · WhatsApp sidecar :4312 · openmuse :8788 (optional)

---

## Root-Level Files

| File | Contains | Linked With | Logic / Purpose | Key Functions | Debug Flow |
|------|----------|-------------|-----------------|---------------|------------|
| `D:\Aegis 2\aegis\start.bat` | Windows batch entry point | `start.ps1`, `start.sh`, host, daemon | Double-click launcher. Loads `.env.local`, ensures Playwright Chromium, fetches OpenCode binary if missing, starts daemon + browser + obscura + WhatsApp + harness sidecars, then host app on :4310. | N/A (batch) | If app won't start: check `host-run.log`, `desktop-launch.out.log/.err.log`, confirm `ELECTRON_RUN_AS_NODE` is unset |
| `D:\Aegis 2\aegis\start.ps1` | PowerShell entry point | `start.bat` | Same as start.bat but PowerShell. Must remain pure ASCII. | N/A | Check execution policy; run as admin if port :4310 is blocked |
| `D:\Aegis 2\aegis\start.sh` | Shell entry point | `start.bat` | Same launcher for bash environments | N/A | Use on WSL/Git Bash |
| `D:\Aegis 2\aegis\run_daemon.bat` | Daemon-only starter | Python daemon (`services/daemon`) | Starts the Python FastAPI daemon on :8765 | N/A | Check `daemon-run.log` |
| `D:\Aegis 2\aegis\run_voice.bat` / `run_voice.ps1` | Voice pipeline starter | `useLocalVoice.ts`, `voiceSession.tsx` | Starts local STT/TTS (faster-whisper + kokoro) | N/A | Check `voice-run.log`, `voice-deps.log` |
| `D:\Aegis 2\aegis\test-computer-tools.mjs` | Computer tool test script | `computer-service.ts`, `computer-routes.ts` | Tests AEGIS Computer (UIA, open_app, screenshot) | N/A | Run to verify computer control works |
| `D:\Aegis 2\aegis\test-shortcut.js` | Shortcut test | Desktop shell | Tests desktop shortcut integration | N/A | Debug shortcut registration |
| `D:\Aegis 2\aegis\check-line.js` / `check-line2.js` | Line-checking utilities | Build scripts | Validates source line counts/formatting | N/A | Used in CI/build |
| `D:\Aegis 2\aegis\.env.example` | Example environment variables | All services | Template for `.env.local` — API keys, provider URLs, tokens | N/A | Copy to `.env.local` and fill real keys |
| `D:\Aegis 2\aegis\.env.local` | Local secrets (user-supplied) | All services | Never committed. Contains API keys (OpenRouter, Groq, etc.), `VOICE_API_KEY`, `GITHUB_TOKEN` | N/A | If providers return 401/402/403, check keys here |
| `D:\Aegis 2\aegis\.gitignore` | Git ignore rules | Git | Excludes node_modules, .venv, dist, build, .aegis-data, logs | N/A | Ensure source changes aren't accidentally ignored |
| `D:\Aegis 2\aegis\host.log` / `host-run.log` / `host-run.log.err` | Host runtime logs | Host app (:4310) | stdout/stderr of the host process | N/A | First place to check when host crashes or API routes fail |
| `D:\Aegis 2\aegis\desktop-launch.out.log` / `.err.log` | Desktop launch logs | Electron shell | stdout/stderr of Aegis.exe | N/A | Check if Electron crashes on startup (pre-existing env issue) |
| `D:\Aegis 2\aegis\host-run.pid` | Host PID file | Host app | Stores running host process ID | N/A | Used to restart/stop host |
| `D:\Aegis 2\aegis\desktop-pack.log` | Desktop pack log | Electron builder | Logs from app.asar repackaging | N/A | Check if `@electron/asar` repack succeeded |
| `D:\Aegis 2\aegis\audit-live.log` | Live audit log | Mail system, server | Append-only audit of mail events | N/A | Check `mail.jsonl` equivalent for sent/read/delete events |

**Key env var:** `ELECTRON_RUN_AS_NODE` must be **unset** before launching `Aegis.exe`, otherwise Electron runs as plain Node and crashes.

---

## Docs Folder

| File | Contains | Linked With | Logic / Purpose | Key Functions | Debug Flow |
|------|----------|-------------|-----------------|---------------|------------|
| `AEGIS-MASTER-PLAN.md` | Master plan, architecture, work assignment | All docs | Single source of truth for what Aegis is, what's built, what's broken, what to do next. Version 13 Nov 2026. | N/A | Read first to understand overall architecture |
| `PLANIT.md` | Working milestone board | `PLANIT-STATUS.md` | November 16–17 product brief. Release scope, constraints, milestone items with acceptance criteria. | N/A | Check which milestones are complete vs pending |
| `PLANIT-STATUS.md` | Execution status tracker | `PLANIT.md` | Each item checked against live API evidence, source code, or test output. Legend: [x] verified · [~] partial · [ ] not done · [?] blocked | N/A | Use to verify release readiness |
| `BUILD_REPORT.md` | Completion build + W-FIX round report | `MODIFICATIONS.md` | Verified state + evidence. W-AI, W-RENAME, W-COMP, W-MEM, W-GEN, W-HARNESS, W-WIN fix rounds. | N/A | Check what was fixed in each round |
| `MODIFICATIONS.md` | File-by-file change log | Every changed file | Logged for EVERY change. Must be updated for every file modification. | N/A | Check here to see what changed recently |
| `AUDIT_REPORT.md` | Audit report | `DESKTOP_APP_AUDIT_REPORT.md` | Security/audit findings | N/A | Check for known vulnerabilities |
| `DESKTOP_APP_AUDIT_REPORT.md` | Desktop app audit | `AUDIT_REPORT.md` | Desktop-specific audit findings | N/A | Check for desktop shell issues |
| `REPAIR-CHECKLIST.md` | Repair checklist | All docs | Status legend: [ ] todo · [~] in progress · [x] done. Browser engine, mascot/voice, computer area, etc. | N/A | Use to track repair progress |
| `ANTIGRAVITY-CONTINUATION-HANDOFF.md` | Continuation handoff | `anti-gravity-handoff.md` | Carries forward implementation context, existing plans, next UI fixes. Notch hover/click, documents tasks. | N/A | Read when resuming work after a break |
| `THIRD_PARTY.md` | Third-party code licences | All vendor code | OpenDots, openmuse, CopilotKit, obscura, Baileys, open-research-ANA | N/A | Check licence compliance |
| `WINDOWS_VOICE_ACCESS.md` | Windows Voice Access bridge docs | `services/daemon/aegis_daemon/windows_bridge.py` | WinRT recogniser + TTS on port 8767. Cannot embed Voice Access directly; uses public WinRT API instead. | N/A | Debug voice recognition on Windows |
| `MEMORY-RESEARCH.md` | Memory research | `memory-document-service.ts`, `store.ts` | GraphRAG, multi-agent, ADK memory design references | N/A | Understand memory layer design |
| `AEGIS_MODEL_ROSTER.md` | Model roster | `providers.ts` | List of models and providers | N/A | Check which models are configured |
| `agent-test-runs.md` | Agent test runs | Test suite | Records of agent test executions | N/A | Check test history |
| `agentic-test-cases.md` | Agentic test cases | Test suite | Test cases for agent behavior | N/A | Use for testing agent flows |
| `model-bench-results.json` | Model benchmark results | `providers.ts` | Benchmark data for models | N/A | Compare model performance |
| `MILESTONE-TASKS.md` | Milestone tasks | `PLANIT.md` | Task breakdown per milestone | N/A | Track milestone completion |

---

## Host App — Server (`apps/host/src/server`)

The server is a Hono-based HTTP API running on port :4310. It handles mail, agents, swarm, harness, computer control, voice, research, connections, marketplace, memory documents, OAuth, WhatsApp, shortcuts, hooks, sandbox, and page routes.

| File | Contains | Linked With | Logic / Purpose | Key Functions | Debug Flow |
|------|----------|-------------|-----------------|---------------|------------|
| `app.ts` | Hono app setup, route mounting | All `*-routes.ts` files | Creates the Hono app, mounts body limit, CORS, CSP (via `app-origin.ts`), and all route modules. Sets up global store. | `app` (Hono instance), route registration | If API routes return 404, check route is mounted here |
| `app-origin.ts` | CSP header configuration | `app.ts` | Content Security Policy: `frame-ancestors 'self'`, `/penboard` inline scripts allowed | CSP headers | Check if penboard/iframe content is blocked |
| `mailbox.ts` | Markdown mail core | `mail-routes.ts`, `mail-orchestrator.ts` | In-app mail simulation. Addresses: `user@aegis`, `orchestrator@aegis`, `agent/<slug>@aegis`. Files: `<messageId>.md` with YAML frontmatter envelope + markdown body. `inbox/`, `sent/`, `archive/`, `reads.json` per mailbox. Caps: 1000 messages, 25 MB per mailbox. Audit: `mail.jsonl`. | `sendMail()`, `readMail()`, `listMailbox()`, `listThreads()`, `unreadCount()`, `markRead()`, `deleteMail()`, `parseMail()`, `serializeMail()`, `mailboxPaths()`, `agentAddress()`, `normalizeAddress()`, `enforceMailboxCap()`, `enforceMailboxBytes()`, `appendAudit()` | If mail not appearing: check `.aegis-data/agent-swarm/mailboxes/` inbox/sent dirs, check `reads.json`, check `mail-processed.json` |
| `mail-routes.ts` | Mail API routes (Hono) | `mailbox.ts`, `agent-swarm.ts` | Routes: `GET /mail/agents` (roster), `GET /mail/me` (unread+threads), `GET /mail/inbox`, `GET /mail/thread`, `GET /mail/message/:id`, `POST /mail/send`, `DELETE /mail/:id` | `mailRoutes()` Hono app | Test with curl: `GET http://localhost:4310/mail/me?address=user@aegis` |
| `mail-orchestrator.ts` | Orchestrator mail consumer | `mailbox.ts`, `agent-swarm.ts`, `harness.ts` | Background loop polling orchestrator inbox every 2s. Dispatches unread `task` mail to swarm task runner. Sends `report` mail back on same thread when task reaches terminal status. Crash-safe via `mail-processed.json` index. Max 2 concurrent. | `startMailOrchestrator()`, `sweep()`, `dispatchOne()`, `reportCompleted()`, `buildReportMarkdown()` | If task mail isn't processed: check orchestrator inbox, check `mail-processed.json`, verify swarm dispatch function is wired |
| `agent-swarm.ts` | Agent orchestration runtime | `mail-orchestrator.ts`, `harness.ts`, `providers.ts` | One task → orchestrator plan → specialist evidence gathering → synthesis → report. Roster uses owner's configured provider chain. Evidence from live services (finance/news connectors, workspace pages, memories, computer permissions/audit). Task state persisted under `.aegis-data/agent-swarm/`. | `AgentSwarm` class, `SwarmAgentId`, `SwarmTask`, `SwarmSubtask`, `SWARM_ROSTER`, `dispatchTask()`, `getTask()` | If swarm doesn't respond: check provider config, check `.aegis-data/agent-swarm/` persistence |
| `harness.ts` | Native execution harness | `agent-swarm.ts`, `harness-routes.ts`, `computer-service.ts` | W-HARNESS: Node / Python / Shell / Tools engine with explicit approval gates. No sidecar binary, no external harness port. `aegisRootDir()` finds product root. | `aegisRootDir()`, `spawn` (child_process), `httpRequest`/`httpsRequest` | If tool execution fails: check harness routes, check approval gates |
| `harness-routes.ts` | Harness API routes | `harness.ts` | Routes for harness control and status | `harnessRoutes()` | Test harness endpoints |
| `providers.ts` | Model provider registry | `agent-swarm.ts`, `app.ts` | 238 providers from models.dev (vendored + live). Mohit's 6 pinned: OpenRouter (default), Groq, NVIDIA NIM, Conduit, TokenHarbor, Vercel AI Gateway. OpenAI-compatible and Anthropic-compatible endpoints. User pastes keys in `.env.local`. | `PROVIDERS`, `listProviders()`, `providerBaseUrl()`, `anthropicSdkBaseUrl()`, `envValue()` | If model calls fail: check provider config, check API keys in `.env.local`, check rate limits (Groq 8k TPM, GitHub 60 req/hr) |
| `computer-service.ts` | Computer use, UIA, open_app | `computer-routes.ts`, `computer-store.ts`, `browser-launch.ts`, `agent-desktop.ts` | Local computer mode: Playwright browser sessions, UIA automation, screen capture, take/release control, audit trail. Sessions tracked in `localSessions` map. | `control()`, `localStart()`, `localStop()`, `json()` (HTTP to computer service), `supervisor()` | If computer control fails: check Playwright Chromium install, check UIA permissions, check `computer-service.ts:429` session lookup |
| `computer-routes.ts` | Computer API routes | `computer-service.ts` | Routes for computer control, screen, browser, files, terminal, activity | `computerRoutes()` | Test computer endpoints |
| `voice.ts` | Voice pipeline routes | `useLocalVoice.ts`, `voiceSession.tsx` | Voice API endpoints for STT/TTS | `voiceRoutes()` | If voice fails: check local STT/TTS deps, check `VOICE_API_KEY` |
| `free-api-routes.ts` | Free API routes (finance/news) | `research-web.ts` | Google Finance, Yahoo Finance, Google News clones with rate-limit handling | `freeApiRoutes()` | If finance/news returns empty: check rate limits, check endpoints |
| `research-web.ts` | Research web connectors | `free-api-routes.ts` | OpenAlex, GitHub, Yahoo Finance, keyless web/image search | Research connector functions | If research returns empty: check API quotas (OpenAlex 429s) |
| `research.ts` | Research engine | `research-web.ts` | Research synthesis and brief generation | Research functions | Check research output quality |
| `workspace.ts` | Workspace management | `workspace-routes.ts` | Workspace pages, spaces, documents | Workspace functions | Check workspace data |
| `workspace-routes.ts` | Workspace API routes | `workspace.ts` | File surface routes, preview endpoints, DOCX/ODT extraction | `workspaceRoutes()` | Test workspace endpoints |
| `store.ts` | Memory document store | `memory-document-service.ts`, `memory-document-routes.ts` | SQLite store with `tier` column. Save/update memory documents. | `setGlobalStore()`, memory document CRUD | If memory search fails: check SQLite, check tier filters |
| `memory-document-service.ts` | Memory document service | `store.ts`, `memory-document-routes.ts` | Unified search, STAIR tree, RAG snippet display, tier patch | `startMemoryReconciler()` | If RAG returns no results: check `rag_enabled` setting, check document indexing |
| `memory-document-routes.ts` | Memory document API routes | `memory-document-service.ts` | Routes for memory documents, tier filters | `memoryDocumentRoutes()` | Test memory endpoints |
| `memory-agent.ts` | Memory agent | `memory-document-service.ts` | Agent for memory operations | Memory agent functions | Check memory agent behavior |
| `aegis-memory-routes.ts` | Aegis memory routes (4-layer) | `store.ts`, `memory-document-service.ts` | L1 Captures → L2 Hybrid RAG → L3 STAIR tree → L4 Temporal graph | Memory route handlers | Check memory layer status |
| `connections.ts` | Connection management | `connection-routes.ts`, `connection-store.ts`, `connection-tools.ts` | WhatsApp QR pairing, integrations, sidecars | Connection functions | If WhatsApp pairing fails: check Baileys sidecar on :4312 |
| `connection-routes.ts` | Connection API routes | `connections.ts` | Routes for connections and sidecars | `connectionRoutes()` | Test connection endpoints |
| `oauth.ts` | OAuth handling | `oauthRoutes()` | OAuth providers (Google Workspace, etc.) | `oauthRoutes()` | Check OAuth flow |
| `composio.ts` / `composio-tools.ts` | Composio integration | `connections.ts` | Composio tools and integrations | Composio functions | Check Composio status |
| `marketplace-routes.ts` | Marketplace routes | `marketplace-data.ts` | Marketplace panel data | `marketplaceRoutes()` | Test marketplace endpoints |
| `shortcuts.ts` | Shortcuts | `shortcutsRoutes()` | Desktop shortcuts | `shortcutsRoutes()` | Check shortcut registration |
| `hooks.ts` | Hooks | `hooksRoutes()` | Webhook handling | `hooksRoutes()` | Check webhook delivery |
| `sandbox.ts` | Sandbox routes | `sandboxRoutes()` | Sandboxed execution | `sandboxRoutes()` | Check sandbox isolation |
| `capabilities.ts` | Capabilities | Agent capabilities | Capability definitions | Capability functions | Check agent capabilities |
| `catalogue.ts` | Provider catalogue | `providers.ts` | Model catalogue from models.dev | Catalogue functions | Check catalogue loading |
| `platform-config.ts` | Platform config | All server files | Platform configuration, computerMode (local default) | `computerModeFromEnv()` | Check platform settings |
| `platform.ts` | Platform abstraction | `platform-config.ts` | Platform-specific code | Platform functions | Check platform compatibility |
| `env-store.ts` | Environment store | All server files | Environment variable storage | Env store functions | Check env var values |
| `documents.ts` | Document handling | `workspace-routes.ts` | Document CRUD | Document functions | Check document operations |
| `dot-agent.ts` | Dot agent | `AgentsPanel.tsx` | Dot (OpenDots) agent representation | Dot agent functions | Check dot agent status |
| `agent-routes.ts` | Agent API routes | `agent-swarm.ts` | Routes for agent management | `agentRoutes()` | Test agent endpoints |
| `agent-sdk-client.ts` | Agent SDK client | `agent-swarm.ts` | CopilotKit/AG-UI client | SDK client functions | Check SDK connection |
| `agent-desktop.ts` / `agent-desktop-annotations.ts` | Agent desktop annotations | `computer-service.ts` | Desktop annotation types | Annotation functions | Check annotation types |
| `aegis-daemon.ts` | Aegis daemon glue | `services/daemon` | Python daemon integration | Daemon functions | Check daemon connection |
| `browser-launch.ts` | Browser launch | `computer-service.ts` | Playwright launch ladder (bundled Chromium → full build → Edge → Chrome → custom path) | `launchPersistentWithFallback()` | If browser won't launch: check Chromium install, check launch ladder |
| `headless.ts` | Headless mode | `browser-launch.ts` | Headless browser operation | Headless functions | Check headless config |
| `index.ts` | Server index | `app.ts` | Server entry point | Server startup | Check server startup logs |
| `keyless-search.ts` | Keyless search | `research-web.ts` | Search without API keys | Search functions | Check search results |
| `learning.ts` | Learning system | `memory-agent.ts` | Agent learning | Learning functions | Check learning data |
| `log.ts` | Logging | All server files | Centralized logging | `log.info()`, `log.warn()`, `log.error()` | Check `host.log` for log output |
| `mcp-config.ts` | MCP config | `connections.ts` | MCP server configuration | MCP config functions | Check MCP server status |
| `models-dev.json` | Models.dev snapshot | `providers.ts` | Vendored models.dev provider catalogue | Catalogue data | Check if catalogue is up to date |
| `office-tools.ts` | Office tools | `connections.ts` | Microsoft Office 365 COM tools | Office tool functions | Check Office integration |
| `page-routes.ts` / `page-service.ts` / `page-tools.ts` / `pages.ts` | Page routes | `PageDocument.tsx`, `PageConversation.tsx` | Workspace pages, page navigation | Page functions | Check page routing |
| `parallel.ts` | Parallel execution | `agent-swarm.ts` | Parallel task execution | Parallel functions | Check parallel task handling |
| `runtime-scope.ts` | Runtime scope | `agent-swarm.ts` | Execution scope (thread→session→turn→run) | Scope functions | Check scope tracking |
| `runner.ts` | Task runner | `agent-swarm.ts` | Task execution runner | Runner functions | Check task runner |
| `setup-telemetry.ts` | Setup telemetry | `app.ts` | Telemetry for setup | Telemetry functions | Check telemetry data |
| `slack-channel.ts` | Slack channel | `connections.ts` | Slack integration | Slack functions | Check Slack status |
| `stair-indexer.ts` | STAIR indexer | `memory-document-service.ts` | STAIR tree indexing | Indexer functions | Check STAIR tree |
| `subagents.ts` | Subagents | `agent-swarm.ts` | Subagent management | Subagent functions | Check subagent behavior |
| `tanstack-tools.ts` | Tanstack tools | `agent-swarm.ts` | Tanstack AI tools | Tool functions | Check Tanstack integration |
| `whatsapp-routes.ts` | WhatsApp routes | `connections.ts` | WhatsApp Web API routes | `whatsappRoutes()` | Check WhatsApp QR pairing |

---

## Host App — Client (`apps/host/src/client`)

The React frontend (Vite) running in the host app. Handles chat, agents, files, memory, research, settings, voice UI, generative UI cards, pen board, and all user-facing views.

| File | Contains | Linked With | Logic / Purpose | Key Functions | Debug Flow |
|------|----------|-------------|-----------------|---------------|------------|
| `App.tsx` | Shell geometry, voice-command regex, sidebar transient collapse | `Chat.tsx`, `voiceSession.tsx`, `InlineVoiceBar.tsx` | Top-level app. Sidebar width (RAIL_WIDTH constant, sidebar left:52px, workspace margin = rail + sidebarWidth). Sidebar auto-collapse made transient (restores saved preference when returning to chat/pages). Voice-command regex fixed (`/\b(?:open\|show\|go to)\s+…/`). `/call` silent no-op fix in browser-only mode (shows error instead of silently doing nothing). | `App()` component | If sidebar geometry is wrong: check RAIL_WIDTH, check sidebar left:52px. If voice commands don't work: check regex pattern |
| `Chat.tsx` | Chat composer, voice, file attachments, `aegis_penboard` frontend tool | `voiceSession.tsx`, `InlineVoiceBar.tsx`, `api.ts`, `PenBoardPanel.tsx`, `visual-ui.ts` | Main chat interface. Message persistence, provider failover, breadcrumbs, adaptive polling (3s → ×1.7 → max 20s), offline banner with retry. File attachments (images ≤4MB, text-like files, DOCX/ODT extraction). `wasInlineVoice` ref added to stop shared session on `inlineVoice: true → false`. Mic button fix: disabled guard for paused/unready/contextNotReady + calls `stopSharedVoice()` before starting. | `Chat()` component, `attachmentFromFile()` | If chat voice switches back to text while listening: check `wasInlineVoice` ref. If mic button hangs: check disabled guard |
| `ChatTranscript.tsx` | Chat transcript rendering | `Chat.tsx` | Renders chat messages, voice receipts | `isInternalVoiceReceipt()` | Check transcript rendering |
| `useLocalVoice.ts` | Local voice session hook | `voiceSession.tsx`, `InlineVoiceBar.tsx` | Voice phase state machine: idle → connecting → warming → listening → thinking → speaking → error. Sentence segmentation, punctuation stripping, VAD, interruption/mute, task-continuation. | `useLocalVoice()`, `VoicePhase`, `VoiceAction`, `VoiceLine` | If voice doesn't stay active: check phase transitions. If TTS speaks punctuation: check punctuation stripping |
| `voiceSession.tsx` | Shared voice session | `useLocalVoice.ts`, `Chat.tsx`, `InlineVoiceBar.tsx` | One voice session for the whole app. Microphone, WebSocket, tool bridge belong to the shell, not one screen. Moving to Computer, Files, Settings, or Integrations must not disconnect voice or drop a reply. | `VoiceSessionProvider()`, `useVoiceSession()` | If voice drops when switching screens: check VoiceSessionProvider |
| `InlineVoiceBar.tsx` | Inline voice bar UI | `voiceSession.tsx`, `useLocalVoice.ts`, `Mascot.tsx` | OwnsSession guard, shell vs local. Shows mic status, phase, mascot pill. | `InlineVoiceBar()` component | If voice bar doesn't update: check ownsSession guard |
| `InlineVoiceBar.tsx` (wasInlineVoice fix) | `wasInlineVoice` ref | `Chat.tsx` | Stops shared session on `inlineVoice: true → false` transition | `wasInlineVoice` ref | Check this ref if voice session isn't stopped |
| `AgentsWorkspace.tsx` | Agents page: Queries / Team / Harness tabs | `AgentMailPanel.tsx`, `HarnessPanel.tsx`, `api.ts` | Rebuilt around mail, not task board. Queries = mail threads (read/reply/delete, unread counts). Team = roster capability cards (Aegis, RFI, Sentinel, Filo, Memo, Operator). Harness = native engine status. | `AgentsWorkspace()` component | If task board remnants exist: check this file. Verify no task board code remains |
| `AgentMailPanel.tsx` | Mail UI: thread list, message detail, reply composer | `api.ts`, `mail-routes.ts` | Split-pane: left = thread list with unread badges; right = message detail with kind badge, from/to, subject, markdown body; bottom = reply composer preserving threadId/inReplyTo/taskId. `AgentSendComposer` for sending task mail. | `AgentMailPanel()`, `AgentSendComposer()` | If mail UI doesn't show threads: check `/mail/me` API |
| `HarnessPanel.tsx` | Harness tab content | `AgentsWorkspace.tsx` | Native engine status, runtimes, tool set, MCP server enable/disable | `HarnessPanel()` component | Check harness status display |
| `api.ts` | API client functions | All client components | Fetch wrapper with auth token, `ApiError` class, `OFFLINE_MESSAGE`. Functions: `getProviders()`, `getProviderModels()`, `selectProvider()`, `getAgents()`, mail API functions, memory document API functions | `api()`, `setToken()`, `ApiError`, `getProviders()`, `selectProvider()`, `getAgents()` | If API calls fail: check token in sessionStorage, check `OFFLINE_MESSAGE` |
| `Mascot.tsx` | Mascot component | `MascotPet.tsx`, `voiceSession.tsx` | Animated mascot (Aegis character) with states: idle, listening, speaking, thinking, working, error | `Mascot()` component | If mascot doesn't animate: check state transitions |
| `MascotPet.tsx` | Mascot pet | `Mascot.tsx` | Pet transitions, scale animation to larger mascot (280px) | `MascotPet()` component | Check mascot pet animation |
| `emitMascot` (from MascotPet) | Mascot event emitter | `Chat.tsx` | Emits mascot state changes | `emitMascot()` | Check mascot event flow |
| `FilesSurfaceView.tsx` | File manager | `workspace-routes.ts`, `api.ts` | File surface: sorting, DOCX/ODT preview, category pills, live search, bounded previews (64 KB text), strict UTF-8 decoding | `FilesSurfaceView()` component | If file preview shows garbage: check UTF-8 decoding |
| `PenBoardPanel.tsx` | Pen board panel | `Chat.tsx`, `annotations.html`, `public/penboard.html` | In-app modal overlay for annotations. Toolbar: Pythagoras / Shapes / Clear. Slash commands `/draw <topic>` and `/whiteboard`. Frontend tool `aegis_penboard({ demo: 'pyth' \| 'shapes' })`. | `PenBoardPanel()`, `openPenBoard()`, `closePenBoard()` | If pen board doesn't open: check `/draw` slash command, check `aegis_penboard` tool |
| `visual-ui.css` | Generative UI styles | `VisualCards.tsx` | CSS for visual cards: entry animation, themed with app tokens, respects prefers-reduced-motion | CSS classes | Check visual card styling |
| `VisualCards.tsx` | Generative UI cards | `visual-ui.ts`, `visual-ui.css` | Renderers for model's generative UI: chart line/area/bar, stats, table, timeline, callout, progress, gallery, code (up to 6 blocks). | `parseVisualSpec()`, `VisualUiCard`, `ResearchBriefCard`, `FencedChart` | If visual cards don't render: check spec validation |
| `shared/visual-ui.ts` | Generative UI spec | `VisualCards.tsx`, `Chat.tsx` | Strict, bounded visual spec schema (zod). No z.record, no free-form props. `visualUiSchema`, `visualUiTool`, `show_visual` tool | `visualUiSchema`, `visualUiTool()` | If visual spec is rejected: check zod validation |
| `RichMarkdown.tsx` | Rich markdown rendering | `Chat.tsx` | Renders markdown with ReactMarkdown, remark-gfm | RichMarkdown component | Check markdown rendering |
| `RunTrace.tsx` | Run trace | `Chat.tsx` | Inline run trace, characterForToolOrSubagent | `InlineRunTrace`, `characterForToolOrSubagent()` | Check run trace display |
| `GenerativeCards.tsx` | Generative cards | `Chat.tsx` | BrowserActivityCard, MemorySourcesCard, ProviderStatusCard | Card components | Check card rendering |
| `MemoryPanel.tsx` | Memory panel | `api.ts`, `store.ts` | Tier filters (All/long/short), toggle, RAG snippet display (capped 1,200 chars, `is_snippet` flag) | `MemoryPanel()` component | If memory tier filter doesn't work: check `tier` column |
| `SettingsForm.tsx` | Settings | `api.ts`, `providers.ts` | Provider/model/permissions/appearance, environment accordion, assistant cards, live theme switching | `SettingsForm()` component | If provider selection doesn't persist: check settings |
| `theme.ts` | Theme | `SettingsForm.tsx` | System/light/dark theme switching | Theme functions | Check theme switching |
| `style.css` | Global styles | All client components | App tokens, CSS variables | CSS variables | Check styling |
| `main.tsx` | React entry | `App.tsx` | React app entry point | `main()` | Check React mount |
| `ComputerPanel.tsx` | Computer panel | `computer-service.ts` | AEGIS Computer surface: live screen, take/release, audit | `ComputerPanel()` component | Check computer panel |
| `ComputerToolCard.tsx` | Computer tool card | `ComputerPanel.tsx` | Tool card for computer actions | `ComputerToolCard()` component | Check tool card |
| `ResearchPanel.tsx` | Research panel | `research.ts`, `research-web.ts` | Research brief display | `ResearchPanel()` component | Check research panel |
| `ResultPane.tsx` | Result pane | `Chat.tsx` | Result display pane | `ResultPane()` component | Check result pane |
| `ThreadList.tsx` | Thread list | `Chat.tsx` | Conversation thread list | `ThreadList()` component | Check thread list |
| `SpaceWorkspace.tsx` / `SpaceNav.tsx` / `SpaceLibrary.tsx` | Space workspace | `App.tsx` | Workspace navigation | Space components | Check workspace nav |
| `ActivityView.tsx` | Activity view | `computer-service.ts` | Activity monitoring | `ActivityView()` component | Check activity view |
| `CompanionPanel.tsx` | Companion panel | `OpenDuet` patterns | Proactive companion behavior | `CompanionPanel()` component | Check companion panel |
| `IntegrationsView.tsx` | Integrations view | `connections.ts` | Integrations UI | `IntegrationsView()` component | Check integrations |
| `MarketplacePanel.tsx` | Marketplace panel | `marketplace-routes.ts` | Marketplace UI | `MarketplacePanel()` component | Check marketplace |
| `ToolsPluginsPanel.tsx` | Tools & plugins | `tanstack-tools.ts` | Tools and plugins UI | `ToolsPluginsPanel()` component | Check tools panel |
| `OpsView.tsx` | Ops view | System logs | Operations view | `OpsView()` component | Check ops view |
| `ServicesStatus.tsx` | Services status | `app.ts` | Service status indicators | `ServicesStatus()` component | Check service status |
| `ConnectionActionCard.tsx` | Connection action card | `connections.ts` | Connection action UI | `ConnectionActionCard()` component | Check connection card |
| `ConnectionsSection.tsx` | Connections section | `connections.ts` | Connections section UI | `ConnectionsSection()` component | Check connections section |
| `OAuthSettingsCard.tsx` | OAuth settings card | `oauth.ts` | OAuth settings UI | `OAuthSettingsCard()` component | Check OAuth settings |
| `BrowserPreviewContext.tsx` | Browser preview context | `Chat.tsx` | Live page preview context | `BrowserPreviewContext`, `previewKey` | Check browser preview |
| `PageConversation.tsx` / `PageDocument.tsx` / `PageOutline.tsx` / `PageReviewCard.tsx` / `page-chat-requests.ts` / `page-context.ts` / `page-navigation.ts` / `page-review-decision.ts` / `page-snapshots.ts` | Page system | `page-routes.ts`, `page-service.ts` | Workspace pages, page conversation, page review | Page components | Check page system |
| `PromptDialog.tsx` | Prompt dialog | `Chat.tsx` | Prompt dialog | `PromptDialog()` component | Check prompt dialog |
| `read-aloud.ts` | Read aloud | `useLocalVoice.ts` | Read aloud functionality | Read aloud functions | Check read-aloud |
| `sounds.ts` | Sounds | `MascotPet.tsx` | Sound cues | `playCue()` | Check sound playback |
| `poll-notice.ts` | Poll notice | `App.tsx` | Adaptive polling notice | Poll notice functions | Check polling |
| `chat-composer.ts` | Chat composer | `Chat.tsx` | Composer logic, `shouldSubmitComposerOnKeyDown` | `shouldSubmitComposerOnKeyDown()` | Check composer submission |
| `browser-preview-context.ts` | Browser preview context | `Chat.tsx` | Browser preview context | Preview context functions | Check preview context |
| `page-context.ts` | Page context | Page system | Page context helper | `contextualMessage()` | Check page context |
| `635+1` | Unknown file | - | Possibly a data file | - | Investigate this file |
| `editor/` | Editor subfolder | - | Editor-related files | - | Check editor files |
| `editor.css` | Editor styles | `editor/` | Editor CSS | CSS classes | Check editor styling |
| `ErrorBoundary.tsx` | Error boundary | All client components | React error boundary | `ErrorBoundary()` component | Check error boundaries |
| `BrandIcons.tsx` | Brand icons | All client components | Brand icon components | Icon components | Check brand icons |
| `CallView.tsx` | Call view | `voice.ts` | Call interface | `CallView()` component | Check call view |
| `ActivityView.tsx` | Activity view | `computer-service.ts` | Activity view | `ActivityView()` component | Check activity view |

---

## Host App — Shared (`apps/host/src/shared`)

TypeScript types and schemas shared between client and server.

| File | Contains | Linked With | Logic / Purpose | Key Functions | Debug Flow |
|------|----------|-------------|-----------------|---------------|------------|
| `visual-ui.ts` | Generative UI spec | `VisualCards.tsx`, `Chat.tsx` | Strict, bounded visual spec schema (zod). No z.record, no free-form props. Series points, series, blocks (chart/stat/table/timeline/callout/progress/gallery/code). Up to 6 blocks per spec. | `visualUiSchema`, `visualUiTool`, `parseVisualSpec()`, `seriesPoint`, `series`, `VisualBlock`, `VisualUiSpec` | If visual spec validation fails: check zod schema constraints |
| `computer-types.ts` | Computer types | `computer-service.ts` | `computerInputs`, `computerPermissionsSchema`, `ComputerAction`, `ComputerControl`, `ComputerStatus` | Type definitions | Check computer type definitions |
| `types.ts` | Shared types | `Chat.tsx`, `api.ts` | `CallReceipt`, `Conversation`, `Dot`, `Result`, `CatalogueProviderOption`, `ProviderOption`, `SetupStatus` | Type definitions | Check shared types |

---

## Desktop Shell (`apps/desktop`)

The Electron shell wrapper around the host app. Connects to `http://127.0.0.1:4310`. Adds desktop-native surfaces: Notch, Tray, mutual exclusivity, voice OS.

| File | Contains | Linked With | Logic / Purpose | Key Functions | Debug Flow |
|------|----------|-------------|-----------------|---------------|------------|
| `main.js` | Desktop shell, notch/tray lifecycle, mutual exclusivity, `syncDesktopSurfaces` | `preload.js`, `notch.html`, `desktop-ui/` | Electron main process. Creates main window loading host on :4310. Notch window (always interactive, no click-through), tray (click-only flyout). Mutual exclusivity: app focused → notch+tray step aside; app blurred/minimized → notch returns. Voice auto-open suppressed while app is foreground. | `createMainWindow()`, `createNotchWindow()`, `createTray()`, `syncDesktopSurfaces()` | If Electron crashes: `ELECTRON_RUN_AS_NODE` must be unset. If notch/tray doesn't appear: check `main.js` window creation |
| `preload.js` | Preload script | `main.js` | Electron preload: exposes safe APIs to renderer, bridges IPC | `contextBridge`, `ipcRenderer` | Check preload exposed APIs |
| `notch.html` | Maintained notch UI source (HTML) | `NotchApp.tsx`, `build-notch.mjs` | HTML template for notch (being replaced by TSX) | - | Check notch HTML if TSX build fails |
| `overlay.html` | Overlay HTML | `main.js` | Overlay window HTML | - | Check overlay |
| `tray-pill.html` | Tray pill HTML | `main.js` | Tray pill HTML | - | Check tray pill |
| `widgets.html` | Widgets HTML | `main.js` | Widgets HTML | - | Check widgets |
| `annotations.html` | Annotation layer HTML | `PenBoardPanel.tsx`, `public/penboard.html` | Full-screen transparent click-through teaching layer. Hand-drawn pen strokes, cursor riding tip, labels, callouts, step captions. | - | If annotations don't render: check `annotations.html` |
| `clipboard-history.js` | Clipboard history | `main.js` | Clipboard history management | Clipboard functions | Check clipboard history |
| `file-tray.js` | File tray | `main.js` | File tray drop/import logic | File tray functions | Check file tray |
| `loading.html` | Loading HTML | `main.js` | Loading screen HTML | - | Check loading screen |
| `media-session.ps1` | Media session | `main.js` | PowerShell media session script | - | Check media session |
| `coding-processes.ps1` | Coding processes | `main.js` | PowerShell coding processes script | - | Check coding processes |
| `package.json` | Desktop package config | `main.js` | Electron app config, dependencies, scripts | - | Check package.json |
| `package-lock.json` | Lock file | `package.json` | Dependency lock | - | Check lock file |
| `README.md` | Desktop README | - | Desktop app documentation | - | Check desktop README |
| `showcase.html` | Showcase HTML | `main.js` | Showcase page | - | Check showcase |

**Notch geometry:** Collapsed 300 × 38 → Expanded 620 × 300. CSS-variable geometry. No width transitions. Window never sweeps sideways. Hover does not resize native window. Click to toggle instantly, hover to expand after dwell delay.

**Tray:** Click-only flyout (no hover pop). Stays hidden while app window is foreground. Returns when minimized/hidden. Avatar unread badge (caps at 9+). Dynamic icon per agent state.

**Mutual exclusivity:** App focused → notch and tray flyout step aside. App blurred/minimized → notch returns. Tray stays available for reopen. Voice auto-open of notch suppressed while app is foreground.

---

## Desktop UI (`apps/desktop/desktop-ui/src`)

Notch React/TSX build source. Built to `desktop-ui.zip` → `ui-kit/notch.html` (packaged notch).

| File | Contains | Linked With | Logic / Purpose | Key Functions | Debug Flow |
|------|----------|-------------|-----------------|---------------|------------|
| `NotchApp.tsx` | React notch component | `main.tsx`, `ipc.ts`, `notch.css` | New React notch component replacing HTML template. Glassmorphism redesign (Droppy/NotchNook: glass surfaces, blur, vibrant colors, rounded corners). Island renders with correct classes. | `NotchApp()` component | If notch doesn't render: check TSX build, check `notch.css` classes |
| `main.tsx` | React entry | `NotchApp.tsx` | React entry point for notch | `main()` | Check React mount for notch |
| `ipc.ts` | Typed IPC bridge | `NotchApp.tsx`, `main.js` | Typed IPC bridge between notch and Electron main | IPC functions | Check IPC communication |
| `notch.css` | Notch styles | `NotchApp.tsx` | Notch styles: glassmorphism, blur, vibrant colors, rounded corners | CSS classes | Check notch styling |
| `build-notch.mjs` | Build script | `NotchApp.tsx`, `main.tsx` | Build script for notch TSX → JS + CSS | Build functions | Check build output (240KB JS, 9.9KB CSS) |
| `core.js` | Shared notch runtime | `notch.css`, `NotchApp.tsx` | Shared notch runtime, mascot gaze (coalesced to rAF at 120ms) | Core functions | Check mascot gaze animation |
| `mascot.js` | Mascot | `core.js` | Desktop mascot logic | Mascot functions | Check mascot behavior |
| `cards.js` | Cards | `NotchApp.tsx` | Notch generative cards | Card functions | Check card rendering |
| `lib.js` | Library | `core.js` | Shared library functions | Lib functions | Check lib functions |
| `annotations.html` | Annotations HTML | `NotchApp.tsx` | Notch annotations | - | Check annotations |
| `overlay.html` | Overlay HTML | `NotchApp.tsx` | Notch overlay | - | Check overlay |
| `showcase.html` | Showcase HTML | `NotchApp.tsx` | Notch showcase | - | Check showcase |
| `tray-pill.html` | Tray pill HTML | `NotchApp.tsx` | Notch tray pill | - | Check tray pill |
| `widgets.html` | Widgets HTML | `NotchApp.tsx` | Notch widgets | - | Check widgets |
| `ui-kit/notch.html` | Packaged notch | `build-notch.mjs` | Regenerated from build | - | Check packaged notch |

**Build output:** 240KB JS, 9.9KB CSS. Probe verified island renders with correct classes.

**Packaged notch/tray/drop interaction:** Not verifiable live in this env (Electron crashes on startup — pre-existing). `node --check main.js` passes. Must verify on owner's machine.

---

## Cross-File Flow Diagrams

### Flow 1: Mail Task Flow (Owner → Orchestrator → Agent → Report)

```
Owner types task in AgentSendComposer (AgentsWorkspace.tsx)
    │
    ▼
POST /mail/send  →  mailbox.ts sendMail()
    │  writes to: user@aegis/sent/ + orchestrator@aegis/inbox/ + audit/mail.jsonl
    ▼
MailOrchestrator polls every 2s (mail-orchestrator.ts sweep())
    │  filters: unread, kind=task, max 2 concurrent
    ▼
dispatchTask() → AgentSwarm creates task
    │  recorded in mail-processed.json (crash safety)
    ▼
AgentSwarm: plan → specialist evidence → synthesis → report
    │  evidence from: finance/news connectors, workspace, memories, computer audit
    ▼
Task reaches terminal (completed/failed/cancelled)
    ▼
reportCompleted() → sendMail(kind=report, same threadId, inReplyTo=original)
    │  written to: orchestrator@aegis/sent/ + user@aegis/inbox/
    ▼
Owner sees report in AgentMailPanel thread detail (ReactMarkdown body)
```

### Flow 2: Voice Flow (Mic → STT → LLM → TTS)

```
User clicks Mic (InlineVoiceBar.tsx / Chat.tsx)
    │
    ▼
useLocalVoice() phase: idle → connecting → warming → listening
    │  VAD: only opens mic when speech detected
    ▼
STT: faster-whisper (local) transcribes audio
    ▼
LLM: configured provider (VOICE_API_KEY / VOICE_MODEL)
    ▼
TTS: kokoro (local) synthesizes reply
    │  SSML/prosody: pauses, emphasis, rate, pitch
    │  Punctuation stripping: no speaking **$, ?, #, *, _, etc.
    ▼
Phase: speaking → idle
    │  Interruption: user can interrupt mid-sentence
    ▼
Voice turn persists to current thread (task-continuation)
```

### Flow 3: Notch Toggle Flow

```
User clicks notch island (300×38)
    │
    ▼
main.js createNotchWindow() toggles expanded (620×300)
    │  CSS-variable geometry, no width transitions
    ▼
Hover after dwell delay → expand
    │  hover does NOT resize native window
    ▼
Click → toggle instantly
    ▼
App focused → notch steps aside (mutual exclusivity)
```

### Flow 4: Computer Control Flow

```
User requests computer action (Chat → computer-service.ts)
    │
    ▼
computer-service.ts localStart() → Playwright browser session
    │  launch ladder: bundled Chromium → full build → Edge → Chrome → custom path
    ▼
UIA automation / screen capture / take/release control
    │  audit trail recorded
    ▼
Result returned to chat via API
```

### Flow 5: Generative UI Flow

```
Model calls show_visual with spec (shared/visual-ui.ts)
    │  zod validation: strict, bounded, no z.record
    ▼
VisualCards.tsx parseVisualSpec() → renders card
    │  chart/stat/table/timeline/callout/progress/gallery/code
    ▼
Card persists (thread_visuals), redraws after reload
```

---

## Debug Checklist by Symptom

| Symptom | Primary Files to Check | Key Things to Verify |
|---------|----------------------|---------------------|
| App won't start | `start.bat`, `start.ps1`, `host.log`, `host-run.log` | `ELECTRON_RUN_AS_NODE` unset, port :4310 free, `.env.local` keys present |
| Electron crashes | `main.js`, `desktop-launch.err.log` | `node --check main.js` passes, `@electron/asar` repack |
| Notch doesn't expand/hover | `NotchApp.tsx`, `notch.css`, `main.js`, `ipc.ts` | TSX build output, CSS classes, IPC bridge |
| Voice switches to text while listening | `Chat.tsx` (`wasInlineVoice` ref), `useLocalVoice.ts`, `voiceSession.tsx` | `wasInlineVoice` ref, phase transitions, `stopSharedVoice()` |
| Mic button hangs | `Chat.tsx`, `InlineVoiceBar.tsx` | Disabled guard for paused/unready/contextNotReady |
| TTS speaks punctuation | `useLocalVoice.ts` | Punctuation stripping regex, SSML/prosody |
| Mail not appearing | `mailbox.ts`, `mail-routes.ts`, `mail-orchestrator.ts` | `.aegis-data/agent-swarm/mailboxes/`, `reads.json`, `mail-processed.json` |
| Task mail not processed | `mail-orchestrator.ts`, `agent-swarm.ts` | Orchestrator inbox, swarm dispatch, `mail-processed.json` |
| Report not received | `mail-orchestrator.ts` (`reportCompleted`) | Terminal status check, same threadId, inReplyTo |
| Model calls fail (401/402/403) | `providers.ts`, `.env.local` | API keys, rate limits (Groq 8k TPM, GitHub 60 req/hr) |
| Computer control fails | `computer-service.ts`, `browser-launch.ts` | Playwright Chromium, UIA permissions, launch ladder |
| Finance/News empty | `free-api-routes.ts`, `research-web.ts` | Rate limits, OpenAlex 429s, GITHUB_TOKEN |
| Visual cards don't render | `VisualCards.tsx`, `shared/visual-ui.ts` | Zod validation, spec constraints (max 6 blocks) |
| Memory search empty | `store.ts`, `memory-document-service.ts` | `rag_enabled` setting, tier column, SQLite |
| Agents page has task board | `AgentsWorkspace.tsx` | Verify no task board code, only Queries/Team/Harness tabs |
| Sidebar geometry wrong | `App.tsx` | `RAIL_WIDTH`, sidebar left:52px, workspace margin |
| WhatsApp pairing fails | `connections.ts`, `whatsapp-routes.ts` | Baileys sidecar on :4312, owner's phone |

---

## Deep Audit — Issue Category 1: Functionality Issues (Not Linked to Other Files)

These are features that don't work correctly or aren't properly linked to their dependent files.

### F1: Voice Mode Auto-Switches to Text While Listening
- **Files:** `App.tsx`, `Chat.tsx`, `useLocalVoice.ts`, `voiceSession.tsx`, `InlineVoiceBar.tsx`
- **Issue:** `App.tsx` line 308-310 resets `setEmptyInlineVoice(false)` on every thread change, even while mic is live. The `wasInlineVoice` ref in `Chat.tsx` helps but doesn't prevent the root cause.
- **Linkage:** `Chat.tsx` ← `App.tsx` ← `useLocalVoice.ts` ← `voiceSession.tsx`
- **Fix:** Guard the reset with `if (!isAnyVoiceActive) setEmptyInlineVoice(false);`

### F2: Microphone Not Released When Leaving Voice Mode
- **Files:** `useLocalVoice.ts`, `voiceSession.tsx`, `Chat.tsx`
- **Issue:** WebSocket and AudioContext cleanup depends on `stop()` callback identity. If component unmounts unexpectedly, stream may linger.
- **Linkage:** `useLocalVoice.ts` ← `voiceSession.tsx` ← `Chat.tsx` ← `InlineVoiceBar.tsx`
- **Fix:** Add `beforeunload`/`pagehide` listener. Ensure `releaseInput()` in all error paths.

### F3: `/call` Silent No-Op in Browser-Only Mode (Partially Fixed)
- **Files:** `App.tsx`, `Chat.tsx`
- **Issue:** Now shows error in browser-only mode, but desktop mode may fail silently if `bridge.action` is undefined.
- **Linkage:** `App.tsx` ← `main.js` ← `NotchApp.tsx`
- **Fix:** Add widget name validation and fallback error for desktop mode.

### F4: Mail Report Not Sent on Host Restart for In-Flight Tasks
- **Files:** `mail-orchestrator.ts`, `mailbox.ts`, `agent-swarm.ts`
- **Issue:** `mail-processed.json` write failure is silently caught. In-memory `inflight` map lost on crash.
- **Linkage:** `mail-orchestrator.ts` ← `mailbox.ts` ← `agent-swarm.ts`
- **Fix:** Add retry for `saveProcessed`. Add startup reconciliation for orphaned tasks.

### F5: Swarm Task Dispatch — No Provider Fallback
- **Files:** `agent-swarm.ts`, `providers.ts`, `SettingsForm.tsx`
- **Issue:** Provider failure (401/402/403/rate limit) fails the entire task with no fallback.
- **Linkage:** `agent-swarm.ts` ← `providers.ts` ← `SettingsForm.tsx`
- **Fix:** Add provider fallback chain in dispatch logic.

### F6: Computer Service — Orphaned Sessions on Host Crash
- **Files:** `computer-service.ts`, `browser-launch.ts`, `computer-routes.ts`
- **Issue:** Playwright browser contexts are tracked in-memory. Host crash leaves orphaned browser processes.
- **Linkage:** `computer-service.ts` ← `browser-launch.ts` ← `computer-routes.ts`
- **Fix:** Add startup cleanup for orphaned processes. Add session TTL.

### F7: Voice/TTS — No Sentence Segmentation or Punctuation Stripping
- **Files:** `useLocalVoice.ts`, `read-aloud.ts`, `voiceSession.tsx`
- **Issue:** TTS receives raw markdown (`**$`, `?`, `#`, `*`, `_`, etc.). No sentence segmentation.
- **Linkage:** `useLocalVoice.ts` ← `read-aloud.ts` ← `voiceSession.tsx`
- **Fix:** Add `sanitizeForTTS()` function with punctuation stripping and sentence segmentation.

### F8: Finance/News Clones — No UI Implementation
- **Files:** `free-api-routes.ts`, `research-web.ts`, (missing UI components)
- **Issue:** API routes exist but no frontend UI for watchlist, charts, or article list.
- **Linkage:** `free-api-routes.ts` ← `research-web.ts` ← (missing React components)
- **Fix:** Build React components for finance watchlist, charts, and news article list.

---

## Deep Audit — Issue Category 2: UI & Visual Appearance Issues

### U1: Notch Lacks Glassmorphism (Droppy/NotchNook Style)
- **Files:** `NotchApp.tsx`, `notch.css`, `build-notch.mjs`, `main.js`
- **Issue:** TSX scaffold built but lacks backdrop-filter blur, semi-transparent backgrounds, vibrant accents, rounded corners.
- **Linkage:** `NotchApp.tsx` ← `notch.css` ← `main.js` ← `ipc.ts`
- **Fix:** Add `backdrop-filter: blur(20px)`, `background: rgba(255,255,255,0.1)`, `border: 1px solid rgba(255,255,255,0.2)`, vibrant accent colors, `border-radius: 16px`.

### U2: Sidebar Auto-Collapse Causes Layout Shift
- **Files:** `App.tsx`, `style.css`
- **Issue:** Non-chat views force sidebar collapse, overriding user preference. Layout shifts on navigation.
- **Linkage:** `App.tsx` ← `style.css`
- **Fix:** Add CSS transition for sidebar width. Make collapse optional per-view.

### U3: Voice Bar Shows Optimistic State Instead of Actual Phase
- **Files:** `InlineVoiceBar.tsx`, `voiceSession.tsx`, `useLocalVoice.ts`
- **Issue:** InlineVoiceBar uses its own `useLocalVoice()` instance instead of reading from shared `VoiceSessionContext`.
- **Linkage:** `InlineVoiceBar.tsx` ← `voiceSession.tsx` ← `useLocalVoice.ts`
- **Fix:** Make InlineVoiceBar read from `useVoiceSession()` context.

### U4: No Visual Polish on Empty/Error States
- **Files:** `AgentMailPanel.tsx`, `FilesSurfaceView.tsx`, `MemoryPanel.tsx`, `visual-ui.css`, `style.css`
- **Issue:** Empty states use basic `<div>` with text. No illustrations or clear CTAs.
- **Linkage:** Multiple client components ← `visual-ui.css` ← `style.css`
- **Fix:** Add illustrated empty states with call-to-action buttons.

### U5: Widgets Panel Blank in Browser-Only Mode
- **Files:** `App.tsx`, `NotchApp.tsx`, `free-api-routes.ts`
- **Issue:** Fallback loads from `/widgets` API every 15s with no loading/error state or retry button.
- **Linkage:** `App.tsx` ← `free-api-routes.ts` ← `NotchApp.tsx`
- **Fix:** Add loading spinner, error banner, and retry button.

---

## Deep Audit — Issue Category 3: Core Functionality, Security & Memory Leaks

### C1: PowerShell Script Injection in computer-service.ts (CRITICAL)
- **Files:** `computer-service.ts` (lines 1005-1044, 1103-1126, 1163+)
- **Issue:** PowerShell scripts built via template literals with user-controlled input (`app`, `input.title`). `replace(/'/g, "''")` is insufficient for injection prevention.
- **Impact:** Remote code execution via `open_app` or `switch_window` actions.
- **Linkage:** `computer-service.ts` ← `computer-routes.ts` ← `App.tsx`
- **Fix:** Use whitelisted commands. Parameterize PowerShell arguments. No user input interpolation.

### C2: `exec()` Arbitrary Command Execution (CRITICAL)
- **Files:** `computer-service.ts` (lines 917-948)
- **Issue:** `exec` action passes `command.command` directly to `execAsync()` with no whitelisting or sandboxing.
- **Impact:** Arbitrary command execution on the host machine.
- **Linkage:** `computer-service.ts` ← `computer-routes.ts`
- **Fix:** Implement command whitelisting. Require explicit approval. Audit log all exec commands.

### C3: Mail Sender Spoofing (HIGH)
- **Files:** `mail-routes.ts`, `mailbox.ts`
- **Issue:** `from` address trusted from client body without authentication. Client can send as `orchestrator@aegis` or any agent.
- **Impact:** Sender spoofing in internal mail system.
- **Linkage:** `mail-routes.ts` ← `mailbox.ts` ← `AgentMailPanel.tsx`
- **Fix:** Authenticate sender against session token. Only allow `user@aegis` for authenticated users.

### C4: Memory Leak — WebSocket/AudioContext Not Cleaned (HIGH)
- **Files:** `useLocalVoice.ts`, `voiceSession.tsx`
- **Issue:** `ScriptProcessorNode` is deprecated. `AudioContext` not closed on all error paths. WebSocket may not close on component unmount.
- **Impact:** Memory grows with each voice session.
- **Linkage:** `useLocalVoice.ts` ← `voiceSession.tsx` ← `Chat.tsx`
- **Fix:** Replace `ScriptProcessorNode` with `AudioWorkletNode`. Ensure `audioContext.close()` in all paths. Add `AbortController` for WebSocket.

### C5: Memory Leak — `taskStatuses` Map Grows Unbounded (MEDIUM)
- **Files:** `App.tsx` (line 276)
- **Issue:** `taskStatuses` ref map accumulates entries for every task ever seen. Old entries never removed.
- **Impact:** Memory grows over long sessions.
- **Linkage:** `App.tsx` ← `Chat.tsx`
- **Fix:** Prune old entries periodically or when tasks are removed.

### C6: Memory Leak — Event Listeners Not Always Removed (MEDIUM)
- **Files:** `App.tsx` (multiple `window.addEventListener` calls)
- **Issue:** Rapid view switching may leave orphaned listeners before cleanup runs.
- **Impact:** Listener accumulation over time.
- **Linkage:** `App.tsx` ← all child components
- **Fix:** Use single event listener manager with `AbortController` pattern.

### C7: No CSP Nonce for Penboard Inline Scripts (MEDIUM)
- **Files:** `app-origin.ts`, `public/penboard.html`
- **Issue:** CSP allows `/penboard` inline scripts without nonce/hash. XSS vector if penboard accepts user content.
- **Impact:** Potential XSS through penboard.
- **Linkage:** `app-origin.ts` ← `public/penboard.html` ← `PenBoardPanel.tsx`
- **Fix:** Restrict inline scripts with nonce or hash. Validate penboard input.

### C8: `ELECTRON_RUN_AS_NODE` Not Unset in Start Scripts (HIGH)
- **Files:** `start.ps1`, `start.bat`, `start.sh`, `main.js`
- **Issue:** If env var is set globally, Electron runs as plain Node and crashes. Start scripts don't unset it.
- **Impact:** App won't launch.
- **Linkage:** `start.ps1` ← `start.bat` ← `start.sh` ← `main.js`
- **Fix:** Add `Remove-Item Env:ELECTRON_RUN_AS_NODE` to `start.ps1`. Add `unset` to `start.bat`/`start.sh`.

---

## Unwanted/Old Files That Can Be Removed

### Files with No Project Context (Safe to Remove)

| File | Path | Reason |
|------|------|--------|
| Python virtual environment | `services/daemon/.venv311/` | Build artifact, regenerate with pip |
| Playwright browser binaries | `.aegis-data/playwright-browsers/` | Downloaded binaries, reinstall with playwright |
| Node modules | `*/node_modules/` | Build artifact, reinstall with npm |
| Build output | `*/dist/`, `*/build/` | Build artifact |
| Log files | `*.log`, `*.err.log`, `*.out.log` | Runtime artifacts |
| PID files | `host-run.pid` | Runtime artifact |
| Audit logs | `audit-live.log` | Runtime artifact |

### Old/Unwanted Source Files (Review Before Removing)

| File | Path | Reason | Safe? |
|------|------|--------|-------|
| Old notch HTML | `apps/desktop/desktop-ui/src/notch.html` | Being replaced by NotchApp.tsx | Yes (if TSX build works) |
| Old widgets HTML | `apps/desktop/widgets.html` | Replaced by desktop UI widgets | Review |
| Old overlay HTML | `apps/desktop/overlay.html` | May be unused | Review |
| Old tray-pill HTML | `apps/desktop/tray-pill.html` | May be unused | Review |
| Old showcase HTML | `apps/desktop/showcase.html` | Demo page, not production | Review |
| `635+1` file | `apps/host/src/client/635+1` | Unknown purpose, possibly old artifact | Investigate first |
| `check-line.js` / `check-line2.js` | `aegis/check-line*.js` | Build utilities, may be unused | Review |
| `test-shortcut.js` | `aegis/test-shortcut.js` | Test artifact | Review |
| `coding-processes.ps1` / `media-session.ps1` | `apps/desktop/` | PowerShell scripts, may be unused | Review |
| `file-tray.js` / `clipboard-history.js` | `apps/desktop/` | May be superseded by desktop UI | Review |

### Reference/Vendor Files (Keep for Reference, Not Part of Aegis Build)

- `reference-repos/` — Third-party code studied for patterns (nod, mercury-agent, harness2, itsaplan)
- `vendor/` — OpenDots, openmuse, mascot-kit (external dependencies needed for build)

---

## Fix Linkage Map — How Issues Are Linked

```
Voice Switch Bug:      Chat.tsx ← App.tsx ← useLocalVoice.ts ← voiceSession.tsx ← InlineVoiceBar.tsx
Notch Glassmorphism:   NotchApp.tsx ← notch.css ← main.js ← ipc.ts ← build-notch.mjs
Mail Report Bug:       mail-orchestrator.ts ← mailbox.ts ← agent-swarm.ts ← mail-routes.ts
PowerShell Injection:  computer-service.ts ← computer-routes.ts ← App.tsx (computer_control)
Memory Leak (WS):      useLocalVoice.ts ← voiceSession.tsx ← Chat.tsx ← InlineVoiceBar.tsx
Memory Leak (tasks):   App.tsx ← Chat.tsx (task status display)
Finance/News UI:       free-api-routes.ts ← research-web.ts ← (missing UI components)
TTS Punctuation:       useLocalVoice.ts ← read-aloud.ts ← voiceSession.tsx
ELECTRON_RUN_AS_NODE:  start.ps1 ← start.bat ← start.sh ← main.js
```

---

## Recommended Fix Priority

| Priority | Issue | Category | Files | Effort |
|----------|-------|----------|-------|--------|
| 1 | PowerShell injection | 3 (Security) | `computer-service.ts` | High |
| 2 | `exec()` arbitrary commands | 3 (Security) | `computer-service.ts` | High |
| 3 | Mail sender spoofing | 3 (Security) | `mail-routes.ts`, `mailbox.ts` | Medium |
| 4 | Voice mic not released | 1 (Functionality) | `useLocalVoice.ts`, `voiceSession.tsx` | Medium |
| 5 | Voice switches to text while listening | 1 (Functionality) | `App.tsx`, `Chat.tsx` | Low |
| 6 | `ELECTRON_RUN_AS_NODE` not unset | 3 (Core) | `start.ps1`, `start.bat` | Low |
| 7 | Notch glassmorphism | 2 (UI) | `NotchApp.tsx`, `notch.css` | Medium |
| 8 | Finance/News clone UI | 1 (Functionality) | New components | High |
| 9 | TTS punctuation stripping | 1 (Functionality) | `useLocalVoice.ts`, `read-aloud.ts` | Medium |
| 10 | Memory leak: taskStatuses map | 3 (Memory) | `App.tsx` | Low |
| 11 | Memory leak: WebSocket/AudioContext | 3 (Memory) | `useLocalVoice.ts` | Medium |
| 12 | Sidebar layout shift | 2 (UI) | `App.tsx`, `style.css` | Low |

---

## Where to Fix Each Issue

| Issue | Primary File to Edit | Secondary Files | What to Change |
|-------|---------------------|-----------------|----------------|
| Voice switch bug | `App.tsx:308-310` | `Chat.tsx` | Guard `setEmptyInlineVoice(false)` with `isAnyVoiceActive` check |
| Mic not released | `useLocalVoice.ts:587` | `voiceSession.tsx` | Add `beforeunload` listener, ensure `releaseInput()` in all paths |
| PowerShell injection | `computer-service.ts:1005-1044` | `computer-routes.ts` | Whitelist commands, parameterize args |
| `exec()` arbitrary commands | `computer-service.ts:917-948` | `computer-routes.ts` | Command whitelisting, approval gate |
| Mail spoofing | `mail-routes.ts:99-114` | `mailbox.ts` | Authenticate sender against session token |
| Notch glassmorphism | `notch.css` | `NotchApp.tsx` | Add backdrop-filter, blur, vibrant colors |
| TTS punctuation | `useLocalVoice.ts` | `read-aloud.ts` | Add `sanitizeForTTS()` function |
| Finance/News UI | New files | `free-api-routes.ts` | Build React watchlist, chart, article components |
| Memory leak tasks | `App.tsx:276` | `Chat.tsx` | Prune old `taskStatuses` entries |
| ELECTRON_RUN_AS_NODE | `start.ps1` | `start.bat`, `start.sh` | Add `Remove-Item Env:ELECTRON_RUN_AS_NODE` |

---

---

## Context Memory System

A SQL-based knowledge graph for fast, accurate debugging of the Aegis codebase.
Located at `D:\Aegis 2\ctxmem/`.

### Components

| File | Purpose |
|------|---------|
| `ctxmem/schema.sql` | SQLite database schema |
| `ctxmem/indexer.py` | Scans codebase, extracts files/functions/relationships/keywords |
| `ctxmem/cli.py` | CLI tool for querying the knowledge graph |
| `ctxmem/seed_issues.py` | Seeds issues from DEEP_ANALYSIS_ISSUES.md |
| `ctxmem/context_memory.db` | The SQLite database (516 files, 2,776 functions, 21 issues) |
| `ctxmem/README.md` | CLI usage documentation |

### CLI Commands

```bash
# Statistics
python cli.py stats

# Keyword search
python cli.py keyword voice

# File details + linked issues
python cli.py file computer-service.ts

# Issue details + linked files
python cli.py issue C1

# List issues
python cli.py issues --severity critical

# Mark issue fixed
python cli.py fix C1 --who "dev" --files "computer-service.ts" --summary "..."

# Relationship graph
python cli.py graph computer-service.ts

# Unwanted files
python cli.py unwanted
```

### Workflow for Fixing

1. `python cli.py issues --severity critical` — find critical issues
2. `python cli.py issue C1` — see root cause, fix, linked files
3. `python cli.py file computer-service.ts` — examine the source file
4. Fix the code in the source file
5. `python cli.py fix C1 --who "dev" --files "computer-service.ts"` — record the fix

### Issue Categories

| Category | Prefix | Examples |
|----------|--------|----------|
| Functionality | F1–F8 | Voice switch bug, mic not released, finance/news UI |
| UI & Visual | U1–U5 | Notch glassmorphism, sidebar shift, voice bar state |
| Core/Security/Memory | C1–C8 | PowerShell injection, exec() commands, mail spoofing, memory leaks |

---

*End of TECHNICAL_REFERENCE.md*
