// Writes MASCOT.md and SOUNDS.md from the live definitions so the docs can never drift from the code.  node tools/docs.mjs
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import * as M from '../src/index.js';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const evFor = (k, v) => Object.entries(M.EVENTS).filter(([, e]) => e[k] === v).map(([n]) => '`' + n + '`').join(', ') || '—';
const sndFor = s => (M.STATE_SOUNDS[s] ? '`' + M.STATE_SOUNDS[s] + '`' : '—');
const LOOK = { aegi: 'Soft gumdrop with the logo "A" on its chest', mail: 'Plump envelope with a flap and a gold seal', social: 'Speech bubble with a tail, rosy cheeks and an unread badge', files: 'Folder with a tab and a sheet of paper peeking out', memory: 'Little cloud with a spark and two linked nodes', harness: 'Hex nut with bolts and a terminal prompt', security: 'Rounded badge with an inner outline and a mint keyhole' };
const col = c => Array.isArray(c) ? c.join(' → ') : c;

const sigOf = c => M.STATE_NAMES.filter(s => M.STATES[s].for === c);
const crewTable = `| Mascot | Job | Looks like | Colour | Personality (idle) | Signature states |
|---|---|---|---|---|---|
${M.CHARACTER_NAMES.map(c => { const C = M.CHARACTERS[c]; return `| **${C.name}** \`${c}\` | ${C.role}: ${C.job} | ${LOOK[c]} | ${C.palette.body} | ${C.mood} | ${sigOf(c).map(s => '\`' + s + '\`').join(', ') || 'none (plays the common states)'} |`; }).join('\n')}`;
const sigTable = `| State | Character | Use it when | Loop | Event | Sound |
|---|---|---|---|---|---|
${M.STATE_NAMES.filter(s => M.STATES[s].for).map(s => { const st = M.STATES[s], ev = Object.entries(M.EVENTS).find(([, e]) => e.state === s) || [null, {}]; return `| \`${s}\` — **${st.label}** | ${M.CHARACTERS[st.for].name} | ${st.when} | ${st.dur}s | ${ev[0] ? '\`' + ev[0] + '\`' : '—'} | ${ev[1].sound ? '\`' + ev[1].sound + '\`' : '—'} |`; }).join('\n')}`;

const mascot = `# Aegi and the crew — the Aegis mascots

