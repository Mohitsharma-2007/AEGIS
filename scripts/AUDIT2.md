# AEGIS AUDIT 2 — code-referenced findings

All paths are under `D:\Aegis 2\aegis`.

## 1. HORIZONTAL SCROLLBARS / UI BREAKOUT

### 1a. Host React app (`apps/host/src/client/style.css`, `editor.css`, `visual-ui.css`)

Top-20 suspect rules, ordered by likelihood of actual horizontal breakout:

| # | Rule | Location | Why it can overflow |
|---|------|--------|---------------------|
| 1 | `.task-layout { grid-template-columns: minmax(340px,1fr) minmax(330px,0.95fr) }` | style.css:1743 | Two tracks with fixed 340+330 px minimums (670 px) are only collapsed to `display:block` at ≤920px (style.css:3167). Between ~700–920px viewport (minus 242px sidebar) the grid’s min-content exceeds the container → horizontal scrollbar. |
| 2 | `.task-layout` @media ≤1150px → `minmax(300px,1fr) minmax(280px,0.9fr)` | style.css:3123 | Same mechanism, min 580px; still above available width for 700–920px windows before the block fallback kicks in. |
| 3 | `.chat-workspace > .result-pane { width:400px; flex-shrink:0 }` / `.wide { width:640px }` | style.css:4277, 4287 | Fixed non-shrinkable right pane inside a flex row; when the chat column’s min-content is large (wide code blocks), the sum exceeds the container. Only at ≤1100px does split become block (style.css:5408). |
| 4 | `.template-app .chat-workspace > .result-pane { width: clamp(390px,40vw,660px) }` | style.css:7368 | A minimum of 390px fixed pane; at 1101–1400px widths, 40vw + chat min-content can exceed available width before the ≤1100 media override takes effect. |
| 5 | `.ag-tasks-layout { grid-template-columns: minmax(280px,360px) minmax(0,1fr) }` | style.css:22371 | 280px minimum left rail; **no media query collapses this layout** — at narrow windows the grid overflows (Agents page). |
| 6 | `.harness-layout { grid-template-columns: minmax(180px,260px) 1fr }` | style.css:10700 | 180px min track; no collapse media query (harness panel). |
| 7 | `grid-template-columns: 280px minmax(0,1fr)` | style.css:23990 | Fixed 280px first track with no responsive fallback at that rule. |
| 8 | `grid-template-columns: minmax(0,1fr) minmax(280px,340px)` | style.css:25278 | Minimum 280px right rail; if the container is the `.workspace` body minus sidebar, narrow windows can force horizontal scroll. |
| 9 | `grid-template-columns: minmax(0,1fr) 216px` | style.css:24758 | Fixed 216px second track, no collapse fallback. |
| 10 | `grid-template-columns: minmax(150px,1fr) minmax(150px,1fr) auto` | style.css:20837 | Two 150px minimum tracks + auto; combined min-width can exceed narrow containers. |
| 11 | `grid-template-columns: minmax(230px,310px) minmax(0,1fr)` | style.css:20269 | 230px minimum track (integrations/connections layout), no media collapse near that rule. |
| 12 | `.page-chat-panel { width:370px; flex-shrink:0 }` | style.css:6044 | Fixed 370px chat panel next to `.page-tree{width:215px}` (style.css:5724); total fixed chrome ~585px + document min-content → horizontal pressure at 761–1100px (only shrunk to 330px at ≤1100, style.css:6098). |
| 13 | `.document-outline { width:205px; flex-shrink:0 }` | editor.css:862-868 | Fixed 205px outline rail inside `.space-writing-layout` flex; plus `.document-assistant.open{width:360px}` (editor.css:813-817) → combined fixed widths clip the editor column at ~700–900px. |
| 14 | `.html-assistant.open { width:360px }` (330px @≤1150) | editor.css:813, 990 | Full-width chat dock on narrow windows; at ≤900px it becomes 100% width (editor.css:1016), but between 901–1150 the fixed 330px + document column can exceed the 700px-wide layout. |
| 15 | `.topbar` (no `flex-wrap`, no shrinking of breadcrumbs/actions) | style.css:609-625 | `.breadcrumbs` + `.top-actions` both contain nowrap content; at ~700–900px the sum can exceed container width → horizontal scroll (topbar has no `overflow-x`). |
| 16 | `.files-table` column widths (`.files-col-name{width:34%}` etc. sum to 100%) | style.css:17850-17880 | `.files-table{width:100%}` with long nowrap paths: `.file-path-cell` (style.css:17941) shows full workspace paths; without cell-level ellipsis, long paths push the table wider than its wrapper. |
| 17 | `.brief th { white-space:nowrap }` on `.brief table` (width:100%; min-width:100%) | style.css:2483, 2417-2439 | `nowrap` headers can force the table wider than its box; only `.brief-table-wrap` has `overflow-x:auto` (style.css:2399-2415) — the `.document-body table` variant (style.css:2421) is not guaranteed a scrolling wrapper. |
| 18 | `.hero-mascot { width:220px }` (fixed) + `.hero` flex | style.css:827 | Fixed 220px mascot inside `.hero` flex with `.hero-copy`; at ~700–920px it is reduced (style.css:3203) but between 921–1150 a long h1 (43px font) + fixed mascot can overflow its row (hero has no wrap). |
| 19 | `.visual-chart svg { width:100%; height:190px; overflow:visible }` | visual-ui.css:50-53 | `overflow:visible` + `preserveAspectRatio="none"` lets chart strokes/tooltips paint outside the card; the absolute `.visual-tooltip` (visual-ui.css:57-74) is clamped via inline left% (VisualCards.tsx:213) but can still extend beyond the card edge. |
| 20 | `.suggestion-grid { grid-template-columns: repeat(3,1fr) }` | style.css:1119 | `1fr` tracks are safe, but combined with `.suggestion` fixed padding (style.css:1125-1145) and `min-height:116px`, at ~701–920px three columns become very narrow; content clips rather than wraps at 100% widths (only ≤700px collapses to 1fr, style.css:3923). |

