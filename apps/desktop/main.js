// Aegis desktop shell.
//
// This is packaging + supervision, not a second UI: the window loads the real
// Aegis host app from http://127.0.0.1:4310. The shell owns the local
// services (daemon, native harness, browser service, WhatsApp sidecar and
// the host app), restarts the host if it exits, and keeps running in the tray
// when the window is closed.
//
// Product root: a folder containing apps/host/ and services/daemon/. Resolved
// from AEGIS_ROOT, the repo layout around this file, or (packaged) ancestors
// of the executable. Nothing is faked when it is missing: the setup window
// says how to point the shell at the tree.
const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  Notification,
  shell,
  screen,
  ipcMain,
  nativeTheme,
  clipboard,
  globalShortcut,
  desktopCapturer,
} = require('electron');
const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { importDroppedFiles } = require('./file-tray');
const { appendClipboardText, MAX_ITEMS } = require('./clipboard-history');

const HOST_URL = 'http://127.0.0.1:4310';
const DEV_MODE = process.argv.includes('--dev');
const isWindows = process.platform === 'win32';
const exe = (name) => (isWindows ? `${name}.exe` : name);

let root = null;
let logFile = null;
let mainWindow = null;
let overlay = null;
let notch = null;
// Guidance overlay window (annotations.html). It is created lazily on the first
// annotation and reused afterwards; declaring it is what lets that path run at
// all (a missing binding made every annotate IPC throw before the window
// existed).
let annotationsWindow = null;
let visualLayer = null;
let visualLayerVisible = false;
// Whether the full-screen layer currently accepts pointer input. Idle, it is
// click-through so the owner keeps using the app underneath.
let visualInteractive = false;
let visualHotkey = '';
let trayPill = null;
let trayAnchorPoint = null;
let tray = null;
let quitting = false;
let overlayVisible = false;
let notchVisible = false;
let notchRendererReady = false;
// Whether the renderer currently shows the expanded shelf. The native surface
// is the island's size and only grows while this is true.
let notchExpanded = false;
// Last broadcast status, replayed when the notch finishes loading. Without it
// the very first status of a run is sent to a page that is still loading and
// the notch opens on stale defaults ("Ready", 0 agents).
let lastStatusPayload = null;
let lastCpuSnapshot = null;
const cpuHistory = [];
const gpuHistory = [];
const memHistory = [];
const MAX_METRIC_HIST = 24;
let cachedWeather = null;
let lastWeatherLoc = null;
let cachedAgents = [];
// The desktop companion wakes on its own: minimized or hidden Aegis shows the
// mascot, and the notch is only kept open while the agent is actually busy or
// the owner has pinned it from the tray.
let overlayAutoShown = false;
let notchPinned = false;
let notchAutoTimer = null;
let notchScreenListeners = false;
let agentBusy = false;
const children = [];
const restarts = new Map();
let buildState = null;
let lastTasks = new Map();
// Owner preference, mirrored from /api/state: reload/devtools shortcuts are
// locked by default and only enabled by Developer Options in Settings.
let devShortcutsEnabled = false;
// Mirrored from /api/state so every desktop surface reads the same pause flag as
// the app window instead of keeping its own copy.
let pausedNow = false;
// Owner choice for the outside-the-app surface: 'notch' or 'mascot'. Only one
// is ever shown, and the app window never draws a mascot of its own.
let desktopSurface = 'notch';
let surfaceInitialised = false;
let minimizeToTray = true;
// ---------------------------------------------------------------- notch prefs
// The Notch is one fixed-size transparent overlay; only the island inside it
// changes size. Preferences persist beside the other desktop settings.
const NOTCH_DEFAULT_SETTINGS = {
  placement: 'center',
  offsetX: 0,
  displayId: null,
  compactWidth: 300,
  compactHeight: 38,
  expandedWidth: 620,
  expandedHeight: 360,
  scale: 1,
  topGap: 0,
  radius: 22,
  border: 1,
  shadow: 1,
  blur: false,
  hoverDelay: 240,
  closeDelay: 220,
  hideWhenIdle: false,
};
let notchSettings = { ...NOTCH_DEFAULT_SETTINGS };

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function normalizeNotchSettings(input) {
  const next = { ...notchSettings, ...(input && typeof input === 'object' ? input : {}) };
  return {
    placement: ['center', 'left', 'right'].includes(next.placement) ? next.placement : 'center',
    offsetX: Math.round(clampNumber(next.offsetX, -2000, 2000, 0)),
    displayId: Number.isFinite(Number(next.displayId)) ? Number(next.displayId) : null,
    compactWidth: Math.round(clampNumber(next.compactWidth, 220, 460, 300)),
    compactHeight: Math.round(clampNumber(next.compactHeight, 30, 60, 38)),
    expandedWidth: Math.round(clampNumber(next.expandedWidth, 480, 900, 620)),
    expandedHeight: Math.round(clampNumber(next.expandedHeight, 200, 640, 320)),
    scale: Math.round(clampNumber(next.scale, 0.8, 1.4, 1) * 100) / 100,
    topGap: Math.round(clampNumber(next.topGap, 0, 60, 0)),
    radius: Math.round(clampNumber(next.radius, 0, 40, 22)),
    border: Math.round(clampNumber(next.border, 0, 1, 1) * 100) / 100,
    shadow: Math.round(clampNumber(next.shadow, 0, 1, 1) * 100) / 100,
    blur: next.blur === true,
    hoverDelay: Math.round(clampNumber(next.hoverDelay, 0, 1200, 240)),
    closeDelay: Math.round(clampNumber(next.closeDelay, 0, 1200, 220)),
    hideWhenIdle: next.hideWhenIdle === true,
  };
}

/**
 * Native surface sized to the visible island. The renderer decides when the
 * shelf opens and reports it over 'notch-expanded'; the window only grows then.
 * A permanently expanded window left a large invisible click blocker over the
 * desktop around the collapsed island.
 */
function notchSurfaceSize() {
  const area = notchDisplayArea();
  if (notchExpanded) {
    return {
      width: Math.min(notchSettings.expandedWidth + 48, area.width),
      height: Math.min(notchSettings.expandedHeight + 72, area.height),
    };
  }
  return {
    width: Math.min(notchSettings.compactWidth + 12, area.width),
    height: Math.min(notchSettings.compactHeight + 12, area.height),
  };
}

function notchDisplayArea() {
  const displays = screen.getAllDisplays();
  const picked = displays.find((display) => display.id === notchSettings.displayId);
  return (picked ?? screen.getPrimaryDisplay()).bounds;
}

/** Window position for the fixed surface so the island lands where the owner chose. */
function notchSurfacePosition() {
  const area = notchDisplayArea();
  const size = notchSurfaceSize();
  let x = Math.round(area.x + (area.width - size.width) / 2);
  if (notchSettings.placement === 'left') x = area.x + 12;
  if (notchSettings.placement === 'right') x = area.x + area.width - size.width - 12;
  x += notchSettings.offsetX;
  const maxX = area.x + area.width - size.width;
  return {
    x: Math.max(area.x, Math.min(maxX, x)),
    y: Math.round(area.y + notchSettings.topGap),
    width: size.width,
    height: size.height,
  };
}

function publishNotchSettings() {
  if (notch && !notch.isDestroyed() && !notch.webContents.isLoading()) {
    notch.webContents.send('aegis:notch-settings', notchSettings);
  }
}

function applyNotchSettings(partial) {
  notchSettings = normalizeNotchSettings(partial);
  try {
    saveDesktopPreferences();
  } catch (error) {
    writeLog(`notch settings save failed: ${error.message}`);
  }
  if (notch && !notch.isDestroyed()) {
    notch.setBounds(notchSurfacePosition());
    notch.setAlwaysOnTop(true, 'screen-saver');
  }
  publishNotchSettings();
  return notchSettings;
}

let clipboardHistoryEnabled = false;
let clipboardHistory = [];
let clipboardLastText = '';
let clipboardTimer = null;
let externalAgentDiscoveryEnabled = false;

function desktopPreferencesPath() {
  return path.join(root ?? app.getPath('userData'), '.aegis-data', 'desktop-preferences.json');
}

function loadDesktopPreferences() {
  try {
    const parsed = JSON.parse(fs.readFileSync(desktopPreferencesPath(), 'utf8'));
    if (typeof parsed.minimizeToTray === 'boolean') minimizeToTray = parsed.minimizeToTray;
    if (typeof parsed.clipboardHistoryEnabled === 'boolean') clipboardHistoryEnabled = parsed.clipboardHistoryEnabled;
    if (typeof parsed.externalAgentDiscoveryEnabled === 'boolean') externalAgentDiscoveryEnabled = parsed.externalAgentDiscoveryEnabled;
    if (parsed.notchSettings && typeof parsed.notchSettings === 'object') notchSettings = normalizeNotchSettings(parsed.notchSettings);
    if (Array.isArray(parsed.clipboardHistory)) clipboardHistory = parsed.clipboardHistory.filter((item) => item && typeof item.text === 'string').slice(0, 30);
  } catch {
    // First launch keeps the existing minimize-to-tray behavior.
  }
}

function saveDesktopPreferences() {
  const file = desktopPreferencesPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify({ minimizeToTray, clipboardHistoryEnabled, clipboardHistory, externalAgentDiscoveryEnabled, notchSettings }, null, 2), { mode: 0o600 });
  fs.renameSync(temp, file);
}

function publishClipboardHistory() {
  broadcastStatus({ widgets: { clipboard: { enabled: clipboardHistoryEnabled, items: clipboardHistory.map(({ text, at }) => ({ text, at })) } } });
}
function sampleClipboard() {
  if (!clipboardHistoryEnabled) return;
  try {
    const text = clipboard.readText();
    if (text === clipboardLastText) return;
    clipboardLastText = text;
    const next = appendClipboardText(clipboardHistory, text);
    if (!next.added) return;
    clipboardHistory = next.history.slice(0, MAX_ITEMS);
    try { saveDesktopPreferences(); } catch (error) { writeLog(`clipboard history save failed: ${error.message}`); }
    publishClipboardHistory();
  } catch (error) { writeLog(`clipboard read skipped: ${error.message}`); }
}
function setClipboardHistory(enabled) {
  clipboardHistoryEnabled = enabled;
  if (clipboardTimer) clearInterval(clipboardTimer);
  clipboardTimer = null;
  if (enabled) {
    sampleClipboard();
    clipboardTimer = setInterval(sampleClipboard, 1000);
    clipboardTimer.unref?.();
  }
  try { saveDesktopPreferences(); } catch (error) { writeLog(`clipboard history preference save failed: ${error.message}`); return false; }
  publishClipboardHistory();
  return true;
}

function writeLog(line) {
  const stamped = `[${new Date().toISOString()}] ${line}\n`;
  process.stdout.write(stamped);
  if (!logFile) return;
  try {
    fs.appendFileSync(logFile, stamped);
  } catch {
    // keep the shell usable if the log cannot be written
  }
}

function isProductRoot(dir) {
  try {
    return (
      fs.existsSync(path.join(dir, 'apps', 'host', 'package.json')) &&
      fs.existsSync(path.join(dir, 'services', 'daemon'))
    );
  } catch {
    return false;
  }
}

// Load a desktop surface from the first real file. Packaged builds resolve
// from app.asar, dev builds from the source tree; a wrong AEGIS_ROOT or a
// stale package must fall back instead of leaving a blank window.
function surfaceCandidates(name) {
  const candidates = [
    path.join(__dirname, 'ui-kit', `${name}.html`),
    path.join(__dirname, `${name}.html`),
    path.join(__dirname, 'desktop-ui', `${name}.html`),
    path.join(__dirname, 'desktop-ui', 'src', `${name}.html`),
  ];
  if (typeof process.resourcesPath === 'string')
    candidates.push(
      path.join(process.resourcesPath, 'app.asar', 'ui-kit', `${name}.html`),
      path.join(process.resourcesPath, 'app.asar', `${name}.html`),
    );
  if (root) {
    candidates.push(
      path.join(root, 'apps', 'desktop', 'ui-kit', `${name}.html`),
      path.join(root, 'apps', 'desktop', `${name}.html`),
      path.join(root, 'apps', 'desktop', 'desktop-ui', `${name}.html`),
    );
  }
  return [...new Set(candidates)];
}

