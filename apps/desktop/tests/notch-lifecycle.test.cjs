const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const desktopRoot = path.resolve(__dirname, '..');
const sourcePath = path.join(desktopRoot, 'desktop-ui', 'src', 'notch.html');
const mainPath = path.join(desktopRoot, 'main.js');

const readNotch = () => fs.readFileSync(sourcePath, 'utf8');
const readMain = () => fs.readFileSync(mainPath, 'utf8');

test('desktop UI build output stays synchronized with Electron-loaded Notch', () => {
  const build = fs.readFileSync(path.join(desktopRoot, 'desktop-ui', 'build.mjs'), 'utf8');
  const source = readNotch();
  const built = fs.readFileSync(path.join(desktopRoot, 'ui-kit', 'notch.html'), 'utf8');
  assert.match(build, /copyFileSync\(path\.join\(dir, f \+ '\.html'\), path\.join\(appUi, f \+ '\.html'\)\)/);
  assert.ok(built.length > source.length, 'built Notch should include the shared UI runtime');
  assert.match(built, /Clicking the shelf closes it/);
  assert.match(built, /initNotchSettings/);
});

test('click-open workspace dismisses after pointer exit instead of remaining pinned', () => {
  const source = readNotch();
  assert.doesNotMatch(source, /pinnedOpen/);
  assert.match(source, /if \(open\) closeWs\(\)/);
  assert.match(source, /if \(open\) closeWs\(\);\s*hover = false/);
});

