# Aegis desktop surfaces v2 — notch, mascot overlay, widgets, tray pill

Spec and integration notes for the coding agent wiring these pages into the Electron app on Windows.

## Files

| File | What it is | Replaces |
|---|---|---|
| `notch.html` | Notch on the top edge: small tab → answer card → notification → hover workspace | the app's current notch page |
| `overlay.html` | Floating mascot, click to talk; status pill and notifications **below** it, no buttons | the app's current overlay page |
| `widgets.html` | Widget board: 27 rich cards plus a searchable library of 340 tiles | the app's current widgets page |
| `tray-pill.html` | NEW. Pill that pops out of the tray icon, plus animated tray-icon frames | — |
| `annotations.html` | Screen annotation layer: the agent's own cursor, highlighted buttons, hand-drawn diagrams, step-by-step captions | the app's current annotations page |
| `showcase.html` | Review only: all surfaces on a fake Windows desktop with state buttons | not loaded by the app |

These are build output, copied here by `../desktop-ui/build.mjs`. Edit `../desktop-ui/src/*`, then run `npm run build` in `../desktop-ui`. Never edit the files in this folder by hand.

Every built page is one self-contained file (no network files, no fonts, no images). Opened in a normal browser without `window.aegis`, each page runs in **preview mode** with demo data and a strip of state buttons. Inside the app, no demo data is shown: a card with no data hides itself.

Look: near-black pills and cards, coral accent `#E8714F`, coloured data (green, blue, violet, amber, red), Segoe UI Variable. Dark is the default. A light variant exists: load a page with `?theme=light`.

## Content-Security-Policy

Same as the current pages plus one addition:

```
default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data:;
connect-src https://api.open-meteo.com https://geocoding-api.open-meteo.com;
```

`connect-src` is only for the weather card. If you do not want the renderer on the network, remove it and push weather from the host instead (`weather` field below). Album art must be a `data:` URL or a file served from `'self'`.

## Window setup on Windows

All four windows: `frame: false, transparent: true, resizable: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: false, focusable: false` (see "Typing" for the one exception), then `win.setAlwaysOnTop(true, 'screen-saver')`.

Click-through: start with `win.setIgnoreMouseEvents(true, { forward: true })`. The pages call `aegis.hover(true|false)` as the pointer enters and leaves real content; on `hover(inside)` call `win.setIgnoreMouseEvents(!inside, { forward: true })`. The `forward: true` part is required on Windows, otherwise the page never sees the pointer come back.

Use `screen.getPrimaryDisplay().bounds` for the notch (it must touch the very top edge of the screen) and `workArea` for the others so the taskbar is respected. Sizes below are DIPs; Electron applies 125 % / 150 % display scaling itself.

| Window | Size (DIP) | Position |
|---|---|---|
| Notch | **680 × 470**, fixed (640 × 320 is enough) | centred, `y = 0` |
| Overlay | **280 × 340**, fixed | user-draggable; default bottom-right of `workArea` |
| Widgets | 960 × up to 720 (or `min(960, workArea.width - 40)`) | centred |
| Tray flyout | **340 × 250**, fixed | bottom-right of `workArea`, 8 px above the taskbar |

The notch window never needs resizing: the notch grows inside its fixed transparent window and the empty area is click-through. It reports `action('notch-size', {width, height})` if you prefer to shrink the window; ignoring it is fine.

## Notch

Modelled on NotchOwl (macOS), rebuilt for Windows: a black tab hanging from the top edge of the screen.

| State | Size | When |
|---|---|---|
| Rest | 300 × 38 | idle: mascot, name, weather or now-playing bars, clock (or the focus countdown) |
| Active | 372 × 38 | listening, thinking, working, speaking: state, live text, level bars, progress % |
| Answer | 400 × 130–318 | one card that matches what was asked; closes 12 s after it opens, or 4 s after the pointer leaves |
| Notification | 400 × content | stays until answered if it asks a question; others 7 s; hovering pauses the timer and never replaces it |
| Subagents | 400 × up to 318 | drops down for 7 s whenever a subagent is spawned; faces stack in the notch while they run |
| Workspace | **620 × 300** | pointer rests on the notch for 260 ms; closes 420 ms after leaving |

**Clicking the notch does not start the microphone** (see "Clicking the notch" below). Nothing is ever resized by hand.

