import { expect, it } from 'vitest';
import {
  browserLaunchAttempts,
  BUNDLED_LABEL,
  BUNDLED_FULL_LABEL,
  CHROME_LABEL,
  EDGE_LABEL,
} from '../src/server/browser-launch.js';

// W-FIX 1a: the launch ladder order is the fix for the fresh-Windows
// "executable doesn't exist" failure — bundled Chromium first, then
// the full build, then system Edge, then system Chrome, then the
// explicit env executable, then well-known system paths. These tests
// pin the order without launching anything.
it('orders the ladder: bundled, full build, edge, chrome, env executable', () => {
  const attempts = browserLaunchAttempts(
    { AEGIS_BROWSER_EXECUTABLE: '/opt/aegis/chrome' },
    'win32',
  );
  const labels = attempts.map((attempt) => attempt.label);
  expect(labels[0]).toBe(BUNDLED_LABEL);
  expect(labels[1]).toBe(BUNDLED_FULL_LABEL);
  expect(labels[2]).toBe(EDGE_LABEL);
  expect(labels[3]).toBe(CHROME_LABEL);
  const envAttempt = attempts.find(
    (attempt) => attempt.options.executablePath === '/opt/aegis/chrome',
  );
  expect(envAttempt).toBeTruthy();
  expect(attempts.indexOf(envAttempt!)).toBeGreaterThan(3);
  expect(attempts[2].options.channel).toBe('msedge');
  expect(attempts[3].options.channel).toBe('chrome');
});

it('omits the env-executable rung when the variable is unset', () => {
  const attempts = browserLaunchAttempts({}, 'linux');
  expect(
    attempts.some((attempt) => attempt.label.startsWith('Custom executable')),
  ).toBe(false);
  expect(attempts[0].label).toBe(BUNDLED_LABEL);
});
