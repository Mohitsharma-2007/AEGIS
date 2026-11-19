# Aegis mascot, widgets and sounds — integration brief

**Audience: the coding agent integrating this kit into the Aegis voice-agent desktop app (Electron).**
This file is the single source of instructions. `MASCOT.md` and `SOUNDS.md` are reference catalogues; `manifest.json` is the same data in machine-readable form.

## 1. What you are integrating

| Piece | Purpose | Entry point |
|---|---|---|
| The crew | **7 mascots, one per job** (see section 2a): Aegi + mail, WhatsApp/socials, files, memory, harness, security. Each has its own shape, colours, personality and signature animations | `CHARACTERS` in `src/mascot.js`, `character` option everywhere |
| Mascot engine | Animated character showing what the agent is doing (34 states) | `src/mascot.js` → `AegisMascot`, `renderSVG`, `renderTrayIcon` |
| Sounds | 17 interface sounds, synthesised at runtime (no audio files needed) | `src/sounds.js` → `AegisSounds` |
| Event map | App event → mascot state + sound | `src/events.js` → `EVENTS`, `STATE_SOUNDS` |
| Widgets | Ready-made desktop layouts that contain the mascot | `src/widgets.js` → `mountWidget`, `toast`, `linkWidgets` |
| Tray icons | Per-state icons for the Windows system tray | `tray/ico/<character>/<variant>/<state>.ico`, `tray/png/<character>/<variant>/<state>-<size>.png` (size 16, 24, 32, 48), `tray/svg/...` |
| Static assets | Animated + still SVG of every character, variant and state | `svg/animated/<character>/<variant>/<state>.svg`, `svg/static/<character>/<variant>/<state>.svg` (variant = `color`, `dark`, `light`) |
| Reference app | Tray + flyout + desktop pet + pill, wired over IPC | `electron-example/` |

Everything in `src/` is dependency-free ES modules. Install with `npm install ./mascot-kit` (package name `aegis-mascot`) or copy `src/` into the renderer.

**Verification status.** The mascot engine, the widgets and both demo pages were exercised in headless Chromium with no errors. The Electron example was **not run** (Electron was not available where it was written): treat `electron-example/` as a reference implementation to adapt and test, not as proven code. The sounds were checked numerically but not listened to.

## 2. The model: one state machine, many surfaces

The app has exactly one "agent state" at a time. Every surface (tray icon, flyout, desktop pet, pill, task card, toasts) renders that same state.

```
voice pipeline (main process)
        │  aegis.emit('mic:start')            aegis.update({ steps, progress })      aegis.say('agent', text)
        ▼
   IPC broadcast  ──►  every widget window  ──►  widget.emit(name) / widget.update(patch) / widget.say(role, text)
        ▲                                                │
        └──────────  'aegis:action' (mic, send, pause, resume, cancel, mute, close)  ◄── user clicks
```

Rules:
1. The **pipeline** is the only thing that decides the state. Widgets never change state on their own in response to a click; they report the action and wait for the pipeline to emit the resulting event.
2. Emit **events** (`'prompt:send'`), not raw states, so the sound and the mascot stay paired. Use `setState` only for states with no event.
3. Exactly **one** renderer window owns an `AegisSounds` instance. Otherwise every window plays every sound.

## 2a. The crew: which mascot for which job

| Mascot | Job | Looks like | Colour | Personality (idle) | Signature states |
|---|---|---|---|---|---|
| **Aegi** `aegi` | Lead assistant: Talks to you, plans, and hands work to the specialists | Soft gumdrop with the logo "A" on its chest | #BA5B45 | calm, breathes and glances around | none (plays the common states) |
| **Posty** `mail` | Mail: Reads, drafts, sends and sorts email | Plump envelope with a flap and a gold seal | #3F6FE0 | eager, does a little hop | `mail-incoming`, `mail-sending`, `mail-reading` |
| **Chatty** `social` | WhatsApp & socials: Handles chats, DMs, mentions and posts | Speech bubble with a tail, rosy cheeks and an unread badge | #22A56A | bubbly, sways and smiles | `social-typing`, `social-message`, `social-react` |
| **Filo** `files` | Files: Finds, organises, uploads and converts files | Folder with a tab and a sheet of paper peeking out | #F2A72E | tidy, steady, peeks sideways | `files-organizing`, `files-upload`, `files-found` |
| **Memo** `memory` | Memory: Remembers facts and preferences, recalls context | Little cloud with a spark and two linked nodes | #7B5BE6 | dreamy, floats and looks up | `memory-saving`, `memory-recalling`, `memory-linking` |
| **Rig** `harness` | Harness: Runs tools, commands, tests and builds | Hex nut with bolts and a terminal prompt | #1596A4 | focused, ticks like a machine | `harness-running`, `harness-testing`, `harness-building` |
| **Guard** `security` | Security: Checks permissions, scans, locks and warns | Rounded badge with an inner outline and a mint keyhole | #33427F | watchful, stands firm, eyes sweep left and right | `security-scanning`, `security-locked`, `security-alert` |

