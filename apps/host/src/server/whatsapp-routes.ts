import { Hono } from 'hono';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { aegisRootDir } from './harness.js';
import { log } from './log.js';

// AEGIS (W-FIX 3d): host-side proxy for the WhatsApp sidecar
// (src/whatsapp, Baileys). The browser only ever talks to these
// routes; the sidecar secret stays server-side.
//
// Aegis is usable without the start scripts: when the sidecar is not
// reachable the host provisions the shared secret under
// .aegis-data/whatsapp-secret and lazily spawns the sidecar with the
// same secret, port and auth directory the start scripts would use.
// Fail-soft: a down sidecar yields reachable:false with the reason,
// never a 500.

export interface WhatsAppStatus {
  reachable: boolean;
  state: 'disconnected' | 'qr' | 'connecting' | 'connected' | 'unavailable';
  qrDataUrl: string | null;
  me: { id: string; name?: string } | null;
  detail: string | null;
  paired: boolean;
}

function dataDir(): string {
  return join(aegisRootDir(), '.aegis-data');
}

function sidecarBase(
  env: Record<string, string | undefined> = process.env,
): string {
  return (env.AEGIS_WHATSAPP_URL?.trim() || 'http://127.0.0.1:4312').replace(
    /\/$/,
    '',
  );
}

/**
 * Shared secret resolution, mirroring the start scripts: env override  
 * .aegis-data/whatsapp-secret   generate a stable one. The file is what
 * lets a host-only dev run and the sidecar agree without the owner
 * exporting anything.
 */
export function whatsappSecret(): string {
  const fromEnv = process.env.WHATSAPP_SECRET?.trim();
  if (fromEnv) return fromEnv;
  const file = join(dataDir(), 'whatsapp-secret');
  try {
    if (existsSync(file)) {
      const value = readFileSync(file, 'utf8').trim();
      if (value) return value;
    }
    const secret = randomBytes(32).toString('hex');
    mkdirSync(dataDir(), { recursive: true });
    writeFileSync(file, secret, { encoding: 'utf8', mode: 0o600 });
    process.env.WHATSAPP_SECRET = secret;
    log.info('Generated the WhatsApp sidecar secret in .aegis-data.');
    return secret;
  } catch (error) {
    log.warn('Could not provision the WhatsApp sidecar secret', {
      error: error instanceof Error ? error.message : String(error),
    });
    return '';
  }
}

function sidecarPort(): string {
  const explicit = process.env.WHATSAPP_PORT?.trim();
  if (explicit) return explicit;
  try {
    const url = new URL(sidecarBase());
    if (url.port) return url.port;
  } catch {
    // Fall through to the default port.
  }
  return '4312';
}

