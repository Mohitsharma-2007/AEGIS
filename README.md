> **Historical note:** OpenCode was removed from Aegis. The task-execution
> harness is the in-process native engine (`apps/host/src/server/harness.ts`);
> any OpenCode description below is a record of the old architecture.

# Aegis

A local-first desktop agent: **Aegis host** (UI + agent runtime, now
`apps/host`), the **Aegis daemon** (memory/services, `services/daemon`),
the **Playwright browser service** (AEGIS Computer browser), and an
**Electron desktop shell** (`apps/desktop`) with tray, mascot and widgets.
Upstream pieces were modified in place; see `docs/MODIFICATIONS.md` for the
change log and `docs/BUILD_REPORT.md` for architecture, integration state
and test results. Licences: `docs/THIRD_PARTY.md`.

## Quick start

```sh
cp .env.example .env.local   # add at least one provider key, e.g. OPENROUTER_API_KEY
./start.sh                   # or: ./start.sh --dev
# Windows: start.ps1 / start.bat
```

Open http://127.0.0.1:4310 (dev mode: http://127.0.0.1:5173).

Desktop app:

```sh
cd apps/desktop && npm start
```

No CopilotKit Intelligence account is needed: the agent runtime runs
locally against the provider registry. If you *have* an Intelligence key
(`CPK_INTELLIGENCE_API_KEY`), the upstream hosted mode still works.

## Providers (OpenCode-style)

Endpoints are hard-coded in `apps/host/src/server/providers.ts` — you
never type an endpoint. Supply a key via ENV for one or more of:
OpenRouter, Groq, NVIDIA NIM, Conduit, TokenHarbor, Vercel AI Gateway.
Pick the active provider + model in the app's **Settings** dialog, or
set `AEGIS_PROVIDER` / `AEGIS_MODEL` in `.env.local`.

## Pieces

| Piece | Port | Notes |
|---|---|---|
| Aegis host (UI + API) | 4310 (dev UI 5173) | `cd apps/host && npm run dev` |
| Aegis daemon | 8765 | memory (STAIR/RAG/Graph), tools, MCP stdio server; `services/daemon/` |
| Aegis browser service (Playwright) | 4311 | the AEGIS Computer browser; `cd apps/host && npm run browser` (needs `BROWSER_SECRET`) |
| Electron desktop shell | — | `cd apps/desktop && npm start` (tray, mascot, widgets) |

## Tests

```sh
cd apps/host && npm run typecheck && npm run build && npm test
node tests/boot-test.mjs
services/daemon/.venv/bin/python tests/smoke_daemon.py
services/daemon/.venv/bin/python tests/test_mcp_roundtrip.py
python3 tests/test_daemon_link.py
```

## Mascot, widgets & sounds

The Aegis mascot kit lives in `vendor/mascot-kit` and is installed as
`aegis-mascot`. Seven crew mascots (Aegi, Posty, Chatty, Filo, Memo,
Rig, Guard) drive the desktop pet, tray, pill and panel widgets. See
`vendor/mascot-kit/INTEGRATION.md` for the full integration brief.

## Voice

Voice calls use the provider configured by `VOICE_API_KEY` /
`VOICE_MODEL` / `VOICE_NAME`. Local STT/TTS (whisper.cpp, piper) is not
yet wired; set these to an OpenAI-compatible endpoint for now.