Rules for the app:
- Show **Aegi** while the user talks to the assistant and while it plans. When the pipeline routes work to a tool family, **switch to that specialist** and switch back to Aegi for the spoken answer.
- Switch with a crew event (section 4, e.g. `mail:new`, `harness:run`, back with `crew:lead`) or directly: `mascot.setCharacter('mail')` / `widget.setCharacter('mail')`. The body morphs; colours and details change.
- Map your tool names to characters in one place (suggested: email/calendar-mail tools → `mail`; WhatsApp, Telegram, Slack, X, Instagram → `social`; filesystem, drive, documents → `files`; memory / notes / RAG → `memory`; shell, code, MCP tools, tests, builds → `harness`; permission prompts, secrets, scans → `security`).
- Every character plays all 16 common states. Signature states belong to one character; asking another character for them is allowed but the props are designed for the owner.
- Each character has three variants: `theme: 'color'` (its own colour, default), `'dark'`, `'light'`. Do not recolour a character with another character's colour: colour is how users tell them apart.

Signature states:

| State | Character | Use it when | Loop | Event | Sound |
|---|---|---|---|---|---|
| `mail-incoming` — **New mail** | Posty | A new email arrived | 2.4s | `mail:new` | `notify` |
| `mail-sending` — **Sending mail** | Posty | An email is being sent | 2s | `mail:send` | `send` |
| `mail-reading` — **Reading mail** | Posty | Reading, summarising or sorting the inbox | 3s | `mail:read` | — |
| `social-typing` — **Typing a reply** | Chatty | Drafting a chat or social reply | 1.8s | `social:typing` | — |
| `social-message` — **New message** | Chatty | New WhatsApp / DM / mention | 2.6s | `social:message` | `receive` |
| `social-react` — **Reacting** | Chatty | Liking, reacting, posting | 2s | `social:react` | `tap` |
| `files-organizing` — **Organising files** | Filo | Moving, renaming, sorting files | 2.4s | `files:organize` | — |
| `files-upload` — **Uploading / saving** | Filo | Uploading, saving, exporting a file | 1.8s | `files:upload` | `send-soft` |
| `files-found` — **File found** | Filo | The file or document was found / opened | 2.2s | `files:found` | `done` |
| `memory-saving` — **Remembering** | Memo | Saving a fact or preference to memory | 2.4s | `memory:save` | `send-soft` |
| `memory-recalling` — **Recalling** | Memo | Looking something up in memory, "I remember…" | 2.6s | `memory:recall` | `receive` |
| `memory-linking` — **Connecting memories** | Memo | Building context, linking notes and past conversations | 3s | `memory:link` | — |
| `harness-running` — **Running tools** | Rig | A tool call / command / pipeline step is running | 1.6s | `harness:run` | `tap` |
| `harness-testing` — **Running checks** | Rig | Tests, evals or validations are running | 2.8s | `harness:test` | — |
| `harness-building` — **Building** | Rig | Writing code, scaffolding, deploying | 2s | `harness:build` | — |
| `security-scanning` — **Scanning** | Guard | Checking permissions, scanning a file / link / request | 2.4s | `security:scan` | — |
| `security-locked` — **Secured** | Guard | Verified, encrypted, access locked | 2.2s | `security:locked` | `done` |
| `security-alert` — **Security alert** | Guard | Risky action, suspicious request, permission needed | 1.6s | `security:alert` | `error` |

## 3. States (common to every character)