Also noted (bounded, but watch):
- `.computer-overlay { width:min(460px,100vw) }` style.css:6238 & 7408 — clamped, OK.
- `.modal` max-width 460px with `max-height:calc(100dvh-48px)` style.css:2751-2763 — vertical only.
- `.chat-bubble.user { max-width:79% }` (style.css:4748) relies on parent overflow-wrap — OK.
- `.rail-views-scroll { overflow-x:hidden }` (style.css:6894) is the *only* hard x-hide in the app; hidden scrollbars can mask overflow elsewhere.

### 1b. Desktop notch (`apps/desktop/desktop-ui/src/notch.html`) and tray pill (`tray-pill.html`)

Suspects / findings:

1. **Dead “quick row”** — `.quick` is declared `display:none!important` (notch.html:42) despite the design comment at line 41 (“quick row: tiny icon tabs, only while hovering…”). `drawQuick()` (notch.html:232) still populates `#quick`, but nothing is ever visible: a fully implemented-but-dead horizontal UI strip.
2. **`.wsh` row can clip at smallest width** — `--cw` min is 220px (notch.html:136); `.wsh` (notch.html:59) holds Talk + Open-app + `.seg` (3 buttons, ~150px) and has **no `flex-wrap` and no `overflow-x`**; at ~220–300px the controls overflow horizontally inside `.ws` (which only scrolls `overflow-y`, line 56). Clipped, not scrollable.
3. **`#deck2` grid** — `repeat(auto-fit, minmax(230px,1fr))` (notch.html:82) and `#deck2[data-t=widgets]` `auto-fill minmax(210px,1fr)` (line 90): with `--ew` min 480px (line 137) inner width ≈ 460px, so two 230px tracks (468px incl. gap) collapse to one column — no overflow, but tiles get surprisingly narrow at mid widths.
4. **`#work` (`.wsb.on`) grid** — `repeat(auto-fit, minmax(164px,1fr))` with `.tile{min-width:150px}` (notch.html:62, 65): safe under auto-fit, but `.t-tasks{grid-row:span 2}` (line 62) with `grid-auto-rows:minmax(74px,auto)` can make a tile taller than the container; content scrolls vertically (container has `overflow-y:auto`), not horizontally.
5. **`.mbar`** — `overflow:hidden` (notch.html:64) intentionally clips long meeting titles; no breakout but content can be cut with no ellipsis on `b`.
6. **`#nset` rows** — `label{flex:0 0 108px}` + `output{flex:0 0 42px}` (notch.html:97-99) sum to 150px fixed; inset is `10px` each side (line 94), so it fits at any `--ew` ≥ ~200px. OK.
7. **`.island`** — `max-width:calc(100vw - 16px)` (notch.html:21) prevents any viewport breakout even when `--ew` is set to 900px (settings slider max, line 137). The `zoom:var(--scale)` on `.anchor` (line 20) scales but never expands the layout box beyond the clamped island.
8. **`#say`** — `width:min(660px,96vw)` (notch.html:91): safe.
9. **Tray pill `.tp`** — `layout()` caps width at 316px (tray-pill.html:70) inside a 340px window; margins (8/12px) fit. However the **expanded height** `52 + extb.offsetHeight` is uncapped — tall menu/notification content can exceed the 250px window height (vertical clipping; the window has no scroll).
10. **Tray pill `.rowp`/`.slot`** — avatar 38px + `.col2` (flex:1, min-width:0) + slot (stack/chev, ~90px) fits 316px; OK.