function loadSurface(win, name) {
  const tried = [];
  for (const candidate of surfaceCandidates(name)) {
    if (!fs.existsSync(candidate)) {
      tried.push(candidate);
      continue;
    }
    try {
      void win.loadFile(candidate).then(() => {
        writeLog(`${name}: loaded ${candidate}`);
      }).catch((error) => {
        writeLog(`${name}: load failed ${candidate}: ${error.message}`);
      });
      return true;
    } catch (error) {
      tried.push(`${candidate} (${error.message})`);
    }
  }
  writeLog(`${name}: no loadable file. Tried: ${tried.join(' | ')}`);
  return false;
}

function resolveRoot() {
  const candidates = [];
  if (process.env.AEGIS_ROOT) {
    // AEGIS_ROOT can point at the product root or at its `apps` directory;
    // normalize the latter so `apps/desktop` never becomes `apps/apps/desktop`.
    let configured = path.resolve(process.env.AEGIS_ROOT);
    if (
      fs.existsSync(path.join(configured, 'host', 'package.json')) &&
      !fs.existsSync(path.join(configured, 'apps', 'host', 'package.json'))
    )
      configured = path.dirname(configured);
    candidates.push(configured);
  }
  if (DEV_MODE || !app.isPackaged) {
    let dir = __dirname;
    for (let i = 0; i < 4; i += 1) {
      candidates.push(dir);
      dir = path.dirname(dir);
    }
  }
  // Packaged: look beside the executable and in its ancestors.
  let dir = path.dirname(process.execPath);
  for (let i = 0; i < 5; i += 1) {
    candidates.push(dir);
    dir = path.dirname(dir);
  }
  return candidates.find(isProductRoot) || null;
}

function readEnvFile(file) {
  const env = {};
  if (!fs.existsSync(file)) return env;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const at = line.indexOf('=');
    const key = line.slice(0, at).trim();
    if (key) env[key] = line.slice(at + 1).trim();
  }
  return env;
}

function ensureSecret(name, bytes = 24) {
  const file = path.join(root, '.aegis-data', name);
  try {
    const value = fs.readFileSync(file, 'utf8').trim();
    if (value) return value;
  } catch {
    // generate below
  }
  const value = require('node:crypto').randomBytes(bytes).toString('hex');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value, { mode: 0o600 });
  return value;
}

function baseEnv() {
  const fileEnv =
    root == null
      ? {}
      : {
          ...readEnvFile(path.join(root, '.env')),
          ...readEnvFile(path.join(root, '.env.local')),
        };
  const effectiveRoot = root ?? app.getPath('userData');
  return {
    ...process.env,
    ...fileEnv,
    AEGIS_LOG_DIR: path.join(effectiveRoot, '.aegis-data', 'logs'),
    AEGIS_HOME: path.join(effectiveRoot, '.aegis-data'),
    DO_NOT_TRACK: process.env.DO_NOT_TRACK ?? '1',
    COPILOTKIT_TELEMETRY_DISABLED:
      process.env.COPILOTKIT_TELEMETRY_DISABLED ?? '1',
  };
}

function startService({ name, command, args, cwd, env, restart = true }) {
  if (!command) return;
  const key = name;
  const attempts = restarts.get(key) ?? 0;
  writeLog(`service ${name}: start ${command} ${args.join(' ')}`);
  let child;
  try {
    child = spawn(command, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
  } catch (error) {
    writeLog(`service ${name}: could not start (${error.message})`);
    return;
  }
  children.push(child);
  child.stdout.on('data', (data) => writeLog(`${name}: ${String(data).trimEnd()}`));
  child.stderr.on('data', (data) => writeLog(`${name}: ${String(data).trimEnd()}`));
  child.on('error', (error) => writeLog(`service ${name}: error ${error.message}`));
  child.on('exit', (code, signal) => {
    writeLog(`service ${name}: exited (code ${code ?? 'null'}, signal ${signal ?? 'none'})`);
    if (quitting || !restart) return;
    const delay = Math.min(1000 * 2 ** attempts, 15000);
    restarts.set(key, attempts + 1);
    setTimeout(() => {
      if (!quitting) startService({ name, command, args, cwd, env, restart });
    }, delay);
  });
}

async function isUp(url, timeoutMs = 1200) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return response.ok || response.status < 500;
  } catch {
    return false;
  }
}

// Server children need a real Node: Electron's bundled Node 20 has no
// node:sqlite (the host requires Node 22+), so process.execPath would exit
// with ERR_UNKNOWN_BUILTIN_MODULE. The shell uses the installed Node and says
// so when it is missing.
const NODE = process.env.AEGIS_NODE || 'node';
const nodeEnv = (env) => ({ ...env });