| State | Meaning | Plays | Default status text | Status colour | Paired sound |
|---|---|---|---|---|---|
| `idle` | Resting, waiting for input | loops | Ready — Say “Hey Aegis” or press the mic | none | — |
| `hello` | App launch, wake word heard, greeting | once → `idle` | Hi! — Aegis is online | #22C55E | `wake` |
| `listening` | Microphone open, user is speaking | loops | Listening… — Go ahead, I’m listening | #EF4444 | `listen-start` |
| `thinking` | Model is reasoning / generating a plan | loops | Thinking… — Working out a plan | #F59E0B | — |
| `searching` | Web / file / memory search, tool lookups | loops | Searching… — Looking things up | #F59E0B | — |
| `working` | Long task running, tool executing, loading | loops | Working… — Running the task | #3B82F6 | — |
| `speaking` | TTS audio is playing | loops | Speaking — Answering out loud | #22C55E | `receive` |
| `sending` | Prompt submitted (Enter / send button) | once → `thinking` | Sending… — Got it | #3B82F6 | `send` |
| `paused` | User paused the agent / playback | loops | Paused — Press resume to continue | #9CA3AF | `pause` |
| `cancelled` | User cancelled / task aborted | once → `idle` | Cancelled — Stopped | #9CA3AF | `cancel` |
| `done` | Task finished successfully | once → `idle` | Done — Task finished | #22C55E | `done` |
| `notification` | New message, reminder, something needs attention | loops | Heads up — Something needs your attention | #EF4444 | `notify` |
| `confused` | Didn't understand, low confidence, needs clarification | loops | Sorry? — I didn’t catch that | #F59E0B | `confused` |
| `error` | Something failed (network, tool, permission) | loops | Something went wrong — Try again | #DC2626 | `error` |
| `sleeping` | Idle for a long time, do-not-disturb, mic muted | loops | Sleeping — Do not disturb is on | #6B7280 | `sleep` |
| `celebrate` | Big win, streak, onboarding complete | loops | Nice! — That went well | #22C55E | `celebrate` |

"once" states play one time and then fall through to the listed state automatically; override with `setState('sending', { then: 'searching' })`.

## 4. Events (what the pipeline should emit, and when)

| Event | Character | Mascot state | Sound |
|---|---|---|---|
| `app:start` | (current) | `hello` | `wake` |
| `key:enter` | (current) | (unchanged) | `tap` |
| `prompt:send` | (current) | `sending` | `send` |
| `mic:start` | (current) | `listening` | `listen-start` |
| `mic:stop` | (current) | `thinking` | `listen-stop` |
| `agent:thinking` | (current) | `thinking` | — |
| `agent:searching` | (current) | `searching` | — |
| `agent:working` | (current) | `working` | — |
| `agent:reply` | (current) | `speaking` | `receive` |
| `agent:speaking` | (current) | `speaking` | — |
| `agent:confused` | (current) | `confused` | `confused` |
| `agent:done` | (current) | `done` | `done` |
| `agent:error` | (current) | `error` | `error` |
| `agent:celebrate` | (current) | `celebrate` | `celebrate` |
| `user:pause` | (current) | `paused` | `pause` |
| `user:resume` | (current) | `working` | `resume` |
| `user:cancel` | (current) | `cancelled` | `cancel` |
| `notify` | (current) | `notification` | `notify` |
| `app:idle` | (current) | `idle` | — |
| `app:sleep` | (current) | `sleeping` | `sleep` |
| `mail:new` | → `mail` | `mail-incoming` | `notify` |
| `mail:read` | → `mail` | `mail-reading` | — |
| `mail:send` | → `mail` | `mail-sending` | `send` |
| `social:message` | → `social` | `social-message` | `receive` |
| `social:typing` | → `social` | `social-typing` | — |
| `social:react` | → `social` | `social-react` | `tap` |
| `files:organize` | → `files` | `files-organizing` | — |
| `files:upload` | → `files` | `files-upload` | `send-soft` |
| `files:found` | → `files` | `files-found` | `done` |
| `memory:save` | → `memory` | `memory-saving` | `send-soft` |
| `memory:recall` | → `memory` | `memory-recalling` | `receive` |
| `memory:link` | → `memory` | `memory-linking` | — |
| `harness:run` | → `harness` | `harness-running` | `tap` |
| `harness:test` | → `harness` | `harness-testing` | — |
| `harness:build` | → `harness` | `harness-building` | — |
| `security:scan` | → `security` | `security-scanning` | — |
| `security:locked` | → `security` | `security-locked` | `done` |
| `security:alert` | → `security` | `security-alert` | `error` |
| `crew:lead` | → `aegi` | `hello` | `wake` |

