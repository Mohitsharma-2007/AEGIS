# Aegis — Deep Analysis, Issues & Audit Report

> Deep analysis of the Aegis desktop app codebase. Identifies missing functionality,
> issues across 3 categories, unwanted/old files to remove, and fix linkage map.
>
> **Categories:**
> 1. **Functionality Issues** — Features that don't work or aren't linked to other files
> 2. **UI & Visual Appearance Issues** — Visual lags, layout problems, appearance bugs
> 3. **Core Functionality, Security & Memory Leaks** — Critical bugs, security vulnerabilities, memory leaks

---

## Part 1: Missing Functionality — What's Not Implemented Yet

Based on the codebase review, the following items from the requirements are NOT yet implemented:

| Missing Feature | Reference | Status | Why It Matters |
|-----------------|-----------|--------|----------------|
| Google Finance clone UI | `free-api-routes.ts`, `research-web.ts` | API routes exist, no UI | Users can't view finance data |
| Yahoo Finance clone UI | `free-api-routes.ts`, `research-web.ts` | API routes exist, no UI | Users can't view Yahoo finance data |
| Google News clone UI | `free-api-routes.ts`, `research-web.ts` | API routes exist, no UI | Users can't view news |
| Voice/TTS punctuation stripping | `useLocalVoice.ts` | Partially implemented | TTS speaks `**$`, `?`, `#`, etc. |
| Sentence segmentation for TTS | `useLocalVoice.ts` | Not implemented | Raw markdown fed to synthesizer |
| SSML/prosody control | `useLocalVoice.ts` | Not implemented | Robotic-sounding voice |
| VAD (Voice Activity Detection) | `useLocalVoice.ts` | Partially implemented | Mic stays open during silence |
| Interruption/mute during TTS | `useLocalVoice.ts` | Partially implemented | Can't reliably interrupt speaking |
| Task-continuation for voice | `voiceSession.tsx`, `Chat.tsx` | Partially implemented | Voice turns don't always persist |
| Finance/Yahoo/Google News rate-limit handling UI | `free-api-routes.ts` | API-level only | No user-facing rate-limit UI |
| Honest empty/error states for clones | `free-api-routes.ts` | API-level only | No user-facing empty states |
| Notch glassmorphism visual polish | `NotchApp.tsx`, `notch.css` | TSX scaffold built, needs polish | Notch looks basic, not Droppy/NotchNook style |
| Harness embedded within app pages | `AgentsWorkspace.tsx` | Harness is a tab, not embedded | Still feels like separate section |
| Live microphone turn verification | N/A | Not verified | User's mic not activated in env |
| Multi-monitor/DPI placement | `main.js` | Not verifiable | Can't test in this env |
| Packaged notch/tray/drop interaction | `main.js`, `desktop-ui/` | Not verifiable | Electron crashes on startup in env |

---

## Part 2: Issue Category 1 — Functionality Issues (Not Linked to Other Files)

### 1.1 Voice Mode Auto-Switches Back to Text While Listening

**Files:** `Chat.tsx`, `App.tsx`, `useLocalVoice.ts`, `voiceSession.tsx`, `InlineVoiceBar.tsx`

**Issue:** When a voice turn creates a new thread, the UI flips back to text mode while the mic is still live. The `wasInlineVoice` ref was added to `Chat.tsx` to stop the shared session on `inlineVoice: true → false`, but the root cause in `App.tsx` still allows `setEmptyInlineVoice(false)` on thread change (line 308-310), which can reset voice state mid-turn.

**Root Cause:** `App.tsx` line 308-310: `useEffect(() => { setEmptyInlineVoice(false); }, [selectedThread]);` — this resets emptyInlineVoice whenever the thread changes, even if voice is actively listening.

**Linked Files:** `Chat.tsx` (inlineVoice state), `voiceSession.tsx` (shared session), `InlineVoiceBar.tsx` (ownsSession guard)