async function startServices() {
  const env = baseEnv();
  const orchestratorToken = ensureSecret('orchestrator-bridge', 32);
  const host = path.join(root, 'apps', 'host');
  const daemon = path.join(root, 'services', 'daemon');
  const dataDir = path.join(root, '.aegis-data');

  // 0. Local model server. The local provider tier (Ollama) is the default
  //    on a fresh install, so the shell starts the model server when it is
  //    installed. Without it every agent turn fails with "Connection error."
  //    while the UI still looks healthy.
  const ollamaBase = (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
  const ollamaCandidates = [
    process.env.OLLAMA_BIN,
    path.join(
      process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
      'Programs',
      'Ollama',
      'ollama.exe',
    ),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Ollama', 'ollama.exe'),
    isWindows ? 'ollama.exe' : 'ollama',
  ].filter(Boolean);
  if (await isUp(`${ollamaBase}/api/version`)) {
    writeLog('ollama: already answering; reusing it');
  } else {
    const ollama = ollamaCandidates.find((candidate) =>
      path.isAbsolute(candidate) ? fs.existsSync(candidate) : true,
    );
    if (ollama) {
      startService({
        name: 'ollama',
        command: ollama,
        args: ['serve'],
        cwd: dataDir,
        env: {
          ...env,
          OLLAMA_HOST: process.env.OLLAMA_HOST || '127.0.0.1:11434',
          OLLAMA_KEEP_ALIVE: process.env.OLLAMA_KEEP_ALIVE || '30m',
        },
        restart: false,
      });
    } else {
      writeLog('ollama: not installed; the local model tier stays offline');
    }
  }

  // 1. Python daemon (memory, tools, MCP). The venv is created by start.ps1;
  //    if it is missing we say so and continue with the rest.
  const pythonCandidates = [
    path.join(daemon, '.venv311', isWindows ? 'Scripts/python.exe' : 'bin/python'),
    path.join(daemon, '.venv', isWindows ? 'Scripts/python.exe' : 'bin/python'),
  ];
  const python = pythonCandidates.find((p) => fs.existsSync(p)) || pythonCandidates[0];
  if (await isUp('http://127.0.0.1:8765/api/health')) {
    writeLog('daemon: already answering on :8765; reusing it');
  } else if (fs.existsSync(python)) {
    startService({
      name: 'daemon',
      command: python,
      args: ['-m', 'aegis_daemon.main'],
      cwd: daemon,
      env,
    });
  } else {
    writeLog(`daemon: no venv at ${python} (run start.ps1 once); memory/MCP offline`);
  }

  // 3. Browser service (:4311) and WhatsApp sidecar (:4312).
  const distBrowser = path.join(host, 'dist', 'server', 'browser', 'index.js');
  const browserUrl = process.env.BROWSER_URL ?? 'http://127.0.0.1:4311';
  const browserSecret = process.env.BROWSER_SECRET || ensureSecret('browser-secret');
  if (await isUp('http://127.0.0.1:4311/health')) {
    writeLog('browser: already answering on :4311; reusing it');
  } else if (fs.existsSync(distBrowser)) {
    startService({
      name: 'browser',
      command: NODE,
      args: [distBrowser],
      cwd: host,
      env: {
        ...nodeEnv(env),
        BROWSER_SECRET: browserSecret,
        BROWSER_URL: browserUrl,
        BROWSER_HOST: process.env.BROWSER_HOST ?? '127.0.0.1',
        BROWSER_PORT: process.env.BROWSER_PORT ?? '4311',
        PLAYWRIGHT_BROWSERS_PATH:
          process.env.PLAYWRIGHT_BROWSERS_PATH ??
          path.join(dataDir, 'playwright-browsers'),
      },
    });
  }
  const distWhatsApp = path.join(host, 'dist', 'server', 'whatsapp', 'index.js');
  if (await isUp('http://127.0.0.1:4312/status')) {
    writeLog('whatsapp: already answering on :4312; reusing it');
  } else if (fs.existsSync(distWhatsApp)) {
    startService({
      name: 'whatsapp',
      command: NODE,
      args: [distWhatsApp],
      cwd: host,
      env: {
        ...nodeEnv(env),
        WHATSAPP_SECRET: process.env.WHATSAPP_SECRET || ensureSecret('whatsapp-secret'),
        AEGIS_WHATSAPP_URL:
          process.env.AEGIS_WHATSAPP_URL ?? 'http://127.0.0.1:4312',
        WHATSAPP_PORT: process.env.WHATSAPP_PORT ?? '4312',
        WHATSAPP_HOST: process.env.WHATSAPP_HOST ?? '127.0.0.1',
        WHATSAPP_AUTH_DIR: path.join(dataDir, 'whatsapp-auth'),
      },
    });
  }

  // 4. Voice pipeline (:8766) - faster-whisper STT + Piper TTS
  const pythonVoice = [
    path.join(daemon, '.venv311', 'Scripts', 'python.exe'),
    path.join(daemon, '.venv', 'Scripts', 'python.exe'),
    path.join(daemon, '.venv311', 'bin', 'python'),
    path.join(daemon, '.venv', 'bin', 'python'),
  ].find((candidate) => fs.existsSync(candidate));

  if (await isUp('http://127.0.0.1:8766/health')) {
    writeLog('voice: already answering on :8766; reusing it');
  } else if (pythonVoice) {
    startService({
      name: 'voice',
      command: pythonVoice,
      args: ['-m', 'aegis_daemon.voice_pipeline', '--port', '8766'],
      cwd: daemon,
      env: {
        ...env,
        PORT: '8766',
        AEGIS_HOST_URL: HOST_URL,
        VOICES_DIR: path.join(daemon, 'voices'),
      },
    });
  } else {
    writeLog('voice: no python venv found for voice pipeline');
  }

  // 4b. Windows Voice Bridge (:8767) - command-only access through the
  // Windows speech engine (the engine behind Windows Voice Access).
  if (isWindows && pythonVoice) {
    if (await isUp('http://127.0.0.1:8767/health')) {
      writeLog('windows-voice: already answering on :8767; reusing it');
    } else {
      startService({
        name: 'windows-voice',
        command: pythonVoice,
        args: ['-m', 'aegis_daemon.windows_bridge', '--port', '8767'],
        cwd: daemon,
        env: {
          ...env,
          PORT: '8767',
          VOICES_DIR: path.join(daemon, 'voices'),
        },
      });
    }
  }

  // 5. The host app. Built output only: the shell never runs a dev server.
  const hostEntry = path.join(host, 'dist', 'server', 'server', 'index.js');
  if (await isUp(`${HOST_URL}/api/health`)) {
    writeLog('host: already answering on :4310; reusing it');
  } else if (fs.existsSync(hostEntry)) {
    startService({
      name: 'host',
      command: NODE,
      args: [hostEntry],
      cwd: host,
      env: {
        ...nodeEnv(env),
        // The host owns the preview proxy and the research tool: both need the
        // same browser URL/secret the sidecar was started with.
        BROWSER_URL: browserUrl,
        BROWSER_SECRET: browserSecret,
        AEGIS_ORCHESTRATOR_TOKEN: orchestratorToken,
        // PORT=0 in a parent environment would give a random port; the shell
        // always wants the fixed URL it loads.
        PORT: '4310',
        HOST: '127.0.0.1',
        DATABASE_PATH: process.env.DATABASE_PATH ?? 'data/aegis.sqlite',
        PLAYWRIGHT_BROWSERS_PATH:
          process.env.PLAYWRIGHT_BROWSERS_PATH ??
          path.join(dataDir, 'playwright-browsers'),
      },
    });
  } else {
    writeLog(`host: ${hostEntry} missing — build apps/host first (npm run build)`);
    buildState = 'missing-build';
  }

  // Optional standalone Cursor Agent SDK orchestrator. It stays bound to
  // loopback, uses a per-install bearer token, and calls only the permission-
  // gated Aegis accessibility bridge above.
  const orchestratorDir = process.env.AEGIS_ORCHESTRATOR_DIR ||
    path.resolve(root, '..', 'aegis-orchestrator');
  const orchestratorEntry = path.join(orchestratorDir, 'serve.mjs');
  if (fs.existsSync(orchestratorEntry) && !(await isUp('http://127.0.0.1:4315/v1/health'))) {
    startService({
      name: 'aegis-orchestrator',
      command: NODE,
      args: [orchestratorEntry],
      cwd: orchestratorDir,
      env: { ...nodeEnv(env), AEGIS_HOST_URL: HOST_URL, AEGIS_ORCHESTRATOR_TOKEN: orchestratorToken },
    });
  } else if (!fs.existsSync(orchestratorEntry)) {
    writeLog(`orchestrator: SDK package not installed in ${orchestratorDir}`);
  }
}

async function waitForHost(timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !quitting) {
    try {
      const response = await fetch(`${HOST_URL}/api/health`, {
        signal: AbortSignal.timeout(1500),
      });
      if (response.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return false;
}

// The splash follows the OS theme: a pure black or pure white canvas, never
// a tinted slate. The renderer also honours this preference directly.
function splashTheme() {
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
}

// Owner-facing lockdown: reload, force-reload, devtools and print shortcuts
// are inert until Developer Options is enabled in Settings. Without this the
// app reloads (and loses in-page state) on a stray Ctrl+R.
function installShortcutGuard(window) {
  const blocked = (input) => {
    if (input.type !== 'keyDown') return false;
    const key = String(input.key || '').toLowerCase();
    const ctrl = input.control || input.meta;
    if (key === 'f5' || key === 'f12') return true;
    if (key === 'f11' && !ctrl) return false; // fullscreen stays
    if (ctrl && ['r', 'p', 'u'].includes(key)) return true;
    if (ctrl && input.shift && ['r', 'i', 'j', 'c', 'p'].includes(key)) return true;
    return false;
  };
  window.webContents.on('before-input-event', (event, input) => {
    if (devShortcutsEnabled) {
      // Developer options is on: keep an explicit DevTools chord, since the
      // default Electron menu (and its accelerators) is removed below.
      const key = String(input.key || '').toLowerCase();
      if (input.type === 'keyDown' && input.control && input.shift && ['i', 'j', 'c'].includes(key)) {
        event.preventDefault();
        window.webContents.toggleDevTools();
      }
      return;
    }
    if (!blocked(input)) return;
    event.preventDefault();
    writeLog(`shortcut locked: ${input.key} (enable Developer Options to allow)`);
  });
  window.webContents.on('devtools-opened', () => {
    if (!devShortcutsEnabled) window.webContents.closeDevTools();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#000000' : '#ffffff',
    title: 'Aegis',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  installShortcutGuard(mainWindow);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (['http:', 'https:'].includes(parsed.protocol)) {
        shell.openExternal(url);
      }
    } catch {}
    return { action: 'deny' };
  });
  mainWindow.loadFile(path.join(__dirname, 'loading.html'), {
    query: { theme: splashTheme() },
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    mainWindow.hide();
    wakeCompanion();
    writeLog('window hidden; services keep running (tray to reopen, Quit to exit)');
  });
  // MS Teams-style: minimize to the tray instead of the taskbar.
  mainWindow.on('minimize', (event) => {
    if (quitting || !minimizeToTray) return;
    event.preventDefault();
    mainWindow.hide();
    wakeCompanion();
    writeLog('window minimized to tray');
  });
  // Mutual exclusivity between the app window and the desktop surfaces: while
  // the owner is inside the app it is the active surface, so both the notch
  // and the tray flyout step aside. When the app is minimized or hidden, only
  // the notch returns (the tray flyout still opens only on a tray click).
  const syncDesktopSurfaces = () => {
    const appActive = !!(
      mainWindow &&
      !mainWindow.isDestroyed() &&
      mainWindow.isVisible() &&
      !mainWindow.isMinimized()
    );
    if (appActive) {
      if (desktopSurface === 'notch' && notchVisible) toggleNotch(false, false);
      setTrayPillVisible(false);
    } else if (desktopSurface === 'notch' && !notchVisible) {
      toggleNotch(true, false);
    }
  };
  mainWindow.on('focus', syncDesktopSurfaces);
  mainWindow.on('blur', syncDesktopSurfaces);
  mainWindow.on('minimize', syncDesktopSurfaces);
  mainWindow.on('restore', syncDesktopSurfaces);
  mainWindow.on('show', syncDesktopSurfaces);
  mainWindow.on('hide', syncDesktopSurfaces);

  void (async () => {
    const healthy = await waitForHost();
    if (healthy) {
      writeLog(`host healthy; loading ${HOST_URL}`);
      await mainWindow.loadURL(HOST_URL);
    } else if (buildState === 'missing-build') {
      mainWindow.loadFile(path.join(__dirname, 'loading.html'), {
        query: { reason: 'build', theme: splashTheme() },
      });
    } else {
      mainWindow.loadFile(path.join(__dirname, 'loading.html'), {
        query: { reason: 'timeout', theme: splashTheme() },
      });
    }
  })();
}

function createOverlay() {
  if (overlay) return overlay;
  const area = screen.getPrimaryDisplay().workArea;
  overlay = new BrowserWindow({
    width: 280,
    height: 340,
    x: area.x + area.width - 304,
    y: area.y + area.height - 364,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    focusable: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  installShortcutGuard(overlay);
  overlay.setAlwaysOnTop(true, 'floating');
  overlay.setIgnoreMouseEvents(true, { forward: true });
  overlay.webContents.on('did-finish-load', () => {
    if (!overlay || overlay.isDestroyed() || !lastStatusPayload) return;
    overlay.webContents.send('aegis:update-thought', lastStatusPayload.text || '');
    overlay.webContents.send('aegis:status', lastStatusPayload);
    overlay.webContents.send('aegis:update', lastStatusPayload);
    if (lastStatusPayload.widgets) overlay.webContents.send('aegis:widgets', lastStatusPayload.widgets);
    if (lastStatusPayload.agents) overlay.webContents.send('aegis:agents', lastStatusPayload.agents);
  });
  loadSurface(overlay, 'overlay');
  overlay.on('closed', () => {
    overlay = null;
    overlayVisible = false;
  });
  return overlay;
}


// A full-screen, transparent, click-through guidance HUD. It is a separate
// top-level window so it can draw above Blender, VS Code or any other app
// without stealing a click: the owner keeps working underneath.
function getAnnotationsWindow() {
  if (annotationsWindow) return annotationsWindow;
  const area = screen.getPrimaryDisplay().bounds;
  annotationsWindow = new BrowserWindow({
    x: area.x,
    y: area.y,
    width: area.width,
    height: area.height,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    focusable: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  installShortcutGuard(annotationsWindow);
  annotationsWindow.setAlwaysOnTop(true, 'screen-saver');
  annotationsWindow.setIgnoreMouseEvents(true, { forward: true });
  annotationsWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  annotationsWindow.webContents.on('did-fail-load', (_event, code, description) => {
    writeLog(`annotations: load failed ${code} ${description}`);
  });
  annotationsWindow.webContents.on('render-process-gone', (_event, details) => {
    writeLog(`annotations: renderer gone ${details?.reason || 'unknown'}`);
  });
  loadSurface(annotationsWindow, 'annotations');
  annotationsWindow.on('closed', () => {
    annotationsWindow = null;
    writeLog('annotations: window closed');
  });
  return annotationsWindow;
}

function showAnnotations(payload) {
  // A clear payload retires the overlay instead of painting an empty scene and
  // leaving the transparent window on top of the desktop.
  if (!payload || payload.clear === true) {
    clearAnnotations();
    return;
  }
  const win = getAnnotationsWindow();
  const display = screen.getPrimaryDisplay();
  const normalizedPayload = payload && payload.unit === 'px' && display.scaleFactor > 1
    ? scaleAnnotationPayload(payload, 1 / display.scaleFactor)
    : payload;
  const send = () => {
    if (!win || win.isDestroyed()) return;
    win.webContents.send('aegis:annotate', normalizedPayload || {});
    // `showInactive` is ignored on Windows for a non-focusable window in some
    // Electron builds, which left the overlay created but never painted. Show
    // it explicitly and put it back on top; it still cannot take focus because
    // the window itself is non-focusable and click-through.
    if (!win.isVisible()) win.showInactive();
    win.moveTop();
    win.setAlwaysOnTop(true, 'screen-saver');
    writeLog(`annotations: shown ${win.isVisible() ? 'visible' : 'hidden'}`);
  };
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send);
  else send();
}

function scaleAnnotationPayload(payload, scale) {
  const scaleItem = (item) => {
    if (!item || typeof item !== 'object') return item;
    const next = { ...item };
    for (const key of ['x', 'y', 'width', 'height', 'cx', 'cy', 'x1', 'y1', 'x2', 'y2']) {
      if (typeof next[key] === 'number') next[key] *= scale;
    }
    if (Array.isArray(next.points)) next.points = next.points.map((point) => Array.isArray(point) ? point.map((value) => typeof value === 'number' ? value * scale : value) : point);
    return next;
  };
  const mapArray = (value) => Array.isArray(value) ? value.map(scaleItem) : value;
  return {
    ...payload,
    targets: mapArray(payload.targets),
    drawings: mapArray(payload.drawings),
    steps: Array.isArray(payload.steps) ? payload.steps.map((step) => ({
      ...step,
      target: scaleItem(step.target),
      targets: mapArray(step.targets),
      drawings: mapArray(step.drawings),
    })) : payload.steps,
  };
}

function clearAnnotations() {
  if (!annotationsWindow || annotationsWindow.isDestroyed()) return;
  annotationsWindow.webContents.send('aegis:clear-annotations');
  annotationsWindow.hide();
}

// AEGIS Visual Layer: one transparent, always-on-top window over the whole
// display. It is the outside-the-app surface: the owner draws on top of any
// application, asks a question, and the host returns an animated scene.
function createVisualLayer() {
  if (visualLayer) return visualLayer;
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).bounds;
  visualLayer = new BrowserWindow({
    x: area.x,
    y: area.y,
    width: area.width,
    height: area.height,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    focusable: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Keep the WebGL scene animating while another app has focus.
      backgroundThrottling: false,
    },
  });
  installShortcutGuard(visualLayer);
  visualLayer.setAlwaysOnTop(true, 'screen-saver');
  visualLayer.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  visualLayer.setIgnoreMouseEvents(false);
  visualLayer.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (isMainFrame) writeLog(`visual: load failed (${code}) ${description} ${url}`);
  });
  visualLayer.webContents.on('render-process-gone', (_event, details) => {
    writeLog(`visual: renderer gone ${details?.reason || 'unknown'}`);
  });
  // The layer is the real Sightline engine in `layer` mode, served by the host.
  // It is not a separate hand-written page: Scene3D, the callouts and the aero
  // lab all come from apps/sightline.
  const layerUrl = `${HOST_URL}/sightline/index.html?layer=1`;
  visualLayer
    .loadURL(layerUrl)
    .then(() => writeLog(`visual: loaded ${layerUrl}`))
    .catch((error) => writeLog(`visual: load failed ${layerUrl}: ${error.message}`));
  visualLayer.on('closed', () => {
    visualLayer = null;
    visualLayerVisible = false;
    visualInteractive = false;
    writeLog('visual: window closed');
  });
  return visualLayer;
}

function toggleVisualLayer(show) {
  // Pressing the hotkey while the layer is open but click-through re-arms it
  // instead of hiding the scene the owner is reading.
  const next = show ?? (visualLayerVisible && !visualInteractive ? true : !visualLayerVisible);
  if (next) {
    const win = createVisualLayer();
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).bounds;
    win.setBounds(area);
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.setIgnoreMouseEvents(false);
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    win.setIgnoreMouseEvents(false);
    visualLayerVisible = true;
    visualInteractive = true;
    const send = () => {
      if (!win || win.isDestroyed()) return;
      win.webContents.send('aegis:visual-open');
    };
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send);
    else send();
    writeLog(`visual: shown visible=${win.isVisible()} bounds=${JSON.stringify(win.getBounds())}`);
  } else if (visualLayer && !visualLayer.isDestroyed()) {
    visualLayer.hide();
    visualLayerVisible = false;
    visualInteractive = false;
    writeLog('visual: hidden');
  }
}

