// AEGIS glue (W-HARNESS): the native execution harness.
// One engine: Node / Python / Shell / Tools with explicit approval gates.
// There is no sidecar binary and no external harness port.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { providerChain } from './providers.js';
import type { PlatformConfig } from './platform-config.js';

/** Aegis product root (aegis/), above apps/host/src/server. */
export function aegisRootDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (
      existsSync(join(dir, 'apps', 'host')) &&
      existsSync(join(dir, 'services', 'daemon'))
    )
      return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
}

export function detectPython(): string {
  const root = aegisRootDir();
  const isWindows = process.platform === 'win32';
  const venvPython = isWindows
    ? join(root, 'services', 'daemon', '.venv', 'Scripts', 'python.exe')
    : join(root, 'services', 'daemon', '.venv', 'bin', 'python');
  if (existsSync(venvPython)) return '3.11 (Aegis Daemon venv)';
  return 'Python 3';
}

export function resolvePythonBinary(): string {
  const root = aegisRootDir();
  const isWindows = process.platform === 'win32';
  const venvPython = isWindows
    ? join(root, 'services', 'daemon', '.venv', 'Scripts', 'python.exe')
    : join(root, 'services', 'daemon', '.venv', 'bin', 'python');
  if (existsSync(venvPython)) return venvPython;
  return isWindows ? 'python.exe' : 'python3';
}

export interface HarnessStatus {
  running: boolean;
  engine: 'native';
  version: string | null;
  url: string;
  detail: string | null;
  info: Record<string, unknown> | null;
  runtimes: {
    node: string;
    python: string;
    shell: string;
    tools: string[];
  };
}

/** Health/identity probe for the in-process native engine. */
export async function getHarnessStatus(): Promise<HarnessStatus> {
  const runtimes = {
    node: process.version,
    python: detectPython(),
    shell: process.platform === 'win32' ? 'PowerShell' : 'Bash',
    tools: ['exec', 'node', 'python', 'files', 'browser'],
  };

  return {
    running: true,
    engine: 'native',
    version: '1.0.0-native',
    url: 'local://aegis-native-harness',
    detail:
      'Aegis Native Execution Engine active (Node / Python / Shell / Tools with Approval Gates).',
    info: {
      mode: 'native',
      supervisor: 'Aegis Host Process Supervisor',
      platform: process.platform,
      arch: process.arch,
    },
    runtimes,
  };
}

// ---------------------------------------------------------------------------
// Native Built-in Execution & Approval Gating Engine
// ---------------------------------------------------------------------------

export interface NativeHarnessApproval {
  id: string;
  sessionId: string;
  runtime: 'node' | 'python' | 'shell' | 'tool';
  command: string;
  status: 'pending' | 'approved' | 'rejected';
  reason?: string;
  createdAt: number;
}

export interface NativeHarnessMessage {
  id: string;
  type: 'user' | 'assistant' | 'system' | 'tool';
  text?: string;
  content?: { type: string; text?: string }[];
  createdAt: number;
  approval?: NativeHarnessApproval;
  execution?: {
    runtime: string;
    command: string;
    exitCode: number;
    stdout: string;
    stderr: string;
    durationMs: number;
  };
}

export interface NativeHarnessSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: NativeHarnessMessage[];
  approvals: Map<string, NativeHarnessApproval>;
  /** Provider/model that answered the last conversational prompt. */
  provider?: string;
  model?: string;
}

const nativeSessions = new Map<string, NativeHarnessSession>();

