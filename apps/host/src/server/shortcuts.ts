import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { Hono } from 'hono';
import { z } from 'zod';
import { aegisRootDir } from './harness.js';
import { emitHook } from './hooks.js';

const execAsync = promisify(exec);

export type ShortcutType = 'app' | 'command' | 'sequence' | 'url';

export interface ShortcutStep {
  action: 'open_app' | 'exec' | 'open_url';
  target: string;
  parameters?: Record<string, unknown>;
}

export interface Shortcut {
  id: string;
  name: string;
  description: string;
  target: string;
  type: ShortcutType;
  steps?: ShortcutStep[];
  hotkey?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ShortcutAudit {
  id: string;
  shortcutId: string;
  name: string;
  type: ShortcutType;
  status: 'success' | 'failed';
  durationMs: number;
  result?: string;
  error?: string;
  timestamp: number;
}

const localDataDir = join(aegisRootDir(), '.aegis-data');
const shortcutsFile = join(localDataDir, 'shortcuts.json');
const auditLog: ShortcutAudit[] = [];
const MAX_AUDITS = 100;

export const DEFAULT_SHORTCUTS: Shortcut[] = [
  {
    id: 'sc_calc',
    name: 'Calculator',
    description: 'Launch or activate Windows Calculator with instance reuse',
    target: 'calc',
    type: 'app',
    hotkey: 'Ctrl+Alt+C',
    createdAt: 1731500000000,
    updatedAt: 1731500000000,
  },
  {
    id: 'sc_notepad',
    name: 'Notepad',
    description: 'Launch or activate Notepad with instance reuse',
    target: 'notepad',
    type: 'app',
    hotkey: 'Ctrl+Alt+N',
    createdAt: 1731500000000,
    updatedAt: 1731500000000,
  },
  {
    id: 'sc_explorer',
    name: 'File Explorer',
    description: 'Open Windows File Explorer at the current workspace root',
    target: 'explorer',
    type: 'app',
    hotkey: 'Ctrl+Alt+E',
    createdAt: 1731500000000,
    updatedAt: 1731500000000,
  },
  {
    id: 'sc_chrome',
    name: 'Google Chrome',
    description: 'Activate existing Chrome window or start browser',
    target: 'chrome',
    type: 'app',
    createdAt: 1731500000000,
    updatedAt: 1731500000000,
  },
  {
    id: 'sc_terminal',
    name: 'Windows Terminal',
    description: 'Open PowerShell Terminal in workspace directory',
    target: 'powershell',
    type: 'app',
    hotkey: 'Ctrl+Alt+T',
    createdAt: 1731500000000,
    updatedAt: 1731500000000,
  },
  {
    id: 'sc_settings',
    name: 'Windows Settings',
    description: 'Open Windows System Settings panel',
    target: 'ms-settings:',
    type: 'url',
    createdAt: 1731500000000,
    updatedAt: 1731500000000,
  },
];

function ensureDir() {
  if (!existsSync(localDataDir)) {
    mkdirSync(localDataDir, { recursive: true });
  }
}

export function loadShortcuts(): Shortcut[] {
  ensureDir();
  if (!existsSync(shortcutsFile)) {
    saveShortcuts(DEFAULT_SHORTCUTS);
    return [...DEFAULT_SHORTCUTS];
  }
  try {
    const raw = readFileSync(shortcutsFile, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed as Shortcut[];
    }
    saveShortcuts(DEFAULT_SHORTCUTS);
    return [...DEFAULT_SHORTCUTS];
  } catch {
    return [...DEFAULT_SHORTCUTS];
  }
}

export function saveShortcuts(shortcuts: Shortcut[]): void {
  ensureDir();
  const tmpFile = `${shortcutsFile}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tmpFile, JSON.stringify(shortcuts, null, 2), 'utf8');
    renameSync(tmpFile, shortcutsFile);
  } catch {
    try {
      writeFileSync(shortcutsFile, JSON.stringify(shortcuts, null, 2), 'utf8');
    } catch {
      // ignore
    }
  }
}

export function getShortcutAuditLog(): ShortcutAudit[] {
  return [...auditLog];
}

export function clearShortcutAuditLog(): void {
  auditLog.length = 0;
}

function recordAudit(audit: ShortcutAudit) {
  auditLog.unshift(audit);
  if (auditLog.length > MAX_AUDITS) {
    auditLog.length = MAX_AUDITS;
  }
}

/**
 * Smart Win32 application launcher with window reuse:
 * Prioritizes activating and bringing forward existing windows rather than
 * spawning duplicates.
 */
async function launchAppWithReuse(appName: string): Promise<string> {
  const isWin = process.platform === 'win32';
  if (!isWin) {
    await execAsync(`xdg-open "${appName}" 2>/dev/null || open "${appName}"`);
    return `Launched ${appName}`;
  }

  const aliases: Record<string, string[]> = {
    calculator: ['calc.exe', 'start calc:'],
    calc: ['calc.exe', 'start calc:'],
    notepad: ['notepad.exe', 'notepad'],
    explorer: ['explorer.exe', 'explorer'],
    chrome: ['chrome.exe'],
    terminal: ['wt.exe', 'powershell.exe', 'cmd.exe'],
    powershell: ['powershell.exe'],
  };

  const candidates = aliases[appName.toLowerCase()] ?? [appName];
  const names = candidates
    .map((c) => c.replace(/^start\s+/, '').replace(/\.exe$/i, '').trim())
    .filter(Boolean);
  const matchHint = names.concat([appName]).join('|');

  const psScript = `
$ProgressPreference = 'SilentlyContinue';
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class WinReuseShortcuts {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);
}
'@ -ErrorAction SilentlyContinue

$hint = '${matchHint.replace(/'/g, "''")}';
$names = $hint.Split('|') | Where-Object { $_ }
$procs = Get-Process -ErrorAction SilentlyContinue | Where-Object {
  $_.MainWindowHandle -ne [IntPtr]::Zero -and (
    ($names -contains $_.ProcessName) -or
    ($_.MainWindowTitle -match $hint) -or
    ($_.ProcessName -match $hint)
  )
}
$hit = $procs | Select-Object -First 1
if ($hit -and $hit.MainWindowHandle -ne [IntPtr]::Zero) {
  $h = $hit.MainWindowHandle
  try {
    [WinReuseShortcuts]::keybd_event(0x12, 0, 0, 0)
    [WinReuseShortcuts]::keybd_event(0x12, 0, 2, 0)
    if ([WinReuseShortcuts]::IsIconic($h)) {
      [WinReuseShortcuts]::ShowWindowAsync($h, 9) | Out-Null
    } else {
      [WinReuseShortcuts]::ShowWindowAsync($h, 3) | Out-Null
    }
    [WinReuseShortcuts]::SetForegroundWindow($h) | Out-Null
    [WinReuseShortcuts]::BringWindowToTop($h) | Out-Null
  } catch {}
  [PSCustomObject]@{ reused = $true; pid = $hit.Id; process = $hit.ProcessName; title = $hit.MainWindowTitle } | ConvertTo-Json -Compress
} else {
  $startTarget = '${candidates[0]}';
  if ($startTarget -like 'start *') {
    Invoke-Expression $startTarget
  } else {
    Start-Process $startTarget -ErrorAction SilentlyContinue
  }
  '{"reused":false,"started":true}'
}
`;

  try {
    const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
    const { stdout } = await execAsync(
      `powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`,
      { timeout: 8000 },
    );
    return stdout.trim();
  } catch (err) {
    // fallback
    await execAsync(`start ${candidates[0]}`).catch(() => undefined);
    return `Fallback started ${appName}`;
  }
}

/**
 * Executes a shortcut by id or name.
 */
export async function runShortcut(
  idOrName: string,
): Promise<{ ok: boolean; shortcut: Shortcut; output?: string; error?: string }> {
  const start = Date.now();
  const shortcuts = loadShortcuts();
  const target = idOrName.toLowerCase().trim();
  // Exact match first (id or name), then fuzzy substring match on the name so
  // "chrome" finds "Google Chrome" and "calc" finds "Calculator".
  let sc =
    shortcuts.find(
      (s) => s.id.toLowerCase() === target || s.name.toLowerCase() === target,
    ) ??
    shortcuts.find((s) => s.name.toLowerCase().includes(target)) ??
    shortcuts.find((s) => target.includes(s.name.toLowerCase()));

  if (!sc) {
    const err = `Shortcut '${idOrName}' not found.`;
    recordAudit({
      id: randomUUID(),
      shortcutId: idOrName,
      name: idOrName,
      type: 'command',
      status: 'failed',
      durationMs: Date.now() - start,
      error: err,
      timestamp: Date.now(),
    });
    return { ok: false, shortcut: null as unknown as Shortcut, error: err };
  }

  let resultOutput = '';
  try {
    if (sc.type === 'app') {
      resultOutput = await launchAppWithReuse(sc.target);
    } else if (sc.type === 'url') {
      const isWin = process.platform === 'win32';
      const cmd = isWin ? `start "" "${sc.target}"` : `open "${sc.target}"`;
      await execAsync(cmd);
      resultOutput = `Opened URL: ${sc.target}`;
    } else if (sc.type === 'command') {
      const { stdout, stderr } = await execAsync(sc.target, {
        cwd: aegisRootDir(),
        timeout: 10000,
      });
      resultOutput = (stdout + (stderr ? `\n${stderr}` : '')).trim();
    } else if (sc.type === 'sequence') {
      const stepResults: string[] = [];
      for (const step of sc.steps || []) {
        if (step.action === 'open_app') {
          const out = await launchAppWithReuse(step.target);
          stepResults.push(`App ${step.target}: ${out}`);
        } else if (step.action === 'open_url') {
          const isWin = process.platform === 'win32';
          await execAsync(isWin ? `start "" "${step.target}"` : `open "${step.target}"`);
          stepResults.push(`URL: ${step.target}`);
        } else if (step.action === 'exec') {
          const { stdout } = await execAsync(step.target, { cwd: aegisRootDir(), timeout: 10000 });
          stepResults.push(`Exec ${step.target}: ${stdout.trim()}`);
        }
      }
      resultOutput = stepResults.join('\n');
    }

    // Trigger lifecycle hook for shortcut_run
    void emitHook('shortcut_run', { shortcutId: sc.id, name: sc.name, type: sc.type });

    const audit: ShortcutAudit = {
      id: randomUUID(),
      shortcutId: sc.id,
      name: sc.name,
      type: sc.type,
      status: 'success',
      durationMs: Date.now() - start,
      result: resultOutput,
      timestamp: Date.now(),
    };
    recordAudit(audit);

    return { ok: true, shortcut: sc, output: resultOutput };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const audit: ShortcutAudit = {
      id: randomUUID(),
      shortcutId: sc.id,
      name: sc.name,
      type: sc.type,
      status: 'failed',
      durationMs: Date.now() - start,
      error: errorMsg,
      timestamp: Date.now(),
    };
    recordAudit(audit);

    return { ok: false, shortcut: sc, error: errorMsg };
  }
}

/**
 * HTTP routes for App Shortcuts & Automations.
 */
export function shortcutsRoutes() {
  const app = new Hono();

  // GET /shortcuts
  app.get('/shortcuts', (c) => {
    return c.json(loadShortcuts());
  });

  // POST /shortcuts
  app.post('/shortcuts', async (c) => {
    const body = z
      .object({
        name: z.string().min(1),
        description: z.string().default(''),
        target: z.string().min(1),
        type: z.enum(['app', 'command', 'sequence', 'url']),
        steps: z
          .array(
            z.object({
              action: z.enum(['open_app', 'exec', 'open_url']),
              target: z.string().min(1),
              parameters: z.record(z.string(), z.unknown()).optional(),
            }),
          )
          .optional(),
        hotkey: z.string().optional(),
      })
      .safeParse(await c.req.json().catch(() => null));

    if (!body.success) {
      return c.json({ error: 'Valid shortcut payload required: name, target, type' }, 400);
    }

    const shortcuts = loadShortcuts();
    const newSc: Shortcut = {
      id: `sc_${randomUUID().slice(0, 8)}`,
      name: body.data.name,
      description: body.data.description,
      target: body.data.target,
      type: body.data.type,
      steps: body.data.steps,
      hotkey: body.data.hotkey,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    shortcuts.push(newSc);
    saveShortcuts(shortcuts);
    return c.json(newSc, 201);
  });

  // GET /shortcuts/audit
  app.get('/shortcuts/audit', (c) => {
    return c.json(getShortcutAuditLog());
  });

  // GET /shortcuts/:id
  app.get('/shortcuts/:id', (c) => {
    const sc = loadShortcuts().find((s) => s.id === c.req.param('id'));
    if (!sc) return c.json({ error: 'Shortcut not found' }, 404);
    return c.json(sc);
  });

  // PATCH /shortcuts/:id
  app.patch('/shortcuts/:id', async (c) => {
    const id = c.req.param('id');
    const shortcuts = loadShortcuts();
    const idx = shortcuts.findIndex((s) => s.id === id);
    if (idx === -1) return c.json({ error: 'Shortcut not found' }, 404);

    const body = z
      .object({
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        target: z.string().min(1).optional(),
        type: z.enum(['app', 'command', 'sequence', 'url']).optional(),
        steps: z
          .array(
            z.object({
              action: z.enum(['open_app', 'exec', 'open_url']),
              target: z.string().min(1),
              parameters: z.record(z.string(), z.unknown()).optional(),
            }),
          )
          .optional(),
        hotkey: z.string().optional(),
      })
      .safeParse(await c.req.json().catch(() => null));

    if (!body.success) {
      return c.json({ error: 'Invalid update payload' }, 400);
    }

    shortcuts[idx] = {
      ...shortcuts[idx],
      ...body.data,
      updatedAt: Date.now(),
    };
    saveShortcuts(shortcuts);
    return c.json(shortcuts[idx]);
  });

  // DELETE /shortcuts/:id
  app.delete('/shortcuts/:id', (c) => {
    const id = c.req.param('id');
    const shortcuts = loadShortcuts();
    const filtered = shortcuts.filter((s) => s.id !== id);
    if (filtered.length === shortcuts.length) {
      return c.json({ error: 'Shortcut not found' }, 404);
    }
    saveShortcuts(filtered);
    return c.json({ ok: true, deleted: id });
  });

  // POST /shortcuts/:id/run
  app.post('/shortcuts/:id/run', async (c) => {
    const id = c.req.param('id');
    const result = await runShortcut(id);
    if (!result.ok) {
      return c.json(result, 400);
    }
    return c.json(result);
  });

  return app;
}
