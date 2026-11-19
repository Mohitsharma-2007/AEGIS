import { afterEach, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceStore } from '../src/server/workspace.js';
import { ComputerService } from '../src/server/computer-service.js';
import { computerTools } from '../src/server/computer-tools.js';
import { computerInputs } from '../src/shared/computer-types.js';
import { computerModeFromEnv } from '../src/server/platform-config.js';

// AEGIS (W-COMP): AEGIS_COMPUTER_MODE parsing + the local computer mode.
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

it('parses AEGIS_COMPUTER_MODE with local as the default', () => {
  expect(computerModeFromEnv({})).toBe('local');
  expect(computerModeFromEnv({ AEGIS_COMPUTER_MODE: '' })).toBe('local');
  expect(computerModeFromEnv({ AEGIS_COMPUTER_MODE: ' LOCAL ' })).toBe('local');
  expect(computerModeFromEnv({ AEGIS_COMPUTER_MODE: 'docker' })).toBe('docker');
  expect(() => computerModeFromEnv({ AEGIS_COMPUTER_MODE: 'cloud' })).toThrow(
    'AEGIS_COMPUTER_MODE',
  );
});

it('keeps service action inputs strict while the advertised no-argument tool schemas are loose', () => {
  // Service layer (computer-service.ts) re-parses with the strict
  // schemas: extra keys are still rejected there.
  expect(
    computerInputs.read.safeParse({ url: 'http://elsewhere' }).success,
  ).toBe(false);
  expect(computerInputs.read.safeParse({}).success).toBe(true);
  expect(computerInputs.files_read.safeParse({ path: 'a.txt' }).success).toBe(
    true,
  );
});

const FIXTURE_HTML = `<!doctype html><title>Local Fixture</title>
<h1>FIXTURE_MARKER hello from the local computer fixture</h1>
<button id="go">Press me</button>
<input id="name" placeholder="Your name" />
<script>
  document.getElementById('go').addEventListener('click', () => {
    document.title = 'Clicked Fixture';
  });
</script>`;

it('runs a local computer end to end: navigate, snapshot, click, screenshot, files, shell, control', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aegis-computer-local-'));
  const workspace = new WorkspaceStore(':memory:', 'owner');
  const server: Server = createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end(FIXTURE_HTML);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no port');
  const fixtureUrl = `http://127.0.0.1:${address.port}/`;
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
    server.close();
    rmSync(root, { recursive: true, force: true });
  });
  workspace.computers.patch(id, {
    enabled: true,
    browser: true,
    files: true,
    shell: true,
  });

  // Status is honest about the mode before anything starts.
  const stopped = await service.status(id);
  expect(stopped).toMatchObject({
    configured: true,
    state: 'stopped',
    computerMode: 'local',
    isolated: false,
    engine: 'playwright',
  });
  expect(stopped.aegisSidecar?.label).toBe('AEGIS Computer (openmuse engine)');
  expect(stopped.aegisSidecar?.configured).toBe(false);

  const started = await service.start(id);
  expect(started.state).toBe('running');
  expect(started.control?.holder).toBe('bot');

  const navigated = (await service.action(
    id,
    'navigate',
    { url: fixtureUrl },
    'agent',
  )) as { url: string; title: string; text: string };
  expect(navigated.title).toBe('Local Fixture');
  expect(navigated.text).toContain('FIXTURE_MARKER');

  const read = (await service.action(id, 'read', {}, 'agent')) as {
    text: string;
  };
  expect(read.text).toContain('FIXTURE_MARKER');

  const snapshot = (await service.action(id, 'snapshot', {}, 'agent')) as {
    snapshotId: number;
    elements: { ref: string; role: string; name: string }[];
  };
  const button = snapshot.elements.find((el) => el.role === 'button');
  expect(button).toBeTruthy();
  // A stale snapshot is refused with the recovery instruction.
  await expect(
    service.action(
      id,
      'click',
      { ref: button!.ref, snapshotId: snapshot.snapshotId + 99 },
      'agent',
    ),
  ).rejects.toThrow('computer_snapshot');
  await service.action(
    id,
    'click',
    { ref: button!.ref, snapshotId: snapshot.snapshotId },
    'agent',
  );
  const afterClick = (await service.action(id, 'read', {}, 'agent')) as {
    title: string;
  };
  expect(afterClick.title).toBe('Clicked Fixture');

  const shot = (await service.action(id, 'screenshot', {}, 'owner')) as {
    base64: string;
    width: number;
    url: string;
  };
  expect(shot.base64.length).toBeGreaterThan(1000);
  expect(shot.width).toBe(1200);
  expect(shot.url).toBe(fixtureUrl);

  // The no-argument agent tool executes through the same service.
  const tools = computerTools(
    service,
    id,
    () => {},
    new AbortController().signal,
  );
  const readTool = tools.find((t) => t.name === 'computer_read')!;
  const toolRead = (await readTool.execute?.({})) as { text: string };
  expect(toolRead.text).toContain('FIXTURE_MARKER');

  // Files are scoped to the per-Agent workspace directory.
  await service.action(
    id,
    'files_write',
    { path: 'notes/hello.txt', contents: 'local mode file body' },
    'agent',
  );
  const file = (await service.action(
    id,
    'files_read',
    { path: 'notes/hello.txt' },
    'agent',
  )) as { text: string; bytes: number };
  expect(file.text).toBe('local mode file body');
  const listing = (await service.action(
    id,
    'files_list',
    { path: '' },
    'agent',
  )) as { entries: { path: string; kind: string }[] };
  expect(
    listing.entries.some((entry) => entry.path === 'notes/hello.txt'),
  ).toBe(true);
  await expect(
    service.action(id, 'files_read', { path: '../secret' }, 'agent'),
  ).rejects.toThrow();

  // Agent shell execution is refused in local mode because the workspace
  // directory is not an OS sandbox; owner shell remains available.
  await expect(
    service.action(id, 'exec', { command: 'pwd', timeoutMs: 10000 }, 'agent'),
  ).rejects.toThrow('not OS-isolated');
  const pwd = (await service.action(
    id,
    'exec',
    { command: 'pwd', timeoutMs: 10000 },
    'owner',
  )) as { stdout: string; exitCode: number };
  expect(pwd.exitCode).toBe(0);
  expect(pwd.stdout.trim().endsWith(join(id, 'workspace'))).toBe(true);
  const failing = (await service.action(
    id,
    'exec',
    { command: 'exit 3', timeoutMs: 10000 },
    'owner',
  )) as { exitCode: number };
  expect(failing.exitCode).toBe(3);

  // Owner takeover / handback.
  const taken = await service.control(id, 'take');
  expect(taken.control?.holder).toBe('human');
  const released = await service.control(id, 'release');
  expect(released.control?.holder).toBe('bot');
  expect(released.control?.resumeSnapshotRequired).toBe(true);

  const stoppedAgain = await service.stop(id);
  expect(stoppedAgain.state).toBe('stopped');
}, 60_000);