## 2. CHAT UI (`apps/host/src/client/Chat.tsx`, `ChatTranscript.tsx`)

### Composer controls (Chat.tsx)
- **Hidden file input** — L2461-2472; `accept` includes pdf/.docx/.doc/.pptx/.zip etc.; onChange → `addFiles`.
- **Tray-file notice** — L2473.
- **Attachment chips + remove** — L2474-2501; per-chip X (L2486-2497) filters state.
- **Source-URL row + toggle** — L2502-2546 (input, remove), toggle button L2550-2566 (`setSourceOpen`).
- **Attach button** — L2568-2584 → `attachInput.current?.click()`.
- **Textarea** — L2586-2626; Enter via `shouldSubmitComposerOnKeyDown` (chat-composer.ts), paste handles dropped files, maxLength 4000.
- **Composer mic button** — L2628-2644: sets `setInlineVoice(true)`.

  ⚠ **Broken/conflicting**: title says *"Voice chat is separate — use the mascot to talk"* while it actually opens the inline voice bar; unlike the header mic (L2244-2255) it has **no `disabled` guard** for `paused || !loaded || !contextReady`, and it **never calls `sharedVoice?.stop()`** — opening it while a shared voice session is live can stack two audio sessions; the header/closing path stops shared voice, this path does not.
- **Send / Stop** — L2646-2690: while running, a Stop button calls `copilotkit.stopAgent({agent})`; otherwise the send button is an implicit **submit** (no `type="button"`, no `onClick`) relying on the form `onSubmit` (L2451-2458) → `submitComposer`. Works, but is fragile if the form is ever nested, and a keyboard user gets no disabled-state feedback beyond the `disabled` attr.
- **Compose footnote** — L2694-2714 (delegate status / attachment count).
- **Slash commands** — `submitComposer` handles `/summary`, `/voice`, `/call`, `/rate`, `/agent`, `/help`, and NAV_COMMANDS (L1303-1438).
  ⚠ `/call` dispatches `CustomEvent('aegis:call-widget')`; it is only handled in `App.tsx:219-231` by forwarding to the desktop bridge `window.aegis.action('call-widget', …)` — **in a browser-only run there is no listener → the command silently does nothing.**