**Workspace** (hover): header with Open app, Widgets and tabs.
- *Workspace* tab: Today's tasks (type or say them, tick, remove), Focus timer (15 / 25 / 45 / 60 min; the countdown shows in the resting notch), Notepad (one note per day, autosaved), Events (next meeting with Join, today's schedule).
- *Live* tab: music, live activities, weather, system, devices, market, tracking, navigation, health, payments.
- *Agents* tab: subagent tree, execution steps, activity feed, security, model, voice.
- *Widgets* tab: the tiles pinned from the widget library.

Tasks, focus timer and notepad are stored locally (`localStorage` keys `aegis.tasks`, `aegis.focus`, `aegis.pad.<date>`). Task changes are also reported as `action('widget', {id: 'tasks', action: 'changed', value: [...]})` if the host wants to sync them.

**Dynamic answers.** Every user utterance (last `transcript` entry with `role: 'user'`, a typed question, or a pushed `heard` field) goes through a keyword router (English + Hinglish) in `core.js` (`INTENTS`). It only decides what to *show*; the spoken answer still comes from the assistant.

| User says | Notch shows / does |
|---|---|
| "What's the time?" | clock card |
| "What's the date?", calendar, schedule, meetings | calendar + today |
| "Play the song", music, volume | music player |
| "What's my flight?", ride, charging, order | the matching live activity |
| "GPU usage?", CPU, RAM | system monitor |
| "Which devices are connected?", Bluetooth, battery | devices |
| "Stock price?", Bitcoin, market | market card |
| weather, timer, alarm, package, directions, health, payments, agents, notifications | the matching card |
| "Open Aegis" | `aegis.show()` |
| "Show me the widgets" / "Hide the widgets" | `aegis.showWidgets()` if it exists, else `toggleWidgets()` / `hideWidgets()` |
| "Add task call the bank", "Remind me to …" | adds the task, opens the workspace briefly |
| "Start focus" / "Stop focus" | starts / pauses the focus timer |
| "Close", "Never mind" | closes the open card |

Every command also sends `action('voice-command', {command, text})`. If the host prefers to decide itself, push the view directly in any `onStatus` / `onUpdate` payload: `{ view: 'schedule' }`, `{ view: { id: 'live', q: 'flight', ms: 15000 } }`, `{ view: 'none' }` to close. View ids are the card ids: `clock, schedule, weather, media, live, system, devices, market, timer, alarms, tracking, navigation, health, payment, agents, research, notes, security, model, call, meeting, ask`.

Two things to check in the host: (1) "show widgets" falls back to `toggleWidgets()`, so if the board is already open it will close; add `showWidgets` to the preload to make it exact. (2) If the host already handles "open Aegis" itself, remove the `cmd:` rows from `INTENTS` so it does not run twice.

A card only has something to show if its data has been sent (table below). Time, date, timers, tasks and notepad work with no data. Without data the notch shows "No … data yet".

### Clicking the notch (changed in v5)

Clicking the notch **never starts the microphone**. A click opens the workspace (same as hovering) or closes whatever is open. Voice starts only from: the coral **Talk** button in the workspace header, a click on the mascot, the tray flyout, the global shortcut, or the wake phrase. The small mic icon on the right of the notch is only an indicator; while Aegis is listening, clicking it stops listening.

Clicking a **subagent face** in the notch opens the subagent tree with that subagent expanded. Clicking the stack again closes it.

## Subagents

Send the list in any `onStatus` / `onUpdate` payload as `agents` (or `subagents`):

```js
{ agents: [{ id: 'a1', name: 'Web researcher', character: 'memory', state: 'working', task: 'Searching 14 sources', progress: 40, parent: 'aegis' }] }
```

or incrementally: payload field `agent: { event: 'spawn' | 'update' | 'done' | 'remove', id, ... }`, or `onEvent('agent:spawn' | 'agent:update' | 'agent:done' | 'agent:remove', agentObject)`. `character` is one of the mascot kit characters (`aegi, mail, social, files, memory, harness, security`); `state` is any mascot state. If only `runningCount` is sent, the notch shows "n agents" with no detail.

What each surface does with them:

| Surface | While subagents run | On spawn | On finish |
|---|---|---|---|
| Notch | faces stack next to the name (up to 3, then "+n"), blue edge | lead mascot hops, the subagent tree drops down for 7 s: lead row, one row per subagent with character, task, progress bar | row shows "✓ done" and fades |
| Mascot overlay | nothing beside the mascot (the subagents live in the notch); the pill reads "Delegating to n subagents" | mascot hops and stretches | mascot nods |
| Tray flyout | face stack in the pill, progress rows in the panel, count badge on the tray icon, count in the tooltip | pill pops up | — |
| Widgets board | Agents card, `Subagents running` and `Agent roster` tiles | — | — |

