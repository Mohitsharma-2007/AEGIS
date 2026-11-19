# Aegis desktop shell (Electron)

Packaging and supervision only — the window loads the real Aegis UI from
`http://127.0.0.1:4310`. There is no forked front end.

## What it does

On launch, in this order:

1. **Python daemon** (`services/daemon`, `aegis_daemon.main`) — memory, tools,
   MCP. Skipped with a log line if `.venv` is missing (run `start.ps1` once).
2. **Native harness** (in-process; no sidecar binary, no `:4096` port), with
   the platform-correct daemon MCP entry and a password from
   approval gates for every execution.
3. **Browser service** (`:4311`) and **WhatsApp sidecar** (`:4312`), sharing
   their secrets from `.aegis-data/`.
4. **Host app** (built output, `:4310`).

Every child is restarted with backoff if it exits, and everything it prints goes
to `.aegis-data/logs/desktop.log` — a silent host death was the original field
failure. The window waits for `GET /api/health` before navigating, and shows an
honest setup page when the build is missing or the server never answers.

Closing the window hides it; services keep running. Quit from the tray.

- **Tray**: open Aegis, host URL, mascot overlay toggle, start-at-login,
  log folder, quit.
- **Mascot overlay**: a small always-on-top, draggable code-drawn shield (the
  "A" button opens the app).
- **Notifications**: task state changes from `/api/state` fire a native
  notification; clicking one opens the app.
- **Single instance**: a second launch focuses the running window.

## Product root

A folder containing `apps/host/package.json` and `services/daemon/`. The shell
tries `AEGIS_ROOT`, the repo layout around `apps/desktop`, then ancestors of the
executable. A packaged installer therefore needs the product tree beside it (or
`AEGIS_ROOT` set) — the shell says so instead of pretending.

## Commands

```sh
npm install
npm start          # dev shell against the repo tree
npm run icons      # regenerate assets/icon.png + tray.png from code
npm run dist:win   # NSIS installer -> release/
```

Prerequisite: `apps/host` must be built (`npm run build`) for a production load.

## Keys

Read from the repo `.env.local` (never bundled, never logged). The shell passes
them to the host process only.
