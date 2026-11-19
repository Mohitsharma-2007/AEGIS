// Aegis desktop shell example (Windows-first, also fine on macOS/Linux).
//   • system-tray icon that changes with the agent state        (tray/ico/<character>/<variant>/<state>.ico)
//   • tray flyout panel  (click the tray icon)                  renderer.html?kind=panel
//   • desktop pet        (transparent, always on top, draggable) renderer.html?kind=pet
//   • pill               (compact status bar, top centre)        renderer.html?kind=pill
// Your voice pipeline lives in the main process and talks to all of them through `aegis` (bottom of this file).
// NOTE: written against the Electron API but not run in the workspace it was authored in — treat as a starting point.
const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, globalShortcut } = require('electron');
const path = require('node:path');
const KIT = path.join(__dirname, '..');                       // -> node_modules/aegis-mascot in a real app
const THEME = 'color';                                         // tray icon variant: color | dark | light
let WHO = 'aegi';                                              // current crew member (changes on crew events such as 'mail:new')
// crew events (same map as src/events.js): '<character>:<verb>' → that character's signature state
const CREW = { mail: 1, social: 1, files: 1, memory: 1, harness: 1, security: 1 };
const CREW_STATE = { 'mail:new': 'mail-incoming', 'mail:read': 'mail-reading', 'mail:send': 'mail-sending', 'social:message': 'social-message', 'social:typing': 'social-typing', 'social:react': 'social-react',
  'files:organize': 'files-organizing', 'files:upload': 'files-upload', 'files:found': 'files-found', 'memory:save': 'memory-saving', 'memory:recall': 'memory-recalling', 'memory:link': 'memory-linking',
  'harness:run': 'harness-running', 'harness:test': 'harness-testing', 'harness:build': 'harness-building', 'security:scan': 'security-scanning', 'security:locked': 'security-locked', 'security:alert': 'security-alert', 'crew:lead': 'hello' };
const EVENT_STATE = { 'app:start': 'hello', 'prompt:send': 'sending', 'mic:start': 'listening', 'mic:stop': 'thinking', 'agent:thinking': 'thinking', 'agent:searching': 'searching',
  'agent:working': 'working', 'agent:reply': 'speaking', 'agent:speaking': 'speaking', 'agent:confused': 'confused', 'agent:done': 'done', 'agent:error': 'error', 'agent:celebrate': 'celebrate',
  'user:pause': 'paused', 'user:resume': 'working', 'user:cancel': 'cancelled', notify: 'notification', 'app:idle': 'idle', 'app:sleep': 'sleeping' };   // mirror of src/events.js
const TOOLTIP = { idle: 'Aegis — ready', listening: 'Aegis — listening', thinking: 'Aegis — thinking', searching: 'Aegis — searching', working: 'Aegis — working', speaking: 'Aegis — speaking',
  paused: 'Aegis — paused', done: 'Aegis — done', error: 'Aegis — something went wrong', notification: 'Aegis — needs your attention', sleeping: 'Aegis — sleeping' };

let tray, wins = {}, actionHandlers = [];
const trayImage = state => nativeImage.createFromPath(path.join(KIT, 'tray', process.platform === 'win32' ? 'ico' : 'png', WHO, THEME, process.platform === 'win32' ? `${state}.ico` : `${state}-32.png`));