Voice: "show my subagents", "what are the agents doing" opens the tree. Clicking a row sends `action('widget', {id: 'agents', action: 'open', value: <agent id>})`.

### Subagent rows are interactive

Clicking a row (in the notch tree, the Agents tab, or the widgets board) expands it: state, model, tool count, up to four `steps`, the last three `log` lines, and three buttons. Optional fields on the agent object: `model`, `tools` (number), `steps` (`[{text, state}]` or strings), `log` (array of strings).

| Button | Action sent to the host |
|---|---|
| Pause | `action('widget', { id: 'agents', action: 'pause', value: <agent id> })` |
| Resume | `action('widget', { id: 'agents', action: 'resume', value: <agent id> })` |
| Stop | `action('widget', { id: 'agents', action: 'stop', value: <agent id> })` |
| Open | `action('widget', { id: 'agents', action: 'open', value: <agent id> })` — open that agent's run in the main app |

The host must act on these and push the new state back (`state: 'paused'`, or remove the agent). In the browser preview the page fakes the result so the buttons can be tried.

## Widget library (340 tiles)

`src/lib.js` defines 340 tiles in 15 groups (Aegis, System, Time, World clock, Weather, Media, Productivity, Messages, Developer, Finance, Health, Travel & live, Home, Tools, Daily). They are built from 8 templates: `stat`, `ring`, `bar`, `spark`, `list`, `toggle`, `tool`, and world-clock stats.

- **140 work with no extra data**: they compute locally or read what the pages already receive (state, steps, subagents, `getSystemMetrics`, weather, media, schedule, tasks, focus timer, 44 world clocks, countdowns, date maths, tools, daily tips).
- **200 need the host to send a value.** Until then the tile shows "waiting for data". In a browser preview they show demo numbers, marked "demo value" in the tooltip.

Feeding a tile: add `x` to any payload (or under `widgets.x`), keyed by tile id:

```js
{ x: { 'sys-diskc': { p: 71, s: '142 GB free' }, 'ms-slack': 5, 'dv-ci': { v: 'Failing', c: '#F2555A' },
       'fn-nifty': { v: '19,840', s: '▲ 0.4%', pts: [19710, 19760, 19800, 19840] }, 'hm-lights': { on: true } } }
```

Value shape: a bare number/string, or `{ v, u, s, p, pts, items, on, c }` = main value, unit, sub line, percent 0–100, sparkline points, `[[label, value]]` rows, toggle state, colour. Toggling a tile sends `action('widget', {id: <tile id>, action: 'toggle', value: bool})`. All ids are in `src/lib.js` (`grep "\['" src/lib.js`); adding a tile is one row in that file.

Where they show up:
- **Widgets board:** "Add widgets" opens the library (search, group filters, click to pin or unpin). Pinned tiles sit above the rich cards; the pinned set is `localStorage['aegis.lib']` and is reported as `action('widget', {id: 'library', action: 'changed', value: [...]})`.
- **Notch:** the *Widgets* tab shows the pinned tiles. Any question that matches no built-in card is looked up in the library by title, so "disk space", "time in Tokyo", "open PRs", "NIFTY" show the matching tiles. The host can force it with `{ view: { id: 'x', q: ['sys-diskc', 'sys-diskd'] } }`.

## Mascot overlay

Just the character, and a small speech pill below it (subagents are shown in the notch, not here); there are no buttons. The character is a fixed size (64–116 px from the window width) and never scales on hover or pointer movement. **Click = start listening**, double-click opens Aegis, drag moves the window via `action('move-overlay', {dx, dy})` in screen pixels, right-click sends `action('overlay-menu', {x, y})` so the host can show a native Windows menu (hide mascot, widgets, notch). The controls that used to be buttons here now live in the tray flyout.

The pill is hidden while idle (on hover it shows only "Ready") and shows state, typed-out text, progress and "Step 2 of 4" while Aegis is active. Up to two notification cards stack under it.

Animation (all in `core.js`, layered on top of the mascot-kit poses, so the notch, tray and board mascots get it too):
- every state change gets a squash-and-stretch pop;
- hops have a crouch, a stretched flight with a slight spin, and a squashy landing that settles;
- idle fidgets picked at random (wiggle, stretch, peek, nod) plus glances and the occasional hop, so it never loops identically;
- it leans toward the pointer, and wobbles like jelly while dragged and after release;
- waves on hover, sparks when a task finishes, ripples while listening, orbit while working, sleeps after 2.5 minutes idle.