**${M.CHARACTER_NAMES.length} mascots, one per job.** Aegi is the lead assistant; six specialists take over when their kind of work starts. They share one
face (two oval eyes and a small mouth) so they read as one family, but each has its **own body shape, colour, body details, idle personality
and three signature animations**. Original designs; the "one shape that morphs between states" idea is inspired by [bloub](https://github.com/jeremy-prt/bloub).

![The crew in colour, dark and light](preview/crew.png)

${crewTable}

## Signature animations

![Signature states](preview/signature.png)

${sigTable}

## Common states (every mascot plays these ${M.COMMON_STATES.length})

![Common states, shown on Aegi](preview/states.png)

| State (file) | Use it when | Loop | Plays | Suggested sound | Triggering events |
|---|---|---|---|---|---|
${M.COMMON_STATES.map(s => { const st = M.STATES[s]; return `| \`${s}.svg\` — **${st.label}** | ${st.when} | ${st.dur}s | ${st.once ? `once, then → \`${st.then}\`` : 'loops'} | ${sndFor(s)} | ${evFor('state', s)} |`; }).join('\n')}

The same states on every crew member:

![Common states on the whole crew](preview/states-crew.png)

Notes
- "once" states (hello, sending, cancelled, done) play one time in the **live component** and then fall through to the next state. The exported SVG files of those states simply loop.
- Every state starts and ends on the same pose, so the files loop without a jump.
- In \`working\`, Aegi rolls into a ball; the specialists keep their shape.
- Typical flow: \`listening\` → \`sending\` → \`thinking\` → (specialist takes over with a signature state) → \`speaking\` → \`done\` → \`idle\`.

## Colours

Each character has three variants: \`color\` (its own colour), \`dark\` (dark body, bright outline in its colour) and \`light\` (cream body, outline in its colour).

| Character | Body | Detail | Eyes | Props | Highlight | On dark |
|---|---|---|---|---|---|---|
${M.CHARACTER_NAMES.map(c => { const P = M.CHARACTERS[c].palette; return `| ${M.CHARACTERS[c].name} | ${P.body} | ${P.detail} | ${P.eye} | ${P.accent} | ${P.pop} | ${P.bright} |`; }).join('\n')}

The hues are spread around the colour wheel (terracotta, blue, green, amber, violet, teal, navy) so the crew members are easy to tell apart, and each keeps
one small highlight colour. Extra themes that can be applied to any character: ${M.THEME_NAMES.filter(t => !['terracotta', 'dark', 'light'].includes(t)).map(t => '\`' + t + '\`').join(', ')}.

## What is in this folder

| Path | What it is |
|---|---|
| \`svg/animated/<character>/<variant>/<state>.svg\` | **Self-animating SVGs** (loop forever, no JavaScript). Use in \`<img>\`, CSS backgrounds, README files. |
| \`svg/static/<character>/<variant>/<state>.svg\` | Still frame of every state (icons, fallbacks, reduced-motion). |
| \`src/mascot.js\` | The live engine: smooth morphing **between** states and characters, custom colours, cursor-following eyes. Zero dependencies. |
| \`src/index.js\` | Mascot + sounds + widgets + the event map in one import. |
| \`src/widgets.js\` | Desktop widgets that contain the mascot: pill, desktop pet, tray flyout panel, task card, toast. |
| \`tray/\` | System-tray icons per character, variant and state (SVG, PNG 16–48, ICO). |
| \`INTEGRATION.md\` | **The brief to hand to a coding agent**: crew routing, widgets, Electron wiring, IPC contract, checklist. |
| \`demo/index.html\` | The playground: pick a mascot, try every state, colour, sound and event. The three guides are at the bottom of the page. |
| \`demo/widgets.html\` | The desktop-widget preview. |
| \`electron-example/\` | Electron shell: tray icon + flyout + desktop pet + pill, driven over IPC (not run here — reference code). |
| \`manifest.json\` | Machine-readable list of characters, states, sounds and events. |
| \`preview/\` | Contact sheets. |

Character = ${M.CHARACTER_NAMES.map(c => '\`' + c + '\`').join(', ')}; variant = \`color\`, \`dark\`, \`light\`; state = any common state, plus that character's signature states.

## Custom colours and new characters

Any colour can be a hex string **or an array of gradient stops**:

\`\`\`js
import { AegisMascot, renderSVG } from 'aegis-mascot';

const mine = { body: ['#FF7A59', '#7C3AED'], eye: '#FFFFFF', accent: '#111827', onAccent: '#FFFFFF', blush: '#FDBA74' };
new AegisMascot('#mascot', { character: 'memory', theme: mine, size: 160 });
fs.writeFileSync('thinking.svg', renderSVG({ character: 'memory', state: 'thinking', theme: mine }));   // Node: write your own file
\`\`\`

To add a crew member: add a body outline to \`SHAPES\`, an entry to \`CHARACTERS\` (name, role, shape, face offset, palette, idle \`life\`), a body detail to
\`FEATURE\` inside \`markup()\`, signature states to \`STATES\` with \`for: '<id>'\`, events to \`src/events.js\`, then run \`npm run build\`.

Options: \`emblem\` (the body details / logo "A", default on; turn off below ~64 px), \`shadow\` (ground shadow, default on), \`shape\` (override the body with one of ${Object.keys(M.SHAPES).filter(k => k !== 'aegis').map(s => '\`' + s + '\`').join(', ')}).

## Using it

**1. Just the files** (simplest — works anywhere):

\`\`\`html
<img src="svg/animated/aegi/color/thinking.svg" width="120" alt="Aegi is thinking">
<img src="svg/animated/mail/color/mail-incoming.svg" width="120" alt="New mail">
\`\`\`

**2. Live component** (morphs between states):

\`\`\`js
import { AegisMascot } from 'aegis-mascot';
const aegi = new AegisMascot('#mascot', { character: 'aegi', theme: 'color', size: 160, follow: true });
aegi.setState('listening');
aegi.setCharacter('files'); aegi.setState('files-found');   // hand over to a specialist
aegi.setCharacter('aegi');
aegi.setState('sending', { then: 'searching' });   // one-shot, then continue somewhere specific
aegi.setTheme('dark'); aegi.setSize(96);
aegi.pause(); aegi.play(); aegi.destroy();
\`\`\`

**3. Custom element**

\`\`\`html
<script type="module">import { defineElement } from 'aegis-mascot'; defineElement();</script>
<aegis-mascot character="harness" state="harness-running" theme="dark" size="120" follow></aegis-mascot>
<aegis-mascot state="idle" body="#22c55e" eye="#ffffff" accent="#052e16"></aegis-mascot>
\`\`\`

**4. Mascot + sounds from app events** (recommended for the voice agent):

\`\`\`js
import { createAegis } from 'aegis-mascot';
const aegi = createAegis('#mascot', { character: 'aegi', size: 160, sounds: { pack: 'warm', volume: 0.6 } });
aegi.emit('mic:start');     // listening + "listen-start" sound
aegi.emit('prompt:send');   // sending   + "send"
aegi.emit('agent:done');    // done      + "done"
aegi.emit('user:cancel');   // cancelled + "cancel"
aegi.emit('mail:new');      // switches to Posty, plays mail-incoming + "notify"
aegi.emit('crew:lead');     // back to Aegi
\`\`\`

The event → state → sound map is \`EVENTS\` in \`src/events.js\`; pass your own with \`createAegis(el, { events })\`.

## Widgets and tray

![Widgets](preview/widgets-light.png)

\`mountWidget(target, 'pill' | 'pet' | 'panel' | 'card' | 'toast', opts)\` gives you the mascot inside a ready-made layout, and \`tray/\` holds a
per-state icon for the system tray. The full specification — sizes, window flags, IPC, checklist — is in **INTEGRATION.md**.

## Electron

Install as a local package: \`npm install ./mascot-kit\` (or copy \`src/\` into your renderer). It is plain ES modules with no
dependencies, so it works with Vite, webpack, or directly with \`<script type="module">\`.

\`electron-example/\` is a tray app with a flyout, a desktop pet and a pill. It has not been run in this workspace — Electron is not
installed here — so treat it as reference code. See INTEGRATION.md section 6.

## Good to know

- Animated files use SVG SMIL animation: supported in Chromium/Electron, Firefox and Safari. Checked here in headless Chromium.
- The live component respects \`prefers-reduced-motion\` (shows the still pose). For files, swap to \`svg/static/\`.
- Animated files average ~25 KB.
- Regenerate everything: \`npm run build\` (SVGs, sounds, demo, manifest) and \`node tools/docs.mjs\` (these docs).
`;

const sounds = `# Aegis sound set

${M.SOUND_NAMES.length} short interface sounds for the Aegis voice agent, in **${Object.keys(M.PACKS).length} packs**. They are **synthesised from code** in
\`src/sounds.js\` (no samples), so they are original and free to ship. Everything is tuned to one key (D major pentatonic), which is why any
two of them sound right next to each other.

Honest note: these were generated and checked numerically (levels, lengths, clean endings) but **not auditioned by ear** — listen
to them in \`demo/index.html\` and tell me which ones to retune.

## Files

\`sounds/<pack>/<name>.wav\` (44.1 kHz, 16-bit mono) and \`sounds/<pack>/<name>.mp3\`.

| Pack | Character |
|---|---|
${Object.entries(M.PACKS).map(([k, p]) => `| \`${k}\` | ${p.label} |`).join('\n')}

## Which sound for which moment

| Sound (file) | Use it when | Length | App events |
|---|---|---|---|
${M.SOUND_NAMES.map(s => { const d = M.SOUNDS[s]; return `| \`${s}\` — **${d.label}** | ${d.when} | ${d.dur}s${d.loop ? ' (loops)' : ''} | ${evFor('sound', s)} |`; }).join('\n')}

### The ones you asked for

| You asked for | Sound | Mascot state |
|---|---|---|
| Pressing Enter | \`tap\` | — |
| Sending a prompt | \`send\` (or the quieter \`send-soft\`) | \`sending\` |
| Pause | \`pause\` (and \`resume\` to come back) | \`paused\` |
| Cancel | \`cancel\` | \`cancelled\` |
| Work is done | \`done\` | \`done\` |
| Notification / alert | \`notify\` | \`notification\` |

Extras for a voice agent: \`listen-start\` / \`listen-stop\` (mic open / closed), \`receive\`, \`confused\`, \`error\`, \`wake\`, \`sleep\`,
\`celebrate\`, and \`thinking-loop\` (an optional quiet bed while the agent works).

## Using them

**Option A — no audio files at all** (recommended in Electron; sounds are rendered on first use and cached):

\`\`\`js
import { AegisSounds } from 'aegis-mascot';
const sfx = new AegisSounds({ pack: 'warm', volume: 0.6 });
sfx.preload();                 // optional: render everything up front
sfx.play('send');
sfx.play('done', { volume: 0.8 });
sfx.startLoop('thinking-loop'); sfx.stopLoop('thinking-loop');
sfx.setPack('crystal'); sfx.setVolume(0.4); sfx.enabled = false;   // mute
\`\`\`

**Option B — the files:**

\`\`\`js
const play = name => new Audio(\`sounds/warm/\${name}.mp3\`).play();
play('cancel');
\`\`\`

**Option C — together with the mascot:** \`createAegis(...).emit('prompt:send')\` — see MASCOT.md.

## Voice-agent tips

- **Do not play sounds into an open microphone.** Play \`listen-start\` *before* opening the mic (or enable echo cancellation), otherwise your speech-to-text will hear the chime.
- Lower or mute interface sounds while text-to-speech is talking; \`receive\` right before speech starts is enough.
- Browsers block audio until the first click or key press. In Electron set \`webPreferences.autoplayPolicy: 'no-user-gesture-required'\` (the example does).
- Keep \`tap\` quiet and do not play it on every keystroke — only on Enter / button presses.
- Give users a mute switch and a volume slider (\`sfx.enabled\`, \`sfx.setVolume\`).

## Changing or adding sounds

Each sound is a few lines in \`SOUNDS\` in \`src/sounds.js\` (notes, timing, timbre). Edit, then \`npm run build\` to rewrite the WAV files.
MP3s are made from the WAVs with ffmpeg: \`ffmpeg -i in.wav -codec:a libmp3lame -q:a 3 out.mp3\`.

## If you want recorded sounds instead

Free libraries worth a look (check the licence on each official page before shipping):

- **Kenney — Interface Sounds**: 100 clicks and feedback sounds, CC0, no attribution required.
- **soundcn**: an open-source registry of 700+ CC0 interface sounds, installable per sound with the shadcn CLI.
- **Mixkit**: notifications and transitions under its own free licence.
- **Freesound**: huge, but the licence varies per sound — avoid anything marked non-commercial.
`;
fs.writeFileSync(path.join(root, 'MASCOT.md'), mascot); fs.writeFileSync(path.join(root, 'SOUNDS.md'), sounds);
fs.writeFileSync(path.join(root, 'README.md'), `# aegis-mascot kit

- **[MASCOT.md](MASCOT.md)** — the crew of ${M.CHARACTER_NAMES.length} mascots (${M.CHARACTER_NAMES.map(c => M.CHARACTERS[c].name + ' = ' + M.CHARACTERS[c].role.toLowerCase()).join(', ')}): which SVG for which state, colours, integration.
- **[SOUNDS.md](SOUNDS.md)** — the sound set: which sound for which event, integration.
- **[INTEGRATION.md](INTEGRATION.md)** — the brief for a coding agent: widgets, tray, Electron wiring, checklist.
- \`demo/index.html\` — open in a browser: the playground with every mascot (guides at the bottom). \`demo/widgets.html\` — desktop widgets.
- \`electron-example/\` — minimal Electron host.

\`\`\`
node tools/docs.mjs   # regenerate MASCOT.md, SOUNDS.md, INTEGRATION.md
npm run build         # regenerate svg/, tray/svg, sounds/*.wav, manifest.json, demo/ (embeds the guides)
python3 tools/tray.py # tray/png + tray/ico
\`\`\`
`);

// INTEGRATION.md from its template
const table = (head, rows) => `| ${head.join(' | ')} |\n|${head.map(() => '---').join('|')}|\n` + rows.map(r => `| ${r.join(' | ')} |`).join('\n');
const integ = fs.readFileSync(path.join(root, 'tools/INTEGRATION.template.md'), 'utf8')
  .replace('{{N_STATES}}', M.STATE_NAMES.length).replace('{{N_CREW}}', M.CHARACTER_NAMES.length).replace('{{N_COMMON}}', M.COMMON_STATES.length).replace('{{CREW_TABLE}}', () => crewTable).replace('{{SIG_TABLE}}', () => sigTable).replace('{{CREW}}', M.CHARACTER_NAMES.join(' | ')).replace('{{N_SOUNDS}}', M.SOUND_NAMES.length)
  .replace('{{STATE_TABLE}}', table(['State', 'Meaning', 'Plays', 'Default status text', 'Status colour', 'Paired sound'], M.COMMON_STATES.map(s => { const st = M.STATES[s]; return ['`' + s + '`', st.when, st.once ? 'once → `' + st.then + '`' : 'loops', M.STATUS_TEXT[s].join(' — '), M.STATUS_COLORS[s] || 'none', M.STATE_SOUNDS[s] ? '`' + M.STATE_SOUNDS[s] + '`' : '—']; })))
  .replace('{{EVENT_TABLE}}', table(['Event', 'Character', 'Mascot state', 'Sound'], Object.entries(M.EVENTS).map(([n, e]) => ['`' + n + '`', e.character ? '→ `' + e.character + '`' : '(current)', e.state ? '`' + e.state + '`' : '(unchanged)', e.sound ? '`' + e.sound + '`' : '—'])))
  .replace('{{SOUND_TABLE}}', table(['Sound', 'When', 'Length'], M.SOUND_NAMES.map(s => ['`' + s + '`', M.SOUNDS[s].when, M.SOUNDS[s].dur + 's' + (M.SOUNDS[s].loop ? ' (loop)' : '')])))
  .replace('{{PACKS}}', Object.keys(M.PACKS).map(p => '`' + p + '`').join(', ')).replace('{{THEMES}}', M.THEME_NAMES.filter(t => !['terracotta', 'dark', 'light'].includes(t)).map(t => '`' + t + '`').join(', ')).replace('{{SHAPES}}', Object.keys(M.SHAPES).map(t => '`' + t + '`').join(', '));
fs.writeFileSync(path.join(root, 'INTEGRATION.md'), integ);
