import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { chromium, type Browser, type BrowserContext } from 'playwright';

// AEGIS (W-FIX 1a): one launch ladder for every local Chromium launch
// (the AEGIS Computer persistent context and the browser service).
//
// Why: on a fresh Windows unzip the Playwright browser binaries were
// never downloaded, so the first launch died with
// "browserType.launchPersistentContext: Failed to launch chromium
// because executable doesn't exist at the path". The start scripts now
// install the pinned build (scripts/ensure-browser.mjs), but a machine
// can still lack it (offline first run, partial download)   and almost
// every Windows machine already has Edge. So launching walks a ladder:
//
//   1. the bundled Playwright Chromium (headless shell, the default)
//   2. the bundled full Chromium build (chromium.executablePath())
//   3. the system Microsoft Edge (Playwright 'msedge' channel)
//   4. the system Google Chrome (Playwright 'chrome' channel)
//   5. an explicit executable: $AEGIS_BROWSER_EXECUTABLE when set, else
//      the first existing well-known system path for this platform
//
// Every rung is attempted in order; the winner's label is returned with
// the browser/context so status surfaces can say TRUTHFULLY which
// binary served the session ('browserBinary' in ComputerStatus). If
// every rung fails, the thrown error lists each rung's failure so the
// owner sees the real reason instead of one opaque Playwright error.

export interface BrowserLaunchAttempt {
  label: string;
  options: { channel?: string; executablePath?: string };
}

export const BUNDLED_LABEL = 'Playwright Chromium (bundled)';
export const BUNDLED_FULL_LABEL = 'Playwright Chromium (full build)';
export const EDGE_LABEL = 'Microsoft Edge (system)';
export const CHROME_LABEL = 'Google Chrome (system)';

/** Well-known per-platform install locations for rung 5. Only paths
 * that exist on disk are attempted. */
export function systemBrowserPaths(
  env: Record<string, string | undefined> = process.env,
  platform: NodeJS.Platform = process.platform,
): { label: string; path: string }[] {
  const found: { label: string; path: string }[] = [];
  const add = (label: string, path: string | undefined) => {
    if (path && existsSync(path)) found.push({ label, path });
  };
  if (platform === 'win32') {
    const pf = env.ProgramFiles ?? 'C:\\Program Files';
    const pf86 = env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
    const local = env.LOCALAPPDATA ?? '';
    for (const root of [pf, pf86, local]) {
      if (!root) continue;
      add(EDGE_LABEL, join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
      add(CHROME_LABEL, join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'));
      add('Chromium (system)', join(root, 'Chromium', 'Application', 'chrome.exe'));
    }
  } else if (platform === 'darwin') {
    add(CHROME_LABEL, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    add(EDGE_LABEL, '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
    add('Chromium (system)', '/Applications/Chromium.app/Contents/MacOS/Chromium');
  } else {
    // Linux: scan PATH for the usual binary names, then fixed paths.
    const names: [string, string][] = [
      ['google-chrome', CHROME_LABEL],
      ['google-chrome-stable', CHROME_LABEL],
      ['microsoft-edge', EDGE_LABEL],
      ['microsoft-edge-stable', EDGE_LABEL],
      ['chromium', 'Chromium (system)'],
      ['chromium-browser', 'Chromium (system)'],
      ['chrome', 'Chromium (system)'],
    ];
    const dirs = (env.PATH ?? '').split(delimiter).filter(Boolean);
    for (const [name, label] of names) {
      for (const dir of dirs) add(label, join(dir, name));
    }
    add(CHROME_LABEL, '/usr/bin/google-chrome');
    add(CHROME_LABEL, '/usr/bin/google-chrome-stable');
    add(EDGE_LABEL, '/usr/bin/microsoft-edge');
    add('Chromium (system)', '/usr/bin/chromium');
    add('Chromium (system)', '/usr/bin/chromium-browser');
    add('Chromium (system)', '/snap/bin/chromium');
  }
  // De-duplicate by path, keeping the first (most preferred) label.
  const seen = new Set<string>();
  return found.filter(({ path }) => {
    if (seen.has(path)) return false;
    seen.add(path);
    return true;
  });
}

/** The ordered launch ladder. Pure (given env/platform) so tests can
 * assert the order without launching anything. */
export function browserLaunchAttempts(
  env: Record<string, string | undefined> = process.env,
  platform: NodeJS.Platform = process.platform,
): BrowserLaunchAttempt[] {
  const attempts: BrowserLaunchAttempt[] = [
    { label: BUNDLED_LABEL, options: {} },
    {
      label: BUNDLED_FULL_LABEL,
      options: { executablePath: chromium.executablePath() },
    },
    { label: EDGE_LABEL, options: { channel: 'msedge' } },
    { label: CHROME_LABEL, options: { channel: 'chrome' } },
  ];
  const override = env.AEGIS_BROWSER_EXECUTABLE?.trim();
  if (override)
    attempts.push({
      label: `Custom executable (${override})`,
      options: { executablePath: override },
    });
  for (const { label, path } of systemBrowserPaths(env, platform))
    attempts.push({ label, options: { executablePath: path } });
  return attempts;
}

const firstLine = (error: unknown) =>
  (error instanceof Error ? error.message : String(error))
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean)
    ?.slice(0, 300) ?? 'unknown error';

async function walkLadder<T>(
  attempts: BrowserLaunchAttempt[],
  launch: (options: BrowserLaunchAttempt['options']) => Promise<T>,
): Promise<{ value: T; binary: string }> {
  const failures: string[] = [];
  for (const attempt of attempts) {
    try {
      const value = await launch(attempt.options);
      return { value, binary: attempt.label };
    } catch (error) {
      failures.push(`${attempt.label}: ${firstLine(error)}`);
    }
  }
  throw new Error(
    `No usable browser binary found. Install the bundled Chromium (the start scripts do this automatically) or install Microsoft Edge / Google Chrome. Attempts   ${failures.join(' | ')}`,
  );
}

/** Launch a persistent context (AEGIS Computer local mode), walking the
 * fallback ladder. Returns the context and the winning binary label. */
export async function launchPersistentWithFallback(
  profileDir: string,
  baseOptions: {
    headless: boolean;
    args: string[];
    viewport: { width: number; height: number };
  },
  attempts: BrowserLaunchAttempt[] = browserLaunchAttempts(),
): Promise<{ context: BrowserContext; binary: string }> {
  const { value, binary } = await walkLadder(attempts, (options) =>
    chromium.launchPersistentContext(profileDir, { ...baseOptions, ...options }),
  );
  return { context: value, binary };
}

/** Launch a throwaway browser (browser service), same ladder. */
export async function launchWithFallback(baseOptions: {
  headless: boolean;
  args: string[];
}): Promise<{ browser: Browser; binary: string }> {
  const { value, binary } = await walkLadder(browserLaunchAttempts(), (options) =>
    chromium.launch({ ...baseOptions, ...options }),
  );
  return { browser: value, binary };
}
