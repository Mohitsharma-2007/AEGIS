# Aegis sound set

17 short interface sounds for the Aegis voice agent, in **2 packs**. They are **synthesised from code** in
`src/sounds.js` (no samples), so they are original and free to ship. Everything is tuned to one key (D major pentatonic), which is why any
two of them sound right next to each other.

Honest note: these were generated and checked numerically (levels, lengths, clean endings) but **not auditioned by ear** — listen
to them in `demo/index.html` and tell me which ones to retune.

## Files

`sounds/<pack>/<name>.wav` (44.1 kHz, 16-bit mono) and `sounds/<pack>/<name>.mp3`.

| Pack | Character |
|---|---|
| `warm` | Warm (soft mallets) |
| `crystal` | Crystal (glassy bells) |

## Which sound for which moment

| Sound (file) | Use it when | Length | App events |
|---|---|---|---|
| `tap` — **Key tap** | Enter key pressed, button pressed, any small click | 0.12s | `key:enter`, `social:react`, `harness:run` |
| `send` — **Send** | Prompt sent (Enter / send button) | 0.5s | `prompt:send`, `mail:send` |
| `send-soft` — **Send (alt, softer)** | Alternative send sound — quieter, for frequent sends | 0.5s | `files:upload`, `memory:save` |
| `receive` — **Message received** | Agent reply arrives / first token | 0.5s | `agent:reply`, `social:message`, `memory:recall` |
| `listen-start` — **Listening on** | Mic opens / wake word detected | 0.45s | `mic:start` |
| `listen-stop` — **Listening off** | Mic closes / end of speech detected | 0.45s | `mic:stop` |
| `pause` — **Pause** | User pauses the agent / playback | 0.6s | `user:pause` |
| `resume` — **Resume** | User resumes after a pause | 0.6s | `user:resume` |
| `cancel` — **Cancel** | User cancels / stops the task | 0.45s | `user:cancel` |
| `done` — **Done** | Task finished — the main "work is done" alert | 1.3s | `agent:done`, `files:found`, `security:locked` |
| `notify` — **Notification** | Reminder, incoming notification, needs attention | 1.1s | `notify`, `mail:new` |
| `error` — **Error** | Something failed | 0.6s | `agent:error`, `security:alert` |
| `confused` — **Confused** | Didn't understand — ask the user to repeat | 0.65s | `agent:confused` |
| `wake` — **Wake / startup** | App launch, agent comes online | 1.5s | `app:start`, `crew:lead` |
| `sleep` — **Sleep / shutdown** | Agent goes idle, do-not-disturb on, app closing | 1.3s | `app:sleep` |
| `celebrate` — **Celebrate** | Big success, milestone | 1.6s | `agent:celebrate` |
| `thinking-loop` — **Thinking (loop)** | Optional quiet bed while the agent works — loops seamlessly | 2s (loops) | — |

### The ones you asked for

| You asked for | Sound | Mascot state |
|---|---|---|
| Pressing Enter | `tap` | — |
| Sending a prompt | `send` (or the quieter `send-soft`) | `sending` |
| Pause | `pause` (and `resume` to come back) | `paused` |
| Cancel | `cancel` | `cancelled` |
| Work is done | `done` | `done` |
| Notification / alert | `notify` | `notification` |

Extras for a voice agent: `listen-start` / `listen-stop` (mic open / closed), `receive`, `confused`, `error`, `wake`, `sleep`,
`celebrate`, and `thinking-loop` (an optional quiet bed while the agent works).

## Using them

**Option A — no audio files at all** (recommended in Electron; sounds are rendered on first use and cached):

```js
import { AegisSounds } from 'aegis-mascot';
const sfx = new AegisSounds({ pack: 'warm', volume: 0.6 });
sfx.preload();                 // optional: render everything up front
sfx.play('send');
sfx.play('done', { volume: 0.8 });
sfx.startLoop('thinking-loop'); sfx.stopLoop('thinking-loop');
sfx.setPack('crystal'); sfx.setVolume(0.4); sfx.enabled = false;   // mute
```

**Option B — the files:**

```js
const play = name => new Audio(`sounds/warm/${name}.mp3`).play();
play('cancel');
```

**Option C — together with the mascot:** `createAegis(...).emit('prompt:send')` — see MASCOT.md.

## Voice-agent tips

- **Do not play sounds into an open microphone.** Play `listen-start` *before* opening the mic (or enable echo cancellation), otherwise your speech-to-text will hear the chime.
- Lower or mute interface sounds while text-to-speech is talking; `receive` right before speech starts is enough.
- Browsers block audio until the first click or key press. In Electron set `webPreferences.autoplayPolicy: 'no-user-gesture-required'` (the example does).
- Keep `tap` quiet and do not play it on every keystroke — only on Enter / button presses.
- Give users a mute switch and a volume slider (`sfx.enabled`, `sfx.setVolume`).

## Changing or adding sounds

Each sound is a few lines in `SOUNDS` in `src/sounds.js` (notes, timing, timbre). Edit, then `npm run build` to rewrite the WAV files.
MP3s are made from the WAVs with ffmpeg: `ffmpeg -i in.wav -codec:a libmp3lame -q:a 3 out.mp3`.

## If you want recorded sounds instead

Free libraries worth a look (check the licence on each official page before shipping):

- **Kenney — Interface Sounds**: 100 clicks and feedback sounds, CC0, no attribution required.
- **soundcn**: an open-source registry of 700+ CC0 interface sounds, installable per sound with the shadcn CLI.
- **Mixkit**: notifications and transitions under its own free licence.
- **Freesound**: huge, but the licence varies per sound — avoid anything marked non-commercial.