**Fix:** Guard the `setEmptyInlineVoice(false)` reset with a check that voice is not actively listening: `if (!isAnyVoiceActive) setEmptyInlineVoice(false);`

---

### 1.2 Microphone Not Released When Leaving Voice Mode

**Files:** `useLocalVoice.ts`, `voiceSession.tsx`, `Chat.tsx`

**Issue:** When the user leaves voice mode (stops speaking or switches away), the microphone stream may not be properly released. The `stop()` function closes the WebSocket and calls `releaseInput()`, but if the component unmounts unexpectedly (e.g., navigating away), the cleanup `useEffect(() => () => stop(), [stop])` may not run in time.

**Root Cause:** `useLocalVoice.ts` line 587: `useEffect(() => () => stop(), [stop]);` — cleanup depends on `stop` callback reference stability. If `stop` changes identity, the previous stream isn't released.

**Linked Files:** `voiceSession.tsx` (shared session state), `App.tsx` (voiceOpen state)

**Fix:** Add a `beforeunload`/`pagehide` listener to force-stop voice on navigation. Ensure `releaseInput()` is called in all error paths.

---

### 1.3 `/call` Silent No-Op in Browser-Only Mode

**Files:** `App.tsx`, `Chat.tsx`

**Issue:** Partially fixed — now shows an error message instead of silently doing nothing. But the error message is only shown in browser-only mode; in desktop mode, the bridge call may fail silently if `bridge.action` is undefined.

**Root Cause:** `App.tsx` lines 220-236: The `onCallWidget` handler checks `bridge?.action` but doesn't verify the widget name is valid before calling.

**Linked Files:** `main.js` (desktop bridge), `NotchApp.tsx` (widget calls)

**Fix:** Add widget name validation and a fallback error for desktop mode too.

---

### 1.4 Mail System — Report Not Sent on Host Restart for In-Flight Tasks

**Files:** `mail-orchestrator.ts`, `mailbox.ts`

**Issue:** The `mail-processed.json` index tracks dispatched tasks, but if the host crashes mid-task (before terminal status), the report is only sent on next boot if the task is still in `inflight` map OR recorded in the index. However, the `inflight` map is in-memory and lost on restart. The recovery loop (lines 210-220) handles this, but only if `entry.taskId` exists and `entry.reported` is false.

**Root Cause:** `mail-orchestrator.ts` lines 200-268: Recovery depends on `mail-processed.json` being written before crash. If the write fails silently (caught at line 152-156), the task is lost.

**Linked Files:** `mailbox.ts` (sendMail writes audit), `agent-swarm.ts` (task status)

**Fix:** Add retry logic for `saveProcessed` failures. Add a startup reconciliation that scans `.aegis-data/agent-swarm/` for orphaned tasks.

---

### 1.5 Swarm Task Dispatch — No Provider Fallback

**Files:** `agent-swarm.ts`, `providers.ts`

**Issue:** If the configured provider fails (401, 402, 403, rate limit), the swarm task fails entirely. No automatic fallback to another provider.

**Root Cause:** `agent-swarm.ts` uses the owner's configured provider chain without fallback logic.

**Linked Files:** `providers.ts` (provider list), `SettingsForm.tsx` (provider selection)

**Fix:** Add provider fallback chain in `agent-swarm.ts` dispatch logic.

---

### 1.6 Computer Service — Session Cleanup on Unexpected Close

**Files:** `computer-service.ts`, `computer-routes.ts`

**Issue:** Local computer sessions (Playwright browser contexts) are tracked in `localSessions` map. When the context closes unexpectedly (line 414-416), the session is deleted. But if the host process crashes, sessions are orphaned — browser processes may linger.

**Root Cause:** `computer-service.ts` lines 414-416: `context.on('close', () => { if (this.localSessions.get(id) === session) this.localSessions.delete(id); });` — only handles graceful close, not process crash.

**Linked Files:** `computer-routes.ts`, `browser-launch.ts`

