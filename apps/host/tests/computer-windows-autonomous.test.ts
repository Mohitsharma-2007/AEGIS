import { afterEach, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceStore } from '../src/server/workspace.js';
import { ComputerService } from '../src/server/computer-service.js';
import { computerInputs } from '../src/shared/computer-types.js';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

it('validates Autonomous Computer schemas for list_windows, desktop_snapshot, mouse, keyboard, and ui_automation_tree', () => {
  expect(computerInputs.list_windows.safeParse({}).success).toBe(true);
  expect(computerInputs.desktop_snapshot.safeParse({}).success).toBe(true);
  expect(computerInputs.switch_window.safeParse({ title: 'Calculator' }).success).toBe(true);
  expect(computerInputs.minimize_window.safeParse({ title: 'Calculator' }).success).toBe(true);
  expect(computerInputs.maximize_window.safeParse({ title: 'Calculator' }).success).toBe(true);
  expect(
    computerInputs.resize_window.safeParse({ title: 'Calculator', width: 1024, height: 768 }).success,
  ).toBe(true);
  expect(
    computerInputs.mouse_click.safeParse({ x: 500, y: 300, button: 'left', double: false }).success,
  ).toBe(true);
  expect(computerInputs.mouse_move.safeParse({ x: 100, y: 200 }).success).toBe(true);
  expect(
    computerInputs.mouse_drag.safeParse({ fromX: 50, fromY: 50, toX: 200, toY: 200 }).success,
  ).toBe(true);
  expect(computerInputs.keyboard_type.safeParse({ text: 'Hello Aegis' }).success).toBe(true);
  expect(computerInputs.keyboard_press.safeParse({ key: 'Enter' }).success).toBe(true);
  expect(
    computerInputs.ui_automation_tree.safeParse({ processName: 'CalculatorApp', maxDepth: 2 }).success,
  ).toBe(true);
});

it('allows read-only desktop inspection but blocks agent physical mouse and keyboard input', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aegis-comp-auto-'));
  const workspace = new WorkspaceStore(':memory:', 'owner');
  const id = workspace.dots()[0].id;
  const service = new ComputerService(
    workspace,
    {
      baseUrl: 'https://example.com',
      voiceName: 'voice',
      slackUsers: [],
      runtimeUrl: 'http://localhost',
      computerMode: 'local',
      computerLocalRoot: root,
    },
    () => false,
  );
  cleanups.push(async () => {
    await service.stop(id).catch(() => {});
    workspace.close();
  });

  workspace.computers.patch(id, {
    enabled: true,
    browser: true,
    files: true,
    shell: true,
  });

  await service.start(id);

  // 1. list_windows
  const wins = (await service.action(id, 'list_windows', {}, 'agent')) as {
    ok: boolean;
    windows: Array<{ id: number; processName: string; title: string }>;
  };
  expect(wins.ok).toBe(true);
  expect(Array.isArray(wins.windows)).toBe(true);

  // 2. desktop_snapshot
  const snap = (await service.action(id, 'desktop_snapshot', {}, 'agent')) as {
    base64: string;
    width: number;
    height: number;
    format: string;
  };
  expect(typeof snap.base64).toBe('string');
  expect(snap.base64.length).toBeGreaterThan(1000);
  // The full-screen capture is JPEG on purpose: it is several times faster and
  // smaller than PNG at this resolution, and the live preview only needs a
  // faithful frame. PNG remains acceptable when a platform falls back to it.
  expect(snap.format).toMatch(/^image\/(jpeg|png)$/);
  expect(snap.width).toBeGreaterThan(0);
  expect(snap.height).toBeGreaterThan(0);

  // Physical inputs are refused without moving the owner's real cursor or
  // sending keys to whichever window currently has focus.
  await expect(service.action(id, 'mouse_move', { x: 100, y: 100 }, 'agent'))
    .rejects.toThrow('owner-only');
  await expect(service.action(id, 'mouse_click', { x: 100, y: 100 }, 'agent'))
    .rejects.toThrow('Coordinate mouse actions are disabled');
  await expect(service.action(id, 'mouse_drag', { fromX: 100, fromY: 100, toX: 150, toY: 150 }, 'agent'))
    .rejects.toThrow('owner-only');
  await expect(service.action(id, 'keyboard_type', { text: 'Aegis 2.0' }, 'agent'))
    .rejects.toThrow('owner-only');
  await expect(service.action(id, 'keyboard_press', { key: 'Escape' }, 'agent'))
    .rejects.toThrow('owner-only');

  // 5. ui_automation_tree
  const treeRes = (await service.action(id, 'ui_automation_tree', { maxDepth: 2 }, 'agent')) as {
    ok: boolean;
    elements: unknown[];
  };
  expect(treeRes.ok).toBe(true);
  expect(Array.isArray(treeRes.elements)).toBe(true);
}, 30000);