Events with a character in the table also switch the mascot to that crew member.

Typical run: `mic:start` → `mic:stop` → `prompt:send` → `agent:searching` / `agent:working` → `agent:reply` → `agent:done` → `app:idle`.
Add or rename events by passing your own map: `mountWidget(el, kind, { events })` / `createAegis(el, { events })`.

## 5. Widgets

All widgets are created with `mountWidget(target, kind, opts)` and return the same controller.

| kind | What it is | Natural size (CSS px) | Suggested host window |
|---|---|---|---|
| `pill` | Compact status bar: mascot, status, live waveform, pause/cancel (mic button when idle) | 290–420 × 56 | 440 × 80, transparent, always on top, top-centre of work area, `focusable: false` |
| `pet` | The mascot standing on the desktop with a speech bubble; click = talk; eyes follow the cursor | ~230 × 220 | 260 × 250, transparent, always on top, bottom-right above the taskbar, draggable, click-through outside the mascot |
| `panel` | Tray flyout: header, transcript, task steps, progress, pause/cancel, text input + mic + send | 360 × ~450 | 384 × 470, frameless, shown above the tray icon on click, hidden on blur |
| `card` | Desktop task widget: mascot, status, elapsed time, progress bar, current step, pause/cancel | 300 × ~105 | 330 × 130, transparent, pinned to a desktop corner |
| `toast` | Notification with the mascot; auto-dismisses | 320 × ~66 | stack in a transparent window at top-right, or inside the panel |

Screens: `preview/widgets-light.png`, `preview/widgets-dark.png`. Live: open `demo/widgets.html` and press "Run voice flow".

### Options

```js
mountWidget('#root', 'panel', {
  character: 'aegi',        // crew member: aegi | mail | social | files | memory | harness | security
  theme: 'color',           // 'color' (the character's own colour) | 'dark' | 'light' | custom theme object (see MASCOT.md)
  ui: 'light',              // 'light' | 'dark'  — widget chrome
  shape: null,              // optional body-shape override; leave unset to use the character's own shape
  size: 70,                 // mascot size in px (defaults per kind)
  state: 'idle',            // initial state
  sounds: sfx,              // an AegisSounds instance — pass it to ONE widget only
  follow: false,            // eyes follow the cursor (pet)
  title: 'Aegis', placeholder: 'Ask Aegis…',   // panel text
  timeout: 5000,            // toast auto-dismiss in ms (0 = stay)
  events: EVENTS,           // custom event map
});
```

### Controller

| Call | Effect |
|---|---|
| `w.emit('agent:done')` | Apply an event: mascot state + sound + default status text |
| `w.setState('searching', { silent, then })` | Set a state directly |
| `w.update({ status, sub, progress, steps, transcript })` | Set texts and data. `progress`: 0..1, or `null` for indeterminate. `steps`: `[{ label, state: 'todo' | 'active' | 'done' }]`. `transcript`: `[{ role: 'user' | 'agent', text }]` |
| `w.say(role, text)` | Append one transcript line (the pet and toast show it in the bubble) |
| `w.on(action, fn)` | User actions: `'mic'`, `'send'` (data = text), `'pause'`, `'resume'`, `'cancel'`, `'mute'` (data = muted), `'close'`; `'*'` for all |
| `w.setCharacter('mail')` | Switch crew member |
| `w.setTheme(theme)`, `w.setUI('dark')` | Restyle |
| `w.mascot` | The underlying `AegisMascot` |
| `w.destroy()` | Remove |

`linkWidgets([a, b, c])` returns a hub with the same methods that drives several widgets in one document at once (used by the demo). Across Electron windows, use IPC instead (section 6).

`toast(target, { state: 'done', status: 'Task finished', sub: 'Report saved', theme, ui, sounds, timeout })` shows a toast.

All user-supplied text is inserted escaped. Status colours per state are in `STATUS_COLORS`; default status lines are in `STATUS_TEXT` (both exported, both in `manifest.json`).

## 6. Electron wiring