/** Initialize default session if none exist */
function ensureInitialSession() {
  if (nativeSessions.size === 0) {
    const id = 'sess_default_main';
    const session: NativeHarnessSession = {
      id,
      title: 'Native Execution Session',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [
        {
          id: 'msg_welcome',
          type: 'assistant',
          text: `Aegis Native Execution Harness initialized.\n\nBuilt-in execution runtimes:\n- Node.js (${process.version})\n- Python (${detectPython()})\n- Shell (${process.platform === 'win32' ? 'PowerShell' : 'Bash'})\n- Aegis Tools & Workspace Files\n\nSecurity: Execution Approval Gates are active. Code executions and shell modifications require explicit confirmation before running.`,
          createdAt: Date.now(),
        },
      ],
      approvals: new Map(),
    };
    nativeSessions.set(id, session);
  }
}

export function getNativeSessions(): { id: string; title: string; createdAt: number }[] {
  ensureInitialSession();
  return Array.from(nativeSessions.values()).map((s) => ({
    id: s.id,
    title: s.title,
    createdAt: s.createdAt,
  }));
}

export function createNativeSession(title?: string): NativeHarnessSession {
  const id = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const session: NativeHarnessSession = {
    id,
    title: title || `Session ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [
      {
        id: `msg_init_${Date.now()}`,
        type: 'assistant',
        text: `Aegis Native Harness session started.\nReady for built-in command execution (Node, Python, Shell, Tools) with approval gates.`,
        createdAt: Date.now(),
      },
    ],
    approvals: new Map(),
  };
  nativeSessions.set(id, session);
  return session;
}

export function getNativeSession(id: string): NativeHarnessSession | undefined {
  ensureInitialSession();
  return nativeSessions.get(id);
}

export function getNativeSessionMessages(id: string): NativeHarnessMessage[] {
  const session = getNativeSession(id);
  return session ? session.messages : [];
}

/** Parses user input into a target runtime and command */
function parseExecutionIntent(text: string): {
  runtime: 'node' | 'python' | 'shell' | 'tool';
  command: string;
} | null {
  const trimmed = text.trim();

  // Shell prefix: $, !, sh:, bash:, powershell:, cmd:
  const shellMatch = trimmed.match(/^(?:\$|!|sh:|bash:|powershell:|cmd:)\s*(.+)$/is);
  if (shellMatch) {
    return { runtime: 'shell', command: shellMatch[1].trim() };
  }

  // Node prefix: node:, js:
  const nodeMatch = trimmed.match(/^(?:node:|js:)\s*(.+)$/is);
  if (nodeMatch) {
    return { runtime: 'node', command: nodeMatch[1].trim() };
  }

  // Python prefix: python:, py:
  const pyMatch = trimmed.match(/^(?:python:|py:)\s*(.+)$/is);
  if (pyMatch) {
    return { runtime: 'python', command: pyMatch[1].trim() };
  }

  // Tool prefix: tool:
  const toolMatch = trimmed.match(/^tool:\s*(.+)$/is);
  if (toolMatch) {
    return { runtime: 'tool', command: toolMatch[1].trim() };
  }

  // Fenced code blocks
  const codeBlockMatch = trimmed.match(/^```(bash|sh|powershell|shell|javascript|js|node|python|py)?\r?\n([\s\S]+?)```$/i);
  if (codeBlockMatch) {
    const lang = (codeBlockMatch[1] || '').toLowerCase();
    const code = codeBlockMatch[2].trim();
    if (['javascript', 'js', 'node'].includes(lang)) {
      return { runtime: 'node', command: code };
    }
    if (['python', 'py'].includes(lang)) {
      return { runtime: 'python', command: code };
    }
    return { runtime: 'shell', command: code };
  }

  // Common CLI command detection
  const firstWord = trimmed.split(/\s+/)[0]?.toLowerCase();
  const knownCli = [
    'dir',
    'ls',
    'pwd',
    'cat',
    'type',
    'echo',
    'git',
    'npm',
    'pnpm',
    'node',
    'python',
    'pip',
    'curl',
    'whoami',
    'hostname',
  ];
  if (firstWord && knownCli.includes(firstWord)) {
    return { runtime: 'shell', command: trimmed };
  }

  return null;
}

/** Sends a user prompt into a native session and triggers approval if execution is required */
// The harness is a real conversational engine: general prompts go to the
// configured provider (local Ollama in local mode) instead of a canned string.
const NATIVE_TIMEOUT_MS = 90_000;

const NATIVE_SYSTEM_PROMPT = [
  'You are Aegis, a concise desktop assistant running inside the native execution harness.',
  'Answer the owner directly and briefly. Use the conversation so far for context.',
  'You can propose shell/node/python commands, but you cannot run them without approval:',
  'when a command is needed, show it in a fenced block and say it needs approval.',
  'Never claim a command ran or a file changed unless the harness reported it.',
].join(' ');


/**
 * POST JSON without a keep-alive pool. Ollama closes idle HTTP/1.1 sockets,
 * and undici's pooled connection then fails every reuse; `agent: false`
 * gives each attempt a fresh socket and removes that intermittent failure.
 */
function postJson(
  url: string,
  headers: Record<string, string>,
  body: string,
  timeoutMs: number,
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const send = target.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = send(
      target,
      { method: 'POST', headers: { ...headers, 'content-length': Buffer.byteLength(body) }, agent: false },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') }),
        );
      },
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error('model request timed out')));
    req.on('error', reject);
    req.end(body);
  });
}

async function completeConversation(
  config: PlatformConfig | undefined,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
): Promise<{ text: string; provider: string; model: string } | null> {
  const active = config
    ? {
        providerId: config.providerId,
        label: config.providerLabel,
        apiKey: config.apiKey,
        model: config.model,
        baseUrl: config.baseUrl,
        apiType: config.providerApiType,
        keyEnv: config.providerKeyEnv,
      }
    : {
        providerId: process.env.AEGIS_PROVIDER,
        model: process.env.AEGIS_MODEL,
        baseUrl: process.env.OLLAMA_BASE_URL,
        apiKey: process.env.AEGIS_PROVIDER === 'local' ? 'local' : undefined,
      };
  const localMode =
    config?.providerId === 'local' ||
    (!config?.providerId && process.env.AEGIS_PROVIDER === 'local');
  const attempts = localMode
    ? [
        {
          providerId: 'local',
          label: 'Local model',
          apiKey: config?.apiKey ?? 'local',
          model: config?.model ?? process.env.AEGIS_MODEL ?? 'qwen3.5:0.8b',
          baseUrl:
            config?.baseUrl ??
            process.env.OLLAMA_BASE_URL ??
            'http://127.0.0.1:11434/v1',
          apiType: 'openai' as const,
        },
      ]
    : providerChain(process.env, active).filter(
        (attempt) => attempt.apiType !== 'anthropic',
      );
  if (!attempts.length)
    console.warn(
      `[harness] no provider attempts (providerId=${String(
        config?.providerId,
      )}, env=${String(process.env.AEGIS_PROVIDER)}, model=${String(
        config?.model,
      )}, baseUrl=${String(config?.baseUrl)})`,
    );
  for (const attempt of attempts) {
    if (!attempt.model) continue;
    // Ollama can briefly refuse or stall while another model is loading;
    // two short retries keep a single prompt from surfacing as "unavailable".
    for (let tryIndex = 0; tryIndex < 3; tryIndex += 1) {
      try {
        const response = await postJson(
          `${attempt.baseUrl.replace(/\/$/, '')}/chat/completions`,
          {
            'content-type': 'application/json',
            ...(attempt.apiKey
              ? { authorization: `Bearer ${attempt.apiKey}` }
              : {}),
          },
          JSON.stringify({
            model: attempt.model,
            stream: false,
            max_tokens: 2048,
            messages: [
              { role: 'system', content: NATIVE_SYSTEM_PROMPT },
              ...history,
            ],
          }),
          NATIVE_TIMEOUT_MS,
        );
        if (response.status < 200 || response.status >= 300) {
          const detail = response.text;
          console.warn(
            `[harness] ${attempt.providerId} ${response.status}: ${detail.slice(0, 200)}`,
          );
          if (tryIndex < 2) await new Promise((r) => setTimeout(r, 1200));
          continue;
        }
        const data = JSON.parse(response.text) as {
          choices?: Array<{
            message?: {
              content?: unknown;
              reasoning?: unknown;
              reasoning_content?: unknown;
            };
          }>;
        };
        const message = data?.choices?.[0]?.message;
        // Thinking models (qwen3.5 via Ollama) sometimes return an empty
        // `content` and put the whole reply in `reasoning`. Use the last
        // non-empty line of that reasoning instead of failing the request.
        const rawReasoning =
          typeof message?.reasoning === 'string'
            ? message.reasoning
            : typeof message?.reasoning_content === 'string'
              ? message.reasoning_content
              : '';
        const reasoningAnswer = rawReasoning
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .pop();
        const text =
          typeof message?.content === 'string' && message.content.trim()
            ? message.content
            : reasoningAnswer;
        if (typeof text === 'string' && text.trim())
          return {
            text: text.trim(),
            provider: attempt.providerId ?? attempt.label,
            model: attempt.model,
          };
        console.warn(
          `[harness] empty completion: ${response.text.slice(0, 240)}`,
        );
        if (tryIndex < 2) await new Promise((r) => setTimeout(r, 600));
      } catch (error) {
        console.warn(
          `[harness] ${attempt.providerId} request failed: ${String(error).slice(0, 200)}`,
        );
        if (tryIndex < 2) await new Promise((r) => setTimeout(r, 1200));
      }
    }
  }
  return null;
}

export async function sendNativePrompt(
  sessionId: string,
  text: string,
  config?: PlatformConfig,
): Promise<{ success: boolean; messageId: string; approvalId?: string }> {
  let session = getNativeSession(sessionId);
  if (!session) {
    session = createNativeSession();
  }

  const userMsgId = `msg_user_${Date.now()}`;
  session.messages.push({
    id: userMsgId,
    type: 'user',
    text,
    createdAt: Date.now(),
  });
  session.updatedAt = Date.now();

  const intent = parseExecutionIntent(text);

  if (intent) {
    const approvalId = `appr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const approval: NativeHarnessApproval = {
      id: approvalId,
      sessionId: session.id,
      runtime: intent.runtime,
      command: intent.command,
      status: 'pending',
      reason: `Requires approval to execute ${intent.runtime} command in workspace`,
      createdAt: Date.now(),
    };
    session.approvals.set(approvalId, approval);

    const asstMsgId = `msg_asst_${Date.now()}`;
    session.messages.push({
      id: asstMsgId,
      type: 'assistant',
      text: `Approval Required: Request to execute ${intent.runtime.toUpperCase()} command:\n\`\`\`${intent.runtime}\n${intent.command}\n\`\`\`\nPlease approve or reject this execution below.`,
      createdAt: Date.now(),
      approval,
    });

    return { success: true, messageId: asstMsgId, approvalId };
  }

  // General conversational prompt: answer with the configured model.
  const asstMsgId = `msg_asst_${Date.now()}`;
  const history = session.messages
    .filter((message) => message.type === 'user' || message.type === 'assistant')
    .slice(-12)
    .map((message) => ({
      role: message.type === 'user' ? ('user' as const) : ('assistant' as const),
      content: message.text ?? '',
    }));
  // Answer in the background. A cold local model can take 90s per attempt with
  // three attempts, so awaiting it here held the HTTP request open for minutes:
  // the panel looked hung and the request could be cut before the reply existed.
  // Both callers poll the session's messages, so the reply still arrives as soon
  // as the model finishes.
  const replyTo = (completion: Awaited<ReturnType<typeof completeConversation>>) => {
    console.log(
      `[harness] reply path=${completion ? 'model' : 'fallback'} model=${completion?.model ?? 'none'}`,
    );
    const text = completion
      ? completion.text
      : [
          'The language model is unavailable, so I could not answer that.',
          'Check the provider and model in Settings (local mode expects Ollama on',
          `${config?.baseUrl ?? process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434/v1'}).`,
          'You can still run an approved command with `$ <shell>`, `node: <code>` or `python: <code>`.',
        ].join(' ');
    session.messages.push({
      id: asstMsgId,
      type: 'assistant',
      text,
      createdAt: Date.now(),
    });
    if (completion) {
      session.provider = completion.provider;
      session.model = completion.model;
    }
    session.updatedAt = Date.now();
  };

  void completeConversation(config, history)
    .then(replyTo)
    .catch((error: unknown) => {
      console.warn(`[harness] reply failed: ${String(error).slice(0, 200)}`);
      replyTo(null);
    });

  return { success: true, messageId: asstMsgId };
}

