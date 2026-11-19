// Owner-handoff and shutdown behaviour of the lazily spawned WhatsApp sidecar.
//
// Real end-to-end process tests: a fixture "host" process spawns the sidecar
// from source, the test kills it (SIGKILL) or asks it to shut down gracefully,
// and checks what happens to the child. No app, dev server or WhatsApp account
// is involved: WHATSAPP_AUTO_CONNECT=0 keeps the sidecar's HTTP surface up with
// no connection, and every case uses its own ephemeral port and temp auth dir.
import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import { installSidecarShutdown } from '../src/server/sidecar-lifecycle.js';

const hostDir = fileURLToPath(new URL('..', import.meta.url));
const fixture = fileURLToPath(
  new URL('./fixtures/whatsapp-owner.ts', import.meta.url),
);
const sidecarEntry = fileURLToPath(
  new URL('../src/whatsapp/index.ts', import.meta.url),
);
const SECRET = 'owner-handoff-test-secret';
const GRACE = 2_500;
const READY_TIMEOUT = 30_000;

const owners = new Set<ChildProcess>();
const sidecarPids = new Set<number>();
const tempDirs: string[] = [];

afterEach(() => {
  for (const owner of owners) killTree(owner.pid);
  owners.clear();
  for (const pid of sidecarPids) killTree(pid);
  sidecarPids.clear();
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function killTree(pid: number | undefined): void {
  if (typeof pid !== 'number' || pid <= 0) return;
  if (process.platform === 'win32') {
    try {
      execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' });
    } catch {
      // already gone
    }
    return;
  }
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // already gone
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => (port ? resolve(port) : reject(new Error('no port'))));
    });
  });
}

function listening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    socket.setTimeout(400);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function waitFor(
  check: () => Promise<boolean> | boolean,
  ms: number,
): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await sleep(100);
  }
  return false;
}

function startOwner(env: NodeJS.ProcessEnv): ChildProcess {
  const owner = spawn(process.execPath, ['--import', 'tsx', fixture], {
    cwd: hostDir,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  owners.add(owner);
  owner.once('exit', () => owners.delete(owner));
  return owner;
}

/** Resolve with the sidecar PIDs the owner reports once it is serving. */
function sidecarPidsOf(
  owner: ChildProcess,
  timeoutMs = READY_TIMEOUT,
): Promise<number[]> {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => {
      cleanup();
      reject(
        new Error(`owner never became ready. Output: ${output.slice(-500)}`),
      );
    }, timeoutMs);
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      const match = output.match(/READY:([\d,]*):reachable=true/);
      if (!match) return;
      cleanup();
      resolve(
        match[1]
          .split(',')
          .filter(Boolean)
          .map((value) => Number(value)),
      );
    };
    const onExit = (code: number | null) => {
      cleanup();
      reject(
        new Error(`owner exited early (${code}). Output: ${output.slice(-500)}`),
      );
    };
    const cleanup = () => {
      clearTimeout(timer);
      owner.stdout?.off('data', onData);
      owner.off('exit', onExit);
    };
    owner.stdout?.on('data', onData);
    owner.once('exit', onExit);
  });
}

function envFor(
  port: number,
  authDir: string,
  grace?: number,
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    WHATSAPP_SECRET: SECRET,
    WHATSAPP_PORT: String(port),
    WHATSAPP_HOST: '127.0.0.1',
    AEGIS_WHATSAPP_URL: `http://127.0.0.1:${port}`,
    WHATSAPP_AUTH_DIR: authDir,
    WHATSAPP_SIDECAR_ENTRY: sidecarEntry,
    WHATSAPP_AUTO_CONNECT: '0',
    ...(grace === undefined ? {} : { WHATSAPP_OWNER_GRACE_MS: String(grace) }),
  };
}

/** Authoritative sidecar PID from its own health endpoint (unauthenticated). */
async function sidecarPidFromHealth(port: number): Promise<number> {
  const response = await fetch(`http://127.0.0.1:${port}/health`);
  const body = (await response.json()) as { pid?: number };
  return Number(body.pid);
}

function authDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'aegis-wa-owner-'));
  tempDirs.push(dir);
  return dir;
}