**Fix:** Add a startup cleanup that kills orphaned Playwright processes. Add session TTL.

---

### 1.7 Voice/TTS — No Sentence Segmentation or Punctuation Stripping

**Files:** `useLocalVoice.ts`, `read-aloud.ts`

**Issue:** TTS receives raw text including markdown artifacts (`**$`, `?`, `#`, `*`, `_`, etc.). No sentence segmentation before sending to synthesizer.

**Root Cause:** `useLocalVoice.ts` `playChunk()` sends raw PCM chunks to AudioContext without text preprocessing. `read-aloud.ts` likely has similar issues.

**Linked Files:** `read-aloud.ts`, `voiceSession.tsx`

**Fix:** Add a `sanitizeForTTS()` function that strips punctuation/markdown and segments sentences before TTS.

---

### 1.8 Finance/News Clones — No UI Implementation

**Files:** `free-api-routes.ts`, `research-web.ts`

**Issue:** API routes exist for Google Finance, Yahoo Finance, Google News, but there's no frontend UI to display them. No watchlist, no chart, no article list.

**Root Cause:** The clones were planned but only the backend API routes were built.

**Linked Files:** `AgentsWorkspace.tsx` (no finance tab), `ResearchPanel.tsx` (no news display)

**Fix:** Build React components for finance watchlist, charts, and news article list.

---

## Part 3: Issue Category 2 — UI & Visual Appearance Issues

### 2.1 Notch Lacks Glassmorphism (Droppy/NotchNook Style)

**Files:** `NotchApp.tsx`, `notch.css`, `build-notch.mjs`

**Issue:** The TSX notch scaffold is built but lacks the glassmorphism visual polish — no backdrop-filter blur, no vibrant color accents, no rounded corners matching Droppy/NotchNook. The island renders with correct classes but looks basic.

**Root Cause:** `notch.css` has basic styles but no glassmorphism effects (backdrop-filter, semi-transparent backgrounds, border gradients, vibrant accents).

**Linked Files:** `main.js` (notch window creation), `desktop-ui/` (packaged output)

**Fix:** Add glassmorphism CSS: `backdrop-filter: blur(20px)`, `background: rgba(255,255,255,0.1)`, `border: 1px solid rgba(255,255,255,0.2)`, vibrant accent colors, `border-radius: 16px`.

---

### 2.2 Sidebar Auto-Collapse Causes Layout Shift

**Files:** `App.tsx`

**Issue:** The sidebar collapses/expands based on view (non-chat views force collapse). This causes layout shift when navigating between views. The `sidebarWidth` state is persisted but the transient collapse overrides it.

**Root Cause:** `App.tsx` lines 437-440: `useEffect(() => { if (view !== 'chat' && view !== 'space') setNavCollapsed(true); else setNavCollapsed(userCollapsedRef.current); }, [view]);`

**Linked Files:** `style.css` (sidebar layout)

**Fix:** Add CSS transition for sidebar width. Make collapse optional per-view rather than forced.

---

### 2.3 Onboarding Scrim Previously Swallowed All Clicks (Historical, May Persist)

**Files:** `App.tsx`, `AgentOnboardingModal.tsx`

**Issue:** The comment at lines 326-336 indicates onboarding used to open behind a full-screen scrim that swallowed clicks. It now opens from a header button, but if `AgentOnboardingModal.tsx` still has a full-screen overlay, clicks may be blocked.

**Root Cause:** Potential z-index or pointer-events issue in `AgentOnboardingModal.tsx`.

**Linked Files:** `App.tsx` (onboardingOpen state)

**Fix:** Verify `AgentOnboardingModal.tsx` doesn't block clicks when dismissed.

---

### 2.4 Voice Bar Doesn't Reflect Actual Phase (Optimistic UI)

**Files:** `InlineVoiceBar.tsx`, `voiceSession.tsx`, `useLocalVoice.ts`