Voice commands are run by the notch page. If the notch is switched off, load the overlay as `overlay.html?commands=1` so it runs them instead.

## Annotations (`annotations.html`)

A full-screen, transparent, click-through layer. Aegis uses it to explain things on screen: its own cursor glides to a control and highlights it, or it draws a diagram stroke by stroke. Standalone file (no shared runtime), same strict CSP as the other pages.

Window: one per display, bounds = the display bounds, `transparent: true`, `frame: false`, `focusable: false`, `skipTaskbar: true`, `alwaysOnTop` at `'screen-saver'`, and `setIgnoreMouseEvents(true)` permanently (the page never needs the mouse). Coordinates are CSS pixels of that window: if the model returns physical screen pixels, divide by the display `scaleFactor`; normalised boxes need no conversion.

Bridge (same names as the current page):

```js
window.aegisAnnotations.onDraw(cb)   // host → page: cb(payload)
window.aegisAnnotations.onClear(cb)  // host → page: remove everything
window.aegisAnnotations.done(info)   // page → host, optional: sequence finished ({ steps })
```

The old payload still works unchanged (`targets`, `shape`, `pointer`, `drawings`, `explanation`, `next`, `timeoutMs`, `clear`). New: `steps`, more drawing types, key caps, and the cursor.

```js
// "I want to render the file, which button do I click?"
{ cursorName: 'Aegis', steps: [
  { explanation: 'Open the Render menu in the top bar.',
    targets: [{ bbox: [0.0, 0.065, 0.03, 0.105], label: 'Render menu', note: 'Click here first.', click: true }] },
  { explanation: 'Now choose Render Image.',
    targets: [{ x: 98, y: 32, width: 216, height: 22, label: 'Render Image', keys: ['F12'], click: true }],
    next: 'wait for the image' } ] }

// "Explain the Pythagoras theorem"
{ steps: [
  { explanation: 'This is a right-angled triangle.', targets: [{ bbox: {x: 150, y: 380, width: 150, height: 110}, shape: 'circle', label: 'The triangle on your page' }] },
  { explanation: 'Squares on each side.', drawings: [{ type: 'pythagoras', x: 900, y: 560, a: 4, b: 3, side: 30, squares: true, formula: true }] } ] }
```

| Field | Meaning |
|---|---|
| `steps[]` | each step: `explanation`, `targets` (or `target`), `drawings`, `next`, `waitMs` (default 2200), `keep` (keep the previous highlights), `clear` (also wipe earlier drawings) |
| `targets[]` | where: `bbox` as an object, or as `[ymin, xmin, ymax, xmax]` in 0–1 or 0–1000 (Gemini format), or `x, y, width, height`, or `point`. Plus `label`, `note`, `keys` (key caps), `step` (number badge), `shape` (`box`, `circle`, `none`), `color`, `click` (ripple), `padding`, `dim` |
| `drawings[]` | `pythagoras`, `triangle`, `arrow`, `line`, `rect`, `circle`, `ellipse`, `polygon`, `polyline`, `freehand`, `path` (`d`), `highlight`, `angle`, `rightangle`, `point`, `text`, `formula`, `label`; options `color`, `fill`, `label`, `dashed`, `bend`, `delay` |
| `explanation`, `next` | caption bar text; with steps it shows "Step i of n" |
| `timeoutMs` | how long the last step stays (default 12000); `0` keeps it until `onClear` |
| `unit` | `px` or `norm`; detected automatically if omitted |
| `dim` | `false` to stop darkening the screen around a target |
| `cursorName` | name tag on the cursor (default "Aegis") |
| `caption` | `'top'` to move the caption bar to the top |
| `clear` | `true` removes everything |