/** Start an owner that has spawned exactly one sidecar and is serving. */
async function servingOwner(
  port: number,
  env: NodeJS.ProcessEnv,
): Promise<{ owner: ChildProcess; pid: number }> {
  const owner = startOwner(env);
  const pids = await sidecarPidsOf(owner);
  expect(pids).toHaveLength(1);
  const pid = pids[0];
  sidecarPids.add(pid);
  expect(await waitFor(() => listening(port), 5_000)).toBe(true);
  return { owner, pid };
}

it(
  'a newer owner adopts a surviving sidecar without a restart',
  async () => {
    const port = await freePort();
    const env = envFor(port, authDir(), GRACE);

    const { owner: first, pid: firstPid } = await servingOwner(port, env);

    // Owner exits abruptly, exactly like a watch restart or a killed worker.
    first.kill('SIGKILL');
    await sleep(300);
    expect(await listening(port)).toBe(true); // handoff window keeps it up

    const second = startOwner(env);
    // The new owner spawned nothing: it reused the running sidecar.
    expect(await sidecarPidsOf(second)).toEqual([]);
    expect(await sidecarPidFromHealth(port)).toBe(firstPid);

    // The handoff timer was cancelled: still serving well past the window.
    await sleep(GRACE + 1_500);
    expect(await listening(port)).toBe(true);

    // The adopted owner's death starts a fresh handoff window, then it stops.
    second.kill('SIGKILL');
    expect(
      await waitFor(async () => !(await listening(port)), GRACE + 5_000),
    ).toBe(true);
  },
  60_000,
);

it(
  'with the default grace of 0 the sidecar stops as soon as its owner dies',
  async () => {
    const port = await freePort();
    const env = envFor(port, authDir());

    const { owner, pid } = await servingOwner(port, env);

    owner.kill('SIGKILL');
    expect(await waitFor(async () => !(await listening(port)), 4_000)).toBe(
      true,
    );
    // Really gone, not merely refusing connections.
    expect(await waitFor(() => !pidAlive(pid), 4_000)).toBe(true);
    sidecarPids.delete(pid);
  },
  60_000,
);

it(
  'a graceful shutdown stops the sidecar immediately, ignoring the handoff grace',
  async () => {
    const port = await freePort();
    // A long grace proves the stop comes from the shutdown path, not the timer.
    const env = {
      ...envFor(port, authDir(), 8_000),
      OWNER_SHUTDOWN_ON_STDIN: '1',
    };

    const { owner, pid } = await servingOwner(port, env);

    owner.stdin?.write('shutdown\n');
    expect(await waitFor(async () => !(await listening(port)), 3_000)).toBe(
      true,
    );
    expect(await waitFor(() => !pidAlive(pid), 3_000)).toBe(true);
    sidecarPids.delete(pid);
    expect(await waitFor(() => owner.exitCode !== null, 5_000)).toBe(true);
  },
  60_000,
);

it('wires SIGTERM and SIGINT to a single sidecar disposal', async () => {
  const handlers = new Map<string, () => void>();
  const dispose = vi.fn(async () => {});
  const uninstall = installSidecarShutdown(dispose, {
    on: (event: string, listener: () => void) => {
      handlers.set(event, listener);
    },
  });

  expect([...handlers.keys()].sort()).toEqual(['SIGINT', 'SIGTERM']);
  handlers.get('SIGTERM')?.();
  handlers.get('SIGINT')?.();
  await Promise.resolve();

  expect(dispose).toHaveBeenCalledTimes(1);
  uninstall();
});

it(
  'an unauthenticated request cannot adopt the sidecar',
  async () => {
    const port = await freePort();
    const env = envFor(port, authDir(), GRACE);

    const { owner, pid } = await servingOwner(port, env);

    // Wrong secret, valid-looking owner header: rejected, never a handoff.
    const rejected = await fetch(`http://127.0.0.1:${port}/status`, {
      headers: {
        'x-aegis-whatsapp-secret': 'wrong-secret',
        'x-aegis-owner-pid': String(process.pid),
      },
    });
    expect(rejected.status).toBe(401);
    expect(await listening(port)).toBe(true);

    owner.kill('SIGKILL');
    await sleep(700);
    expect(await listening(port)).toBe(true); // still inside the window
    expect(
      await waitFor(async () => !(await listening(port)), GRACE + 5_000),
    ).toBe(true);
    sidecarPids.delete(pid);
  },
  60_000,
);