Reference: `electron-example/main.js`, `preload.js`, `renderer.html`.

**Windows.** One `BrowserWindow` per widget, all loading the same `renderer.html?kind=<kind>&sounds=<0|1>`.

| Window | Key `BrowserWindow` options |
|---|---|
| all | `frame: false, transparent: true, resizable: false, skipTaskbar: true, hasShadow: false`, `webPreferences: { preload, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' }` |
| pet, pill | `alwaysOnTop: true, focusable: false`; show with `showInactive()` so they never steal focus from the user's app |
| panel | positioned from `tray.getBounds()` + `screen.getDisplayMatching(...).workArea`; `hide()` on `blur` |

**IPC contract.**

| Direction | Channel | Payload |
|---|---|---|
| main → renderer | `aegis:event` | event name (string) |
| main → renderer | `aegis:update` | `{ status?, sub?, progress?, steps?, transcript? }` |
| main → renderer | `aegis:say` | `role, text` |
| renderer → main | `aegis:action` | `action, data` |
| renderer → main | `aegis:hover` | `boolean` — pointer is over the widget (for click-through) |

**Main-process API to expose to the pipeline** (already in the example): `aegis.emit(name)`, `aegis.update(patch)`, `aegis.say(role, text)`, `aegis.onAction(fn)`.

