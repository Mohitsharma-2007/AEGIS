#!/usr/bin/env node
// AEGIS (W-FIX 1a): make sure the Playwright Chromium build this app
// pins actually exists BEFORE the host app starts, so the AEGIS
// Computer browser works on a fresh unzip (Mohit's Windows failure:
// "Failed to launch chromium because executable doesn't exist").
//
// Idempotent and cheap on the happy path: it performs one real
// headless launch probe; only when the bundled binaries are missing
// does it run `playwright install chromium` (into PLAYWRIGHT_BROWSERS_
// PATH when the start scripts set it — they point it at the app-local
// .aegis-data/playwright-browsers directory). If the install cannot
// complete (offline machine), the script says so and exits 0 anyway:
// the runtime launch ladder (src/server/browser-launch.ts) then falls
// back to a system Edge/Chrome, labelled in the Computer status.
//
// Usage: node scripts/ensure-browser.mjs [--quiet]
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const quiet = process.argv.includes('--quiet');
const say = (...args) => {
  if (!quiet) console.log('[aegis] browser setup:', ...args);
};
const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, '..', 'node_modules', 'playwright', 'cli.js');

async function probe() {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  await browser.close();
}

/** Returns true when a system Edge/Chrome exists as a fallback, using
 * the same well-known paths the runtime ladder scans (subset: the two
 * Playwright channels are probed with a real launch attempt). */
async function systemFallbackWorks() {
  const { chromium } = await import('playwright');
  for (const channel of ['msedge', 'chrome']) {
    try {
      const browser = await chromium.launch({ headless: true, channel });
      await browser.close();
      return channel;
    } catch {
      // try the next channel
    }
  }
  return null;
}

try {
  await probe();
  say('bundled Chromium present, nothing to install.');
  process.exit(0);
} catch {
  say('bundled Chromium missing - installing the pinned Playwright build (one-time download)...');
}
const install = spawnSync(
  process.execPath,
  // 'chromium' fetches the full build; the headless shell is a
  // separate artefact Playwright uses for headless persistent
  // contexts, so install it explicitly too.
  [cli, 'install', 'chromium', 'chromium-headless-shell'],
  { stdio: 'inherit' },
);
if (install.status !== 0) {
  say(
    'WARNING: Playwright install did not complete (offline?). The AEGIS Computer browser will fall back to a system Edge/Chrome if one is installed.',
  );
  process.exit(0);
}
try {
  await probe();
  say('bundled Chromium installed and verified by a launch probe.');
} catch {
  const channel = await systemFallbackWorks();
  say(
    channel
      ? `bundled Chromium still not launchable, but a system browser fallback is available (${channel}); the Computer status will label it.`
      : 'WARNING: bundled Chromium still not launchable and no system Edge/Chrome found. Install Google Chrome or Microsoft Edge, or re-run start with a network connection.',
  );
}
process.exit(0);