/** Handles approval or rejection of a pending native execution */
export async function approveNativeAction(
  sessionId: string,
  approvalId: string,
  approved: boolean,
): Promise<{
  success: boolean;
  status: 'approved' | 'rejected';
  execution?: NativeHarnessMessage['execution'];
}> {
  const session = getNativeSession(sessionId);
  if (!session) throw new Error('Harness session not found.');

  const approval = session.approvals.get(approvalId);
  if (!approval) throw new Error('Pending approval request not found.');

  if (!approved) {
    approval.status = 'rejected';
    session.messages.push({
      id: `msg_rej_${Date.now()}`,
      type: 'assistant',
      text: `Execution of ${approval.runtime} command was rejected by owner.`,
      createdAt: Date.now(),
      approval: { ...approval },
    });
    return { success: true, status: 'rejected' };
  }

  approval.status = 'approved';
  const startTime = Date.now();
  const root = aegisRootDir();
  const isWindows = process.platform === 'win32';

  let bin = '';
  let args: string[] = [];

  switch (approval.runtime) {
    case 'shell':
      if (isWindows) {
        bin = 'powershell.exe';
        args = ['-NoProfile', '-NonInteractive', '-Command', approval.command];
      } else {
        bin = '/bin/bash';
        args = ['-c', approval.command];
      }
      break;
    case 'node':
      bin = process.execPath;
      args = ['-e', approval.command];
      break;
    case 'python':
      bin = resolvePythonBinary();
      args = ['-c', approval.command];
      break;
    case 'tool':
      // A tool request names one of the harness's own runtimes (files, browser,
      // exec) rather than an arbitrary program, so it is reported instead of
      // pretending to have run something. Previously this spawned node to print
      // "Invoked tool: …", which looked like a successful execution in the log
      // while changing nothing at all.
      session.messages.push({
        id: `msg_tool_${Date.now()}`,
        type: 'assistant',
        text: `The tool runtime (${approval.command}) is not wired to a handler yet, so nothing was executed. Use \`$ <shell>\`, \`node: <code>\` or \`python: <code>\` instead.`,
        createdAt: Date.now(),
        approval: { ...approval },
      });
      return { success: true, status: 'approved' };
  }

  const result = await new Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
    durationMs: number;
  }>((res) => {
    let stdout = '';
    let stderr = '';
    let child;
    try {
      child = spawn(bin, args, {
        cwd: root,
        env: { ...process.env, DO_NOT_TRACK: '1' },
        windowsHide: true,
      });
    } catch (err) {
      res({
        exitCode: 1,
        stdout: '',
        stderr: err instanceof Error ? err.message : 'Spawn error',
        durationMs: Date.now() - startTime,
      });
      return;
    }

    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // The process may have exited between the check and the kill.
      }
      res({
        exitCode: 124,
        stdout,
        stderr: stderr + '\nExecution timed out after 30 seconds.',
        durationMs: 30000,
      });
    }, 30000);

    child.stdout.on('data', (d) => {
      stdout += String(d);
    });
    child.stderr.on('data', (d) => {
      stderr += String(d);
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      res({
        exitCode: 1,
        stdout,
        stderr: stderr + '\n' + err.message,
        durationMs: Date.now() - startTime,
      });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      res({
        exitCode: code ?? 0,
        stdout: stdout.slice(0, 50000),
        stderr: stderr.slice(0, 50000),
        durationMs: Date.now() - startTime,
      });
    });
  });

  const execution = {
    runtime: approval.runtime,
    command: approval.command,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    durationMs: result.durationMs,
  };

  const statusLabel =
    result.exitCode === 0
      ? `Command executed successfully in ${result.durationMs}ms:`
      : `Command failed (exit code ${result.exitCode}) in ${result.durationMs}ms:`;

  const outputSummary = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();

  session.messages.push({
    id: `msg_exec_${Date.now()}`,
    type: 'assistant',
    text: `${statusLabel}\n\`\`\`\n${outputSummary || '(No output)'}\n\`\`\``,
    createdAt: Date.now(),
    approval: { ...approval },
    execution,
  });

  return { success: true, status: 'approved', execution };
}

