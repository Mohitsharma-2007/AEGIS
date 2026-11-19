import { resolve, relative, isAbsolute, normalize } from 'node:path';
import { tmpdir } from 'node:os';
import { Hono } from 'hono';
import { z } from 'zod';
import { aegisRootDir } from './harness.js';

export type SandboxMode = 'off' | 'workspace' | 'strict';

export interface SandboxAudit {
  id: string;
  type: 'path' | 'command';
  target: string;
  allowed: boolean;
  reason?: string;
  mode: SandboxMode;
  timestamp: number;
}

let activeMode: SandboxMode =
  (process.env.AEGIS_SANDBOX as SandboxMode) || 'workspace';

const sandboxAudits: SandboxAudit[] = [];
const MAX_AUDITS = 100;

export function getSandboxMode(): SandboxMode {
  return activeMode;
}

export function setSandboxMode(mode: SandboxMode): void {
  activeMode = mode;
}

export function getSandboxAudits(): SandboxAudit[] {
  return [...sandboxAudits];
}

export function clearSandboxAudits(): void {
  sandboxAudits.length = 0;
}

function recordAudit(audit: SandboxAudit) {
  sandboxAudits.unshift(audit);
  if (sandboxAudits.length > MAX_AUDITS) {
    sandboxAudits.length = MAX_AUDITS;
  }
}

/**
 * Checks if a file path is permitted by the sandbox policy.
 */
export function isPathAllowed(
  targetPath: string,
  mode: SandboxMode = activeMode,
): { allowed: boolean; reason?: string } {
  if (mode === 'off') {
    return { allowed: true };
  }

  if (!targetPath || typeof targetPath !== 'string') {
    const res = { allowed: false, reason: 'Invalid or empty path.' };
    recordAudit({
      id: Math.random().toString(36).slice(2, 10),
      type: 'path',
      target: String(targetPath),
      allowed: false,
      reason: res.reason,
      mode,
      timestamp: Date.now(),
    });
    return res;
  }

  const workspaceRoot = resolve(aegisRootDir());
  const tempRoot = resolve(tmpdir());
  const resolvedTarget = resolve(targetPath);

  // Check if target is inside workspace or temp
  const relWorkspace = relative(workspaceRoot, resolvedTarget);
  const inWorkspace =
    !relWorkspace.startsWith('..') && !isAbsolute(relWorkspace);

  const relTemp = relative(tempRoot, resolvedTarget);
  const inTemp = !relTemp.startsWith('..') && !isAbsolute(relTemp);

  if (!inWorkspace && !inTemp) {
    const res = {
      allowed: false,
      reason: `Path '${targetPath}' escapes workspace boundary ('${workspaceRoot}').`,
    };
    recordAudit({
      id: Math.random().toString(36).slice(2, 10),
      type: 'path',
      target: targetPath,
      allowed: false,
      reason: res.reason,
      mode,
      timestamp: Date.now(),
    });
    return res;
  }

  // In strict mode, forbid sensitive system and credential files
  if (mode === 'strict') {
    const normalized = normalize(resolvedTarget).toLowerCase();
    const sensitivePatterns = [
      '.env',
      '.git',
      '.ssh',
      '.aws',
      'id_rsa',
      'id_ed25519',
      'windows\\system32',
      '/etc/shadow',
      '/etc/passwd',
    ];

    for (const pat of sensitivePatterns) {
      if (normalized.includes(pat.toLowerCase())) {
        const res = {
          allowed: false,
          reason: `Strict sandbox denies access to sensitive path containing '${pat}'.`,
        };
        recordAudit({
          id: Math.random().toString(36).slice(2, 10),
          type: 'path',
          target: targetPath,
          allowed: false,
          reason: res.reason,
          mode,
          timestamp: Date.now(),
        });
        return res;
      }
    }
  }

  return { allowed: true };
}

/**
 * Checks if a CLI command is permitted by the sandbox policy.
 */
export function isCommandAllowed(
  cmd: string,
  mode: SandboxMode = activeMode,
): { allowed: boolean; reason?: string } {
  if (mode === 'off') {
    return { allowed: true };
  }

  if (!cmd || typeof cmd !== 'string') {
    return { allowed: false, reason: 'Command is empty' };
  }

  const lower = cmd.toLowerCase().trim();

  // Deny destructive command patterns
  const dangerousPatterns = [
    /\brm\s+-[a-z]*r[a-z]*f\s+[\/\\]/i,
    /\brmdir\s+(?:\/[a-z]\s+)*[a-z]:\\/i,
    /\bdel\s+(?:\/[a-z]\s+)*[a-z]:\\/i,
    /\bformat\s+[a-z]:/i,
    /\bmkfs\b/i,
    /\bdiskpart\b/i,
    /\breg\s+delete\b/i,
    /\bdrop\s+database\b/i,
    /\bshutdown\s+[\/-]/i,
    /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
  ];

  for (const pat of dangerousPatterns) {
    if (pat.test(lower)) {
      const res = {
        allowed: false,
        reason: `Command blocked by sandbox policy: matches destructive pattern '${pat}'.`,
      };
      recordAudit({
        id: Math.random().toString(36).slice(2, 10),
        type: 'command',
        target: cmd,
        allowed: false,
        reason: res.reason,
        mode,
        timestamp: Date.now(),
      });
      return res;
    }
  }

  return { allowed: true };
}

/**
 * Scrubs sensitive environment variables before passing to external tools or subprocesses.
 */
export function scrubEnv(
  env: Record<string, string | undefined>,
): Record<string, string> {
  const result: Record<string, string> = {};
  const secretKeywords = [
    'KEY',
    'SECRET',
    'TOKEN',
    'PASSWORD',
    'CREDENTIAL',
    'AUTH',
    'PRIVATE',
  ];

  for (const [k, v] of Object.entries(env)) {
    if (!v) continue;
    const upperKey = k.toUpperCase();
    const isSecret = secretKeywords.some((w) => upperKey.includes(w));
    if (!isSecret) {
      result[k] = v;
    }
  }

  return result;
}

/**
 * Caps output length to avoid memory exhaustion attacks.
 */
export function capOutput(output: string, maxBytes = 100_000): string {
  if (!output || output.length <= maxBytes) return output;
  return `${output.slice(0, maxBytes)}\n...[output capped at ${maxBytes} bytes]`;
}

/**
 * HTTP routes for Sandbox inspection and control.
 */
export function sandboxRoutes() {
  const app = new Hono();

  // GET /sandbox
  app.get('/sandbox', (c) => {
    return c.json({
      mode: activeMode,
      workspaceRoot: aegisRootDir(),
      audits: getSandboxAudits(),
    });
  });

  // PATCH /sandbox
  app.patch('/sandbox', async (c) => {
    const body = z
      .object({
        mode: z.enum(['off', 'workspace', 'strict']),
      })
      .safeParse(await c.req.json().catch(() => null));

    if (!body.success) {
      return c.json({ error: 'Valid mode required: off | workspace | strict' }, 400);
    }

    setSandboxMode(body.data.mode);
    return c.json({
      mode: activeMode,
      message: `Sandbox mode updated to ${activeMode}`,
    });
  });

  return app;
}