The quality of this feature depends on the coordinates the host sends. The page only draws; the host must locate the button (UI Automation `BoundingRectangle` is exact; a vision model's box is approximate) and send its rectangle. Speak each `explanation` with TTS as the step starts, or send one step at a time when the voice finishes.

Opened in a browser, the page shows a fake document and a fake Blender window with three demo buttons. That preview never appears when the bridge exists.

## Tray flyout (`tray-pill.html`)

Three stages, all growing from the corner nearest the tray icon:
1. **Dot**: a state-coloured dot jumps out of the tray icon with a pulse.
2. **Pill** (214–316 × 52): mascot, state, current text, and a context slot on the right: level bars while listening or speaking, a progress ring while working, stacked subagent faces, or a green tick when a task finishes. A light sweep runs across it while busy.
3. **Panel** (316 × about 170–215), opened by clicking the pill or the tray icon: a Talk button, four controls (Open, Notch, Mascot, Widgets) and progress rows for running subagents. A notification opens the panel with its title, text and action buttons instead; a question stays until answered.

It appears when the state leaves idle, a subagent spawns or a notification arrives, stays 4.5–7 s (not while hovered), then folds back to the dot and drops into the tray. It sends `action('tray-pill', {visible})`: on `true` call `win.showInactive()`, on `false` hide the window. Forward tray events to the page as `onEvent('tray:hover')` (show the pill) and `onEvent('tray:click')` (open the panel). If the taskbar is on the left or top, load it with `?anchor=bottom-left` or `?anchor=top-right`.

Animated tray icon: while this page is loaded it calls `aegis.trayUpdate({state, tooltip, icon, frame: true})` 8 times a second while Aegis is active and every 3 s when idle. `icon` is a 32 × 32 PNG data URL: the animated mascot inside a ring (progress arc while working, pulsing while listening or speaking, spinning otherwise) with a blue count badge when subagents are running. In the main process, inside whatever handler already receives `trayUpdate` (the channel name below is a placeholder):

```js
ipcMain.on('tray-update', (_e, { tooltip, icon }) => {
  if (icon) tray.setImage(nativeImage.createFromDataURL(icon).resize({ width: 16, height: 16 }));
  if (tooltip) tray.setToolTip(tooltip);
});
```

If you ignore `icon`, the existing static tray behaviour keeps working.

## Typing

Task input, notepad and the ask bar need keyboard focus. The page sends `action('want-focus', true|false)`; on `true` call `win.setFocusable(true); win.focus()`, on `false` `win.setFocusable(false)`.

## Bridge (unchanged calls)

`aegis.hover`, `show`, `voice`, `toggleWidgets`, `toggleNotch`, `toggleMascot`, `hideWidgets`, `hideOverlay`, `action(name, payload)`, `trayUpdate`, `mediaControl(previous|playPause|next|volumeDown|volumeUp)`, `getSystemMetrics()`, `onStatus`, `onUpdate`, `onEvent` (`mic:start`, `mic:stop`, `agent:working`, `agent:done`, `app:idle`), `aegisOverlay.onStatus(text)`.

Optional new ones, used if present: `aegis.ask(text)`, `aegis.onWidgets(cb)`, `aegis.onNotify(cb)`.

## Data in: `onStatus` / `onUpdate` payload

Everything the current pages accept still works (`status|text|prompt`, `state`, `character`, `runningCount`, `transcript`). New optional fields:

| Field | Shape | Shown as |
|---|---|---|
| `progress` | 0–100 | progress bars, tray ring |
| `steps` | strings or `{text, state}` with state `done`, `now`, `todo` | execution-steps card, overlay "Step n of m" |
| `step` | index of the current step (when `steps` are strings) | same |
| `tools` | number | "2 tools executed" |
| `view` | card id, or `{id, q, ms}` | opens that card in the notch |
| `heard` | string | runs the keyword router on this text |
| `notice` or `notification` | string or `{title, body, kind, steps, progress, actions}` | notification in notch, overlay, tray pill, activity feed |
| `media` | `{title, artist, app, art, position, duration, playing, volume}` | music player |
| `agents` / `subagents` | `[{id, name, character, state, task, progress, parent}]` | subagents everywhere (see Subagents) |
| `agent` | `{event, id, …}` | one subagent spawn / update / done / remove |
| `x` | `{ <tile id>: value }` | widget-library tiles |
| `metrics` | `{cpuPercent, memoryPercent, usedMemoryGb, totalMemoryGb, gpuPercent}` | GPU / system card |
| `weather` | `{temp, kind, city, high, low, …}` | weather card without network |
| `widgets` | object keyed as below | all other cards |

Notification `kind`: `info`, `done`, `error`, `ask`. `actions` is `[{id, label}]`; a click sends `action('widget', {id: 'notification', action: <action id>, value: {id: <notification id>}})`. Two notifications are created automatically: "Task finished" (with the completed steps) when a running task reaches `done`, and "Needs attention" on `error`.

### `widgets` keys

| Key | Shape |
|---|---|
| `research` | `{name, text, steps, progress}` |
| `voice` | `{stt, lang, tts}` |
| `security` | `{pending, label}` |
| `model` | `{provider, model, mode, status}` |
| `conversations` | `{active}` |
| `schedule` | `{more, items: [{title, start, end, color}]}` |
| `alarms` | `[{id, time, repeat, on}]` |
| `devices` | `[{name, battery, connected}]` |
| `health` | `{sleep, steps, calories, heart}` |
| `market` | `[{symbol, name, price, change, currency, points}]` |
| `payment` | `{month, total, currency, last4, latest: {name, amount}}` |
| `tracking` | `{title, status, eta, progress, stops, by}` |
| `navigation` | `{next, destination, distance, eta}` |
| `meeting` | `{title, start, people, app}` |
| `call` | `{name, agent, startedAt or duration, status}` |
| `status` | `{wifi, bluetooth, battery, charging}` |
| `replies` | `[string]` quick replies under the ask bar |
| `live` | `[{id, title, value, sub, progress, from, to, color, icon or glyph}]` |

`live` is the generic black live-activity pill: ride drop-off, flight, EV charge, heart rate, lap time, order pickup, transit and so on. `color` is one of `green, blue, violet, amber, red, pink, cyan, accent` or any CSS colour; `glyph` is a single character or emoji; `from`/`to` draws a route bar.

Send only the keys you have. Timers and the weather city are kept locally by the page.

## Actions out

| User does | Page calls |
|---|---|
| Media buttons | `aegis.mediaControl(...)` |
| Volume slider | `action('volume', {value})` |
| Ask bar submit | `aegis.ask(text)`, else `action('ask', {text})` |
| Card buttons | `action('widget', {id, action, value})` |

Card actions in use: `research:pause|resume|open`, `security:open`, `model:open`, `conversations:open`, `meeting:join`, `call:hangup`, `tracking:open`, `live:open` (value = activity id), `alarms:toggle` (value `{id, on}`), `notification:<action id>`.

## Element ids

Kept from the current pages — notch: `island, compact, brand, open, status, voice, panel, avatar, chip, widgets, open-app, progress`; overlay: `stage, mascot-wrap, mascot-img, bubble, status`; widgets: `board, mascot-img, chip, status, task, transcript, voice, open, notch, mascot, hide`.

Removed (cards are generated, overlay buttons are gone): `expand, collapse, deck, talk, dock`, the overlay's `voice, open, notch, widgets, hide`, `card-mic, card-task, card-agents, card-media, card-alerts, card-system, cpu-value, memory-value, memory-meter, system-sub, time, weekday, date, foot-status, collapse, sub, meta, agents-unit`. If host code or tests query these, switch them to the payload fields above.

## Status of testing

v5.1 fixes: (1) the showcase had a CSS mistake that made the notch ignore the pointer, so hover did nothing there; fixed, and the notch also resets its hover state on `mouseout`/`blur` so it cannot get stuck. (2) Performance: cards are now patched in place instead of re-created on every progress update (subagent rows no longer replay their entry animation), cards that are not on screen are not rendered until shown, and the per-frame `--pulse` variable is set on the one element that uses it instead of `:root`. Measured in headless Chromium for 5 s after a spawn in the notch: style recalculation 1084 ms → 113 ms, main-thread time 2179 ms → 976 ms.

v5, checked in headless Chromium: clicking the notch leaves the state idle and opens the workspace; the Talk button starts listening; clicking a subagent face opens the tree with that row expanded; Pause, Resume and Stop change the row in preview; the overlay shows no mini characters; the annotation page plays the Pythagoras, Blender and all-shapes demos and an old-format payload with no errors. **Not run inside Electron on Windows**: click-through, multi-monitor and DPI scaling of annotation coordinates, and the host handling of the new `agents` actions still need checking in the real app.

Checked in headless Chromium: all pages and the showcase load with no console errors. Measured: notch 300 × 38 at rest, 620 × 300 as workspace, 400 wide for answers and the subagent tree; spawning subagents stacked faces in the notch, (v4, since removed) put mini characters beside the mascot and faces in the tray pill; the library rendered all 340 tiles, search and pinning worked; permission notifications kept their buttons in the notch and the tray panel. Not yet run inside the real Electron shell on Windows, so click-through, keyboard focus for typing, tray icon frame rate and 125 % / 150 % scaling still need a pass there.