**Issue:** The voice bar may show optimistic state instead of actual phase/mute/error state from the shared session. The `voiceSession.tsx` broadcasts to `window.aegis.status` and `window.aegis.trayUpdate`, but the InlineVoiceBar may not read the actual state.

**Root Cause:** `InlineVoiceBar.tsx` uses `useLocalVoice()` directly instead of reading from the shared `VoiceSessionContext`.

**Linked Files:** `voiceSession.tsx` (shared state broadcast)

**Fix:** Make `InlineVoiceBar` read from `useVoiceSession()` context, not its own `useLocalVoice()` instance.

---

### 2.5 No Visual Polish on Empty/Error States

**Files:** Multiple client components

**Issue:** Empty states (no mail, no files, no memory) use basic `<div>` with text. No illustrations, no action buttons, no visual hierarchy.

**Root Cause:** Components like `AgentMailPanel.tsx`, `FilesSurfaceView.tsx`, `MemoryPanel.tsx` use minimal empty states.

**Linked Files:** `visual-ui.css`, `style.css`

**Fix:** Add illustrated empty states with clear call-to-action buttons.

---

### 2.6 Widgets Panel Blank in Browser-Only Mode (Partial Fix)

**Files:** `App.tsx` (lines 448-468)

**Issue:** The fallback loads widgets from `/widgets` API every 15 seconds, but there's no loading state, no error state, and no retry button. The widget panel appears blank while loading.

**Root Cause:** `App.tsx` lines 448-468: The `load()` function swallows errors silently.

**Linked Files:** `NotchApp.tsx` (widget source), `free-api-routes.ts` (widget API)

**Fix:** Add loading spinner, error banner, and retry button to widgets panel.

---

### 2.7 Harness Panel Hides Failures and Fakes Runtime Values

**Files:** `apps/host/src/client/HarnessPanel.tsx`

**Issue:** A single failed status poll left the error banner up for the rest of the session, because `loadStatus` never cleared `error` on a successful retry. The runtime badges also printed invented values (`status.runtimes?.node ?? 'active'`) whenever the engine reported nothing, so the panel claimed a Node runtime was active when it had never said so.

**Root Cause:** `setError('')` was only called on mutation paths, and the badge labels used `??` defaults rather than reflecting the actual payload.

**Linked Files:** `apps/host/src/server/harness.ts` (status payload)

**Fix:** Clear the error on every successful probe, drop the fabricated defaults, render only the runtimes the engine reports, and show an explicit "No runtimes reported" badge otherwise.

---

## Part 4: Issue Category 3 — Core Functionality, Security & Memory Leaks

### 3.1 Security: PowerShell Script Injection in `computer-service.ts`

**Files:** `computer-service.ts` (lines 1005-1044, 1103-1126, 1163-1200+)

**Issue:** PowerShell scripts are constructed using template literals with user-controlled input (`app`, `input.title`). The `replace(/'/g, "''")` escaping is insufficient — an attacker could inject arbitrary PowerShell commands through `open_app` or `switch_window` actions.

**Example:** `open_app` with `app: "calc'; Remove-Item C:\\important -Recurse; '"` could inject commands.

**Root Cause:** `computer-service.ts` builds PowerShell scripts by string interpolation without proper parameterization.

**Severity:** CRITICAL — Remote code execution via computer control API.

**Fix:** Use PowerShell `-Command` with properly escaped arguments, or better, use a fixed set of whitelisted commands with no user input interpolation.

---

### 3.2 Security: `exec()` with User-Controlled Commands

**Files:** `computer-service.ts` (lines 917-948)

**Issue:** The `exec` action runs arbitrary shell commands via `execAsync()` with `maxBuffer: 1_000_000`. No command whitelisting, no sandboxing beyond `cwd: session.workspaceDir`.

**Root Cause:** `computer-service.ts` `case 'exec':` directly passes `command.command` to `execAsync`.

**Severity:** CRITICAL — Arbitrary command execution.

**Fix:** Implement command whitelisting. Require explicit approval for `exec` actions. Add audit logging for all exec commands.