// ---------------------------------------------------------------------------
// Daemon activity & MCP (phase-10 surface)
// ---------------------------------------------------------------------------

export interface DaemonActivity {
  reachable: boolean;
  learnedTools: Record<string, unknown>[];
  forgedLog: Record<string, unknown>[];
  log: Record<string, unknown>[];
  counts: Record<string, unknown> | null;
  detail: string | null;
}

export interface DaemonMcp {
  reachable: boolean;
  servers: unknown;
  tools: unknown;
  detail: string | null;
}

/** The daemon's own MCP client state via /api/mcp/* */
export async function getDaemonMcp(
  env: Record<string, string | undefined> = process.env,
): Promise<DaemonMcp> {
  const base = (
    env.AEGIS_DAEMON_URL?.trim() || 'http://127.0.0.1:8765'
  ).replace(/\/$/, '');
  const get = async (path: string) => {
    const response = await fetch(`${base}${path}`, {
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  };
  try {
    const [servers, tools] = await Promise.all([
      get('/api/mcp/servers'),
      get('/api/mcp/tools'),
    ]);
    return { reachable: true, servers, tools, detail: null };
  } catch (error) {
    return {
      reachable: false,
      servers: null,
      tools: null,
      detail: `Aegis daemon is not reachable at ${base} (${error instanceof Error ? error.message : 'error'}).`,
    };
  }
}

export async function getDaemonActivity(
  env: Record<string, string | undefined> = process.env,
): Promise<DaemonActivity> {
  const base = (
    env.AEGIS_DAEMON_URL?.trim() || 'http://127.0.0.1:8765'
  ).replace(/\/$/, '');
  const get = async (path: string) => {
    const response = await fetch(`${base}${path}`, {
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return (await response.json()) as Record<string, unknown>;
  };
  try {
    const [tools, log, state] = await Promise.all([
      get('/api/tools'),
      get('/api/log?limit=100'),
      get('/api/state'),
    ]);
    const learned = Array.isArray(tools.learned)
      ? (tools.learned as Record<string, unknown>[])
      : [];
    const entries = Array.isArray(log.entries)
      ? (log.entries as Record<string, unknown>[])
      : [];
    return {
      reachable: true,
      learnedTools: learned,
      forgedLog: entries.filter((entry) => entry.forged_from),
      log: entries.slice(-30).reverse(),
      counts:
        state.counts && typeof state.counts === 'object'
          ? (state.counts as Record<string, unknown>)
          : null,
      detail: null,
    };
  } catch (error) {
    return {
      reachable: false,
      learnedTools: [],
      forgedLog: [],
      log: [],
      counts: null,
      detail: `Aegis daemon is not reachable at ${base} (${error instanceof Error ? error.message : 'error'}).`,
    };
  }
}
