// Computer-use backend: vercel-labs/agent-desktop.
//
// The vendored CLI (vendor/agent-desktop, Apache-2.0, Rust) reads the OS
// accessibility tree (UI Automation on Windows, AX on macOS, AT-SPI on Linux)
// and returns JSON with a stable ref per actionable element. Every command
// prints one JSON envelope and exits.
//
// The binary is NOT built by `npm install`; it is a Cargo project. When it is
// missing this module fails loudly with AGENT_DESKTOP_MISSING and the build
// instructions — it never falls back to another input engine and never captures
// the screen.
import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { aegisRootDir } from './harness.js';
import {
  clearAnnotations,
  publishActAnnotations,
} from './agent-desktop-annotations.js';

const DEFAULT_TIMEOUT_MS = 15_000;

export type AgentDesktopErrorCode =
  | 'AGENT_DESKTOP_MISSING'
  | 'AGENT_DESKTOP_TIMEOUT'
  | 'AGENT_DESKTOP_FAILED'
  | 'AGENT_DESKTOP_BAD_OUTPUT'
  | 'AGENT_DESKTOP_UNSAFE'
  | 'STALE_REF'
  | 'UNKNOWN_REF';

export class AgentDesktopError extends Error {
  code: AgentDesktopErrorCode;
  detail?: string;
  constructor(code: AgentDesktopErrorCode, message: string, detail?: string) {
    super(message);
    this.name = 'AgentDesktopError';
    this.code = code;
    this.detail = detail;
  }
}

const BUILD_HELP =
  'Build it once with: cd vendor/agent-desktop && cargo build --release ' +
  '(needs the Rust toolchain), or install the published CLI with ' +
  '`npm install -g agent-desktop`. Set AGENT_DESKTOP_BIN to an explicit path.';

/** Candidate binary locations, in priority order. */
export function agentDesktopCandidates(): string[] {
  const exe = process.platform === 'win32' ? 'agent-desktop.exe' : 'agent-desktop';
  const packageExe = process.platform === 'win32'
    ? `agent-desktop-${process.platform}-${process.arch}.exe`
    : `agent-desktop-${process.platform}-${process.arch}`;
  const root = aegisRootDir();
  const fromEnv = process.env.AGENT_DESKTOP_BIN?.trim();
  return [
    ...(fromEnv ? [fromEnv] : []),
    join(root, 'apps', 'host', 'node_modules', 'agent-desktop', 'bin', packageExe),
    join(root, 'vendor', 'agent-desktop', 'target', 'release', exe),
    join(root, 'vendor', 'agent-desktop', 'target', 'debug', exe),
    join(root, 'tools-bin', 'agent-desktop', exe),
  ];
}

