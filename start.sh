#!/bin/sh
# Aegis — start the union: obscura (browser engine) + Aegis daemon
# (memory/MCP services) + Aegis host app (UI + agent runtime).
#
# Usage:
#   ./start.sh           production mode (builds the client if needed)
#   ./start.sh --dev     Aegis dev mode (vite hot reload on :5173)
#
# Keys come from ./.env.local (copy .env.example) or the environment.
# You only ever supply API KEYS — provider endpoints are hard-coded in
# apps/host/src/server/providers.ts.
set -e

# W-FIX: ELECTRON_RUN_AS_NODE must be unset before launching Electron,
# otherwise Electron runs as plain Node and crashes on startup.
unset ELECTRON_RUN_AS_NODE
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$ROOT"

# Load product env (keys) if present; exported vars reach every child.
if [ -f .env.local ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env.local
  set +a
fi

# The daemon locates obscura via AEGIS_OBSCURA (its bundled-path default
# assumes the old layout, so point it at this repo's tools-bin).
export AEGIS_OBSCURA="$ROOT/tools-bin/obscura"
export AEGIS_DAEMON_URL="${AEGIS_DAEMON_URL:-http://127.0.0.1:8765}"
export OBSCURA_CDP_URL="${OBSCURA_CDP_URL:-http://127.0.0.1:9222}"
export AEGIS_COMPUTER_MODE="${AEGIS_COMPUTER_MODE:-local}"

PIDS=""
cleanup() {
  # shellcheck disable=SC2086
  [ -n "$PIDS" ] && kill $PIDS 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# 1. obscura CDP server (idempotent; no-op if already answering).
if [ -x tools-bin/start-obscura.sh ]; then
  sh tools-bin/start-obscura.sh || echo "obscura: not started (browser falls back to Playwright, labelled)"
fi

# 2. Aegis daemon on :8765 (memory, tools, MCP stdio server, AG-UI).
DAEMON_DIR="$ROOT/services/daemon"
if [ ! -x "$DAEMON_DIR/.venv/bin/python" ]; then
  python3 -m venv "$DAEMON_DIR/.venv"
  "$DAEMON_DIR/.venv/bin/pip" install -q -r "$DAEMON_DIR/requirements.txt"
fi
(cd "$DAEMON_DIR" && AEGIS_HOME="${AEGIS_HOME:-$ROOT/.aegis-data}" exec .venv/bin/python -m aegis_daemon.main) &
PIDS="$PIDS $!"

# 3. Optional: Aegis computer sidecar (requires CPK_INTELLIGENCE_API_KEY;
#    run-aegis.sh fails closed without it). Enable with AEGIS_START_SIDECAR=1.
if [ "${AEGIS_START_SIDECAR:-}" = "1" ]; then
  (sh "$ROOT/openmuse/run-aegis.sh") &
  PIDS="$PIDS $!"
  export AEGIS_COMPUTER_URL="${AEGIS_COMPUTER_URL:-http://127.0.0.1:8788}"
fi

# 5. Aegis host app on :4310 (serves the built client in prod mode).
cd "$ROOT/apps/host"
if [ ! -d node_modules ]; then
  npm install --no-audit --no-fund
fi

# W-FIX 1a: the Playwright Chromium binaries live in an app-local
# browsers path and are installed on first run when missing — a fresh
# unzip used to die with "executable doesn't exist at the path" the
# first time the AEGIS Computer browser launched. Idempotent: the
# script probes a real launch and only downloads when needed.
export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-$ROOT/.aegis-data/playwright-browsers}"
mkdir -p "$PLAYWRIGHT_BROWSERS_PATH"
node scripts/ensure-browser.mjs || echo "browser setup: continuing without the bundled Chromium (system Edge/Chrome fallback may still serve)"

if [ "${1:-}" != "--dev" ] && [ ! -d dist ]; then
  npm run build
fi

# W-FIX: supervise the browser service (:4311) that powers the Browser
# view and the read-only research browser. It used to never be started
# by the launchers at all, so those surfaces were dead on a normal
# install. A user-supplied BROWSER_URL/BROWSER_SECRET pair (their own
# browser service) is respected and left alone.
if [ -z "${BROWSER_URL:-}" ] && [ -z "${BROWSER_SECRET:-}" ]; then
  if [ -f "$ROOT/.aegis-data/browser-secret" ]; then
    BROWSER_SECRET=$(cat "$ROOT/.aegis-data/browser-secret")
  else
    BROWSER_SECRET=$(python3 -c "import secrets; print(secrets.token_hex(24))" 2>/dev/null || head -c 48 /dev/urandom | od -An -tx1 | tr -d ' \n')
    (umask 077; printf '%s' "$BROWSER_SECRET" > "$ROOT/.aegis-data/browser-secret")
  fi
  export BROWSER_SECRET
  export BROWSER_URL="${BROWSER_URL:-http://127.0.0.1:4311}"
  export BROWSER_HOST="${BROWSER_HOST:-127.0.0.1}"
  export BROWSER_PORT="${BROWSER_PORT:-4311}"
  if [ "${1:-}" = "--dev" ]; then
    npm run browser &
  else
    npm run browser:start &
  fi
  PIDS="$PIDS $!"
  echo "browser service: starting on :$BROWSER_PORT"
fi

# W-FIX 3d: supervise the WhatsApp sidecar (:4312, Baileys QR pairing).
# The shared secret lives ONLY in .aegis-data/whatsapp-secret
# (gitignored); it is exported to the host (which proxies status for
# the UI) and read by the daemon's whatsapp.* tools from the same file.
# A user-supplied WHATSAPP_SECRET is respected and left alone.
if [ -z "${WHATSAPP_SECRET:-}" ]; then
  if [ -f "$ROOT/.aegis-data/whatsapp-secret" ]; then
WHATSAPP_SECRET=$(openssl rand -hex 24 2>/dev/null || date +%s%N | sha256sum | cut -c1-48)
  else
    mkdir -p "$ROOT/.aegis-data"
WHATSAPP_SECRET=$(openssl rand -hex 24 2>/dev/null || date +%s%N | sha256sum | cut -c1-48)
    (umask 077; printf '%s' "$WHATSAPP_SECRET" > "$ROOT/.aegis-data/whatsapp-secret")
  fi
  export WHATSAPP_SECRET
fi
export AEGIS_WHATSAPP_URL="${AEGIS_WHATSAPP_URL:-http://127.0.0.1:4312}"
export WHATSAPP_PORT="${WHATSAPP_PORT:-4312}"
export WHATSAPP_HOST="${WHATSAPP_HOST:-127.0.0.1}"
export WHATSAPP_AUTH_DIR="${WHATSAPP_AUTH_DIR:-$ROOT/.aegis-data/whatsapp-auth}"
if [ "${1:-}" = "--dev" ]; then
  npm run whatsapp &
else
  npm run whatsapp:start &
fi
PIDS="$PIDS $!"
echo "whatsapp sidecar: starting on :$WHATSAPP_PORT"

mkdir -p "$ROOT/.aegis-data/logs"
export AEGIS_LOG_DIR="${AEGIS_LOG_DIR:-$ROOT/.aegis-data/logs}"
if [ "${1:-}" = "--dev" ]; then
  node "$ROOT/scripts/supervise-host.mjs" "$PWD" npm run dev &
  PIDS="$PIDS $!"
  echo "Aegis dev: UI http://127.0.0.1:5173 · API :4310 · daemon :8765 · obscura CDP :9222 · browser :4311 · whatsapp :4312"
else
  node "$ROOT/scripts/supervise-host.mjs" "$PWD" npm start &
  PIDS="$PIDS $!"
  echo "Aegis: http://127.0.0.1:4310 · daemon :8765 · obscura CDP :9222 · browser :4311 · whatsapp :4312"
fi
echo "Host log: $AEGIS_LOG_DIR/host.log (supervised: restarts if the host exits)"

wait
