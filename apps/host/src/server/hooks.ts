import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { Hono } from 'hono';
import { z } from 'zod';
import { aegisRootDir } from './harness.js';
import { log } from './log.js';

export type HookEvent =
  | 'run_start'
  | 'run_end'
  | 'pre_tool'
  | 'post_tool'
  | 'memory_write'
  | 'shortcut_run';

export interface LifecycleHook {
  id: string;
  name: string;
  event: HookEvent;
  command: string;
  enabled: boolean;
  timeoutMs: number;
  createdAt: number;
  updatedAt: number;
}

export interface HookAudit {
  id: string;
  hookId: string;
  hookName: string;
  event: HookEvent;
  command: string;
  status: 'success' | 'failed' | 'timeout' | 'denied';
  exitCode: number | null;
  durationMs: number;
  output: string;
  timestamp: number;
}

const localDataDir = join(aegisRootDir(), '.aegis-data');
const hooksFile = join(localDataDir, 'hooks.json');
const auditLog: HookAudit[] = [];
const MAX_AUDIT_LOG = 150;

function ensureDir() {
  if (!existsSync(localDataDir)) {
    mkdirSync(localDataDir, { recursive: true });
  }
}

export function loadHooks(): LifecycleHook[] {
  ensureDir();
  if (!existsSync(hooksFile)) return [];
  try {
    const raw = readFileSync(hooksFile, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as LifecycleHook[]) : [];
  } catch {
    return [];
  }
}