function registerVisualShortcuts() {
  if (visualHotkey) return;
  // Win+Shift+Space is the requested gesture; Ctrl+Shift+Space is the reliable
  // fallback when Windows reserves the Super combination for input switching.
  for (const accelerator of ['Super+Shift+Space', 'CommandOrControl+Shift+Space']) {
    try {
      if (globalShortcut.register(accelerator, () => toggleVisualLayer())) {
        visualHotkey = visualHotkey ? `${visualHotkey}, ${accelerator}` : accelerator;
        writeLog(`visual: hotkey ${accelerator}`);
      }
    } catch (error) {
      writeLog(`visual: hotkey ${accelerator} failed: ${error.message}`);
    }
  }
}

function toggleOverlay(show) {
  const next = show ?? !overlayVisible;
  if (next) {
    createOverlay().showInactive();
    overlayVisible = true;
  } else if (overlay) {
    overlay.hide();
    overlayVisible = false;
  }
  tray?.setContextMenu(buildTrayMenu());
}

// A top-centre notch that stays out of the way and shows what Aegis is doing.
// It is a real control: the status text opens the app, the mic opens voice.
function createNotch() {
  if (notch) return notch;
  // One fixed transparent surface holds every Notch state (compact, hover,
  // shelf). It never resizes while the pointer is over it, so hover and click
  // cannot sweep the island sideways or stall on repeated setBounds() calls.
  const surface = notchSurfacePosition();
  const { width: NOTCH_WIDTH, height: NOTCH_HEIGHT } = surface;
  notch = new BrowserWindow({
    width: NOTCH_WIDTH,
    height: NOTCH_HEIGHT,
    x: surface.x,
    y: surface.y,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    focusable: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  installShortcutGuard(notch);
  // Keep the notch above ordinary application windows (including when Aegis
  // itself is focused). It is a non-activating overlay, so this does not steal
  // keyboard focus from the user's active application.
  notch.setAlwaysOnTop(true, 'screen-saver');
  notch.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // The surface always accepts input: it is sized to the island, so there is
  // never empty click-through space that needs forwarding.
  notch.setIgnoreMouseEvents(false);
  // Electron 33 sends a details object as the second console-message argument.
  // Keep renderer errors in the desktop log so a silent Notch boot failure is
  // diagnosable from a packaged build too.
  notch.webContents.on('console-message', (_event, details, legacyMessage) => {
    const message = typeof details === 'string' ? details : details?.message ?? legacyMessage;
    const level = typeof details === 'object' ? details?.level : undefined;
    if (level === 'error' || level === 3) writeLog(`[notch-renderer] ${String(message)}`);
  });
  notch.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (isMainFrame) writeLog(`[notch-renderer] load failed (${code}): ${description} ${url}`);
  });
  notch.webContents.on('render-process-gone', (_event, details) => {
    writeLog(`[notch-renderer] process gone: ${details?.reason || 'unknown'} ${details?.exitCode ?? ''}`);
  });
  // The page is created cold on the first status of a run, so replay the last
  // status once it can receive it.
  notch.webContents.on('did-finish-load', () => {
    if (!notch || notch.isDestroyed()) return;
    if (lastStatusPayload) {
      notch.webContents.send('aegis:update-thought', lastStatusPayload.text || '');
      notch.webContents.send('aegis:status', lastStatusPayload);
      notch.webContents.send('aegis:update', lastStatusPayload);
      if (lastStatusPayload.widgets) notch.webContents.send('aegis:widgets', lastStatusPayload.widgets);
      if (lastStatusPayload.agents) notch.webContents.send('aegis:agents', lastStatusPayload.agents);
    }
    notch.webContents.send('aegis:notch-settings', notchSettings);
  });
  notch.webContents.on('did-start-loading', () => { notchRendererReady = false; });
  loadSurface(notch, 'notch');
  if (!notchScreenListeners) {
    const reposition = () => {
      if (!notch || notch.isDestroyed()) return;
      notch.setBounds(notchSurfacePosition());
      notch.setAlwaysOnTop(true, 'screen-saver');
      notch.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      if (notch.isVisible()) notch.moveTop();
    };
    screen.on('display-metrics-changed', reposition);
    screen.on('display-added', reposition);
    screen.on('display-removed', reposition);
    notchScreenListeners = true;
  }
  notch.on('closed', () => {
    notchRendererReady = false;
    notchExpanded = false;
    notch = null;
    notchVisible = false;
  });
  return notch;
}

/**
 * Grow/shrink the native surface to the island the renderer is showing. The
 * window is repositioned so the island stays centered on the same display.
 */
function setNotchExpanded(expanded) {
  const next = expanded === true;
  if (next === notchExpanded) return;
  notchExpanded = next;
  if (!notch || notch.isDestroyed()) return;
  notch.setBounds(notchSurfacePosition());
  notch.setAlwaysOnTop(true, 'screen-saver');
  if (notch.isVisible()) notch.moveTop();
}

function toggleNotch(show, manual = true) {
  const next = show ?? !notchVisible;
  if (next) {
    const win = createNotch();
    win.setBounds(notchSurfacePosition());
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.setIgnoreMouseEvents(false);
    win.showInactive();
    win.moveTop();
    notchVisible = true;
    writeLog(`notch: shown visible=${win.isVisible()} bounds=${JSON.stringify(win.getBounds())}`);
  } else if (notch) {
    notch.hide();
    notchVisible = false;
    notchExpanded = false;
    writeLog('notch: hidden');
  }
  if (manual) notchPinned = next;
  tray?.setContextMenu(buildTrayMenu());
}

function toggleWidgets(show) {
  // Widgets belong to the notch shelf, never a second floating window.
  if (show === false) {
      if (notch && !notch.isDestroyed()) notch.webContents.send('aegis:event', 'view:close');
    return;
  }
  if (!notchVisible) toggleNotch(true, false);
  if (notch && !notch.isDestroyed()) {
    const eventName = 'view:widgets';
    if (notch.webContents.isLoading()) notch.webContents.once('did-finish-load', () => notch?.webContents.send('aegis:event', eventName));
    else notch.webContents.send('aegis:event', eventName);
  }
}

function focusDesktopSurface(event, focused) {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win === mainWindow || win.isDestroyed()) return;
  win.setFocusable(Boolean(focused));
  if (focused) win.focus();
}

function positionTrayPill() {
  if (!trayPill || trayPill.isDestroyed()) return;
  // Use the actual pointer location reported by the native tray enter/click
  // event. getBounds() can be empty while Windows is moving an icon between
  // the overflow flyout and the notification area; falling back to the right
  // edge put our flyout over the language/clock controls.
  const point = trayAnchorPoint || screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(point);
  const area = display.workArea;
  const width = 340;
  const height = 320;
  const x = Math.max(area.x + 8, Math.min(area.x + area.width - width - 8,
    Math.round(point.x - width / 2)));
  const y = Math.max(area.y + 8, Math.min(area.y + area.height - height - 8,
    Math.round(point.y - height - 8)));
  trayPill.setBounds({ x, y, width, height });
}

function createTrayPill() {
  if (trayPill && !trayPill.isDestroyed()) return trayPill;
  trayPill = new BrowserWindow({
    width: 340,
    height: 320,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    focusable: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  installShortcutGuard(trayPill);
  trayPill.setAlwaysOnTop(true, 'screen-saver');
  trayPill.setIgnoreMouseEvents(true, { forward: true });
  loadSurface(trayPill, 'tray-pill');
  trayPill.webContents.on('did-finish-load', () => {
    if (lastStatusPayload) {
      trayPill?.webContents.send('aegis:update-thought', lastStatusPayload.text || lastStatusPayload.status || '');
      trayPill?.webContents.send('aegis:status', lastStatusPayload);
      trayPill?.webContents.send('aegis:update', lastStatusPayload);
      if (lastStatusPayload.widgets) trayPill?.webContents.send('aegis:widgets', lastStatusPayload.widgets);
      if (lastStatusPayload.agents) trayPill?.webContents.send('aegis:agents', lastStatusPayload.agents);
    }
  });
  trayPill.on('closed', () => { trayPill = null; });
  return trayPill;
}

function showTrayPill(eventName = 'tray:hover', point = null) {
  trayAnchorPoint = point || screen.getCursorScreenPoint();
  const win = createTrayPill();
  positionTrayPill();
  if (!win.isVisible()) win.showInactive();
  win.moveTop();
  win.webContents.send('aegis:event', eventName);
}

function setTrayPillVisible(visible) {
  if (visible) {
    const win = createTrayPill();
    positionTrayPill();
    if (!win.isVisible()) win.showInactive();
    win.moveTop();
  } else if (trayPill && !trayPill.isDestroyed()) {
    trayPill.hide();
  }
}

// The voice-mode live screen: while the owner is talking to Aegis the screen
// the agent is looking at steps out of the app and floats above every other
// window, larger than the in-app preview and with its own widen control. The
// host renderer streams frames here over IPC, so this window needs no host
// credentials of its own and can sit on top of Blender or any other app.
function broadcastStatus(status) {
  const statusText = typeof status === 'string'
    ? status
    : (status?.text || status?.status || status?.prompt || '');

  let agentState = 'idle';
  let character = currentTrayCharacter || 'aegi';

  if (typeof status === 'object' && status !== null) {
    if (status.state) agentState = status.state;
    if (status.character) character = status.character;
  } else if (typeof status === 'string') {
    const lower = status.toLowerCase();
    if (lower.includes('running') || lower.includes('working')) agentState = 'working';
    else if (lower.includes('listen') || lower.includes('mic')) agentState = 'listening';
    else if (lower.includes('think') || lower.includes('plan') || lower.includes('queued')) agentState = 'thinking';
    else if (lower.includes('search')) agentState = 'searching';
    else if (lower.includes('done') || lower.includes('finish') || lower.includes('success')) agentState = 'done';
    else if (lower.includes('fail') || lower.includes('error')) agentState = 'error';
    else if (lower.includes('speak')) agentState = 'speaking';
    else if (lower.includes('idle') || lower.includes('ready')) agentState = 'idle';
  }

  // Update dynamic tray icon to match current agent state
  updateTrayIcon(agentState, character);

  // While the agent is busy the notch is useful, so it opens on its own; it
  // closes itself again after the run finishes unless the owner pinned it.
  // It never opens while the main app window is foreground — the app is the
  // active surface then, and the notch must stay out of the way.
  agentBusy = ['listening', 'working', 'thinking', 'searching', 'speaking'].includes(agentState);
  const appForeground = !!(
    mainWindow &&
    !mainWindow.isDestroyed() &&
    mainWindow.isVisible() &&
    !mainWindow.isMinimized()
  );
  if (agentBusy && desktopSurface === 'notch' && !appForeground) {
    if (notchAutoTimer) {
      clearTimeout(notchAutoTimer);
      notchAutoTimer = null;
    }
    if (!notchVisible) toggleNotch(true, false);
  } else {
    armNotchAutoHide(9000);
  }

  // Broadcast rich updates to overlay, notch, and widgets
  const payload = typeof status === 'object' && status !== null
    ? { ...status, state: agentState, character, text: statusText, status: statusText }
    : { status: statusText, state: agentState, character, text: statusText };
  // Every surface gets the same pause flag and outside-surface choice, so the
  // notch can never disagree with the app window about either.
  payload.paused = typeof payload.paused === 'boolean' ? payload.paused : pausedNow;
  payload.surface = desktopSurface;
  if (payload.paused !== pausedNow) pausedNow = payload.paused;
  lastStatusPayload = payload;

  // Desktop surfaces get the whole status object; the app window gets only the
  // fields its Widgets surface actually renders, so the renderer is not waking
  // up for agent trees, step lists and prompts it never reads.
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('aegis:status', {
      status: payload.status,
      state: payload.state,
      paused: payload.paused,
      surface: payload.surface,
      widgets: payload.widgets,
    });
  }

  for (const window of [notch, trayPill]) {
    if (window && !window.isDestroyed()) {
      window.webContents.send('aegis:update-thought', statusText);
      window.webContents.send('aegis:status', payload);
      window.webContents.send('aegis:update', payload);
      if (payload.widgets) window.webContents.send('aegis:widgets', payload.widgets);
      if (payload.agents) window.webContents.send('aegis:agents', payload.agents);
      if (payload.notice || payload.notification)
        window.webContents.send('aegis:notify', payload.notice || payload.notification);
    }
  }
}

/**
 * Shows exactly one outside-the-app surface. 'notch' is the compact island;
 * 'mascot' is the floating character. They are mutually exclusive by owner
 * preference, and the app window never draws a mascot of its own.
 */
function applyDesktopSurface(surface) {
  // The desktop mascot is intentionally disabled: it was resource-heavy and
  // competed with the user's desktop. Keep the single, lightweight notch.
  desktopSurface = 'notch';
  surfaceInitialised = true;
  try {
    toggleOverlay(false);
    overlayAutoShown = false;
    toggleNotch(true, false);
  } catch (error) {
    writeLog(`applyDesktopSurface error: ${error.message}`);
  }
  broadcastStatus({ paused: pausedNow, surface: desktopSurface, status: 'Ready' });
}

function openVoice() {
  if (!mainWindow) createWindow();
  showMain();
  const send = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('aegis:open-voice');
  };
  if (mainWindow.webContents.isLoading()) {
    mainWindow.webContents.once('did-finish-load', send);
  } else {
    send();
  }
}