test('the Notch native window is fixed-size and never resized by hover or clicks', () => {
  const main = readMain();
  // Fixed surface computed from settings, positioned once and on display changes.
  assert.match(main, /function notchSurfaceSize\(\)/);
  assert.match(main, /notchSettings\.expandedWidth \+ 48/);
  assert.match(main, /function notchSurfacePosition\(\)/);
  // The legacy per-event resize handler is a no-op now.
  assert.match(main, /action === 'notch-size'[\s\S]{0,220}never resized here/);
  assert.doesNotMatch(main, /notchSurfaceSize = \{ width: nextWidth/);
  assert.doesNotMatch(main, /notch\.setBounds\(\{\s*x: Math\.round\(bounds\.x \+ \(bounds\.width - nextWidth\)/);
});

test('Notch settings persist, apply live, and are exposed over IPC', () => {
  const main = readMain();
  const preload = fs.readFileSync(path.join(desktopRoot, 'preload.js'), 'utf8');
  assert.match(main, /const NOTCH_DEFAULT_SETTINGS = \{/);
  assert.match(main, /function normalizeNotchSettings\(input\)/);
  assert.match(main, /externalAgentDiscoveryEnabled, notchSettings \}, null, 2\)/);
  assert.match(main, /function applyNotchSettings\(partial\)/);
  assert.match(main, /ipcMain\.handle\('aegis:get-notch-settings'/);
  assert.match(main, /ipcMain\.handle\('aegis:set-notch-settings'/);
  assert.match(main, /notch\.webContents\.send\('aegis:notch-settings', notchSettings\)/);
  assert.match(preload, /getNotchSettings: \(\) => ipcRenderer\.invoke\('aegis:get-notch-settings'\)/);
  assert.match(preload, /setNotchSettings: \(settings\) => ipcRenderer\.invoke\('aegis:set-notch-settings', settings\)/);
  assert.match(preload, /onNotchSettings: \(callback\)/);
});

test('Notch covers the settings: size, placement, cutout and timing', () => {
  const notch = readNotch();
  for (const id of [
    'ns-place',
    'ns-offset',
    'ns-cw',
    'ns-ew',
    'ns-eh',
    'ns-scale',
    'ns-radius',
    'ns-gap',
    'ns-border',
    'ns-shadow',
    'ns-hover',
    'ns-close',
  ]) {
    assert.match(notch, new RegExp(`id="${id}"`), `missing control ${id}`);
  }
  assert.match(notch, /applyNotchCfg/);
  assert.match(notch, /setProperty\('--cw'/);
  assert.match(notch, /api\?\.setNotchSettings\?\./);
});

test('Notch hover is decided by one rAF-coalesced hit test with hysteresis', () => {
  const notch = readNotch();
  assert.match(notch, /const hitTest = \(x, y\) =>/);
  assert.match(notch, /const pad = hover \? 14 : 6;/);
  assert.match(notch, /requestAnimationFrame\(\(\) => \{\s*pointerFrame = 0;\s*setHov\(hitTest\(pointerX, pointerY\)\)/);
  // Main-process pointer-enter/leave events no longer drive hover state.
  assert.match(notch, /notch:pointer-enter' \|\| name === 'notch:pointer-leave'\) \{ \/\* renderer owns hover \*\/ \}/);
});

test('Notch has no native pointer polling at all — the window matches the island', () => {
  const main = readMain();
  // The old click-through recovery tick is gone: the native surface is always
  // interactive and sized to the visible island, so nothing needs polling.
  assert.doesNotMatch(main, /function recoverNotchPointer\(\)/);
  assert.doesNotMatch(main, /setInterval\(recoverNotchPointer, 250\)/);
  assert.doesNotMatch(main, /setInterval\(pollNotchPointer, 60\)/);
  // The surface grows only when the renderer says the shelf opened.
  assert.match(main, /action === 'notch-expanded'/);
  assert.match(main, /compactWidth \+ 12/);
});

test('clicking never forces a synchronous reflow or a native resize round trip', () => {
  const notch = readNotch();
  assert.doesNotMatch(notch, /void island\.offsetWidth/);
  assert.match(notch, /requestAnimationFrame\(\(\) => requestAnimationFrame\(\(\) => island\.classList\.add\('flash'\)\)\)/);
  assert.doesNotMatch(notch, /api\?\.action\?\.\('notch-size'/);
  assert.match(notch, /The native surface is fixed; no window geometry work happens per event/);
});

test('expanded widget shelf scrolls instead of clipping cards', () => {
  const notch = readNotch();
  assert.match(notch, /\.ws\{[^}]*overflow-y:auto/);
  assert.match(notch, /height:calc\(var\(--eh,320px\) - var\(--ch,38px\)\)/);
  assert.match(notch, /#deck2\{[^}]*grid-template-columns:repeat\(auto-fit,minmax\(230px,1fr\)\)/);
  assert.match(notch, /\.t-files\{[^}]*display:flex/);
});

test('Notch live cards tolerate the empty initial payload', () => {
  const cards = fs.readFileSync(path.join(desktopRoot, 'desktop-ui', 'src', 'cards.js'), 'utf8');
  assert.match(cards, /Array\.isArray\(W\.live\) \? W\.live : \[\]/);
});

test('Notch width changes are CSS-only and stay centered', () => {
  const notch = readNotch();
  assert.match(notch, /\.anchor\{[^}]*justify-content:center/);
  assert.match(notch, /\.island\{[^}]*width:var\(--cw,300px\)/);
  assert.doesNotMatch(notch, /transition:width \.24s/);
});

test('tray flyout follows the pointer anchor on the display that raised it', () => {
  const main = readMain();
  assert.match(main, /trayAnchorPoint = point \|\| screen\.getCursorScreenPoint\(\)/);
  assert.match(main, /screen\.getDisplayNearestPoint\(point\)/);
  assert.match(main, /Math\.round\(point\.x - width \/ 2\)/);
  assert.doesNotMatch(main, /area\.x \+ area\.width - width - 8\)\);/);
});

test('Notch file tray exposes a chat attach action backed by workspace-only reads', () => {
  const notch = readNotch();
  const main = readMain();
  const preload = fs.readFileSync(path.join(desktopRoot, 'preload.js'), 'utf8');
  assert.match(notch, /data-use="\$\{i\}"/);
  assert.match(notch, /file-tray-select/);
  assert.match(main, /aegis:read-file-tray-file/);
  assert.match(main, /20 \* 1024 \* 1024/);
  assert.match(main, /File is outside the Aegis file tray/);
  assert.match(preload, /readFileTrayFile: \(filePath\) => ipcRenderer\.invoke/);
});

test('Live shelf includes real Aegis/voice status and hides expensive animation work offscreen', () => {
  const notch = readNotch();
  const core = fs.readFileSync(path.join(desktopRoot, 'desktop-ui', 'src', 'core.js'), 'utf8');
  assert.match(notch, /live: \['agent', 'voice', 'live'/);
  assert.match(notch, /if \(t !== 'work'\).*DECK\[t\]/s);
  assert.match(core, /filter\(b => b\.getClientRects\(\)\.length\)/);
  assert.match(core, /!el\.isConnected \|\| !el\.getClientRects\(\)\.length/);
});

test('Windows media card is session-backed and hidden without an active player', () => {
  const cards = fs.readFileSync(path.join(desktopRoot, 'desktop-ui', 'src', 'cards.js'), 'utf8');
  const main = readMain();
  const script = fs.readFileSync(path.join(desktopRoot, 'media-session.ps1'), 'utf8');
  assert.match(cards, /media: \{ need: \(\) => W\.media\?\.available === true/);
  assert.match(main, /aegis:get-media-session/);
  assert.match(script, /TryTogglePlayPauseAsync/);
  assert.match(script, /TrySkipPreviousAsync/);
  assert.match(script, /TrySkipNextAsync/);
  assert.match(script, /GetTimelineProperties/);
});

test('External coding app detection is opt-in and labels process presence honestly', () => {
  const main = readMain();
  const preload = fs.readFileSync(path.join(desktopRoot, 'preload.js'), 'utf8');
  const notch = readNotch();
  assert.match(main, /if \(!externalAgentDiscoveryEnabled \|\| !isWindows\) return \{ enabled: externalAgentDiscoveryEnabled, agents: \[\] \}/);
  assert.match(main, /Task activity is unavailable without a supported integration/);
  assert.match(preload, /getExternalAgents: \(\) => ipcRenderer\.invoke/);
  assert.match(notch, /externalAgentPoll = setInterval\(.*15000\)/);
});

test('the Notch appearance panel opens without a second Notch button in the header', () => {
  const source = readNotch();
  // The panel lives inside .ws, so hiding .ws hid the panel it was meant to show.
  assert.doesNotMatch(source, /\.island\.nset \.ws\{display:none\}/);
  assert.match(source, /\.island\.nset \.wsh/);
  // The header holds actions and tabs only: no duplicate "Notch" opener.
  assert.doesNotMatch(source, /id="nsetopen"/);
  assert.doesNotMatch(source, /data-t="widgets"/);
  // Right-clicking the island is the settings entry point.
  assert.match(source, /addEventListener\('contextmenu'/);
  assert.match(source, /settingsToggle = toggle/);
});

test('the workspace fills its surface and widgets are called by use case', () => {
  const source = readNotch();
  assert.match(source, /\.wsb\.on\{display:grid/);
  assert.match(source, /\.callbar\{display:flex/);
  assert.match(source, /id="callin"/);
  assert.match(source, /function callWidget/);
  assert.match(source, /\/call weather/);
  assert.match(source, /id="mbar"/);
  assert.match(source, /Lib\.match\(raw, 1\)/);
  // /call works from chat too: preload forwards the payload, main routes it,
  // and the notch resolves the widget name.
  const preload = fs.readFileSync(path.join(desktopRoot, 'preload.js'), 'utf8');
  assert.match(preload, /const listener = \(_event, name, data\) => callback\(name, data\)/);
  assert.match(readMain(), /action === 'call-widget'/);
  assert.match(source, /name === 'call-widget'/);
});