async function callSidecar(
  path: string,
  method: 'GET' | 'POST' = 'GET',
  timeoutMs = 5_000,
  body?: unknown,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${sidecarBase()}${path}`, {
    method,
    headers: {
      'x-aegis-whatsapp-secret': whatsappSecret(),
      // Lets a sidecar surviving a dev-watch restart adopt this host (no
      // reconnect) instead of being killed by its previous owner.
      'x-aegis-owner-pid': String(process.pid),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (response.status === 401)
    throw new Error(
      'Sidecar rejected the shared secret. Restart Aegis so the host and sidecar reload .aegis-data/whatsapp-secret.',
    );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as Record<string, unknown>;
}

async function sidecarReachable(): Promise<boolean> {
  try {
    await callSidecar('/status', 'GET', 1_500);
    return true;
  } catch {
    return false;
  }
}

let spawnPromise: Promise<void> | null = null;
let lastSpawnAt = 0;

// The lazy sidecar is an owned child process: every spawn is recorded here so a
// single dispose path can stop it. Without this a host run (or a test worker)
// can exit and leave an orphaned node process listening on the WhatsApp port.
const sidecars = new Set<ChildProcess>();
let exitHookInstalled = false;

function killProcessTree(pid: number): void {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    return;
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }
}

function stopSidecarsSync(): void {
  for (const child of sidecars) {
    const pid = child.pid;
    if (typeof pid === 'number') killProcessTree(pid);
  }
  sidecars.clear();
}

function trackSidecar(child: ChildProcess): void {
  sidecars.add(child);
  child.once('exit', () => sidecars.delete(child));
  if (!exitHookInstalled) {
    exitHookInstalled = true;
    // Last line of defence: never let this process exit with a live sidecar.
    process.once('exit', stopSidecarsSync);
  }
}

/** PIDs of the sidecars this process spawned and still owns (diagnostics/tests). */
export function whatsappSidecarPids(): number[] {
  return [...sidecars]
    .map((child) => child.pid)
    .filter((pid): pid is number => typeof pid === 'number');
}

/** Stop every sidecar this process lazily spawned (host shutdown, test teardown). */
export async function disposeWhatsAppSidecar(): Promise<void> {
  const children = [...sidecars];
  sidecars.clear();
  await Promise.all(
    children.map(
      (child) =>
        new Promise<void>((resolve) => {
          const pid = child.pid;
          if (child.exitCode !== null || typeof pid !== 'number') {
            resolve();
            return;
          }
          const timer = setTimeout(() => {
            killProcessTree(pid);
            resolve();
          }, 2_000);
          child.once('exit', () => {
            clearTimeout(timer);
            resolve();
          });
          try {
            child.kill();
          } catch {
            clearTimeout(timer);
            killProcessTree(pid);
            resolve();
          }
        }),
    ),
  );
}

function spawnSidecar(): Promise<void> {
  if (spawnPromise) return spawnPromise;
  lastSpawnAt = Date.now();
  spawnPromise = (async () => {
    const hostDir = join(aegisRootDir(), 'apps', 'host');
    const built = join(hostDir, 'dist', 'server', 'whatsapp', 'index.js');
    const source = join(hostDir, 'src', 'whatsapp', 'index.ts');
    const override = process.env.WHATSAPP_SIDECAR_ENTRY?.trim();
    const entry = override || (existsSync(built) ? built : source);
    if (!existsSync(entry))
      throw new Error('The WhatsApp sidecar entry point is missing.');
    const authDir =
      process.env.WHATSAPP_AUTH_DIR?.trim() ||
      join(dataDir(), 'whatsapp-auth');
    mkdirSync(authDir, { recursive: true });
    const logFile = join(dataDir(), 'whatsapp-sidecar.log');
    const fd = openSync(logFile, 'a');
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      WHATSAPP_SECRET: whatsappSecret(),
      WHATSAPP_PORT: sidecarPort(),
      WHATSAPP_HOST: process.env.WHATSAPP_HOST?.trim() || '127.0.0.1',
      WHATSAPP_AUTH_DIR: authDir,
      // Ownership: the sidecar stops itself if this process goes away.
      WHATSAPP_PARENT_PID: String(process.pid),
    };
    const runSource = /\.(ts|tsx|mts)$/.test(entry);
    const child = !runSource
      ? spawn(process.execPath, [entry], {
          cwd: hostDir,
          env,
          detached: true,
          windowsHide: true,
          stdio: ['ignore', fd, fd, 'pipe'],
        })
      : spawn(process.execPath, ['--import', 'tsx', entry], {
          cwd: hostDir,
          env,
          detached: true,
          windowsHide: true,
          stdio: ['ignore', fd, fd, 'pipe'],
        });
    trackSidecar(child);
    child.unref();
    log.info('Started the WhatsApp sidecar (lazy host launch).');
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null)
        throw new Error(
          'The WhatsApp sidecar exited during startup. See .aegis-data/whatsapp-sidecar.log.',
        );
      if (await sidecarReachable()) return;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  })().finally(() => {
    spawnPromise = null;
  });
  return spawnPromise;
}

/** Lazily make sure the sidecar process is up (throttled, idempotent). */
async function ensureSidecar(force = false): Promise<void> {
  if (await sidecarReachable()) return;
  if (!force && Date.now() - lastSpawnAt < 30_000) return;
  try {
    await spawnSidecar();
  } catch (error) {
    log.warn('WhatsApp sidecar launch failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function getWhatsAppStatus(): Promise<WhatsAppStatus> {
  try {
    const raw = await callSidecar('/status');
    return {
      reachable: true,
      state: (raw.state as WhatsAppStatus['state']) ?? 'disconnected',
      qrDataUrl: (raw.qrDataUrl as string | null) ?? null,
      me: (raw.me as WhatsAppStatus['me']) ?? null,
      detail: (raw.detail as string | null) ?? null,
      paired: raw.paired === true,
    };
  } catch (error) {
    // A down sidecar is the normal first-run state; provision + start it
    // once, throttled, and report the honest current state meanwhile.
    await ensureSidecar();
    return {
      reachable: false,
      state: 'unavailable',
      qrDataUrl: null,
      me: null,
      detail:
        error instanceof Error && error.message.includes('rejected the shared secret')
          ? error.message
          : `WhatsApp sidecar is starting at ${sidecarBase()}. If it stays unavailable, check .aegis-data/whatsapp-sidecar.log.`,
      paired: false,
    };
  }
}

export async function getWhatsAppMessages(chat?: string, limit = 50): Promise<Record<string, unknown>> {
  const boundedLimit = Math.min(200, Math.max(1, limit));
  const params = new URLSearchParams({ limit: String(boundedLimit) });
  if (chat?.trim()) params.set('chat', chat.trim());
  try {
    return await callSidecar(`/messages?${params.toString()}`);
  } catch (error) {
    return {
      ok: false,
      messages: [],
      error: error instanceof Error ? error.message : 'WhatsApp is unavailable.',
    };
  }
}

export async function sendWhatsAppMessage(to: string, text: string): Promise<Record<string, unknown>> {
  const recipient = to?.trim();
  const content = text?.trim();
  if (!recipient || !content) {
    return { ok: false, error: 'A recipient and a message are required.' };
  }
  try {
    return await callSidecar('/send', 'POST', 20_000, { to: recipient, text: content });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'The message could not be sent.',
    };
  }
}

export function whatsappRoutes() {
  const app = new Hono();
  app.get('/whatsapp/status', async (c) => c.json(await getWhatsAppStatus()));
  app.post('/whatsapp/start', async (c) => {
    try {
      await ensureSidecar(true);
      await callSidecar('/start', 'POST', 20_000);
    } catch (error) {
      // Status below reports the unreachable state honestly.
      log.warn('WhatsApp start request failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return c.json(await getWhatsAppStatus());
  });
  // The WhatsApp surface reads through the host so the sidecar secret never
  // reaches the browser, and sending is the same path the agent uses.
  app.get('/whatsapp/messages', async (c) => {
    const limit = Math.min(
      200,
      Math.max(1, Number(c.req.query('limit') ?? 60) || 60),
    );
    const chat = c.req.query('chat') ?? '';
    const params = new URLSearchParams({ limit: String(limit) });
    if (chat) params.set('chat', chat);
    try {
      return c.json(await callSidecar(`/messages?${params.toString()}`));
    } catch (error) {
      return c.json(
        {
          ok: false,
          messages: [],
          error:
            error instanceof Error ? error.message : 'WhatsApp is unavailable.',
        },
        503,
      );
    }
  });
  app.post('/whatsapp/send', async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      to?: string;
      text?: string;
    } | null;
    const to = body?.to?.trim();
    const text = body?.text?.trim();
    if (!to || !text)
      return c.json({ error: 'A recipient and a message are required.' }, 400);
    try {
      return c.json(await callSidecar('/send', 'POST', 20_000, { to, text }));
    } catch (error) {
      return c.json(
        {
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : 'The message could not be sent.',
        },
        503,
      );
    }
  });
  app.post('/whatsapp/send-media', async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      to?: string; data?: string; mimetype?: string; filename?: string; caption?: string;
    } | null;
    if (!body?.to?.trim() || !body.data || !body.mimetype)
      return c.json({ ok: false, error: 'Recipient and attachment are required.' }, 400);
    if (body.data.length > 28_000_000)
      return c.json({ ok: false, error: 'Attachments must be 20 MB or smaller.' }, 413);
    if (!/^(image|video|application)\/[\w.+-]+$/.test(body.mimetype))
      return c.json({ ok: false, error: 'Unsupported attachment type.' }, 400);
    try {
      return c.json(await callSidecar('/send-media', 'POST', 45_000, {
        ...body, to: body.to.trim(), filename: body.filename?.slice(0, 120), caption: body.caption?.slice(0, 1000),
      }));
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : 'The attachment could not be sent.' }, 503);
    }
  });
  return app;
}