/** Look for the CLI on PATH without executing anything. */
function findOnPath(exe: string): string | null {
  const raw = process.env.PATH ?? '';
  for (const dir of raw.split(process.platform === 'win32' ? ';' : ':')) {
    const trimmed = dir.trim().replace(/^"|"$/g, '');
    if (!trimmed) continue;
    const candidate = join(trimmed, exe);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function resolveAgentDesktopBinary(): string | null {
  for (const candidate of agentDesktopCandidates()) {
    if (!candidate.includes('/') && !candidate.includes('\\')) return candidate;
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function agentDesktopStatus(): {
  available: boolean;
  binary: string | null;
  error: string | null;
  buildHelp: string;
} {
  const binary = resolveAgentDesktopBinary();
  return {
    available: Boolean(binary),
    binary,
    error: binary ? null : 'agent-desktop binary not built. ' + BUILD_HELP,
    buildHelp: BUILD_HELP,
  };
}

/** Only passive reads and ref-based UIA actions cross this process boundary. */
const ALLOWED_COMMANDS = new Set([
  'snapshot', 'list-apps', 'list-windows', 'status', 'version',
  'find', 'get', 'is', 'click', 'set-value', 'clear', 'select', 'toggle',
  'check', 'uncheck', 'expand', 'collapse', 'scroll', 'scroll-to',
]);

/** Commands that steal focus or inject physical input are refused outright. */
const FOCUS_STEALING_COMMANDS = new Set([
  'type',
  'press',
  'key',
  'focus',
  'focus-window',
  'double-click',
  'right-click',
]);

/** Caller-controlled flags that would widen the adapter's authority. */
const FORBIDDEN_FLAG_PATTERNS: RegExp[] = [
  /^--headed(?:=|$)/,
  /^--force(?:=|$)/,
  /^--session=/,
  /^--agent-id=/,
];

/**
 * Safety boundary for every command sent to the CLI.
 *
 * Observations and semantic accessibility actions are allowed; physical input
 * injection, focus stealing and caller-controlled flags are not, and neither is
 * anything that would write trace/screenshot artifacts of the owner's desktop.
 */
export function validateAgentDesktopRequest(
  command: string,
  args: string[] = [],
): void {
  const name = String(command ?? '').trim().toLowerCase();
  if (!name) throw new AgentDesktopError('AGENT_DESKTOP_UNSAFE', 'A command is required.');
  if (FOCUS_STEALING_COMMANDS.has(name))
    throw new AgentDesktopError(
      'AGENT_DESKTOP_UNSAFE',
      `The ${name} command is disabled because it can take over the owner's desktop.`,
    );
  if (!ALLOWED_COMMANDS.has(name))
    throw new AgentDesktopError(
      'AGENT_DESKTOP_UNSAFE',
      `The ${name} command is not in the Agent Desktop observation and semantic-action allowlist.`,
    );
  for (const arg of args) {
    const value = String(arg);
    if (value === '--trace' || value.startsWith('--trace='))
      throw new AgentDesktopError('AGENT_DESKTOP_UNSAFE', 'The --trace flag is not allowed.');
    if (value === '--screenshot' || value.startsWith('--screenshot='))
      throw new AgentDesktopError('AGENT_DESKTOP_UNSAFE', 'The --screenshot flag is not allowed.');
    if (FORBIDDEN_FLAG_PATTERNS.some((pattern) => pattern.test(value)))
      throw new AgentDesktopError('AGENT_DESKTOP_UNSAFE', `The ${value} flag is not allowed.`);
  }
}

let privateStateHome: string | null = null;

/**
 * Agent Desktop deliberately refuses state directories whose ACL grants to
 * broad groups. Give it a per-user state root and remove inherited broad ACEs
 * instead of weakening its private-file checks.
 */
function agentDesktopEnv(): NodeJS.ProcessEnv {
  if (process.platform !== 'win32' || process.env.AGENT_DESKTOP_HOME?.trim())
    return process.env;
  const localAppData = process.env.LOCALAPPDATA;
  const userDomain = process.env.USERDOMAIN;
  const userName = process.env.USERNAME;
  if (!localAppData || !userName)
    throw new AgentDesktopError(
      'AGENT_DESKTOP_FAILED',
      'Agent Desktop needs a per-user Windows state directory; LOCALAPPDATA or USERNAME is missing.',
    );

  const stateHome = join(localAppData, 'Aegis', 'agent-desktop');
  if (privateStateHome !== stateHome) {
    mkdirSync(stateHome, { recursive: true });
    const principal = userDomain ? `${userDomain}\\${userName}` : userName;
    try {
      execFileSync(
        'icacls.exe',
        [
          stateHome,
          '/inheritance:r',
          '/grant:r',
          `${principal}:(OI)(CI)F`,
          'NT AUTHORITY\\SYSTEM:(OI)(CI)F',
          'BUILTIN\\Administrators:(OI)(CI)F',
        ],
        { windowsHide: true, stdio: 'ignore' },
      );
    } catch (error) {
      throw new AgentDesktopError(
        'AGENT_DESKTOP_FAILED',
        'Could not secure Agent Desktop state directory permissions.',
        error instanceof Error ? error.message : String(error),
      );
    }
    privateStateHome = stateHome;
  }
  return { ...process.env, AGENT_DESKTOP_HOME: stateHome };
}

interface ExecOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

function execJson(
  command: string,
  args: string[],
  { timeoutMs = DEFAULT_TIMEOUT_MS, signal }: ExecOptions = {},
): Promise<Record<string, unknown>> {
  const binary = resolveAgentDesktopBinary();
  if (!binary) {
    return Promise.reject(
      new AgentDesktopError(
        'AGENT_DESKTOP_MISSING',
        'agent-desktop binary not built. ' + BUILD_HELP,
      ),
    );
  }
  return new Promise((resolve, reject) => {
    execFile(
      binary,
      [command, ...args],
      {
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
        signal,
        env: agentDesktopEnv(),
      },
      (error, stdout, stderr) => {
        if (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            reject(
              new AgentDesktopError(
                'AGENT_DESKTOP_MISSING',
                'agent-desktop binary not built. ' + BUILD_HELP,
              ),
            );
            return;
          }
          if ((error as { killed?: boolean }).killed === true) {
            reject(
              new AgentDesktopError(
                'AGENT_DESKTOP_TIMEOUT',
                `agent-desktop ${command} did not answer within ${timeoutMs}ms.`,
              ),
            );
            return;
          }
          const text = (stderr || stdout || error.message || '').trim();
          let parsed: Record<string, unknown> | null = null;
          try {
            parsed = JSON.parse(text) as Record<string, unknown>;
          } catch {
            parsed = null;
          }
          if (parsed) {
            const errorEnvelope = parsed.error && typeof parsed.error === 'object'
              ? parsed.error as Record<string, unknown>
              : undefined;
            const code = String(parsed.code ?? errorEnvelope?.code ?? parsed.error ?? '');
            if (code === 'STALE_REF') {
              reject(
                new AgentDesktopError(
                  'STALE_REF',
                  'That ref belongs to an older snapshot. Take a new snapshot and retry.',
                ),
              );
              return;
            }
          }
          reject(
            new AgentDesktopError(
              'AGENT_DESKTOP_FAILED',
              text.slice(0, 800) || `agent-desktop ${command} failed.`,
            ),
          );
          return;
        }
        const text = stdout.trim();
        try {
          const value = JSON.parse(text) as unknown;
          if (!value || typeof value !== 'object') throw new Error('not an object');
          resolve(value as Record<string, unknown>);
        } catch {
          reject(
            new AgentDesktopError(
              'AGENT_DESKTOP_BAD_OUTPUT',
              'agent-desktop returned output that is not a JSON object.',
              text.slice(0, 400),
            ),
          );
        }
      },
    );
  });
}

/**
 * Run one agent-desktop command and return its JSON envelope.
 *
 * `dotId` scopes the CLI session to the calling Agent (the desktop is shared,
 * but a run's refs are not), and `label` is a human description used only for
 * diagnostics.
 */
export async function runAgentDesktop(
  command: string,
  args: string[] = [],
  dotId?: string,
  label?: string,
  signal?: AbortSignal,
): Promise<unknown> {
  if (args.some((arg) =>
    arg === '--session' || arg === '--agent-id' ||
    arg.startsWith('--session=') || arg.startsWith('--agent-id=')
  )) {
    throw new AgentDesktopError(
      'AGENT_DESKTOP_UNSAFE',
      'Session and subagent identifiers are owned by Aegis and cannot be overridden by a tool call.',
    );
  }
  validateAgentDesktopRequest(command, args);
  const scoped = dotId ? [...args, '--session', dotId] : args;
  void label;
  return execJson(command, scoped, { signal });
}

export interface AgentDesktopElement {
  ref: string;
  role?: string;
  name?: string;
  value?: string;
  enabled?: boolean;
  /** Screen rectangle when the CLI reports one (used for the cursor overlay). */
  frame?: { x: number; y: number; width: number; height: number };
}

export interface AgentDesktopSnapshot {
  sessionId: string;
  generation: number;
  app?: string;
  window?: string;
  elements: AgentDesktopElement[];
}

export type AgentDesktopAction =
  | { kind: 'click'; ref: string }
  | { kind: 'type'; ref: string; text: string }
  | {
      kind: 'scroll';
      direction: 'up' | 'down' | 'left' | 'right';
      amount?: number;
    };

export interface AgentDesktopResult {
  ok: boolean;
  action: AgentDesktopAction;
  target: AgentDesktopElement | null;
  before: AgentDesktopSnapshot;
  after: AgentDesktopSnapshot;
  changed: boolean;
  /** Where the agent's cursor should be drawn, from the element frame. */
  cursor?: { x: number; y: number };
  durationMs: number;
}

function normaliseElements(raw: unknown): AgentDesktopElement[] {
  const elements: AgentDesktopElement[] = [];
  const visit = (items: unknown): void => {
    if (Array.isArray(items)) {
      for (const item of items) visit(item);
      return;
    }
    if (!items || typeof items !== 'object') return;
    const item = items as Record<string, unknown>;
    const nested = item.children ?? item.elements ?? item.nodes;
    if (nested) visit(nested);
    const record = item;
    const ref = typeof record.ref === 'string'
      ? record.ref
      : typeof record.ref_id === 'string'
        ? record.ref_id
        : null;
    if (!ref) return;
    const frame =
      record.frame && typeof record.frame === 'object'
        ? (record.frame as Record<string, unknown>)
        : record.bounds && typeof record.bounds === 'object'
          ? (record.bounds as Record<string, unknown>)
          : null;
    elements.push({
      ref,
      role: typeof record.role === 'string' ? record.role : undefined,
      name: typeof record.name === 'string' ? record.name : undefined,
      value: typeof record.value === 'string' ? record.value : undefined,
      enabled: typeof record.enabled === 'boolean'
        ? record.enabled
        : Array.isArray(record.available_actions)
          ? record.available_actions.length > 0
          : undefined,
      frame:
        frame && typeof frame.x === 'number' && typeof frame.y === 'number'
          ? {
              x: frame.x,
              y: frame.y,
              width: Number(frame.width) || 0,
              height: Number(frame.height) || 0,
            }
          : undefined,
    });
  };
  visit(raw);
  return elements;
}

/**
 * Per-session ref lifetime. A ref is only valid for the snapshot generation
 * that produced it; every action re-snapshots and bumps the generation, so a
 * stale ref is caught instead of being clicked on the wrong element.
 */
interface SessionState {
  generation: number;
  snapshot: AgentDesktopSnapshot | null;
  app?: string;
}

const sessions = new Map<string, SessionState>();

function sessionState(sessionId: string): SessionState {
  let state = sessions.get(sessionId);
  if (!state) {
    state = { generation: 0, snapshot: null };
    sessions.set(sessionId, state);
  }
  return state;
}

export function parseSnapshot(
  sessionId: string,
  body: Record<string, unknown>,
  generation: number,
): AgentDesktopSnapshot {
  const data = body.data && typeof body.data === 'object'
    ? body.data as Record<string, unknown>
    : body;
  const app =
    typeof data.app === 'string'
      ? data.app
      : data.app && typeof data.app === 'object'
        ? ((data.app as Record<string, unknown>).name as string | undefined)
        : undefined;
  return {
    sessionId,
    generation,
    app,
    window: typeof data.window === 'string'
      ? data.window
      : data.window && typeof data.window === 'object'
        ? String((data.window as Record<string, unknown>).title ?? '') || undefined
        : undefined,
    elements: normaliseElements(data.elements ?? data.tree ?? data.nodes),
  };
}

/** Snapshot the accessibility tree for a session. */
export async function snapshot(
  sessionId: string,
  options: { app?: string; timeoutMs?: number } = {},
): Promise<AgentDesktopSnapshot> {
  const state = sessionState(sessionId);
  const body = await execJson(
    'snapshot',
    [
      ...(options.app ? ['--app', options.app] : []),
      '--interactive-only',
      '--include-bounds',
      '--compact',
      '--session',
      sessionId,
    ],
    { timeoutMs: options.timeoutMs },
  );
  state.generation += 1;
  const parsed = parseSnapshot(sessionId, body, state.generation);
  state.snapshot = parsed;
  state.app = options.app ?? parsed.app ?? state.app;
  return parsed;
}

function elementFor(
  value: AgentDesktopSnapshot | null,
  ref: string,
): AgentDesktopElement | null {
  return value?.elements.find((element) => element.ref === ref) ?? null;
}

function snapshotContentSignature(snapshotValue: AgentDesktopSnapshot): string {
  return JSON.stringify(snapshotValue.elements.map(({ role, name, value, enabled, frame }) => [
    role ?? '', name ?? '', value ?? '', enabled ?? null, frame ?? null,
  ]));
}

/**
 * Semantic actions only: typing is `set-value` on a ref (never physical key
 * injection, which the safety boundary refuses), so the owner keeps their focus.
 */
function commandForAction(
  action: AgentDesktopAction,
  sessionId: string,
): { command: string; args: string[] } {
  const session = ['--session', sessionId];
  switch (action.kind) {
    case 'click':
      return { command: 'click', args: [action.ref, ...session] };
    case 'type':
      return { command: 'set-value', args: [action.ref, action.text, ...session] };
    case 'scroll':
      return {
        command: 'scroll',
        args: [
          '--direction',
          action.direction,
          ...(action.amount ? ['--amount', String(action.amount)] : []),
          ...session,
        ],
      };
  }
}

/**
 * Perform one action on a ref and verify it by re-snapshotting.
 * Throws UNKNOWN_REF when the ref is not in the current snapshot.
 */
export async function act(
  sessionId: string,
  action: AgentDesktopAction,
  options: { timeoutMs?: number } = {},
): Promise<AgentDesktopResult> {
  const startedAt = Date.now();
  const state = sessionState(sessionId);
  const before = state.snapshot ?? (await snapshot(sessionId, options));
  const ref = 'ref' in action ? action.ref : undefined;
  if (ref && !elementFor(before, ref)) {
    clearAnnotations(sessionId, 'stale');
    throw new AgentDesktopError(
      'UNKNOWN_REF',
      `Ref ${ref} is not in the current snapshot. Take a new snapshot.`,
    );
  }

  const step = commandForAction(action, sessionId);
  validateAgentDesktopRequest(step.command, step.args);
  await execJson(step.command, step.args, { timeoutMs: options.timeoutMs });

  // Re-snapshot to verify the action actually landed (observe/act/verify).
  const after = await snapshot(sessionId, {
    app: state.app,
    timeoutMs: options.timeoutMs,
  });
  const targetAfter = ref ? elementFor(after, ref) : null;
  const targetBefore = ref ? elementFor(before, ref) : null;
  const frame = targetAfter?.frame ?? targetBefore?.frame;

  const result: AgentDesktopResult = {
    ok: true,
    action,
    target: targetAfter,
    before,
    after,
    changed: snapshotContentSignature(before) !== snapshotContentSignature(after),
    cursor: frame
      ? {
          x: frame.x + Math.round(frame.width / 2),
          y: frame.y + Math.round(frame.height / 2),
        }
      : undefined,
    durationMs: Date.now() - startedAt,
  };
  // Feed the desktop overlay (cursor + marker) from the same result the caller gets.
  publishActAnnotations(result);
  return result;
}

/** Drop a session's refs (called when a run ends). */
export function endSession(sessionId: string): void {
  clearAnnotations(sessionId, 'session-ended');
  sessions.delete(sessionId);
}