function showMain() {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  else {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
  // The notch is a persistent desktop surface and remains available above the
  // main application. Only the desktop mascot is retired.
  if (overlay && !overlay.isDestroyed()) overlay.hide();
  overlayAutoShown = false;
  if (desktopSurface === 'notch' && (!notch || !notch.isVisible())) toggleNotch(true, false);
}

// The companion wakes on its own when Aegis leaves the screen, and the notch
// closes again once the agent is idle so it never sits in the way.
function armNotchAutoHide(delay = 6000) {
  // Kept as a compatibility no-op for old wake/status call sites. Hiding the
  // notch merely because a task became idle made it disappear behind apps.
  if (notchAutoTimer) clearTimeout(notchAutoTimer);
  notchAutoTimer = null;
}

function wakeCompanion() {
  toggleNotch(true, false);
}

function sleepCompanion() {
  if (overlay && !overlay.isDestroyed()) overlay.hide();
  overlayAutoShown = false;
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: 'Open Aegis', click: showMain },
    {
      label: 'Talk to Aegis',
      click: () => openVoice(),
    },
    {
      label: 'Display notch',
      type: 'checkbox',
      checked: notchVisible,
      click: () => toggleNotch(),
    },
    {
      label: 'Visual layer (Win+Shift+Space)',
      click: () => toggleVisualLayer(true),
    },
    {
      label: 'Start Aegis at login',
      type: 'checkbox',
      checked:
        process.platform !== 'linux' && app.getLoginItemSettings().openAtLogin,
      click: (item) => {
        app.setLoginItemSettings({
          openAtLogin: item.checked,
          openAsHidden: true,
        });
      },
    },
    {
      label: 'Open log folder',
      click: () =>
        shell.openPath(path.join(root ?? app.getPath('userData'), '.aegis-data', 'logs')),
    },
    { type: 'separator' },
    {
      label: 'Quit Aegis (stops services)',
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ]);
}

let currentTrayState = 'idle';
let currentTrayCharacter = 'aegi';

const TRAY_TOOLTIPS = {
  idle: 'Aegis — Ready',
  listening: 'Aegis — Listening...',
  thinking: 'Aegis — Thinking...',
  searching: 'Aegis — Searching...',
  working: 'Aegis — Working...',
  speaking: 'Aegis — Speaking',
  sending: 'Aegis — Sending...',
  paused: 'Aegis — Paused',
  cancelled: 'Aegis — Cancelled',
  done: 'Aegis — Done',
  error: 'Aegis — Something went wrong',
  notification: 'Aegis — Needs attention',
  sleeping: 'Aegis — Sleeping',
  celebrate: 'Aegis — Success!',
};

function getMascotKitPath() {
  const candidates = [
    path.join(__dirname, '..', '..', 'vendor', 'mascot-kit'),
    root ? path.join(root, 'vendor', 'mascot-kit') : null,
    path.join(__dirname, 'vendor', 'mascot-kit'),
  ].filter(Boolean);
  return candidates.find((c) => fs.existsSync(c)) || path.join(__dirname, '..', '..', 'vendor', 'mascot-kit');
}

function getTrayIcon(state = 'idle', character = 'aegi') {
  const safeChar = typeof character === 'string' && character ? character : 'aegi';
  const safeState = typeof state === 'string' && state ? state : 'idle';
  const kitPath = getMascotKitPath();
  const theme = nativeTheme.shouldUseDarkColors ? 'dark' : 'color';

  if (isWindows) {
    // 1. Primary: .ico for current character and variant
    const icoPath = path.join(kitPath, 'tray', 'ico', safeChar, theme, `${safeState}.ico`);
    if (fs.existsSync(icoPath)) {
      const img = nativeImage.createFromPath(icoPath);
      if (!img.isEmpty()) return img;
    }
    // 2. Fallback: 'color' variant .ico
    const colorIco = path.join(kitPath, 'tray', 'ico', safeChar, 'color', `${safeState}.ico`);
    if (fs.existsSync(colorIco)) {
      const img = nativeImage.createFromPath(colorIco);
      if (!img.isEmpty()) return img;
    }
    // 3. Fallback: 'aegi' .ico
    const aegiIco = path.join(kitPath, 'tray', 'ico', 'aegi', 'color', `${safeState}.ico`);
    if (fs.existsSync(aegiIco)) {
      const img = nativeImage.createFromPath(aegiIco);
      if (!img.isEmpty()) return img;
    }
  }

  // 4. PNG fallback: size 32 or 16
  const pngPath = path.join(kitPath, 'tray', 'png', safeChar, theme, `${safeState}-32.png`);
  if (fs.existsSync(pngPath)) {
    const img = nativeImage.createFromPath(pngPath).resize({ width: 16, height: 16 });
    if (!img.isEmpty()) return img;
  }
  const colorPng = path.join(kitPath, 'tray', 'png', safeChar, 'color', `${safeState}-32.png`);
  if (fs.existsSync(colorPng)) {
    const img = nativeImage.createFromPath(colorPng).resize({ width: 16, height: 16 });
    if (!img.isEmpty()) return img;
  }
  const aegiPng = path.join(kitPath, 'tray', 'png', 'aegi', 'color', `${safeState}-32.png`);
  if (fs.existsSync(aegiPng)) {
    const img = nativeImage.createFromPath(aegiPng).resize({ width: 16, height: 16 });
    if (!img.isEmpty()) return img;
  }

  // 5. Desktop local assets fallback
  const desktopTrayMascot = path.join(__dirname, 'assets', 'tray-mascot.png');
  if (fs.existsSync(desktopTrayMascot)) {
    return nativeImage.createFromPath(desktopTrayMascot).resize({ width: 16, height: 16 });
  }
  const defaultTray = path.join(__dirname, 'assets', 'tray.png');
  if (fs.existsSync(defaultTray)) {
    return nativeImage.createFromPath(defaultTray).resize({ width: 16, height: 16 });
  }
  return nativeImage.createEmpty();
}

function updateTrayIcon(state, character, customTooltip, iconDataUrl) {
  if (!tray) return;
  const safeState = typeof state === 'string' && state ? state : currentTrayState;
  const safeChar = typeof character === 'string' && character ? character : currentTrayCharacter;
  currentTrayState = safeState;
  currentTrayCharacter = safeChar;

  const icon = typeof iconDataUrl === 'string' && iconDataUrl.startsWith('data:image/')
    ? nativeImage.createFromDataURL(iconDataUrl).resize({ width: 16, height: 16 })
    : getTrayIcon(currentTrayState, currentTrayCharacter);
  if (!icon.isEmpty()) {
    tray.setImage(icon);
  }
  const tooltip = (typeof customTooltip === 'string' && customTooltip) || TRAY_TOOLTIPS[currentTrayState] || `Aegis — ${currentTrayState}`;
  tray.setToolTip(tooltip);
}

function createTray() {
  const image = getTrayIcon('idle', 'aegi');
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image);
  tray.setToolTip(TRAY_TOOLTIPS.idle);
  tray.setContextMenu(buildTrayMenu());
  // The flyout is click-only: hovering the tray icon must not pop it open.
  // It also stays hidden while the main app window is visible (the app is the
  // active surface then), so it never covers the app or double-activates.
  tray.on('click', () => {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && !mainWindow.isMinimized()) {
      setTrayPillVisible(false);
      return;
    }
    showTrayPill('tray:click', screen.getCursorScreenPoint());
  });
}

const AGENT_CHARACTERS = {
  aegis: 'aegi',
  rfi: 'harness',
  security: 'security',
  files: 'files',
  memory: 'memory',
  computer: 'social',
};

function handleMediaControl(control) {
  if (isWindows && ['previous', 'playPause', 'next'].includes(control)) {
    void queryWindowsMediaSession(control).then((result) => {
      if (!result?.available || !result.ok) writeLog(`Windows media session did not accept ${control}: ${result?.reason || 'unsupported control'}`);
    });
    return;
  }
  const virtualKeys = {
    previous: 0xB1,
    playPause: 0xB3,
    next: 0xB0,
    volumeDown: 0xAE,
    volumeUp: 0xAF,
    mute: 0xAD,
  };
  const key = virtualKeys[control];
  if (!key) return;
  if (isWindows) {
    const script = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class AegisMediaKeys { [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra); }'; [AegisMediaKeys]::keybd_event(${key},0,0,[UIntPtr]::Zero); [AegisMediaKeys]::keybd_event(${key},0,2,[UIntPtr]::Zero)`;
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true,
      timeout: 3000,
    }, (error) => {
      if (error) writeLog(`media control ${control} failed: ${error.message}`);
    });
  } else if (process.platform === 'linux') {
    const playerctl = { previous: 'previous', playPause: 'play-pause', next: 'next' }[control];
    if (playerctl) execFile('playerctl', [playerctl], { timeout: 3000 }, () => {});
  }
}

