# Aegis

A local-first desktop agent. Everything runs on your machine: the agent
runtime, the memory service, the browser, and the voice pipeline. You bring
a model key and Aegis brings the rest.

```sh
cp .env.example .env.local     # add one provider key, e.g. OPENROUTER_API_KEY
./start.sh                     # Windows: start.ps1 (or start.bat)
```

The UI opens at <http://127.0.0.1:4310>.

## What you get

| Surface | What it does |
|---|---|
| **Conversation** | Chat with the agent. Type `/` for commands, `@` to hand a task to a specific agent. Attachments, voice, and the computer pane all live here. |
| **Agents** | The agent team, their state and their work in progress. |
| **Harness** | The execution engine, separate from the chat: its own sessions, its own approval gate for shell/Node/Python commands. |
| **Files** | The workspace filesystem, with previews. |
| **Memory** | What the daemon remembers — STAIR, retrieval and the knowledge graph. |
| **Research** | Web research that returns sources rather than a wall of text. |
| **Finance** | Live market quotes and charts. |
| **3D Library** | Labelled 3D models and their 2D diagrams, with the parts annotated. |
| **Integrations** | Connections, plugins and the marketplace. |

Two more surfaces are not in the rail because they are not destinations:
the **AEGIS Computer** (the Playwright browser) opens from the header into a
chat-side pane so controlling it never takes you away from the thread that
asked for it, and **Settings** carries providers, models, voice and appearance.

## The pieces

| Piece | Port | Notes |
|---|---|---|
| Aegis host — UI + agent runtime | 4310 (dev UI 5173) | `apps/host` |
| Aegis daemon — memory, tools, MCP | 8765 | `services/daemon` |
| Voice pipeline — STT + TTS | 8766 | faster-whisper + Piper, `services/daemon/aegis_daemon/voice_pipeline.py` |
| AEGIS Computer browser — Playwright | 4311 | needs `BROWSER_SECRET` |
| WhatsApp bridge | 4312 | optional |
| Electron desktop shell | — | `apps/desktop`: tray, Notch, widgets, visual layer |

`start.sh` / `start.ps1` supervise all of them and restart what dies; you
rarely run the individual processes by hand. Use `--dev` (`-Dev` on Windows)
for the Vite dev server with hot reload on :5173.

## Models

Endpoints are fixed in `apps/host/src/server/providers.ts`, so you never type
an endpoint — only a key. Supported: OpenRouter, Groq, NVIDIA NIM, Conduit,
TokenHarbor, Vercel AI Gateway, and a local model server (Ollama or LM Studio).
Pick the provider and model in **Settings**, or set `AEGIS_PROVIDER` /
`AEGIS_MODEL` in `.env.local`.

Anything that needs a key lives in `.env.local` (or the process environment).
`.env.example` lists every variable with blank values; it is the only
environment file in the repository.

## Voice

The voice pipeline is local, not a hosted API: faster-whisper for speech to
text and Piper for text to speech, on :8766. The Notch is the desktop front
end for it — say "Hey Aegis" (enable the wake word in Settings) or press
<kbd>Alt</kbd>+<kbd>Space</kbd> to summon it, and its mic starts the call.

Without the pipeline running, voice can fall back to a hosted
OpenAI-compatible endpoint via `VOICE_BASE_URL` / `VOICE_API_KEY` /
`VOICE_MODEL`.

## Desktop app

```sh
cd apps/desktop && npm start
```

The Electron shell adds the Notch, tray, desktop mascot and the visual layer
(<kbd>Super</kbd>/<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Space</kbd>). It is a
thin client over the same host on :4310 — nothing in it runs a second agent.

## Development

```sh
cd apps/host && npm run dev      # host + Vite
cd apps/host && npm run typecheck
cd apps/host && npm test
```

`npm run build` also builds the 3D Library viewer from `apps/sightline` into
`apps/host/public/sightline`; run `npm run build:sightline` to force a rebuild
of just that piece.

Tests for the daemon and the wiring between processes:

```sh
node tests/boot-test.mjs
services/daemon/.venv/bin/python tests/smoke_daemon.py
services/daemon/.venv/bin/python tests/test_mcp_roundtrip.py
```

## Layout

```
apps/host        UI (React) + agent runtime + HTTP API
apps/desktop     Electron shell: Notch, tray, widgets, visual layer
apps/sightline   screen-to-scene visual engine (2D diagrams, 3D models)
services/daemon  memory, tools, MCP server, voice pipeline
vendor/          vendored pieces, e.g. the mascot kit
```

## Licence

MIT. Upstream components and their licences are listed in
`docs/THIRD_PARTY.md`; changes to vendored pieces are recorded in
`docs/MODIFICATIONS.md`.