---

### 3.3 Memory Leak: WebSocket Connections Not Properly Cleaned

**Files:** `useLocalVoice.ts`, `voiceSession.tsx`

**Issue:** WebSocket connections (`ws.current`) are created in `start()` but the cleanup in `stop()` may not always run. The `captureFromSocket` callback creates `AudioContext` and `ScriptProcessorNode` which are deprecated and may not be garbage collected.

**Root Cause:** `useLocalVoice.ts` lines 259-269: `new AudioContext()`, `input.createScriptProcessor(4096, 1, 1)` — ScriptProcessorNode is deprecated. AudioContext is not closed on all error paths.

**Severity:** HIGH — Memory grows with each voice session.

**Fix:** Replace `ScriptProcessorNode` with `AudioWorkletNode`. Ensure `audioContext.close()` is called in all paths. Add `AbortController` for WebSocket cleanup.

---

### 3.4 Memory Leak: Event Listeners Not Always Removed

**Files:** `App.tsx`, multiple components

**Issue:** `App.tsx` adds multiple `window.addEventListener` listeners (lines 216-218, 238-239, 246-248, 257-259, 400-402). The cleanup functions are returned, but if the component re-renders frequently, listeners may accumulate before cleanup runs.

**Root Cause:** React `useEffect` cleanup runs on unmount or dependency change, but rapid view switching may leave orphaned listeners.

**Severity:** MEDIUM — Event listener accumulation over time.

**Fix:** Use a single event listener manager. Add `AbortController` pattern for all listeners.

---

### 3.5 Memory Leak: `taskStatuses` Map Grows Unbounded

**Files:** `App.tsx` (line 276)

**Issue:** `taskStatuses` is a `useRef(new Map<string, string>())` that accumulates entries for every task ever seen. Old task entries are never removed.

**Root Cause:** `App.tsx` line 284-291: The map is updated but entries are never deleted for completed/old tasks.

**Severity:** MEDIUM — Memory grows with task count over long sessions.

**Fix:** Prune old entries from `taskStatuses` map periodically or when tasks are removed.

---

### 3.6 Security: No CSP for Inline Scripts in Penboard

**Files:** `app-origin.ts`, `public/penboard.html`

**Issue:** `app-origin.ts` allows `/penboard` inline scripts via CSP. If penboard.html accepts user-controlled content, this could be an XSS vector.

**Root Cause:** `app-origin.ts` CSP header: `frame-ancestors 'self'`, `/penboard` inline scripts allowed.

**Severity:** MEDIUM — Potential XSS through penboard.

**Fix:** Restrict penboard inline scripts with nonce or hash. Validate all penboard input.

---

### 3.7 Core Functionality: `ELECTRON_RUN_AS_NODE` Causes Electron to Run as Plain Node

**Files:** `start.bat`, `start.ps1`, `main.js`

**Issue:** If `ELECTRON_RUN_AS_NODE` is set globally, Electron runs as plain Node and crashes. The docs mention this but the start scripts don't explicitly unset it.

**Root Cause:** Environment variable not cleared in start scripts.

**Severity:** HIGH — App won't launch if env var is set.

**Fix:** Add `Remove-Item Env:ELECTRON_RUN_AS_NODE` to `start.ps1` and `unset ELECTRON_RUN_AS_NODE` to `start.bat`/`start.sh`.

---

### 3.8 Core Functionality: Email Address Spoofing in Mail System

**Files:** `mailbox.ts`, `mail-routes.ts`

**Issue:** The mail system validates addresses are `@aegis` internal, but `from` address is trusted from the client. A malicious client could send mail as `orchestrator@aegis` or any agent address.

**Root Cause:** `mail-routes.ts` line 99-114: `sendMail` accepts `from` from request body without verifying the sender is authenticated as that address.

**Severity:** HIGH — Sender spoofing in internal mail.

**Fix:** Authenticate the sender against the session token before allowing `from` address. Only allow `user@aegis` for authenticated users, or verify the token matches the sender.