function queryWindowsMediaSession(action = 'query') {
  return new Promise((resolve) => {
    const scriptPath = path.join(__dirname, 'media-session.ps1');
    execFile('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-Action', action], {
      windowsHide: true,
      timeout: 5000,
      maxBuffer: 64 * 1024,
    }, (error, stdout) => {
      if (error) return resolve({ available: false, reason: 'Windows media session query failed.' });
      try { resolve(JSON.parse(stdout.trim())); }
      catch { resolve({ available: false, reason: 'Windows returned an unreadable media session response.' }); }
    });
  });
}

function discoverExternalAgents() {
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'coding-processes.ps1')], {
      windowsHide: true,
      timeout: 4000,
      maxBuffer: 64 * 1024,
    }, (error, stdout) => {
      if (error) return resolve([]);
      let processNames;
      try { processNames = JSON.parse(stdout.trim() || '[]'); }
      catch { return resolve([]); }
      const names = new Set((Array.isArray(processNames) ? processNames : [processNames]).map((name) => String(name).toLowerCase()));
      const supported = [
        ['cursor', 'Cursor'], ['claude', 'Claude Code'], ['codex', 'Codex'],
        ['opencode', 'OpenCode'], ['antigravity', 'Antigravity'], ['windsurf', 'Windsurf'],
      ];
      resolve(supported.filter(([processName]) => names.has(processName)).map(([processName, label]) => ({
        id: processName,
        name: label,
        state: 'open',
        detail: 'App detected. Task activity is unavailable without a supported integration.',
      })));
    });
  });
}

function getSystemMetricsSnapshot() {
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const cpus = os.cpus();
  const current = cpus.reduce((sum, cpu) => {
    const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
    return { total: sum.total + total, idle: sum.idle + cpu.times.idle };
  }, { total: 0, idle: 0 });
  let cpuPercent = 0;
  if (lastCpuSnapshot) {
    const totalDelta = current.total - lastCpuSnapshot.total;
    const idleDelta = current.idle - lastCpuSnapshot.idle;
    if (totalDelta > 0) cpuPercent = Math.round((1 - idleDelta / totalDelta) * 100);
  }
  lastCpuSnapshot = current;
  const clampedCpu = Math.max(0, Math.min(100, cpuPercent));
  const memoryPercent = Math.round(((totalMemory - freeMemory) / totalMemory) * 100);
  const usedMemoryGb = Number(((totalMemory - freeMemory) / 1024 ** 3).toFixed(1));
  const totalMemoryGb = Number((totalMemory / 1024 ** 3).toFixed(1));
  const uptimeHours = Number((os.uptime() / 3600).toFixed(1));

  cpuHistory.push(clampedCpu);
  if (cpuHistory.length > MAX_METRIC_HIST) cpuHistory.shift();
  memHistory.push(memoryPercent);
  if (memHistory.length > MAX_METRIC_HIST) memHistory.shift();

  return {
    cpuPercent: clampedCpu,
    memoryPercent,
    usedMemoryGb: String(usedMemoryGb),
    totalMemoryGb: String(totalMemoryGb),
    uptimeHours: String(uptimeHours),
    platform: os.platform(),
    cpu: clampedCpu,
    mem: memoryPercent,
    gpu: null,
    used: usedMemoryGb,
    total: totalMemoryGb,
    up: uptimeHours,
    hist: {
      cpu: [...cpuHistory],
      gpu: [...gpuHistory],
      mem: [...memHistory],
    },
  };
}

function normalizeWeather(wJson, cityName) {
  if (!wJson) return null;
  const current = wJson.current || {};
  const daily = wJson.daily || {};
  const temp = typeof current.temperature_2m === 'number'
    ? current.temperature_2m
    : typeof current.temp === 'number' ? current.temp : 20;
  const weatherCode = current.weather_code ?? 0;
  return {
    temp: Math.round(temp),
    code: weatherCode,
    weatherCode,
    city: cityName || wJson.city || 'Local',
    high: Math.round(daily.temperature_2m_max?.[0] ?? temp),
    low: Math.round(daily.temperature_2m_min?.[0] ?? temp),
    feels: Math.round(current.apparent_temperature ?? temp),
    humidity: current.relative_humidity_2m ?? 50,
    wind: current.wind_speed_10m ?? 5,
    isDay: current.is_day === 1 || current.is_day === true,
    condition: current.condition || 'Fair',
    day: Array.isArray(daily.time)
      ? daily.time.slice(0, 24).map((t, idx) => ({ h: idx, temp: Math.round(daily.temperature_2m_max?.[idx] ?? temp) }))
      : Array.from({ length: 24 }, (_, h) => ({ h, temp: Math.round(temp) })),
    hours: [
      { label: 'Now', temp: Math.round(temp), code: weatherCode, isDay: current.is_day === 1 },
      { label: '+2h', temp: Math.round(temp + 1), code: weatherCode, isDay: current.is_day === 1 },
      { label: '+4h', temp: Math.round(temp + 2), code: weatherCode, isDay: current.is_day === 1 },
      { label: '+6h', temp: Math.round(temp), code: weatherCode, isDay: current.is_day === 1 },
    ],
    sample: false,
    source: 'host',
  };
}