### Transcript header actions (Chat.tsx L2150-2257)
- **Run-trace toggle** — L2152-2168 (`setTraceOpen(!traceOpen)`, `aria-pressed`, works).
- **Save conversation as page** — L2170-2228 (`promptText` modal → POST `/conversations/:id/page` → `location.hash = /spaces/...`; disabled while running; works).
- **Schedule** — L2230-2242 (`onSchedule` prop; works).
- **Voice toggle** — L2244-2255 (header mic; stops shared voice on close; disabled when paused/unready; works).
- **Context banner / Retry** — L2374-2379; error banner Reconnect L2392-2416.

### ChatTranscript.tsx
- **Read-aloud button per assistant bubble** — L204-240 (`readAloud`/`stopReadAloud`, Piper; works).
- **Render tools hook**: `renderTools` prop is accepted (L129) but never passed by `Chat` — tool *cards* are rendered through Chat’s `useRenderTool('*')` (Chat.tsx:1770-1806), so this is an inert prop, not a dead button.
- **Call receipts / scheduled tags / images** — L147-153, 196-248, 254-276.

### Generative surfaces — available and used
- `GenerativeCards.tsx` → `BrowserActivityCard` (L66), `ProviderStatusCard` (L256), `MemorySourcesCard` (L428). All three are used by Chat: provider-status frontend tool (Chat.tsx:1542-1610), memory-sources frontend tool (L1612-1692), browser activity via useRenderTool (L1770-1806).
- `VisualCards.tsx` → `VisualUiCard` (L648), `ResearchBriefCard` (L769), `FencedChart` (L578). Used: `visualUiTool` frontend tool (Chat.tsx:1700-1738), stored-visual replay (L2323-2337), research brief card (L2339-2343).
- So every exported generative surface is wired; none are orphaned.

## 3. FILE MANAGER

### Listing / sorting / grouping
- Server `GET /files/surface` (workspace-routes.ts:126-225): merges (1) conversation pages (`pages.listByThread`) grouped `Chat: <title>` (L162-183), and (2) on-disk files from `generatedDir()` + `.aegis-data/uploads` grouped `Generated files` / `Uploaded files` (L186-216).
- Client `FilesSurfaceView.tsx` groups by chatGroup/category (L164-191); **no explicit sort anywhere** — order is backend insertion order (pages list order, `readdir` order).
- **Generated artifact dumps ARE shown**: any file in the generated dir (including raw dump/JSON/text artifacts) appears in the “Generated files” group with `kind` inferred from extension (kindFor, workspace-routes.ts:128-137).

### Preview pipeline (server)
- `previewKindFor` (workspace-routes.ts:50-56): image ext → `image`; `pdf` → `pdf`; a fixed text-extension list → `text` (≤64KB) or `text-too-large` (>65536); **everything else → `unavailable`**.
- `GET /files/preview` (L108-124): reads file, for text rejects NUL (`content.includes(0)` → `unavailable`, L119).
- `GET /files/raw` (L68-104): streams bytes with mime map (docx/xlsx/pptx/pdf/... L79-95).

### What happens per type
- **PDF**: `previewKind:'pdf'` → `FilesSurfaceView.tsx:534-545` renders an `<iframe src={downloadUrl}>` (native viewer). Works.
- **DOCX / DOC**: `previewKindFor` does not include `docx/doc` in the text list → `unavailable`. `FilesSurfaceView` then renders the fallback card **“Preview unavailable for this format”** (L561-570). There is **no DOCX preview anywhere**: no `mammoth`/reader dependency exists in the repo (only the *writer* `docx` package: `documents.ts:11`, `office-tools.ts:9,362-370`), so .docx never renders and never shows as text — it is simply “unavailable”.
- **BIN/unknown**: `unavailable` → same fallback card with “Binary, archive, and complex media files cannot be displayed inline…” (L567-568).

