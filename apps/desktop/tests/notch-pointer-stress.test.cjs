// Pointer-stress regression: rapid hover cycles and rapid clicks must not move
// or resize the native Notch window, and must not spam IPC.
//
// The live stress run (10 enter/leave cycles in ~1 s, then a click burst) is
// recorded in docs/aegis-audit/notch-interaction.md; these assertions keep the
// architecture that made it stable from regressing.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const desktopRoot = path.resolve(__dirname, '..');
const notchSource = fs.readFileSync(path.join(desktopRoot, 'desktop-ui', 'src', 'notch.html'), 'utf8');
const mainSource = fs.readFileSync(path.join(desktopRoot, 'main.js'), 'utf8');

test('island sizes are CSS variables, so expanding cannot translate the window', () => {
  for (const name of ['--cw', '--ch', '--iw', '--bw', '--ew', '--eh']) {
    assert.ok(notchSource.includes(`setProperty('${name}'`), `missing ${name}`);
  }
  // The island is centered inside a fixed window: every width keeps one center.
  assert.match(notchSource, /\.anchor\{[^}]*justify-content:center/);
  assert.match(mainSource, /Math\.round\(area\.x \+ \(area\.width - size\.width\) \/ 2\)/);
});

test('renderer layout never asks the native window to resize', () => {
  const sizeBody = notchSource.slice(
    notchSource.indexOf('const size = () => {'),
    notchSource.indexOf('const paint = () =>'),
  );
  assert.ok(sizeBody.length > 100, 'size() body should be present');
  assert.doesNotMatch(sizeBody, /notch-size/);
  assert.doesNotMatch(sizeBody, /setBounds/);
  assert.match(sizeBody, /island\.style\.height = open \? '' : h \+ 'px'/);
});

test('hover ipc is edge-triggered, not level-triggered', () => {
  assert.match(notchSource, /if \(routingInteractive === interactive\) return;/);
  assert.match(notchSource, /api\?\.action\?\.\('notch-hit', \{ inside: interactive \}\)/);
  // Ten pointer events in one frame collapse into one rAF decision.
  assert.match(notchSource, /if \(pointerFrame\) return;\s*pointerFrame = requestAnimationFrame/);
});

test('hover opens the shelf after a dwell; click still toggles; close delay is persisted', () => {
  assert.match(notchSource, /const pad = hover \? 14 : 6;/);
  // Hover expands the shelf (NotchNook-style) after the persisted dwell.
  assert.match(notchSource, /if \(!open && !note && !view && !suppressHoverOpen && !dwellT\)/);
  assert.match(notchSource, /if \(!st\.listening && !open && hover\) openWs\(\)/);
  assert.match(notchSource, /Number\(notchCfg\.hoverDelay\) \|\| 240/);
  assert.match(notchSource, /Number\(notchCfg\.closeDelay\)/);
  // A click clears the pending dwell so a fast click burst cannot stack timers.
  assert.match(notchSource, /clearTimeout\(dwellT\);\s*dwellT = null;\s*if \(e\.target\.closest\('#voice'\)\)/);
});

test('the native surface tracks the visible island (no click-through, no invisible blocker)', () => {
  const main = fs.readFileSync(path.join(desktopRoot, 'main.js'), 'utf8');
  // Collapsed window is the island size; it grows only when the shelf opens.
  assert.match(main, /if \(notchExpanded\) \{[\s\S]*?expandedWidth/);
  assert.match(main, /compactWidth \+ 12/);
  assert.match(main, /action === 'notch-expanded'/);
  // The notch is never made click-through.
  assert.doesNotMatch(main, /if \(win === notch\) notchClickThrough = !!through;/);
  assert.doesNotMatch(main, /if \(w === notch\) notchClickThrough = !over;/);
  // No per-hover native polling loop.
  assert.doesNotMatch(main, /setInterval\(recoverNotchPointer, 250\)/);
});

test('clicks update classes only, with no synchronous reflow', () => {
  assert.doesNotMatch(notchSource, /void island\.offsetWidth/);
  assert.match(notchSource, /function openWs\(t\) \{[\s\S]*?paint\(\);\s*\}/);
  assert.doesNotMatch(notchSource, /openWs[\s\S]{0,400}notch-size/);
});
