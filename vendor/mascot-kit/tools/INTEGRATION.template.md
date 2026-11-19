# Aegis mascot, widgets and sounds — integration brief

**Audience: the coding agent integrating this kit into the Aegis voice-agent desktop app (Electron).**
This file is the single source of instructions. `MASCOT.md` and `SOUNDS.md` are reference catalogues; `manifest.json` is the same data in machine-readable form.

## 1. What you are integrating

| Piece | Purpose | Entry point |
|---|---|---|
| The crew | **{{N_CREW}} mascots, one per job** (see section 2a): Aegi + mail, WhatsApp/socials, files, memory, harness, security. Each has its own shape, colours, personality and signature animations | `CHARACTERS` in `src/mascot.js`, `character` option everywhere |
| Mascot engine | Animated character showing what the agent is doing ({{N_STATES}} states) | `src/mascot.js` → `AegisMascot`, `renderSVG`, `renderTrayIcon` |
| Sounds | {{N_SOUNDS}} interface sounds, synthesised at runtime (no audio files needed) | `src/sounds.js` → `AegisSounds` |
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

{{CREW_TABLE}}

Rules for the app:
- Show **Aegi** while the user talks to the assistant and while it plans. When the pipeline routes work to a tool family, **switch to that specialist** and switch back to Aegi for the spoken answer.
- Switch with a crew event (section 4, e.g. `mail:new`, `harness:run`, back with `crew:lead`) or directly: `mascot.setCharacter('mail')` / `widget.setCharacter('mail')`. The body morphs; colours and details change.
- Map your tool names to characters in one place (suggested: email/calendar-mail tools → `mail`; WhatsApp, Telegram, Slack, X, Instagram → `social`; filesystem, drive, documents → `files`; memory / notes / RAG → `memory`; shell, code, MCP tools, tests, builds → `harness`; permission prompts, secrets, scans → `security`).
- Every character plays all {{N_COMMON}} common states. Signature states belong to one character; asking another character for them is allowed but the props are designed for the owner.
- Each character has three variants: `theme: 'color'` (its own colour, default), `'dark'`, `'light'`. Do not recolour a character with another character's colour: colour is how users tell them apart.

Signature states:

{{SIG_TABLE}}

## 3. States (common to every character)

{{STATE_TABLE}}

"once" states play one time and then fall through to the listed state automatically; override with `setState('sending', { then: 'searching' })`.

## 4. Events (what the pipeline should emit, and when)

{{EVENT_TABLE}}

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
  character: 'aegi',        // crew member: {{CREW}}
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

{{SOUND_TABLE}}

```js
import { AegisSounds } from 'aegis-mascot';
const sfx = new AegisSounds({ pack: 'warm', volume: 0.6 });   // packs: {{PACKS}}
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

Variants per character: `color`, `dark`, `light`. Extra themes that work on any character: {{THEMES}}. Shape overrides: {{SHAPES}}.
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
