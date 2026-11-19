#!/usr/bin/env node
// Artifact check: build output must not carry strings from the removed desktop
// preview or the removed OpenCode engine.
//
// Source is checked by review/tests; this only looks at regenerated artifacts
// (apps/host/dist and, when present, apps/desktop/release).
//
// SKIP: exactly one file, the vendored models.dev catalogue snapshot
// (dist/server/server/models-dev.json). It legitimately lists providers such as
// "OpenCode Zen" (opencode, opencode-go) because that is third-party models.dev
// data, not Aegis code. The skip is path-exact on purpose: a stray
// models-dev.json elsewhere, or any other JSON asset, is still checked.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const hostDir = fileURLToPath(new URL('..', import.meta.url));
const root = join(hostDir, '..', '..');
const targets = [join(hostDir, 'dist'), join(root, 'apps', 'desktop', 'release')];
// Path-exact: only the built catalogue snapshot is exempt.
const SKIP_PATHS = new Set([
  resolve(hostDir, 'dist', 'server', 'server', 'models-dev.json'),
]);
const PATTERN = /liveScreen|live-screen|captureScreen|opencode|pyautogui/i;

const hits = [];
let scanned = 0;
let skipped = 0;

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    if (!entry.isFile()) continue;
    if (SKIP_PATHS.has(resolve(full))) {
      skipped += 1;
      continue;
    }
    const size = statSync(full).size;
    if (size > 8 * 1024 * 1024) continue;
    const buffer = readFileSync(full);
    if (buffer.includes(0)) continue; // binary artifact
    const text = buffer.toString('utf8');
    scanned += 1;
    const match = text.match(PATTERN);
    if (match) {
      const line = text.slice(0, match.index).split('\n').length;
      hits.push(`${relative(root, full)}:${line}  ${match[0]}`);
    }
  }
}

for (const target of targets) {
  if (!existsSync(target)) {
    console.log(`skip (absent): ${relative(root, target)}`);
    continue;
  }
  walk(target);
}

console.log(
  `checked ${scanned} artifact files, skipped ${skipped} third-party catalogue file(s)`,
);
if (hits.length > 0) {
  console.error('stale strings found in build output:');
  for (const hit of hits) console.error('  ' + hit);
  process.exit(1);
}
console.log('artifact check: clean');