---

### 3.4 Windows Launcher Could Not Start the App (D2)

**Files:** `start.ps1`

**Issue:** The launcher contained a literal BEL control byte (0x07) where the path segment `apps` belonged: `$dots = "$Root<BEL>pps\host"`. `$dots` therefore resolved to a directory that does not exist, so the guard `if (-not (Test-Path "$dots\node_modules"))` failed, `ensure-browser.mjs` was never run from a real directory, and the host, browser and WhatsApp sidecars were all skipped. The desktop shell then found nothing on `:4310` and could not load the UI.

**Root Cause:** A `\a` escape was written to the file as a real control byte rather than the characters `apps`, almost certainly from an unescaped string substitution in an earlier edit. `start.ps1` is documented as ASCII-only, so the byte survived every review.

**Linked Files:** `start.bat` (invokes it), `apps/desktop/main.js` (loads `http://127.0.0.1:4310`)

**Fix:** Replaced the byte with the literal `apps` path, verified the file contains zero 0x07 bytes, and confirmed it parses cleanly with the PowerShell AST parser before launching. All services now start: host `:4310`, browser `:4311`, WhatsApp `:4312`, daemon `:8765`, voice `:8766`, Windows voice `:8767`.

---

### 3.5 Harness Prompt Held the HTTP Request Open for Minutes (H1)

**Files:** `apps/host/src/server/harness.ts`

**Issue:** `POST /harness/sessions/:id/prompt` awaited `completeConversation` before responding. That call allows 90 s per attempt with three attempts, so a cold local model held the request open for up to 4.5 minutes. The panel looked hung, and a client-side cut could drop the request before the reply was ever stored.

**Root Cause:** `sendNativePrompt` awaited the model instead of returning after queueing the turn. Both callers already poll the session's messages, so the await bought nothing.

**Linked Files:** `apps/host/src/client/HarnessPanel.tsx` (polls while awaiting)

**Fix:** Reserve the assistant message id, return immediately, and push the reply into the session from a background continuation (with a fallback message if the model fails). Measured: returns in 15 ms; the reply still lands in the session.

---

### 3.6 Harness Tool Runtime Faked Success (H2)

**Files:** `apps/host/src/server/harness.ts`

**Issue:** Approving a `tool: <name>` request spawned Node to print `Invoked tool: <name>`. The log showed a successful execution that had changed nothing.

**Root Cause:** The `tool` case in `approveNativeAction` had no handler and a placeholder branch that produced a success-looking record.

**Linked Files:** none

**Fix:** Report honestly that no tool handler is wired and name the runtimes that do work, keeping the approval record for the audit trail.

---

## Part 5: Unwanted/Old Files That Can Be Removed

### 5.1 Files with No Project Context

| File | Path | Why Remove | Safe to Remove? |
|------|------|-----------|-----------------|
| Reference repos (third-party code) | `reference-repos/` | External code studied for patterns only, not part of Aegis | Yes (but keep for reference) |
| Vendor third-party libraries | `vendor/` | OpenDots, openmuse, mascot-kit — external dependencies | No (needed for build) |
| Python virtual environment | `services/daemon/.venv311/` | Build artifact, not source | Yes (regenerate with pip) |
| Playwright browser binaries | `.aegis-data/playwright-browsers/` | Downloaded binaries, not source | Yes (reinstall with playwright) |
| Node modules | `*/node_modules/` | Build artifact | Yes (reinstall with npm) |
| Build output | `*/dist/`, `*/build/` | Build artifact | Yes |
| Log files | `*.log`, `*.err.log`, `*.out.log` | Runtime artifacts | Yes |
| PID files | `host-run.pid` | Runtime artifact | Yes |
| Audit logs | `audit-live.log` | Runtime artifact | Yes |
| Desktop launch logs | `desktop-launch.*.log` | Runtime artifact | Yes |

### 5.2 Old/Unwanted Source Files — Removed (D1)