function makeWindow(kind, opts) {
  const w = new BrowserWindow({ frame: false, transparent: true, resizable: false, skipTaskbar: true, hasShadow: false, show: false, ...opts,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' } });
  w.loadFile(path.join(__dirname, 'renderer.html'), { query: { kind, sounds: kind === 'panel' ? '1' : '0' } });   // exactly ONE window owns the sounds
  wins[kind] = w; return w;
}
function placeFlyout() {                                       // above the tray icon, clamped to the work area
  const w = wins.panel, tb = tray.getBounds(), wa = screen.getDisplayMatching(tb).workArea, [ww, wh] = w.getSize();
  const x = Math.min(Math.max(Math.round(tb.x + tb.width / 2 - ww / 2), wa.x + 8), wa.x + wa.width - ww - 8);
  const y = tb.y > wa.y + wa.height / 2 ? wa.y + wa.height - wh - 8 : wa.y + 8;                                   // taskbar at bottom vs top
  w.setPosition(x, y, false);
}
function toggleFlyout() { const w = wins.panel; if (w.isVisible()) return w.hide(); placeFlyout(); w.show(); w.focus(); }

function createShell() {
  const wa = screen.getPrimaryDisplay().workArea;
  makeWindow('panel', { width: 384, height: 470 }).on('blur', () => wins.panel.hide());
  makeWindow('pet', { width: 260, height: 250, alwaysOnTop: true, x: wa.x + wa.width - 280, y: wa.y + wa.height - 260, focusable: false }).once('ready-to-show', () => wins.pet.showInactive());
  makeWindow('pill', { width: 440, height: 80, alwaysOnTop: true, x: wa.x + Math.round(wa.width / 2 - 220), y: wa.y + 12, focusable: false });
  wins.pet.setAlwaysOnTop(true, 'floating'); wins.pill.setAlwaysOnTop(true, 'screen-saver');
  tray = new Tray(trayImage('idle')); tray.setToolTip(TOOLTIP.idle); tray.on('click', toggleFlyout);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Aegis', click: toggleFlyout },
    { label: 'Desktop mascot', type: 'checkbox', checked: true, click: i => (i.checked ? wins.pet.showInactive() : wins.pet.hide()) },
    { label: 'Status pill', type: 'checkbox', checked: false, click: i => (i.checked ? wins.pill.showInactive() : wins.pill.hide()) },
    { type: 'separator' }, { label: 'Sleep (do not disturb)', click: () => aegis.emit('app:sleep') }, { label: 'Quit', role: 'quit' },
  ]));
}

// ───────────── the API your pipeline uses ─────────────
const broadcast = (channel, ...args) => Object.values(wins).forEach(w => !w.isDestroyed() && w.webContents.send(channel, ...args));
const aegis = {
  /** aegis.emit('mic:start' | 'prompt:send' | 'agent:searching' | 'agent:done' | 'user:cancel' | …) — see src/events.js */
  emit(name) { broadcast('aegis:event', name); const c = name.split(':')[0]; if (CREW[c]) WHO = c; else if (name === 'crew:lead') WHO = 'aegi';
    const s = EVENT_STATE[name] || CREW_STATE[name]; if (s && tray) { tray.setImage(trayImage(s)); tray.setToolTip(TOOLTIP[s] || 'Aegis'); } },
  /** aegis.update({ status, sub, progress, steps: [{ label, state }], transcript: [{ role, text }] }) */
  update(patch) { broadcast('aegis:update', patch); },
  /** aegis.say('user' | 'agent', text) — append a transcript line */
  say(role, text) { broadcast('aegis:say', role, text); },
  /** aegis.onAction((action, data) => …) — 'mic' | 'send' (text) | 'pause' | 'resume' | 'cancel' | 'mute' | 'close' */
  onAction(fn) { actionHandlers.push(fn); },
};
module.exports = { aegis };

app.whenReady().then(() => {
  createShell();
  ipcMain.on('aegis:action', (_e, action, data) => { if (action === 'close') wins.panel.hide(); actionHandlers.forEach(fn => fn(action, data)); });
  // transparent windows: let clicks fall through to the desktop except over the widget itself
  ipcMain.on('aegis:hover', (e, over) => { const w = BrowserWindow.fromWebContents(e.sender); if (w && w !== wins.panel) w.setIgnoreMouseEvents(!over, { forward: true }); });
  setTimeout(() => aegis.emit('app:start'), 800);

  // ── demo wiring: replace with your real pipeline ──
  aegis.onAction((action, data) => {
    if (action === 'mic') aegis.emit('mic:start');
    if (action === 'send') { aegis.say('user', data); aegis.emit('prompt:send'); setTimeout(() => aegis.emit('agent:working'), 1800); setTimeout(() => { aegis.say('agent', 'Done — this is where your agent reply goes.'); aegis.emit('agent:done'); }, 5200); }
    if (action === 'pause') aegis.emit('user:pause');
    if (action === 'resume') aegis.emit('user:resume');
    if (action === 'cancel') aegis.emit('user:cancel');
  });
  globalShortcut.register('CommandOrControl+Shift+Space', () => aegis.emit('mic:start'));   // push-to-talk style hotkey
});
app.on('window-all-closed', e => e.preventDefault());         // tray app: keep running with no visible windows