### Where corrupted binary shows as garbage
1. `workspace-routes.ts:117-120` — a “text” file whose bytes contain **no NUL** but are not valid UTF-8 is decoded with `content.toString('utf8')`, producing U+FFFD replacement characters shown in the inspector (`preview-code`, FilesSurfaceView.tsx:546-549).
2. `Chat.tsx:334-389` — attachment classification is extension-driven: any `.txt/.md/.log/.env/.ini/.yaml/.xml/.toml/...` file is read as text (`readAsText`) and **inlined into the user message**; a mislabeled binary with one of those extensions becomes garbage in the transcript.
3. `memory-document-service.ts:132-133` — upload indexing reads UTF-8 and only skips NUL; binary without NUL is stored as a memory document and indexed into RAG.
4. `workspace-routes.ts:518-537` (`POST /attachments`) — client-supplied base64 is stored as-is with no mime/byte sniffing.

## 4. MEMORY

### Document listing / raw IDs
- `GET /memory/documents` returns every column, including `id` (memory-document-routes.ts:18-25). The MemoryPanel document list shows title/format/chunk-count/state **but not the raw id** (MemoryPanel.tsx:1395-1407). Raw IDs **are** surfaced elsewhere: RAG result `Capture: <code>{res.capture_id}</code>` (MemoryPanel.tsx:1071), capture card footer `ID: {capture.id}` (L1183), graph edge “Capture ID” (L947), and Chat’s MemorySourcesCard `· capture {hit.capture_id}` (GenerativeCards.tsx:473).

### “Large context text”
- **No production UI produces a “large context text” label.** The string exists only in test fixtures: `docs/audit/prompts/skills-battery.json:19`, `docs/audit/results-skills-battery.json:75` (eval name `memory-large-context`), and `.aegis-data/stair_local_tree.json:95-98` (“Orbital Relay Handbook (large context test)”). The closest production analogues are the **64 KB preview cap** (“Preview truncated at 64 KB”, FilesSurfaceView.tsx:562; `text-too-large` in workspace-routes.ts:55) and per-document `ragChunkCount` (MemoryPanel.tsx:1405,1424).

### Unnecessary content injected into RAG results
1. **Daemon recall returns full memory text, not chunks** — `services/daemon/aegis_daemon/memory.py:738-745` sets `"text": mem["text"]` (the whole memory row) per hit; chunk rows are only used for ranking (BM25/vector). So every result carries the whole stored text.
2. **Whole-file ingestion** — host `indexDocument` sends the entire document with a class header as a single memory: `` `[document class: ${docClass}]\n${doc.title}\n\n${doc.content}` `` (memory-document-service.ts:173-180). The daemon chunks for the index, but the *memory row* remains the whole file, which is what recall returns.
3. **Host unified search duplicates whole files** — `searchUnifiedMemory` SQLite branch returns `text: doc.content` (full content, memory-document-service.ts:249) and always scores `1.0` (L251), mixing with daemon hits.
4. **Combined captures** — same-capture memories are collapsed via `mem_by_capture[cap_id][0]` (memory.py:667-669,715), so a capture with multiple memories returns only the first row’s text.
5. **Personal memories injected into every turn** — `/memories` host store is described as “injected into every agent prompt” (api.ts:223-229; MemoryPanel.tsx:1210-1212). The onboarding vault writes the full AES-GCM blob as a personal memory (`AgentOnboardingModal.tsx:460-462`) — filtered from the UI by `isEncryptedMemory` (MemoryPanel.tsx:34-37) but still present in the prompt-injected store.

### Short-term vs long-term separation — what it would touch
- **State shapes**: `AegisMemoryStateResponse`, `AegisCaptureItem` (api.ts:110-124,146-151); `HostMemory` (api.ts:225-229); `MemoryDocument` (store.ts:33-47) — none carry a lifetime/tier field.
- **Stores**: SQLite `memories` + `memory_documents` tables (store.ts:81-97); daemon `captures`/`memories`/`chunks`/`tree_nodes`/graph (services/daemon/aegis_daemon/db.py:15-48).
- **Routes**: `/memories` CRUD, `/memory/documents` + `/memory/capture` (memory-document-routes.ts), `/aegis-memory/*` (aegis-memory-routes.ts), `/aegis-memory/search` scope_id plumbing (aegis-daemon.ts:475-496; memory.py:658).
- **UI tabs**: “overview / graph / rag / documents / personal” (MemoryPanel.tsx:29, 587-631) — a short/long split would map onto these tabs + the daemon `scope_id` filter.