> Tooling note: `seed_issues.py` used to force every issue back to `open` on each run, so adding one issue silently erased every recorded fix. It now preserves the existing status and only seeds new rows.

The desktop surfaces are plain HTML built by `desktop-ui/build.mjs`. An earlier React rewrite was never wired in, and its leftovers plus a stale fork of the sources made two builders fight over `ui-kit/`. The following were deleted after confirming nothing referenced them:

| File | Path | Why it went |
|------|------|-------------|
| Orphaned React notch | `desktop-ui/src/NotchApp.tsx`, `main.tsx`, `ipc.ts`, `notch.css` | Nothing imported them; `main.js` loads `ui-kit/*.html` |
| Orphaned React entry + config | `desktop-ui/index.html`, `vite.config.ts`, `tsconfig.json`, `build-notch.mjs` | Only served the React build; its output clobbered the real notch |
| Stale source fork | `ui-kit/src/` | Older copy of `desktop-ui/src` (352-line notch vs 546) |
| Second builder | `ui-kit/build.mjs` | Rebuilt the fork over the good output |
| Stale build output | `desktop-ui/tmp/notch-test.js`, `ui-kit/notch.react-broken.bak.html` | React bundles from the abandoned pipeline |
| Root surface copies | `apps/desktop/{notch,overlay,widgets,annotations,showcase,tray-pill,visual-layer}.html` | Byte-identical or stale duplicates of `ui-kit/`; `surfaceCandidates` prefers `ui-kit/` |
| Stub + probes | `main.stub.bak.js`, `test-electron{,2..9}.js`, `test-electron8.mjs`, `test-electron.js` | Hand-written stub that lost every IPC handler, and one-off Electron probes |
| Dead milestone scripts | `tests/verify-desktop-milestone{4}.mjs`, `tests/verify-desktop-replication.mjs` | Asserted on the deleted layout and on a zip that never existed |
| Runtime artifacts | root `*.log`, `host-run.pid`, `apps/desktop/dev-launch.*.log` | Stale run output from Nov 15–18 |

Still present and required: `loading.html` (loaded explicitly by `main.js`), `coding-processes.ps1`, `media-session.ps1`, `file-tray.js`, `clipboard-history.js` — all referenced by `main.js`.

---

## Part 6: Fix Linkage Map — How Issues Are Linked

```
Voice Switch Bug: Chat.tsx ← App.tsx ← useLocalVoice.ts ← voiceSession.tsx ← InlineVoiceBar.tsx
                              │
Notch Glassmorphism: desktop-ui/src/notch.html ← build.mjs ← ui-kit/notch.html ← main.js
                              │
Mail Report Bug: mail-orchestrator.ts ← mailbox.ts ← agent-swarm.ts ← mail-routes.ts
                              │
Security (PowerShell): computer-service.ts ← computer-routes.ts ← App.tsx (computer_control action)
                              │
Memory Leak (WS): useLocalVoice.ts ← voiceSession.tsx ← Chat.tsx ← InlineVoiceBar.tsx
                              │
Memory Leak (taskStatuses): App.tsx ← Chat.tsx (task status display)
                              │
Finance/News UI: free-api-routes.ts ← research-web.ts ← (missing UI components)
                              │
TTS Punctuation: useLocalVoice.ts ← read-aloud.ts ← voiceSession.tsx
                              │
ELECTRON_RUN_AS_NODE: start.ps1 ← start.bat ← start.sh ← main.js
```

---

## Part 7: Recommended Fix Priority

| Priority | Issue | Category | Files to Fix | Effort |
|----------|-------|----------|--------------|--------|
| 1 | PowerShell injection in computer-service.ts | 3 (Security) | `computer-service.ts` | High |
| 2 | `exec()` arbitrary command execution | 3 (Security) | `computer-service.ts` | High |
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

*End of Deep Analysis Report. Next: Update TECHNICAL_REFERENCE.md with these findings.*