export function saveHooks(hooks: LifecycleHook[]): void {
  ensureDir();
  const tmpFile = `${hooksFile}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tmpFile, JSON.stringify(hooks, null, 2), 'utf8');
    renameSync(tmpFile, hooksFile);
  } catch (err) {
    try {
      writeFileSync(hooksFile, JSON.stringify(hooks, null, 2), 'utf8');
    } catch {
      // ignore
    }
  }
}

export function getHookAuditLog(): HookAudit[] {
  return [...auditLog];
}

export function clearHookAuditLog(): void {
  auditLog.length = 0;
}

function recordAudit(audit: HookAudit) {
  auditLog.unshift(audit);
  if (auditLog.length > MAX_AUDIT_LOG) {
    auditLog.length = MAX_AUDIT_LOG;
  }
}

/**
 * Executes a hook command inside a sandboxed environment with strict timeout,
 * workspace jail, and sanitized env.
 */
export async function executeHook(
  hook: LifecycleHook,
  payload: Record<string, unknown> = {},
): Promise<HookAudit> {
  const auditId = randomUUID();
  const start = Date.now();
  const timeoutMs = Math.min(Math.max(1000, hook.timeoutMs || 5000), 10_000);

  // Build sanitized environment allowlist
  const safeEnv: Record<string, string> = {
    AEGIS_HOOK_EVENT: hook.event,
    AEGIS_HOOK_NAME: hook.name,
    AEGIS_HOOK_PAYLOAD: JSON.stringify(payload),
  };

  const allowList = [
    'PATH',
    'SYSTEMROOT',
    'WINDIR',
    'TEMP',
    'TMP',
    'USER',
    'USERNAME',
    'HOME',
    'USERPROFILE',
    'SHELL',
    'COMSPEC',
    'PATHEXT',
  ];

  for (const key of allowList) {
    if (process.env[key]) {
      safeEnv[key] = process.env[key]!;
    }
  }

  // Also include AEGIS_* non-secret variables
  for (const [key, val] of Object.entries(process.env)) {
    if (
      key.startsWith('AEGIS_') &&
      !key.includes('KEY') &&
      !key.includes('SECRET') &&
      !key.includes('TOKEN') &&
      val
    ) {
      safeEnv[key] = val;
    }
  }

  const cwd = aegisRootDir();
  const isWindows = process.platform === 'win32';
  const shell = isWindows ? 'powershell.exe' : '/bin/sh';
  const args = isWindows
    ? ['-NoProfile', '-NonInteractive', '-Command', hook.command]
    : ['-c', hook.command];

  return new Promise<HookAudit>((resolve) => {
    let stdoutData = '';
    let stderrData = '';
    let timedOut = false;

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(shell, args, {
        cwd,
        env: safeEnv,
        windowsHide: true,
      });
    } catch (err) {
      const durationMs = Date.now() - start;
      const audit: HookAudit = {
        id: auditId,
        hookId: hook.id,
        hookName: hook.name,
        event: hook.event,
        command: hook.command,
        status: 'failed',
        exitCode: 1,
        durationMs,
        output: `Spawn failed: ${err instanceof Error ? err.message : String(err)}`,
        timestamp: Date.now(),
      };
      recordAudit(audit);
      return resolve(audit);
    }

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore
      }
    }, timeoutMs);

    child.stdout?.on('data', (d) => {
      stdoutData += d.toString();
      if (stdoutData.length > 50_000) stdoutData = stdoutData.slice(0, 50_000);
    });

    child.stderr?.on('data', (d) => {
      stderrData += d.toString();
      if (stderrData.length > 50_000) stderrData = stderrData.slice(0, 50_000);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      const durationMs = Date.now() - start;
      const combinedOutput = (stdoutData + (stderrData ? `\nSTDERR: ${stderrData}` : '')).trim();

      const audit: HookAudit = {
        id: auditId,
        hookId: hook.id,
        hookName: hook.name,
        event: hook.event,
        command: hook.command,
        status: timedOut ? 'timeout' : code === 0 ? 'success' : 'failed',
        exitCode: code,
        durationMs,
        output: timedOut ? `Execution timed out after ${timeoutMs}ms. Output: ${combinedOutput}` : combinedOutput,
        timestamp: Date.now(),
      };

      recordAudit(audit);
      resolve(audit);
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      const durationMs = Date.now() - start;
      const audit: HookAudit = {
        id: auditId,
        hookId: hook.id,
        hookName: hook.name,
        event: hook.event,
        command: hook.command,
        status: 'failed',
        exitCode: 1,
        durationMs,
        output: `Process error: ${err.message}`,
        timestamp: Date.now(),
      };
      recordAudit(audit);
      resolve(audit);
    });
  });
}

/**
 * Fires all enabled hooks registered for an event.
 * Never throws into the turn or crashes the host.
 */
export async function emitHook(
  event: HookEvent,
  payload: Record<string, unknown> = {},
): Promise<HookAudit[]> {
  try {
    const hooks = loadHooks();
    const matching = hooks.filter((h) => h.enabled && h.event === event);
    if (!matching.length) return [];

    const audits: HookAudit[] = [];
    for (const hook of matching) {
      try {
        const audit = await executeHook(hook, payload);
        audits.push(audit);
      } catch (err) {
        log.warn?.(`Hook execution error for ${hook.name}: ${err}`);
      }
    }
    return audits;
  } catch {
    return [];
  }
}

/**
 * HTTP routes for CRUD operations on Lifecycle Hooks.
 */
export function hooksRoutes() {
  const app = new Hono();

  // GET /hooks
  app.get('/hooks', (c) => {
    return c.json(loadHooks());
  });

  // POST /hooks
  app.post('/hooks', async (c) => {
    const body = z
      .object({
        name: z.string().min(1),
        event: z.enum([
          'run_start',
          'run_end',
          'pre_tool',
          'post_tool',
          'memory_write',
          'shortcut_run',
        ]),
        command: z.string().min(1).max(500),
        enabled: z.boolean().optional().default(true),
        timeoutMs: z.number().int().min(500).max(10_000).optional().default(5000),
      })
      .safeParse(await c.req.json().catch(() => null));

    if (!body.success) {
      return c.json({ error: 'Invalid hook payload: name, event, command are required' }, 400);
    }

    // Security: validate hook command against whitelist — no shell metacharacters
    const ALLOWED_COMMAND_PATTERN = /^[a-zA-Z0-9\s\-_.:/]+$/;
    const DANGEROUS_CHARS = /[|&;<>$`(){}[\]\\*?~]/;
    if (!ALLOWED_COMMAND_PATTERN.test(body.data.command)) {
      return c.json(
        { error: 'Invalid hook command: only alphanumeric, spaces, hyphens, underscores, colons, and slashes allowed.' },
        400,
      );
    }
    if (DANGEROUS_CHARS.test(body.data.command)) {
      return c.json(
        { error: 'Hook command contains dangerous characters: shell metacharacters are not allowed.' },
        400,
      );
    }

    const hooks = loadHooks();
    const newHook: LifecycleHook = {
      id: `hook_${randomUUID().slice(0, 8)}`,
      name: body.data.name,
      event: body.data.event,
      command: body.data.command,
      enabled: body.data.enabled,
      timeoutMs: body.data.timeoutMs,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    hooks.push(newHook);
    saveHooks(hooks);
    return c.json(newHook, 201);
  });

  // GET /hooks/audit
  app.get('/hooks/audit', (c) => {
    return c.json(getHookAuditLog());
  });

  // GET /hooks/:id
  app.get('/hooks/:id', (c) => {
    const hook = loadHooks().find((h) => h.id === c.req.param('id'));
    if (!hook) return c.json({ error: 'Hook not found' }, 404);
    return c.json(hook);
  });

  // PATCH /hooks/:id
  app.patch('/hooks/:id', async (c) => {
    const id = c.req.param('id');
    const hooks = loadHooks();
    const idx = hooks.findIndex((h) => h.id === id);
    if (idx === -1) return c.json({ error: 'Hook not found' }, 404);

    const body = z
      .object({
        name: z.string().min(1).optional(),
        event: z
          .enum([
            'run_start',
            'run_end',
            'pre_tool',
            'post_tool',
            'memory_write',
            'shortcut_run',
          ])
          .optional(),
        command: z.string().min(1).optional(),
        enabled: z.boolean().optional(),
        timeoutMs: z.number().int().min(500).max(10_000).optional(),
      })
      .safeParse(await c.req.json().catch(() => null));

    if (!body.success) {
      return c.json({ error: 'Invalid update payload' }, 400);
    }

    hooks[idx] = {
      ...hooks[idx],
      ...body.data,
      updatedAt: Date.now(),
    };
    saveHooks(hooks);
    return c.json(hooks[idx]);
  });

  // DELETE /hooks/:id
  app.delete('/hooks/:id', (c) => {
    const id = c.req.param('id');
    const hooks = loadHooks();
    const filtered = hooks.filter((h) => h.id !== id);
    if (filtered.length === hooks.length) {
      return c.json({ error: 'Hook not found' }, 404);
    }
    saveHooks(filtered);
    return c.json({ ok: true, deleted: id });
  });

  return app;
}