async function watchTasks() {
  if (buildState === 'missing-build') return;
  try {
    const [stateRes, agentsRes, tasksRes] = await Promise.allSettled([
      fetch(`${HOST_URL}/api/state`, { signal: AbortSignal.timeout(2500) }),
      fetch(`${HOST_URL}/api/agents`, { signal: AbortSignal.timeout(2500) }),
      fetch(`${HOST_URL}/api/agents/tasks`, { signal: AbortSignal.timeout(2500) }),
    ]);

    const state = stateRes.status === 'fulfilled' && stateRes.value.ok ? await stateRes.value.json() : null;
    const agentsData = agentsRes.status === 'fulfilled' && agentsRes.value.ok ? await agentsRes.value.json() : null;
    const tasksData = tasksRes.status === 'fulfilled' && tasksRes.value.ok ? await tasksRes.value.json() : null;

    if (state?.settings?.developerOptionsEnabled !== undefined) {
      devShortcutsEnabled = state.settings.developerOptionsEnabled === true;
    }
    if (state?.settings && typeof state.settings.paused === 'boolean') {
      pausedNow = state.settings.paused;
    }
    const surface = 'notch';
    if (!surfaceInitialised || surface !== desktopSurface) {
      surfaceInitialised = true;
      applyDesktopSurface(surface);
    }

    const hostTasks = Array.isArray(state?.tasks) ? state.tasks : [];
    const swarmTasks = Array.isArray(tasksData?.tasks) ? tasksData.tasks : [];

    // Find running swarm task or host task
    const runningSwarm = swarmTasks.find((t) =>
      ['running', 'planning', 'synthesizing'].includes(t.status)
    );
    const runningHost = hostTasks.filter((t) => t.status === 'running');
    const queuedHost = hostTasks.filter((t) => t.status === 'queued');

    // Build live agents roster
    const rawAgents = Array.isArray(agentsData?.agents) && agentsData.agents.length
      ? agentsData.agents
      : [
          { id: 'aegis', name: 'Aegis', role: 'Orchestrator' },
          { id: 'rfi', name: 'RFI', role: 'Research & Financial Intelligence' },
          { id: 'security', name: 'Sentinel', role: 'Security & Permissions' },
          { id: 'files', name: 'Filo', role: 'Files & Documents' },
          { id: 'memory', name: 'Memo', role: 'Memory & Context' },
          { id: 'computer', name: 'Operator', role: 'Computer & Browser' },
        ];

    const liveAgents = rawAgents.map((ag) => {
      const char = AGENT_CHARACTERS[ag.id] || 'aegi';
      let agentState = 'idle';
      let currentTask = '';
      let progress = null;

      if (runningSwarm) {
        if (runningSwarm.agents?.includes(ag.id) || runningSwarm.requestedAgentId === ag.id) {
          agentState = runningSwarm.status === 'planning' ? 'thinking' : 'working';
          currentTask = runningSwarm.prompt || runningSwarm.title || '';
          progress = runningSwarm.subtaskCount > 0
            ? Math.round((runningSwarm.completedSubtasks / runningSwarm.subtaskCount) * 100)
            : 50;
        }
      }
      return {
        id: ag.id,
        name: ag.name,
        role: ag.role,
        character: char,
        state: agentState,
        task: currentTask,
        progress,
        capabilities: ag.capabilities || [],
        kind: ag.kind || (ag.id === 'aegis' ? 'orchestrator' : 'specialist'),
        model: ag.model || agentsData?.active?.model || 'mercury-3',
        provider: ag.provider || agentsData?.active?.provider || 'Inception',
      };
    });
    cachedAgents = liveAgents;

    // Determine overall running prompt, state, progress, steps
    let activePrompt = '';
    let statusText = 'Idle';
    let agentState = 'idle';
    let taskProgress = null;
    let taskSteps = [];
    const runningCount = (runningSwarm ? 1 : 0) + runningHost.length;

    if (runningSwarm) {
      activePrompt = runningSwarm.prompt || runningSwarm.title || 'Swarm task running';
      statusText = `Aegis Swarm: ${activePrompt.slice(0, 42)}`;
      agentState = runningSwarm.status === 'planning' ? 'thinking' : 'working';
      taskProgress = runningSwarm.subtaskCount > 0
        ? Math.round((runningSwarm.completedSubtasks / runningSwarm.subtaskCount) * 100)
        : 50;
      taskSteps = (runningSwarm.agents || []).map((agId) => ({
        text: `${agId.toUpperCase()} specialist execution`,
        state: runningSwarm.status === 'completed' ? 'done' : 'now',
      }));
    } else if (runningHost.length) {
      activePrompt = String(runningHost[0].prompt ?? 'task');
      statusText = `${runningHost.length} running: ${activePrompt.slice(0, 40)}`;
      agentState = 'working';
      taskProgress = runningHost[0].progress ?? null;
      taskSteps = Array.isArray(runningHost[0].steps) ? runningHost[0].steps : [];
    } else if (queuedHost.length) {
      statusText = `${queuedHost.length} queued`;
      agentState = 'thinking';
    }

    lastTasks.set('__status', statusText);

    // Weather from cache or host
    if (!cachedWeather) {
      try {
        const lat = lastWeatherLoc?.lat ?? 51.5;
        const lon = lastWeatherLoc?.lon ?? -0.12;
        const wRes = await fetch(`${HOST_URL}/api/weather?lat=${lat}&lon=${lon}`, {
          signal: AbortSignal.timeout(2000),
        });
        if (wRes.ok) {
          cachedWeather = normalizeWeather(await wRes.json(), lastWeatherLoc?.name || 'Local');
        }
      } catch {
        // host weather optional
      }
    }

    const widgetData = {
      agents: liveAgents,
      subagents: liveAgents,
      voice: {
        stt: 'faster-whisper',
        lang: 'en',
        tts: 'kokoro',
        available: true,
      },
      security: {
        pending: 0,
        label: 'Sentinel Active',
        strict: process.env.AEGIS_PROVENANCE_STRICT === 'true',
      },
      model: {
        provider: agentsData?.active?.provider || 'Inception',
        model: agentsData?.active?.model || 'mercury-3',
        mode: state?.mode || 'Assistant',
      },
      conversations: {
        active: Array.isArray(state?.memories) ? state.memories.length : 0,
      },
    };
    if (cachedWeather) widgetData.weather = cachedWeather;

    // Paused is a real state for every surface, not just a boolean the app
    // knows about, so the notch shows "Paused" the moment the app pauses.
    if (pausedNow) {
      agentState = 'paused';
      statusText = 'Paused by you';
    }

    broadcastStatus({
      status: statusText,
      state: agentState,
      running: runningCount,
      runningCount,
      prompt: activePrompt,
      progress: taskProgress,
      steps: taskSteps,
      agents: liveAgents,
      subagents: liveAgents,
      widgets: widgetData,
      paused: pausedNow,
      surface: desktopSurface,
    });

    for (const task of hostTasks) {
      const previous = lastTasks.get(task.id);
      lastTasks.set(task.id, task.status);
      if (
        previous &&
        previous !== task.status &&
        ['completed', 'failed'].includes(task.status)
      ) {
        const notification = new Notification({
          title: task.status === 'completed' ? 'Aegis finished a task' : 'Aegis task failed',
          body: String(task.prompt ?? '').slice(0, 160),
          icon: path.join(__dirname, 'assets', 'icon.png'),
          silent: false,
        });
        notification.on('click', showMain);
        notification.show();
        writeLog(`notification: task ${task.id} ${task.status}`);
      }
    }

    for (const st of swarmTasks) {
      const prevStatus = lastTasks.get('swarm:' + st.id);
      lastTasks.set('swarm:' + st.id, st.status);
      if (
        prevStatus &&
        prevStatus !== st.status &&
        ['completed', 'failed'].includes(st.status)
      ) {
        const notification = new Notification({
          title: st.status === 'completed' ? 'Aegis Swarm completed task' : 'Aegis Swarm task failed',
          body: String(st.prompt ?? st.title ?? '').slice(0, 160),
          icon: path.join(__dirname, 'assets', 'icon.png'),
          silent: false,
        });
        notification.on('click', showMain);
        notification.show();
        writeLog(`notification: swarm task ${st.id} ${st.status}`);
      }
    }
  } catch (err) {
    writeLog(`watchTasks error: ${err.message}`);
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', showMain);

  app.whenReady().then(() => {
    // No application menu: Electron's default View menu is exactly where
    // Reload / Force Reload / Toggle DevTools live, and reloading the page
    // is what produced the stray flashing screen. The tray menu and the
    // in-app views are the supported surfaces.
    Menu.setApplicationMenu(null);
    root = resolveRoot();
    loadDesktopPreferences();
    if (clipboardHistoryEnabled) {
      sampleClipboard();
      clipboardTimer = setInterval(sampleClipboard, 1000);
      clipboardTimer.unref?.();
    }
    if (root) {
      fs.mkdirSync(path.join(root, '.aegis-data', 'logs'), { recursive: true });
      logFile = path.join(root, '.aegis-data', 'logs', 'desktop.log');
      writeLog(`Aegis desktop ${app.getVersion()} starting; product root ${root}`);
    } else {
      writeLog('Aegis desktop: no product root (set AEGIS_ROOT to the aegis folder)');
      buildState = 'missing-build';
    }
    if (root) void startServices();
    createWindow();
    createTray();
    try {
      registerVisualShortcuts();
    } catch (error) {
      writeLog(`visual: shortcut registration failed: ${error.message}`);
    }
    // Only the surface the owner chose is launched. Widgets live inside the app
    // and the notch; a third floating window was pure noise (and the widgets
    // window itself stays available from the tray on explicit request).
    try {
      applyDesktopSurface(desktopSurface);
    } catch (e) {
      writeLog(`Error launching desktop surfaces: ${e.message}`);
    }
    // Replay the last status once the app renderer can receive it, otherwise
    // the first in-app widget paint waits for the next 15s poll.
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.on('did-finish-load', () => {
        if (!lastStatusPayload || !mainWindow || mainWindow.isDestroyed()) return;
        mainWindow.webContents.send('aegis:status', {
          status: lastStatusPayload.status,
          state: lastStatusPayload.state,
          paused: lastStatusPayload.paused,
          surface: lastStatusPayload.surface,
          widgets: lastStatusPayload.widgets,
        });
      });
    }

    void watchTasks();
    setInterval(() => void watchTasks(), 15_000);
  });

  // Pause/Resume is owned by the host (/api/state.settings.paused). The notch,
  // widgets and the app window all go through this one path, which is what
  // makes pausing in the app pause the notch too.
  ipcMain.handle('aegis:set-paused', async (_event, next) => {
    const paused = next === true;
    try {
      const response = await fetch(`${HOST_URL}/api/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paused }),
        signal: AbortSignal.timeout(4000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      pausedNow = paused;
      broadcastStatus({ paused, status: lastStatusPayload?.text || 'Ready' });
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('aegis:desktop-action', {
          action: 'paused',
          data: paused,
        });
      }
      void watchTasks();
    } catch (error) {
      writeLog(`set-paused error: ${error.message}`);
    }
    return pausedNow;
  });

  ipcMain.handle('aegis:get-notch-settings', () => notchSettings);
  ipcMain.handle('aegis:set-notch-settings', (_event, next) => ({
    notchSettings: applyNotchSettings(next),
    saved: true,
  }));
  ipcMain.handle('aegis:get-desktop-preferences', () => ({
    notchSettings,
    minimizeToTray,
    clipboardHistoryEnabled,
    externalAgentDiscoveryEnabled,
    openAtLogin: app.getLoginItemSettings().openAtLogin,
  }));
  ipcMain.handle('aegis:set-clipboard-history', (_event, next) => {
    if (typeof next !== 'boolean') return { clipboardHistoryEnabled, saved: false };
    return { clipboardHistoryEnabled: next, saved: setClipboardHistory(next) };
  });
  ipcMain.handle('aegis:set-external-agent-discovery', (_event, next) => {
    if (typeof next !== 'boolean') return { externalAgentDiscoveryEnabled, saved: false };
    externalAgentDiscoveryEnabled = next;
    try {
      saveDesktopPreferences();
      return { externalAgentDiscoveryEnabled, saved: true };
    } catch (error) {
      writeLog(`external agent discovery preference save failed: ${error.message}`);
      return { externalAgentDiscoveryEnabled, saved: false };
    }
  });
  ipcMain.handle('aegis:set-minimize-to-tray', (_event, next) => {
    if (typeof next !== 'boolean') return { minimizeToTray, saved: false };
    minimizeToTray = next;
    try {
      saveDesktopPreferences();
      return { minimizeToTray, saved: true };
    } catch (error) {
      writeLog(`desktop preference save failed: ${error.message}`);
      return { minimizeToTray, saved: false };
    }
  });

  ipcMain.on('aegis:show', showMain);
  ipcMain.on('aegis:quit', () => {
    quitting = true;
    app.quit();
  });
  ipcMain.on('aegis:voice', openVoice);
  ipcMain.on('aegis:ask', (_event, text) => {
    const prompt = String(text ?? '').trim();
    if (!prompt) return;
    showMain();
    const send = () => mainWindow?.webContents.send('aegis:open-ask', prompt);
    if (mainWindow?.webContents.isLoading()) mainWindow.webContents.once('did-finish-load', send);
    else send();
  });
  ipcMain.handle('aegis:system-metrics', () => {
    return getSystemMetricsSnapshot();
  });
  ipcMain.handle('aegis:get-weather', async () => {
    if (cachedWeather) return cachedWeather;
    const lat = lastWeatherLoc?.lat ?? 28.61;
    const lon = lastWeatherLoc?.lon ?? 77.21;
    // The surface asks for weather while the host is still booting, which used
    // to leave the widget permanently empty; retry briefly before giving up.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const wRes = await fetch(`${HOST_URL}/api/weather?lat=${lat}&lon=${lon}`, {
          signal: AbortSignal.timeout(4000),
        });
        if (wRes.ok) {
          cachedWeather = normalizeWeather(
            await wRes.json(),
            lastWeatherLoc?.name || 'Local',
          );
          return cachedWeather;
        }
      } catch (err) {
        writeLog(`aegis:get-weather attempt ${attempt + 1} failed: ${err.message}`);
        await new Promise((resolve) => setTimeout(resolve, 1200));
      }
    }
    return null;
  });
  ipcMain.handle('aegis:get-agents', () => {
    return cachedAgents;
  });
  ipcMain.handle('aegis:get-media-session', () => isWindows
    ? queryWindowsMediaSession('query')
    : Promise.resolve({ available: false, reason: 'System media sessions are not supported on this platform.' }));
  // The notch reads the native harness through the host: its runtimes, the tool
  // set it exposes and the MCP servers that are installed. Nothing here is a
  // guess: an unreachable host returns an error the card can show.
  ipcMain.handle('aegis:get-harness', async () => {
    try {
      const [statusRes, pluginsRes] = await Promise.all([
        fetch(`${HOST_URL}/api/harness/status`, { signal: AbortSignal.timeout(2500) }),
        fetch(`${HOST_URL}/api/harness/plugins`, { signal: AbortSignal.timeout(2500) }),
      ]);
      const status = statusRes.ok ? await statusRes.json() : null;
      const plugins = pluginsRes.ok ? await pluginsRes.json() : null;
      return {
        status,
        servers: plugins?.servers || {},
        path: plugins?.path || '',
        ...(status ? {} : { error: 'The Aegis host did not answer, so the harness cannot report its tools.' }),
      };
    } catch {
      return { status: null, servers: {}, path: '', error: 'The Aegis host is not running.' };
    }
  });

  ipcMain.handle('aegis:set-harness-plugin', async (_event, name, disabled) => {
    const key = String(name || '').trim();
    if (!key) return { ok: false, error: 'A tool server needs a name.' };
    try {
      const response = await fetch(
        `${HOST_URL}/api/harness/plugins/${encodeURIComponent(key)}/toggle`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ disabled: disabled === true }),
          signal: AbortSignal.timeout(4000),
        },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) return { ok: false, error: body?.error || 'The host refused that change.' };
      return { ok: true, servers: body?.servers || {} };
    } catch {
      return { ok: false, error: 'The Aegis host is not running.' };
    }
  });

  ipcMain.handle('aegis:get-external-agents', async () => {
    if (!externalAgentDiscoveryEnabled || !isWindows) return { enabled: externalAgentDiscoveryEnabled, agents: [] };
    return { enabled: true, agents: await discoverExternalAgents() };
  });
  ipcMain.handle('aegis:import-dropped-files', async (event, inputPaths) => {
    const result = await importDroppedFiles(inputPaths, path.join(root ?? app.getPath('userData'), '.aegis-data', 'uploads'));
    const { files } = result;
    if (files.length) {
      broadcastStatus({ text: `Added ${files.length} file${files.length === 1 ? '' : 's'} to the Aegis file tray.`, state: 'notification' });
      writeLog(`file tray import: ${files.length} file(s), ${files.reduce((sum, file) => sum + file.sizeBytes, 0)} bytes`);
    }
    return result;
  });
  ipcMain.handle('aegis:open-workspace-file', async (_event, requestedPath) => {
    try {
      const uploadsDir = await fs.promises.realpath(path.join(root ?? app.getPath('userData'), '.aegis-data', 'uploads'));
      const target = await fs.promises.realpath(String(requestedPath || ''));
      if (!target.startsWith(`${uploadsDir}${path.sep}`)) return { ok: false, error: 'File is outside the Aegis file tray.' };
      const info = await fs.promises.stat(target);
      if (!info.isFile()) return { ok: false, error: 'Only files can be opened.' };
      const error = await shell.openPath(target);
      return error ? { ok: false, error } : { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Could not open this file.' };
    }
  });
  ipcMain.handle('aegis:read-file-tray-file', async (_event, requestedPath) => {
    try {
      const uploadsDir = await fs.promises.realpath(path.join(root ?? app.getPath('userData'), '.aegis-data', 'uploads'));
      const target = await fs.promises.realpath(String(requestedPath || ''));
      if (!target.startsWith(`${uploadsDir}${path.sep}`)) return { ok: false, error: 'File is outside the Aegis file tray.' };
      const info = await fs.promises.stat(target);
      if (!info.isFile()) return { ok: false, error: 'Only files can be attached.' };
      if (info.size > 20 * 1024 * 1024) return { ok: false, error: 'Files over 20 MB cannot be attached from the tray.' };
      const ext = path.extname(target).toLowerCase();
      const mime = ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.pdf': 'application/pdf', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xls': 'application/vnd.ms-excel', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.doc': 'application/msword', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation', '.ppt': 'application/vnd.ms-powerpoint', '.zip': 'application/zip', '.csv': 'text/csv', '.txt': 'text/plain', '.md': 'text/markdown' })[ext] || 'application/octet-stream';
      return { ok: true, name: path.basename(target), size: info.size, mime, base64: (await fs.promises.readFile(target)).toString('base64') };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Could not read this tray file.' };
    }
  });
  ipcMain.on('aegis:media-control', (_event, control) => {
    handleMediaControl(control);
  });
  ipcMain.on('aegis:hide-overlay', () => toggleOverlay(false));
  ipcMain.on('aegis:annotate', (_event, payload) => showAnnotations(payload));
  ipcMain.on('aegis:clear-annotations', () => clearAnnotations());
  ipcMain.on('aegis:visual-toggle', () => toggleVisualLayer());
  ipcMain.on('aegis:visual-close', () => toggleVisualLayer(false));
  // The layer page reports when it wants pointer control (active chrome / pen)
  // and when it should let the desktop underneath receive clicks again.
  ipcMain.on('aegis:visual-interactive', (event, on) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed() || win !== visualLayer) return;
    const interactive = !!on;
    win.setIgnoreMouseEvents(!interactive, { forward: true });
    if (interactive) win.focus();
    visualInteractive = interactive;
    writeLog(`visual: interactive=${interactive}`);
  });
  ipcMain.handle('aegis:visual-capture', async () => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1440, height: 900 },
      });
      return sources[0]?.thumbnail?.toDataURL('image/jpeg', 72) || null;
    } catch (error) {
      writeLog(`visual: capture failed ${error.message}`);
      return null;
    }
  });
  ipcMain.handle('aegis:visual-ask', async (_event, payload) => {
    try {
      const response = await fetch(`${HOST_URL}/api/visual/explain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload || {}),
        signal: AbortSignal.timeout(30_000),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        return { error: data?.error || `Visual service returned ${response.status}.` };
      }
      return data;
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'The visual service is not reachable.' };
    }
  });
  ipcMain.on('aegis:hide-widgets', () => toggleWidgets(false));
  ipcMain.on('aegis:toggle-mascot', () => { if (overlay && !overlay.isDestroyed()) overlay.hide(); });
  ipcMain.on('aegis:toggle-notch', () => toggleNotch());
  ipcMain.on('aegis:toggle-widgets', () => toggleWidgets(true));
  ipcMain.on('aegis:show-widgets', () => toggleWidgets(true));
  ipcMain.on('aegis:want-focus', (event, focused) => focusDesktopSurface(event, focused));
  // Transparent desktop surfaces (overlay, mascot, widgets) stay click-through
  // over empty space, and each page turns that off while the pointer is over a
  // real control. The notch is excluded: its window matches the island exactly,
  // so making it click-through only ever swallowed its own buttons.
  ipcMain.on('aegis:click-through', (event, through) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed() || win === notch) return;
    if (through) {
      win.setIgnoreMouseEvents(true, { forward: true });
    } else {
      win.setIgnoreMouseEvents(false);
    }
  });

  // Click-through hover IPC: transparent windows pass clicks to the desktop unless over interactive elements
  ipcMain.on('aegis:hover', (e, over) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (w && w !== mainWindow && w !== notch && !w.isDestroyed()) {
      if (over) {
        w.setIgnoreMouseEvents(false);
      } else {
        w.setIgnoreMouseEvents(true, { forward: true });
      }
    }
  });

  // Dynamic system tray icon updates
  ipcMain.on('aegis:tray-update', (_e, data) => {
    if (!data) return;
    const { state, character, tooltip, icon } = typeof data === 'string' ? { state: data } : data;
    updateTrayIcon(state, character, tooltip, icon);
  });

  // Action dispatch from desktop surfaces
  ipcMain.on('aegis:action', (event, action, data) => {
    if (action === 'notch-renderer-error' && BrowserWindow.fromWebContents(event.sender) === notch) {
      writeLog(`[notch-renderer] ${String(data?.message || 'Unknown renderer error').slice(0, 1000)}`);
      return;
    }
    if (action === 'notch-renderer-ready' && BrowserWindow.fromWebContents(event.sender) === notch) {
      notchRendererReady = true;
      return;
    }
    if (action === 'notch-size' && BrowserWindow.fromWebContents(event.sender) === notch) {
      // The island draws itself inside the native surface and reports its real
      // state over 'notch-expanded'; it is never resized here.
      return;
    }
    if (action === 'notch-expanded' && BrowserWindow.fromWebContents(event.sender) === notch) {
      setNotchExpanded(data?.expanded === true);
      return;
    }
    if (action === 'notch-settings-set' && BrowserWindow.fromWebContents(event.sender) === notch) {
      applyNotchSettings(data);
      return;
    }
    if (action === 'want-focus') {
      focusDesktopSurface(event, data === true);
      return;
    }
    if (action === 'ask' && typeof data?.text === 'string') {
      const prompt = data.text.trim();
      if (!prompt) return;
      showMain();
      const send = () => mainWindow?.webContents.send('aegis:open-ask', prompt);
      if (mainWindow?.webContents.isLoading()) mainWindow.webContents.once('did-finish-load', send);
      else send();
      return;
    }
    if (action === 'overlay-menu') {
      const menu = Menu.buildFromTemplate([
        { label: 'Open Aegis', click: showMain },
        { label: 'Open Widgets in Notch', click: () => toggleWidgets(true) },
        { label: 'Display notch', click: () => toggleNotch(true) },
      ]);
      menu.popup({ window: BrowserWindow.fromWebContents(event.sender) ?? undefined });
      return;
    }
    if (action === 'tray-pill') {
      setTrayPillVisible(data?.visible !== false);
      return;
    }
    if (action === 'tray-command') {
      const command = data?.command;
      if (command === 'login') {
        const openAtLogin = !app.getLoginItemSettings().openAtLogin;
        app.setLoginItemSettings({ openAtLogin, openAsHidden: true });
        trayPill?.webContents.send('aegis:login-setting', openAtLogin);
      } else if (command === 'logs') {
        void shell.openPath(path.join(root ?? app.getPath('userData'), '.aegis-data', 'logs'));
      } else if (command === 'quit') {
        quitting = true;
        app.quit();
      }
      return;
    }
    if (action === 'file-tray-select') {
      showMain();
      const send = () => mainWindow?.webContents.send('aegis:desktop-action', { action, data });
      if (mainWindow?.webContents.isLoading()) mainWindow.webContents.once('did-finish-load', send);
      else send();
      return;
    }
    if (action === 'clipboard-copy') {
      const index = Number(data?.index);
      const item = Number.isInteger(index) ? clipboardHistory[index] : undefined;
      if (item) clipboard.writeText(item.text);
      return;
    }
    if (action === 'move-overlay') {
      // Dragging the mascot character moves its transparent window.
      const w = BrowserWindow.fromWebContents(event.sender);
      if (w && !w.isDestroyed()) {
        const [x, y] = w.getPosition();
        const dx = Math.round(Number(data?.dx) || 0);
        const dy = Math.round(Number(data?.dy) || 0);
        if (dx || dy) w.setPosition(x + dx, y + dy);
      }
      return;
    }
    if (action === 'mediaControl' || action === 'media') {
      handleMediaControl(typeof data === 'string' ? data : (data?.control || data?.action));
      return;
    }
    if (action === 'weather-location') {
      if (data && typeof data === 'object') {
        lastWeatherLoc = data;
        if (data.lat != null && data.lon != null) {
          void fetch(`${HOST_URL}/api/weather?lat=${encodeURIComponent(data.lat)}&lon=${encodeURIComponent(data.lon)}`, {
            signal: AbortSignal.timeout(4000),
          })
            .then((r) => r.ok ? r.json() : null)
            .then((wJson) => {
              if (wJson) {
                cachedWeather = normalizeWeather(wJson, data.name || data.city);
                broadcastStatus({ widgets: { weather: cachedWeather } });
              }
            })
            .catch((err) => writeLog(`weather-location error: ${err.message}`));
        }
      }
      if (mainWindow && !mainWindow.isDestroyed())
        mainWindow.webContents.send('aegis:desktop-action', { action, data });
      return;
    }
    if (action === 'call-widget') {
      // /call <widget> from chat: show the notch and let the renderer resolve
      // the widget name against the real card library.
      const name = String(data?.name || '').trim();
      if (name) {
        if (!notchVisible) toggleNotch(true, false);
        if (notch && !notch.isDestroyed())
          notch.webContents.send('aegis:event', 'call-widget', { name });
      }
      return;
    }
    if (action === 'widget') {
      if (data?.id === 'agents') {
        const subAction = data.action;
        const subVal = data.value;
        if (subAction === 'run' || subAction === 'task' || subAction === 'create') {
          const prompt = typeof subVal === 'string' ? subVal : (data.prompt || data.text || '');
          if (prompt) {
            void fetch(`${HOST_URL}/api/agents/tasks`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ prompt, agentId: data.agentId }),
              signal: AbortSignal.timeout(5000),
            }).then(() => watchTasks()).catch((err) => writeLog(`agent task dispatch error: ${err.message}`));
          }
        } else if (subAction === 'cancel' && data.taskId) {
          void fetch(`${HOST_URL}/api/agents/tasks/${encodeURIComponent(data.taskId)}/cancel`, {
            method: 'POST',
            signal: AbortSignal.timeout(5000),
          }).then(() => watchTasks()).catch((err) => writeLog(`agent task cancel error: ${err.message}`));
        } else if (subAction === 'retry' && data.taskId) {
          void fetch(`${HOST_URL}/api/agents/tasks/${encodeURIComponent(data.taskId)}/retry`, {
            method: 'POST',
            signal: AbortSignal.timeout(5000),
          }).then(() => watchTasks()).catch((err) => writeLog(`agent task retry error: ${err.message}`));
        }
      }
      if (mainWindow && !mainWindow.isDestroyed())
        mainWindow.webContents.send('aegis:desktop-action', { action, data });
      return;
    }
    if (action === 'voice-command' || action === 'notification' || action === 'volume') {
      if (mainWindow && !mainWindow.isDestroyed())
        mainWindow.webContents.send('aegis:desktop-action', { action, data });
    }
    if (action === 'mic' || action === 'voice') openVoice();
    else if (action === 'open' || action === 'show') showMain();
    else if (action === 'close' || action === 'hide') {
      toggleOverlay(false);
      toggleWidgets(false);
    } else if (action === 'mascot') {
      if (overlay && !overlay.isDestroyed()) overlay.hide();
    }
  });

  ipcMain.on('aegis:set-thought', (event, thought) => {
    broadcastStatus(thought);
  });

  ipcMain.on('aegis:status', (event, status) => {
    broadcastStatus(status);
  });

  app.on('before-quit', () => {
    quitting = true;
  });

  app.on('window-all-closed', () => {
    // Keep running in the tray; quitting is explicit.
  });

function terminateChildren() {
  for (const child of children) {
    if (!child) continue;
    try {
      if (isWindows && child.pid) {
        require('node:child_process').execSync(`taskkill /PID ${child.pid} /T /F 2>nul`);
      } else if (!child.killed) {
        child.kill('SIGTERM');
      }
    } catch {
      try {
        if (!child.killed) child.kill();
      } catch {}
    }
  }
}

process.on('SIGINT', () => {
  quitting = true;
  terminateChildren();
  app.quit();
});
process.on('SIGTERM', () => {
  quitting = true;
  terminateChildren();
  app.quit();
});
process.on('uncaughtException', (err) => {
  writeLog(`uncaughtException: ${err?.stack || err?.message || err}`);
});
process.on('unhandledRejection', (reason) => {
  writeLog(`unhandledRejection: ${reason?.stack || reason?.message || reason}`);
});

  app.on('will-quit', () => {
    try { globalShortcut.unregisterAll(); } catch {}
    terminateChildren();
  });
}
