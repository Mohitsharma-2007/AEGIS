import { expect, it } from 'vitest';
import { computerToolsForPermissions } from '../src/server/computer-tools.js';
import type { ComputerPermissions } from '../src/shared/computer-types.js';

// W-FIX 2a: offer-side permission gating. When a permission is off its
// tools must not be offered to the model at all — the model cannot
// call what it cannot see, so no "Computer permission is disabled"
// cards and no unrequested screenshots.
const all: ComputerPermissions = {
  enabled: true,
  browser: true,
  files: true,
  shell: true,
};

it('offers nothing at all when the computer permission is disabled', () => {
  expect(computerToolsForPermissions({ ...all, enabled: false })).toEqual([]);
});

it('offers every agent action when all permissions are on, minus human-only', () => {
  const names = computerToolsForPermissions(all);
  expect(names).toContain('navigate');
  expect(names).toContain('screenshot');
  expect(names).toContain('files_write');
  expect(names).toContain('exec');
  expect(names).toContain('desktop');
  for (const physicalInput of [
    'mouse_click', 'mouse_move', 'mouse_drag', 'keyboard_type', 'keyboard_press',
    'open_app', 'switch_window', 'window_switch', 'minimize_window',
    'maximize_window', 'resize_window',
  ]) expect(names).not.toContain(physicalInput);
  expect(names.some((name) => name.startsWith('human_'))).toBe(false);
});

it('gates each category independently', () => {
  const noBrowser = computerToolsForPermissions({ ...all, browser: false });
  expect(noBrowser).not.toContain('navigate');
  expect(noBrowser).not.toContain('screenshot');
  expect(noBrowser).toContain('files_read');
  expect(noBrowser).toContain('exec');

  const noFiles = computerToolsForPermissions({ ...all, files: false });
  expect(noFiles).not.toContain('files_list');
  expect(noFiles).not.toContain('files_write');
  expect(noFiles).toContain('navigate');

  const noShell = computerToolsForPermissions({ ...all, shell: false });
  expect(noShell).not.toContain('exec');
  expect(noShell).toContain('navigate');
});