## 5. RESEARCH PANEL (`apps/host/src/client/ResearchPanel.tsx`)

- **OpenAlex “Search works”** — L150-157 + `searchWorks` L92-100 → `callAegisResearch('openalex.search_works', …)` (api.ts:405-413). **Live**, not a stub.
- **GitHub “Analyse”** — L207-214 + `loadRepo` L102-111 → `github.repo`/`github.commits`. **Live**.
- **Finance look-up + watchlist chips** — L431-433, L436-448 → `GET /api/research/finance?symbol=`. **Live** (server proxies Yahoo chart API).
- **News search + category pills** — L621-623, L626-644 → `GET /api/research/news?q=`. **Live** (Google News RSS).
- **TimeFM “not loaded” line** — L524-527: *“Time-series model (TimeFM): not loaded — runs on demand for forecast overlays; nothing is loaded at startup.”* There is **no control, button, or forecast overlay anywhere** — this is an informational placeholder for a **dead feature** (no action attached).
- **Fictional fallback on unconfigured Live mode** — server `research.ts:71-108` returns a fabricated “fictional sample, not live research” brief (with placeholder URL `https://fieldnote.example/research`, L94) when Live mode is not configured; this is placeholder-content behaviour worth flagging even though it is clearly labelled.
- No other no-op buttons exist; all forms/buttons have real handlers and error/empty states.

## 6. AGENTS PAGE

### Task-board elements to remove for an agent-focused view (`AgentsWorkspace.tsx`)
- **Default “Tasks” tab** — L453 (`tab` state), L670-679 (tab + count badge), and L720-787 (`.ag-tasks-layout` list + detail). The list header literally says **“Task board”** (L723).
- **Task list items with status pills + progress bars** — L732-763 (`.ag-task-item`, `.ag-progress`, `StatusPill`).
- **TaskDetail machinery** — plan & specialist reports (L245-262), synthesis section (L264-280), execution trace timeline (L282-305), Stop/Run-again (L220-239), subtask expanders (L110-185).
- **`STATUS_LABEL` / `STATUS_ICON` / `isActiveStatus`** — L53-80 (status vocabulary only used by task UI).
- **Keep (agent-focused)**: `TeamCard` grid (L310-347, tab L681-690), `FlowGraph` (L349-440, tab L691-699), composer + agent select (L612-662), runtime header (L587-609).

### HarnessPanel — existing capabilities (`HarnessPanel.tsx`)
Fully functional panel: status/engine + runtime badges (L161, 190-210), “New session” (L179-186), session list (L227-242), approval gate Approve/Reject (L273-316), execution output with exit codes (L319-346), run-prefix chips `$ / node: / python: / tool:` (L357-388), composer send (L390-421). It is a ready-made execution surface that can absorb the task-board role.

### Onboarding stubs to flag (`AgentOnboardingModal.tsx`)
- **Google “Authenticate Google Workspace”** — L770-776 only toggles local `googleConnected` state; no OAuth flow (the OAuth client-id is just an optional text field, L757-768).
- **WhatsApp QR/pairing** — L824-835: `.qr-box-mock` is a static mock (L825-827) and the button label is literally **“Simulate Pairing Device”** (L834), toggling `whatsAppPaired` locally.
- These are simulated/snub flows (they only write the local vault record), not real integrations.

### Cross-cutting
- Chat delegates `/rate /agent` to the runtime and tells the user reports land on the **“Agents task board”** (Chat.tsx:1257) — if the board is removed, that string and the delegation report path need updating.
- AgentsWorkspace refreshes every 5s (L482-486) and task detail every 2.5s (L507-512) — heavy if kept as a background surface.