**Tray.** On every event, map event → state and call `tray.setImage(...)` with `tray/ico/<character>/<variant>/<state>.ico` on Windows (`tray/png/<character>/<variant>/<state>-32.png` elsewhere) plus `tray.setToolTip(...)`. Use variant `color` or `light` on light taskbars and `dark` on dark ones.shouldUseDarkColors`. Left click toggles the flyout; the context menu toggles pet and pill and offers Sleep and Quit.

**Click-through.** Transparent windows block clicks on the desktop under them. The example sends `aegis:hover` on `mouseenter`/`mouseleave` of the widget and the main process calls `win.setIgnoreMouseEvents(!over, { forward: true })`.

**Dragging the pet.** The mascot area has `-webkit-app-region: drag`. A drag region swallows click events, so if you need both drag and click-to-talk, implement dragging manually (pointer events → `win.setPosition`) instead. Persist the position.

**Packaging.** The example imports `../src/index.js` directly. In a bundled app import from `aegis-mascot`; make sure `tray/` is copied to resources (`extraResources` in electron-builder) because tray icons are loaded by path from the main process.

## 7. Sounds

| Sound | When | Length |
|---|---|---|
| `tap` | Enter key pressed, button pressed, any small click | 0.12s |
| `send` | Prompt sent (Enter / send button) | 0.5s |
| `send-soft` | Alternative send sound — quieter, for frequent sends | 0.5s |
| `receive` | Agent reply arrives / first token | 0.5s |
| `listen-start` | Mic opens / wake word detected | 0.45s |
| `listen-stop` | Mic closes / end of speech detected | 0.45s |
| `pause` | User pauses the agent / playback | 0.6s |
| `resume` | User resumes after a pause | 0.6s |
| `cancel` | User cancels / stops the task | 0.45s |
| `done` | Task finished — the main "work is done" alert | 1.3s |
| `notify` | Reminder, incoming notification, needs attention | 1.1s |
| `error` | Something failed | 0.6s |
| `confused` | Didn't understand — ask the user to repeat | 0.65s |
| `wake` | App launch, agent comes online | 1.5s |
| `sleep` | Agent goes idle, do-not-disturb on, app closing | 1.3s |
| `celebrate` | Big success, milestone | 1.6s |
| `thinking-loop` | Optional quiet bed while the agent works — loops seamlessly | 2s (loop) |

```js
import { AegisSounds } from 'aegis-mascot';
const sfx = new AegisSounds({ pack: 'warm', volume: 0.6 });   // packs: `warm`, `crystal`
sfx.preload(); sfx.play('send'); sfx.startLoop('thinking-loop'); sfx.stopLoop('thinking-loop'); sfx.enabled = false;
```

Voice-specific rules:
- Play `listen-start` **before** opening the microphone (wait ~450 ms or use echo cancellation) so speech-to-text does not transcribe the chime.
- Do not play interface sounds while text-to-speech is talking; `receive` just before speech starts is enough.
- `tap` is for Enter and button presses only, never per keystroke.
- Expose mute and volume in settings (`sfx.enabled`, `sfx.setVolume(v)`, `sfx.setPack(name)`).
- Pre-rendered files exist in `sounds/<pack>/<name>.wav|.mp3` if you prefer `<audio>` or a native player.

## 8. Mascot only (no widget)

```js
import { AegisMascot, renderSVG, renderTrayIcon } from 'aegis-mascot';
const m = new AegisMascot('#slot', { character: 'aegi', theme: 'color', size: 120, follow: true, emblem: true, shadow: true });
m.setCharacter('mail'); m.setState('mail-incoming'); m.setCharacter('aegi'); m.setState('thinking');
m.setTheme('dark'); m.setTheme({ body: ['#FF7A59', '#7C3AED'], eye: '#fff', accent: '#111827', onAccent: '#fff', blush: '#FDBA74' });
const svg = renderSVG({ character: 'files', state: 'files-found', theme: 'color', animated: true });     // string, self-animating
const icon = renderTrayIcon({ character: 'aegi', state: 'listening', theme: 'dark' });            // string, square, readable at 16px
```

Variants per character: `color`, `dark`, `light`. Extra themes that work on any character: `snow`, `aurora`, `sunset`, `ocean`, `candy`, `neon`. Shape overrides: `aegi`, `mail`, `social`, `files`, `memory`, `harness`, `security`, `leaf`, `orb`, `squircle`, `blob`, `drop`, `aegis`.
For small sizes (under ~64 px) pass `emblem: false` — the widgets already do this for pill, panel and toast.

## 9. Integration steps

1. Add the package (`npm install ./mascot-kit`) and confirm `demo/index.html` (playground with all mascots) and `demo/widgets.html` (desktop widgets) both animate.
2. Create the main-process `aegis` module (copy from `electron-example/main.js`): windows, tray, IPC, `emit/update/say/onAction`.
3. Create the shared renderer page and preload (copy from the example). Give `sounds=1` to exactly one window.
4. Hook the voice pipeline: emit the events in section 4 at the matching points (mic open/close, prompt submitted, tool start, first reply token or TTS start, completion, error, cancel, pause/resume).
5. Feed data: `aegis.say()` for transcript lines, `aegis.update({ steps, progress, sub })` during tasks.
6. Handle actions in the pipeline: `mic` (start listening), `send` (submit text), `pause` / `resume`, `cancel`, `mute`.
7. Add settings: mascot theme, light/dark chrome (default: follow the OS), which widgets are visible, sound pack, volume, mute, do-not-disturb (`app:sleep`).
8. Persist window positions and widget visibility; restore on launch; start with `app:start`.

## 10. Acceptance checklist

- [ ] Every pipeline transition produces exactly one event; mascot state, tray icon and status text always agree across all windows.
- [ ] Each sound plays once per event (not once per window) and never while the microphone is open.
- [ ] Pause, resume and cancel from any widget reach the pipeline, and the UI changes only after the pipeline emits the resulting event.
- [ ] Pet and pill never take keyboard focus; clicks outside the widget shape reach the desktop.
- [ ] The flyout opens above the tray icon on any taskbar position and closes on blur or Escape.
- [ ] Tray icon is legible on light and dark taskbars; tooltip names the current state.
- [ ] One-shot states (`hello`, `sending`, `cancelled`, `done`) return to the right follow-up state.
- [ ] With OS "reduce motion" on, the mascot shows still poses; with sounds muted, nothing plays.
- [ ] Long transcripts scroll; long status text truncates without resizing the window.
- [ ] No errors in any renderer console during a full run.

## 11. Regenerating assets

```
node tools/docs.mjs      # MASCOT.md, SOUNDS.md, INTEGRATION.md  (run first: the demo embeds them)
npm run build            # svg/, tray/svg/, sounds/*.wav, manifest.json, demo/*.html, preview/*.svg
python3 tools/tray.py    # tray/png + tray/ico   (pip install resvg-py pillow)
```

To add a character, theme, state, sound or event, edit `CHARACTERS` / `THEMES` / `STATES` in `src/mascot.js`, `SOUNDS` in `src/sounds.js`, or `EVENTS` in `src/events.js`, then rebuild. To edit this brief, change `tools/INTEGRATION.template.md`.
