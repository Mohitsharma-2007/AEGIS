// AEGIS agent runtime. One task   orchestrator plan   specialist evidence
// gathering   specialist reports   synthesis. Everything here runs on the
// host: the roster uses the owner's configured provider chain, the evidence
// comes from the same live services the UI reads (finance/news connectors,
// workspace pages, memories, computer permissions/audit), and task state is
// persisted under .aegis-data/agent-swarm so restarts do not lose the board.
//
// The native harness (harness.ts) stays the command execution engine. This
// module is the reasoning layer above it: it never claims an action happened
// without evidence from a real service call.

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { chat } from '@tanstack/ai';
import { openaiCompatibleText } from '@tanstack/ai-openai/compatible';
import { ANTHROPIC_MODELS, createAnthropicChat } from '@tanstack/ai-anthropic';
import { aegisRootDir } from './harness.js';
import {
  anthropicSdkBaseUrl,
  probeProvider,
  providerChain,
} from './providers.js';
import { fetchFinanceQuote, fetchNewsArticles } from './research-web.js';
import { log } from './log.js';
import type { Store } from './store.js';
import type { WorkspaceStore } from './workspace.js';
import type { ComputerService } from './computer-service.js';
import type { PlatformConfig } from './platform-config.js';

export const SWARM_AGENT_IDS = [
  'aegis',
  'rfi',
  'security',
  'files',
  'memory',
  'computer',
] as const;
export type SwarmAgentId = (typeof SWARM_AGENT_IDS)[number];

export interface SwarmAgentDefinition {
  id: SwarmAgentId;
  name: string;
  role: string;
  description: string;
  capabilities: string[];
  kind: 'orchestrator' | 'specialist';
}

export const SWARM_ROSTER: SwarmAgentDefinition[] = [
  {
    id: 'aegis',
    name: 'Aegis',
    role: 'Orchestrator',
    description:
      'Plans the task, assigns specialists, and writes the final synthesis.',
    capabilities: ['planning', 'delegation', 'synthesis', 'general reasoning'],
    kind: 'orchestrator',
  },
  {
    id: 'rfi',
    name: 'RFI',
    role: 'Research & Financial Intelligence',
    description:
      'Pulls live market quotes and current news, then turns them into a sourced brief.',
    capabilities: ['finance quotes', 'news search', 'source synthesis'],
    kind: 'specialist',
  },
  {
    id: 'security',
    name: 'Sentinel',
    role: 'Security & Permissions',
    description:
      'Inspects the owner settings, Agent permissions, and the computer audit trail.',
    capabilities: ['permission review', 'audit review', 'risk checks'],
    kind: 'specialist',
  },
  {
    id: 'files',
    name: 'Filo',
    role: 'Files & Documents',
    description:
      'Indexes saved pages and per-conversation documents so work is grounded in real files.',
    capabilities: ['page index', 'document lookup', 'file inventory'],
    kind: 'specialist',
  },
  {
    id: 'memory',
    name: 'Memo',
    role: 'Memory & Context',
    description:
      'Recalls owner memories and recent conversations to keep answers personal and consistent.',
    capabilities: ['memory recall', 'conversation context', 'preferences'],
    kind: 'specialist',
  },
  {
    id: 'computer',
    name: 'Operator',
    role: 'Computer & Browser',
    description:
      'Reports the live computer/browser state, permissions, and recent execution audit.',
    capabilities: ['computer status', 'browser readiness', 'execution audit'],
    kind: 'specialist',
  },
];

export function isSwarmAgentId(value: unknown): value is SwarmAgentId {
  return (
    typeof value === 'string' &&
    (SWARM_AGENT_IDS as readonly string[]).includes(value)
  );
}

export type SwarmTaskStatus =
  | 'queued'
  | 'planning'
  | 'running'
  | 'synthesizing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type SwarmSubtaskStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed';

export interface SwarmEvidence {
  agentId: SwarmAgentId;
  label: string;
  source: string;
  value: string;
  url?: string;
}

export interface SwarmSubtask {
  id: string;
  agentId: SwarmAgentId;
  title: string;
  instruction: string;
  status: SwarmSubtaskStatus;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  evidence: SwarmEvidence[];
  report?: string;
  error?: string;
  /** Absolute path of this specialist's markdown deliverable, when written. */
  artifactPath?: string;
}

export interface SwarmTaskEvent {
  at: number;
  stage:
    | 'queued'
    | 'plan'
    | 'dispatch'
    | 'evidence'
    | 'report'
    | 'handoff'
    | 'synthesis'
    | 'done'
    | 'error'
    | 'cancel';
  agentId: SwarmAgentId | 'system';
  title: string;
  detail?: string;
}

export interface SwarmTask {
  id: string;
  prompt: string;
  title: string;
  dotId: string;
  requestedAgentId?: SwarmAgentId;
  status: SwarmTaskStatus;
  planSource: 'model' | 'heuristic';
  provider?: string;
  model?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  subtasks: SwarmSubtask[];
  synthesis?: string;
  /** Markdown deliverables collected from the specialists during handoff. */
  artifacts?: string[];
  /** The orchestrator's handoff summary (artifact index + failures). */
  handoff?: string;
  error?: string;
  events: SwarmTaskEvent[];
}

export interface SwarmTaskSummary {
  id: string;
  title: string;
  prompt: string;
  dotId: string;
  status: SwarmTaskStatus;
  planSource: 'model' | 'heuristic';
  provider?: string;
  model?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  subtaskCount: number;
  completedSubtasks: number;
  failedSubtasks: number;
  agents: SwarmAgentId[];
  artifactCount?: number;
  error?: string;
}

export interface SwarmPlatform {
  store: Store;
  workspace: WorkspaceStore;
  computers: ComputerService;
  config: PlatformConfig;
}

const MAX_TASKS = 60;
const MAX_SUBTASKS = 4;
const MAX_CONCURRENT = 2;
const LLM_TIMEOUT_MS = 90_000;

function swarmDir(): string {
  const override = process.env.AEGIS_SWARM_DIR?.trim();
  if (override) return override;
  return join(aegisRootDir(), '.aegis-data', 'agent-swarm');
}

function tasksFile(): string {
  return join(swarmDir(), 'tasks.json');
}

function eventsFile(taskId: string): string {
  return join(swarmDir(), 'tasks', `${taskId}.jsonl`);
}

function ensureDir(path: string) {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

function persist(tasks: SwarmTask[]) {
  try {
    ensureDir(swarmDir());
    ensureDir(join(swarmDir(), 'tasks'));
    const tmp = `${tasksFile()}.tmp`;
    writeFileSync(
      tmp,
      JSON.stringify({ version: 1, tasks: tasks.slice(0, MAX_TASKS) }, null, 2),
      'utf8',
    );
    renameSync(tmp, tasksFile());
  } catch (error) {
    log.warn('Agent swarm persistence failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function loadTasks(): SwarmTask[] {
  try {
    const file = tasksFile();
    if (!existsSync(file)) return [];
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as {
      version?: number;
      tasks?: unknown;
    };
    if (parsed.version !== 1 || !Array.isArray(parsed.tasks)) return [];
    const tasks: SwarmTask[] = [];
    for (const item of parsed.tasks) {
      if (!isSwarmTask(item)) continue;
      if (
        item.status === 'queued' ||
        item.status === 'planning' ||
        item.status === 'running' ||
        item.status === 'synthesizing'
      ) {
        item.status = 'failed';
        item.error = 'Interrupted by a host restart. Submit the task again.';
        item.updatedAt = Date.now();
        for (const subtask of item.subtasks) {
          if (subtask.status === 'running') subtask.status = 'failed';
        }
      }
      tasks.push(item);
    }
    return tasks;
  } catch (error) {
    log.warn('Agent swarm task history could not be read', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

function isSwarmTask(value: unknown): value is SwarmTask {
  if (!value || typeof value !== 'object') return false;
  const task = value as Record<string, unknown>;
  return (
    typeof task.id === 'string' &&
    typeof task.prompt === 'string' &&
    typeof task.title === 'string' &&
    typeof task.dotId === 'string' &&
    typeof task.status === 'string' &&
    Array.isArray(task.subtasks) &&
    Array.isArray(task.events)
  );
}

function summarise(task: SwarmTask): SwarmTaskSummary {
  return {
    id: task.id,
    title: task.title,
    prompt: task.prompt,
    dotId: task.dotId,
    status: task.status,
    planSource: task.planSource,
    provider: task.provider,
    model: task.model,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    completedAt: task.completedAt,
    subtaskCount: task.subtasks.length,
    completedSubtasks: task.subtasks.filter((s) => s.status === 'completed')
      .length,
    failedSubtasks: task.subtasks.filter((s) => s.status === 'failed').length,
    agents: [...new Set(task.subtasks.map((s) => s.agentId))],
    artifactCount: task.artifacts?.length ?? 0,
    error: task.error,
  };
}

// ---------------------------------------------------------------------------
// Provider calls
// ---------------------------------------------------------------------------

interface CompletionResult {
  text: string;
  provider: string;
  model: string;
}

function clip(value: string, max = 1200): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)} `;
}

async function complete(
  config: PlatformConfig,
  system: string,
  prompt: string,
  signal: AbortSignal,
): Promise<CompletionResult | null> {
  const attempts = providerChain(process.env, config);
  if (!attempts.length) return null;

  // Try each provider in order until one succeeds. Fallback on any failure
  // (network error, 401, 402, 403, rate limit, timeout, empty response).
  for (const selected of attempts) {
    if (signal.aborted) throw new Error('The task was cancelled.');
    if (!(await probeProvider(selected))) continue;

    const anthropic = selected.apiType === 'anthropic';
    const adapter = anthropic
      ? createAnthropicChat(
          selected.model as (typeof ANTHROPIC_MODELS)[number],
          selected.apiKey,
          {
            baseURL: anthropicSdkBaseUrl(selected.baseUrl),
            maxRetries: 1,
          },
        )
      : openaiCompatibleText(selected.model, {
          apiKey: selected.apiKey,
          baseURL: selected.baseUrl,
          api: 'chat-completions',
          maxRetries: 1,
        });

    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
    try {
      const result = await chat({
        adapter,
        messages: [{ role: 'user', content: prompt }],
        systemPrompts: [system],
        stream: false,
        modelOptions: anthropic
          ? { max_tokens: 1800 }
          : { max_completion_tokens: 1800 },
        abortController: controller,
      });
      const text = typeof result === 'string' ? result.trim() : '';
      if (!text) continue; // try next provider
      return {
        text,
        provider: selected.label,
        model: selected.model,
      };
    } catch (error) {
      log.warn('Agent swarm model call failed, trying next provider', {
        provider: selected.providerId ?? null,
        error: error instanceof Error ? error.message : String(error),
      });
      continue; // try next provider
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

interface PlanSubtask {
  agentId: SwarmAgentId;
  title: string;
  instruction: string;
}

interface Plan {
  title: string;
  subtasks: PlanSubtask[];
}

const planSchema = z.object({
  title: z.string().trim().min(1).max(140),
  subtasks: z
    .array(
      z.object({
        agentId: z.string().trim().min(1),
        title: z.string().trim().min(1).max(120),
        instruction: z.string().trim().min(1).max(1200),
      }),
    )
    .min(1)
    .max(MAX_SUBTASKS),
});

const FINANCE_NAMES: Record<string, string> = {
  apple: 'AAPL',
  microsoft: 'MSFT',
  nvidia: 'NVDA',
  tesla: 'TSLA',
  amazon: 'AMZN',
  google: 'GOOGL',
  alphabet: 'GOOGL',
  meta: 'META',
  netflix: 'NFLX',
  bitcoin: 'BTC-USD',
  ethereum: 'ETH-USD',
  reliance: 'RELIANCE.NS',
  infosys: 'INFY.NS',
  tcs: 'TCS.NS',
  hdfc: 'HDFCBANK.NS',
  sensex: '^BSESN',
  nifty: '^NSEI',
  's&p': '^GSPC',
};

const FINANCE_INTENT =
  /\b(stock|share|market|ticker|portfolio|invest|valuation|price|earnings|revenue|nifty|sensex|nasdaq|crypto|bitcoin|ethereum)\b/i;
const NEWS_INTENT = /\b(news|latest|today|headline|current|update|announce)\b/i;
const SECURITY_INTENT =
  /\b(security|secure|permission|audit|risk|safe|privacy|approval|policy)\b/i;
const FILES_INTENT =
  /\b(file|document|page|pages|report|pdf|folder|doc|workspace|notes?)\b/i;
const MEMORY_INTENT =
  /\b(remember|memory|recall|preference|prefer|earlier|before|context|profile)\b/i;
const COMPUTER_INTENT =
  /\b(computer|browser|screen|desktop|click|website|web page|open app)\b/i;

function fallbackTitle(prompt: string): string {
  const clean = prompt.replace(/\s+/g, ' ').trim();
  if (!clean) return 'Agent task';
  return clean.length > 90 ? `${clean.slice(0, 87)} ` : clean;
}

function heuristicPlan(prompt: string, forced?: SwarmAgentId): Plan {
  if (forced) {
    return {
      title: fallbackTitle(prompt),
      subtasks: [
        {
          agentId: forced,
          title: `${SWARM_ROSTER.find((agent) => agent.id === forced)?.name ?? forced} handles the request`,
          instruction: prompt,
        },
      ],
    };
  }
  const assigned: SwarmAgentId[] = [];
  if (FINANCE_INTENT.test(prompt) || NEWS_INTENT.test(prompt)) assigned.push('rfi');
  if (SECURITY_INTENT.test(prompt)) assigned.push('security');
  if (FILES_INTENT.test(prompt)) assigned.push('files');
  if (MEMORY_INTENT.test(prompt)) assigned.push('memory');
  if (COMPUTER_INTENT.test(prompt)) assigned.push('computer');
  if (!assigned.length) assigned.push('aegis');
  return {
    title: fallbackTitle(prompt),
    subtasks: assigned.slice(0, MAX_SUBTASKS).map((agentId) => ({
      agentId,
      title:
        SWARM_ROSTER.find((agent) => agent.id === agentId)?.role ??
        'Specialist review',
      instruction: prompt,
    })),
  };
}

function parsePlan(text: string): Plan | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = planSchema.parse(JSON.parse(text.slice(start, end + 1)));
    const subtasks = parsed.subtasks
      .filter((subtask) => isSwarmAgentId(subtask.agentId))
      .map((subtask) => ({
        agentId: subtask.agentId as SwarmAgentId,
        title: subtask.title,
        instruction: subtask.instruction,
      }));
    if (!subtasks.length) return null;
    return { title: parsed.title, subtasks: subtasks.slice(0, MAX_SUBTASKS) };
  } catch {
    return null;
  }
}

async function planTask(
  config: PlatformConfig,
  prompt: string,
  forced: SwarmAgentId | undefined,
  signal: AbortSignal,
  onProvider: (provider: string, model: string) => void,
): Promise<{ plan: Plan; source: 'model' | 'heuristic' }> {
  if (forced) return { plan: heuristicPlan(prompt, forced), source: 'heuristic' };
  const roster = SWARM_ROSTER.filter((agent) => agent.id !== 'aegis')
    .map(
      (agent) =>
        `- ${agent.id}: ${agent.name}, ${agent.role}. ${agent.description}`,
    )
    .join('\n');
  const system = [
    'You are Aegis, the orchestrator of a local agent team.',
    'Break the owner request into at most 4 concrete subtasks, each owned by one specialist.',
    'Only use the specialist ids listed. Do not invent tools or claim actions.',
    'Return strict JSON only, with this shape:',
    '{"title":"short task title","subtasks":[{"agentId":"rfi","title":"short subtitle","instruction":"what that specialist must do"}]}',
  ].join(' ');
  const user = [
    `Owner request: ${prompt}`,
    '',
    'Specialists:',
    roster,
    '',
    `Today is ${new Date().toISOString().slice(0, 10)}.`,
  ].join('\n');
  const result = await complete(config, system, user, signal);
  if (result) {
    onProvider(result.provider, result.model);
    const plan = parsePlan(result.text);
    if (plan) return { plan, source: 'model' };
  }
  return { plan: heuristicPlan(prompt), source: 'heuristic' };
}

// ---------------------------------------------------------------------------
// Evidence gathering   every item below comes from a live service read.
// ---------------------------------------------------------------------------

function detectSymbols(prompt: string): string[] {
  const symbols = new Set<string>();
  for (const match of prompt.matchAll(/\$([A-Za-z]{1,6}(?:\.[A-Za-z]{1,4})?)/g)) {
    symbols.add(match[1].toUpperCase());
  }
  for (const match of prompt.matchAll(
    /\b(?:ticker|symbol)\s*[:=]?\s*\$?([A-Za-z.]{1,10})\b/gi,
  )) {
    symbols.add(match[1].toUpperCase());
  }
  const lower = prompt.toLowerCase();
  for (const [name, symbol] of Object.entries(FINANCE_NAMES)) {
    if (lower.includes(name)) symbols.add(symbol);
  }
  return [...symbols].slice(0, 3);
}

async function rfiEvidence(
  prompt: string,
): Promise<SwarmEvidence[]> {
  const evidence: SwarmEvidence[] = [];
  const symbols = detectSymbols(prompt);
  for (const symbol of symbols) {
    try {
      const quote = await fetchFinanceQuote(symbol);
      const direction =
        quote.price !== null && quote.previousClose !== null
          ? quote.price >= quote.previousClose
            ? 'up'
            : 'down'
          : 'flat/unknown';
      evidence.push({
        agentId: 'rfi',
        label: `${quote.symbol} ${quote.name}`,
        source: 'Yahoo Finance chart API',
        value: [
          `Price: ${quote.price ?? 'n/a'} ${quote.currency}`.trim(),
          `Previous close: ${quote.previousClose ?? 'n/a'}`,
          `Day range: ${quote.dayLow ?? 'n/a'}   ${quote.dayHigh ?? 'n/a'}`,
          `Session direction: ${direction}`,
          `Exchange: ${quote.exchange || 'n/a'}`,
          `Fetched: ${quote.updatedAt}`,
        ].join('\n'),
        url: `https://finance.yahoo.com/quote/${encodeURIComponent(quote.symbol)}`,
      });
    } catch (error) {
      evidence.push({
        agentId: 'rfi',
        label: `${symbol} quote unavailable`,
        source: 'Yahoo Finance chart API',
        value:
          error instanceof Error ? error.message : 'The quote request failed.',
      });
    }
  }

  const newsQuery = prompt.replace(/\s+/g, ' ').trim().slice(0, 180);
  if (newsQuery) {
    try {
      const articles = await fetchNewsArticles(newsQuery);
      if (!articles.length) {
        evidence.push({
          agentId: 'rfi',
          label: 'News search',
          source: 'Google News RSS',
          value: `No articles returned for  ${newsQuery} .`,
        });
      }
      for (const article of articles.slice(0, 6)) {
        evidence.push({
          agentId: 'rfi',
          label: clip(article.title, 160),
          source: article.source || 'Google News RSS',
          value: [article.time, article.title].filter(Boolean).join('   '),
          url: article.url,
        });
      }
    } catch (error) {
      evidence.push({
        agentId: 'rfi',
        label: 'News search unavailable',
        source: 'Google News RSS',
        value:
          error instanceof Error ? error.message : 'The news request failed.',
      });
    }
  }
  return evidence;
}

function securityEvidence(
  platform: SwarmPlatform,
  dotId: string,
): SwarmEvidence[] {
  const evidence: SwarmEvidence[] = [];
  const settings = platform.store.settings();
  evidence.push({
    agentId: 'security',
    label: 'Owner controls',
    source: 'Aegis settings store',
    value: [
      `Paused: ${settings.paused}`,
      `Research allowed: ${settings.researchAllowed}`,
      `Memory allowed: ${settings.memoryAllowed}`,
      `Apps allowed: ${settings.appsAllowed}`,
      `Developer options: ${settings.developerOptionsEnabled}`,
    ].join('\n'),
  });
  const permissions = platform.workspace.computers.permissions(dotId);
  evidence.push({
    agentId: 'security',
    label: 'Computer permissions',
    source: 'Computer permission store',
    value: [
      `Enabled: ${permissions.enabled}`,
      `Browser: ${permissions.browser}`,
      `Files: ${permissions.files}`,
      `Shell: ${permissions.shell}`,
    ].join('\n'),
  });
  const audit = platform.workspace.computers.audit(dotId);
  evidence.push({
    agentId: 'security',
    label: 'Computer audit trail',
    source: 'Computer audit store',
    value: audit.length
      ? audit
          .slice(0, 6)
          .map(
            (entry) =>
              `${new Date(entry.createdAt).toISOString()} ${entry.actor} ${entry.action}   ${entry.outcome}`,
          )
          .join('\n')
      : 'No computer audit entries for this Agent.',
  });
  const dots = platform.workspace.dots();
  evidence.push({
    agentId: 'security',
    label: 'Agent roster',
    source: 'Workspace store',
    value: `${dots.length} Agent(s): ${dots.map((dot) => dot.name).join(', ')}`,
  });
  return evidence;
}

function filesEvidence(platform: SwarmPlatform): SwarmEvidence[] {
  const conversations = platform.workspace.conversations();
  const pages: Array<{ title: string; thread: string; updatedAt: number }> = [];
  for (const conversation of conversations) {
    try {
      for (const page of platform.workspace.pages.listByThread(conversation.id)) {
        pages.push({
          title: page.title,
          thread: conversation.title,
          updatedAt: page.updatedAt,
        });
      }
    } catch {
      // A conversation without pages is normal.
    }
  }
  pages.sort((a, b) => b.updatedAt - a.updatedAt);
  const evidence: SwarmEvidence[] = [
    {
      agentId: 'files',
      label: 'Workspace index',
      source: 'Page + conversation stores',
      value: `${conversations.length} conversation(s), ${pages.length} saved page(s).`,
    },
  ];
  if (pages.length) {
    evidence.push({
      agentId: 'files',
      label: 'Recent saved pages',
      source: 'Page store',
      value: pages
        .slice(0, 10)
        .map(
          (page) =>
            `${new Date(page.updatedAt).toISOString().slice(0, 10)}   ${page.title} (${page.thread})`,
        )
        .join('\n'),
    });
  } else {
    evidence.push({
      agentId: 'files',
      label: 'Recent saved pages',
      source: 'Page store',
      value: 'No saved pages yet. The Files surface will list pages as Agents create them.',
    });
  }
  return evidence;
}

function memoryEvidence(platform: SwarmPlatform): SwarmEvidence[] {
  const memories = platform.store.memories();
  const conversations = platform.workspace.conversations();
  const evidence: SwarmEvidence[] = [
    {
      agentId: 'memory',
      label: 'Stored memories',
      source: 'Memory store',
      value: memories.length
        ? memories
            .slice(0, 12)
            .map(
              (memory) =>
                `${new Date(memory.createdAt).toISOString().slice(0, 10)}   ${clip(memory.text, 220)}`,
            )
            .join('\n')
        : 'No stored memories yet.',
    },
    {
      agentId: 'memory',
      label: 'Recent conversations',
      source: 'Workspace store',
      value: conversations.length
        ? conversations
            .slice(0, 8)
            .map(
              (conversation) =>
                `${new Date(conversation.createdAt).toISOString().slice(0, 10)}   ${conversation.title}`,
            )
            .join('\n')
        : 'No conversations yet.',
    },
  ];
  return evidence;
}

async function computerEvidence(
  platform: SwarmPlatform,
  dotId: string,
): Promise<SwarmEvidence[]> {
  try {
    const status = await platform.computers.status(dotId);
    const permissions = status.permissions;
    return [
      {
        agentId: 'computer',
        label: 'Computer state',
        source: 'Computer service',
        value: [
          `State: ${status.state}`,
          `Configured: ${status.configured}`,
          `Permissions: browser=${permissions.browser}, files=${permissions.files}, shell=${permissions.shell}, enabled=${permissions.enabled}`,
          'browserBinary' in status && status.browserBinary
            ? `Browser binary: ${status.browserBinary}`
            : 'Browser binary: not reported',
        ].join('\n'),
      },
      {
        agentId: 'computer',
        label: 'Browser service',
        source: 'Aegis browser config',
        value: `Browser URL: ${platform.config.browserUrl ?? 'not configured'}; engine: ${platform.config.browserEngine ?? 'playwright'}.`,
      },
    ];
  } catch (error) {
    return [
      {
        agentId: 'computer',
        label: 'Computer status unavailable',
        source: 'Computer service',
        value:
          error instanceof Error ? error.message : 'The status request failed.',
      },
    ];
  }
}

async function gatherEvidence(
  platform: SwarmPlatform,
  task: SwarmTask,
  subtask: SwarmSubtask,
): Promise<SwarmEvidence[]> {
  switch (subtask.agentId) {
    case 'rfi':
      return rfiEvidence(task.prompt);
    case 'security':
      return securityEvidence(platform, task.dotId);
    case 'files':
      return filesEvidence(platform);
    case 'memory':
      return memoryEvidence(platform);
    case 'computer':
      return computerEvidence(platform, task.dotId);
    case 'aegis':
      return [
        ...memoryEvidence(platform).slice(1),
        ...filesEvidence(platform).slice(0, 1),
      ];
  }
}

// ---------------------------------------------------------------------------
// Reports and synthesis
// ---------------------------------------------------------------------------

function evidenceBlock(evidence: SwarmEvidence[]): string {
  return evidence
    .map(
      (item, index) =>
        `[${index + 1}] ${item.label} (${item.source})\n${item.value}${item.url ? `\nURL: ${item.url}` : ''}`,
    )
    .join('\n\n');
}

function fallbackReport(
  subtask: SwarmSubtask,
  evidence: SwarmEvidence[],
): string {
  const agent =
    SWARM_ROSTER.find((entry) => entry.id === subtask.agentId)?.name ??
    subtask.agentId;
  const lines = [
    `${agent} evidence summary (model unavailable, no text was generated).`,
    '',
  ];
  if (!evidence.length) {
    lines.push('No evidence was returned by the connected services.');
  } else {
    for (const item of evidence.slice(0, 10)) {
      lines.push(`- ${item.label}   ${item.source}: ${clip(item.value, 320)}`);
    }
  }
  return lines.join('\n');
}

function fallbackSynthesis(task: SwarmTask): string {
  const sections = task.subtasks.map((subtask) => {
    const agent =
      SWARM_ROSTER.find((entry) => entry.id === subtask.agentId)?.name ??
      subtask.agentId;
    return `### ${agent}   ${subtask.title}\n${subtask.report ?? subtask.error ?? 'No report produced.'}`;
  });
  return [
    'Model synthesis was unavailable, so this is the combined specialist output. Every finding below came from a live service read.',
    '',
    ...sections,
  ].join('\n');
}

/** One file name per specialist deliverable: stable, ordered, readable. */
function artifactFileName(subtask: SwarmSubtask, index: number): string {
  const slug = subtask.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${String(index + 1).padStart(2, '0')}-${subtask.agentId}-${slug || 'report'}.md`;
}

/**
 * Write one specialist's markdown deliverable into the task's run directory.
 *
 * Returns the absolute path, or null when there is nothing to write (the
 * specialist failed or produced no report) or the write failed. Artifact
 * problems never fail the run: the report still reaches the orchestrator.
 */
export function writeSubtaskArtifact(
  task: SwarmTask,
  subtask: SwarmSubtask,
  index: number,
): string | null {
  if (subtask.status !== 'completed' || !subtask.report?.trim()) {
    subtask.artifactPath = undefined;
    return null;
  }
  const agent =
    SWARM_ROSTER.find((entry) => entry.id === subtask.agentId)?.name ??
    subtask.agentId;
  const dir = join(swarmDir(), task.id);
  const file = join(dir, artifactFileName(subtask, index));
  const tmp = `${file}.tmp`;
  const body = [
    `# ${subtask.title}`,
    '',
    `- Agent: ${agent} (${subtask.agentId})`,
    `- Task: ${task.title}`,
    `- Owner request: ${task.prompt}`,
    `- Written: ${new Date().toISOString()}`,
    '',
    '## Report',
    '',
    subtask.report.trim(),
    '',
    '## Evidence',
    '',
    subtask.evidence.length
      ? subtask.evidence
          .map(
            (item, i) =>
              `${i + 1}. ${item.label} — ${item.source}${item.url ? ` (${item.url})` : ''}`,
          )
          .join('\n')
      : 'No evidence was returned by the connected services.',
    '',
  ].join('\n');
  try {
    ensureDir(dir);
    writeFileSync(tmp, body, 'utf8');
    renameSync(tmp, file);
    subtask.artifactPath = file;
    return file;
  } catch (error) {
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {
      // the temp file is already gone
    }
    log.warn('Agent swarm artifact write failed', {
      agent: subtask.agentId,
      error: error instanceof Error ? error.message : String(error),
    });
    subtask.artifactPath = undefined;
    return null;
  }
}

/** The orchestrator's handoff summary: every deliverable plus any gaps. */
export function swarmHandoffMarkdown(task: SwarmTask): string {
  const artifacts = task.subtasks.filter((subtask) => subtask.artifactPath);
  const failed = task.subtasks.filter((subtask) => subtask.status === 'failed');
  const lines = ['## Specialist artifacts', ''];
  if (artifacts.length) {
    for (const subtask of artifacts) {
      const agent =
        SWARM_ROSTER.find((entry) => entry.id === subtask.agentId)?.name ??
        subtask.agentId;
      lines.push(
        `- ${agent} (${subtask.agentId}) — ${subtask.title}: \`${relative(aegisRootDir(), subtask.artifactPath as string)}\``,
      );
    }
  } else {
    lines.push('- No artifact files were produced for this run.');
  }
  if (failed.length) {
    lines.push('', '## Specialists without a deliverable', '');
    for (const subtask of failed) {
      const agent =
        SWARM_ROSTER.find((entry) => entry.id === subtask.agentId)?.name ??
        subtask.agentId;
      lines.push(`- ${agent} (${subtask.agentId}): ${subtask.error ?? 'failed'}`);
    }
  }
  return lines.join('\n');
}

/** Final orchestrator reply: the synthesis followed by the artifact index. */
export function assembleFinalReply(synthesis: string, handoff: string): string {
  return `${synthesis.trim()}

${handoff}`.trim();
}

/**
 * Handoff step: collect every specialist's deliverable into the run directory,
 * record the paths on the task, and return the summary the orchestrator adds to
 * its final reply. Missing/failed artifacts are reported, never fatal.
 */
export function finalizeSwarmRun(task: SwarmTask): string {
  const artifacts: string[] = [];
  task.subtasks.forEach((subtask, index) => {
    const written = writeSubtaskArtifact(task, subtask, index);
    if (written) artifacts.push(written);
  });
  task.artifacts = artifacts;
  task.handoff = swarmHandoffMarkdown(task);
  return task.handoff;
}

async function runSpecialist(
  platform: SwarmPlatform,
  task: SwarmTask,
  subtask: SwarmSubtask,
  signal: AbortSignal,
  onProvider: (provider: string, model: string) => void,
  emit: (event: Omit<SwarmTaskEvent, 'at'>) => void,
): Promise<void> {
  subtask.status = 'running';
  subtask.startedAt = Date.now();
  emit({
    stage: 'dispatch',
    agentId: subtask.agentId,
    title: `${SWARM_ROSTER.find((agent) => agent.id === subtask.agentId)?.name ?? subtask.agentId} started`,
    detail: subtask.instruction,
  });

  let evidence: SwarmEvidence[];
  try {
    evidence = await gatherEvidence(platform, task, subtask);
  } catch (error) {
    evidence = [
      {
        agentId: subtask.agentId,
        label: 'Evidence gathering failed',
        source: 'Aegis host',
        value:
          error instanceof Error ? error.message : 'The service call failed.',
      },
    ];
  }
  subtask.evidence = evidence;
  if (subtask.agentId === 'computer') {
    const appMatch = task.prompt.match(/\bopen\s+(whatsapp|calculator|calc|notepad|explorer|paint|terminal|settings|edge|chrome)\b/i);
    if (appMatch) {
      const appName = appMatch[1].toLowerCase();
      try {
        // Auto-start the computer if it is stopped.
        try {
          const status = await platform.computers.status(task.dotId);
          if (status.state !== 'running') await platform.computers.start(task.dotId);
        } catch (e) {
          evidence.push({
            agentId: 'computer',
            label: 'Auto-start failed',
            source: 'Aegis computer',
            value: e instanceof Error ? e.message : String(e),
          });
          subtask.evidence = evidence;
        }
        const result = await platform.computers.action(task.dotId, 'open_app', { app: appName });
        evidence.push({
          agentId: 'computer',
          label: `Opened ${appName}`,
          source: 'Aegis computer',
          value: JSON.stringify(result).slice(0, 300),
        });
        subtask.evidence = evidence;
        emit({
          stage: 'dispatch',
          agentId: 'computer',
          title: `Opened ${appName}`,
          detail: 'Launched via the Aegis computer service.',
        });
      } catch (error) {
        evidence.push({
          agentId: 'computer',
          label: `Failed to open ${appName}`,
          source: 'Aegis computer',
          value: error instanceof Error ? error.message : String(error),
        });
        subtask.evidence = evidence;
      }
    }
  }
  emit({
    stage: 'evidence',
    agentId: subtask.agentId,
    title: `${evidence.length} evidence item(s) collected`,
    detail: evidence
      .map((item) => `${item.label} (${item.source})`)
      .slice(0, 8)
      .join('; '),
  });

  const definition =
    SWARM_ROSTER.find((agent) => agent.id === subtask.agentId) ??
    SWARM_ROSTER[0];
  const system = [
    `You are ${definition.name}, the ${definition.role} specialist inside Aegis, a local-first owner-controlled agent.`,
    'Answer from the supplied evidence only. Never invent prices, news, files, permissions, or actions.',
    'If evidence is missing, unavailable, or a fetch failed, say so plainly.',
    'Return a compact report: 3-6 bullet findings followed by one recommendation line. Maximum 220 words.',
  ].join(' ');
  const user = [
    `Owner request: ${task.prompt}`,
    `Your assignment: ${subtask.instruction}`,
    '',
    'Evidence:',
    evidenceBlock(evidence) || 'No evidence was returned.',
  ].join('\n');

  const result = await complete(platform.config, system, user, signal);
  if (signal.aborted) throw new Error('The task was cancelled.');
  if (result) {
    onProvider(result.provider, result.model);
    subtask.report = result.text;
  } else {
    subtask.report = fallbackReport(subtask, evidence);
  }
  subtask.status = 'completed';
  subtask.completedAt = Date.now();
  emit({
    stage: 'report',
    agentId: subtask.agentId,
    title: `${definition.name} reported`,
    detail: clip(subtask.report, 500),
  });
}

// ---------------------------------------------------------------------------
// Swarm manager
// ---------------------------------------------------------------------------

export class AgentSwarm {
  private tasks = new Map<string, SwarmTask>();
  private controllers = new Map<string, AbortController>();
  private queue: string[] = [];
  private running = 0;
  private loaded = false;

  constructor(private platform: SwarmPlatform) {}

  private ensureLoaded() {
    if (this.loaded) return;
    this.loaded = true;
    for (const task of loadTasks()) this.tasks.set(task.id, task);
  }

  roster() {
    return SWARM_ROSTER.map((agent) => ({
      ...agent,
      model: this.platform.config.model ?? null,
      provider: this.platform.config.providerLabel ?? null,
    }));
  }

  activeProvider() {
    return {
      providerId: this.platform.config.providerId ?? null,
      provider: this.platform.config.providerLabel ?? null,
      model: this.platform.config.model ?? null,
      configured: Boolean(this.platform.config.apiKey && this.platform.config.model),
      running: this.running,
      queued: this.queue.length,
    };
  }

  list(): SwarmTaskSummary[] {
    this.ensureLoaded();
    return [...this.tasks.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(summarise);
  }

  get(id: string): SwarmTask | undefined {
    this.ensureLoaded();
    return this.tasks.get(id);
  }

  create(prompt: string, dotId: string, agentId?: SwarmAgentId): SwarmTask {
    this.ensureLoaded();
    const now = Date.now();
    const task: SwarmTask = {
      id: randomUUID(),
      prompt,
      title: fallbackTitle(prompt),
      dotId,
      requestedAgentId: agentId,
      status: 'queued',
      planSource: 'heuristic',
      createdAt: now,
      updatedAt: now,
      subtasks: [],
      events: [],
    };
    this.tasks.set(task.id, task);
    this.trim();
    this.emit(task, {
      stage: 'queued',
      agentId: 'system',
      title: agentId
        ? `Queued for ${SWARM_ROSTER.find((entry) => entry.id === agentId)?.name ?? agentId}`
        : 'Queued for orchestration',
    });
    this.persist();
    this.queue.push(task.id);
    this.controllers.set(task.id, new AbortController());
    this.pump();
    return task;
  }

  cancel(id: string): SwarmTask | undefined {
    this.ensureLoaded();
    const task = this.tasks.get(id);
    if (!task) return undefined;
    if (
      task.status === 'completed' ||
      task.status === 'failed' ||
      task.status === 'cancelled'
    )
      return task;
    task.status = 'cancelled';
    task.completedAt = Date.now();
    task.updatedAt = Date.now();
    task.error = 'Cancelled by the owner.';
    for (const subtask of task.subtasks) {
      if (subtask.status === 'pending' || subtask.status === 'running')
        subtask.status = 'failed';
    }
    this.emit(task, {
      stage: 'cancel',
      agentId: 'system',
      title: 'Task cancelled',
    });
    this.controllers.get(id)?.abort();
    this.queue = this.queue.filter((queued) => queued !== id);
    this.persist();
    return task;
  }

  private trim() {
    if (this.tasks.size <= MAX_TASKS) return;
    const ordered = [...this.tasks.values()].sort(
      (a, b) => a.createdAt - b.createdAt,
    );
    while (ordered.length > MAX_TASKS) {
      const oldest = ordered.shift();
      if (!oldest) break;
      if (oldest.status === 'running' || oldest.status === 'planning') {
        ordered.push(oldest);
        break;
      }
      this.tasks.delete(oldest.id);
    }
  }

  private persist() {
    persist([...this.tasks.values()].sort((a, b) => b.createdAt - a.createdAt));
  }

  private emit(task: SwarmTask, event: Omit<SwarmTaskEvent, 'at'>) {
    const full: SwarmTaskEvent = { ...event, at: Date.now() };
    task.events.push(full);
    if (task.events.length > 400) task.events.splice(0, task.events.length - 400);
    task.updatedAt = full.at;
    try {
      ensureDir(join(swarmDir(), 'tasks'));
      appendFileSync(eventsFile(task.id), `${JSON.stringify(full)}\n`, 'utf8');
    } catch {
      // Event history is diagnostic; losing a line must not fail the task.
    }
  }

  private pump() {
    while (this.running < MAX_CONCURRENT && this.queue.length) {
      const id = this.queue.shift();
      if (!id) return;
      const task = this.tasks.get(id);
      if (!task || task.status !== 'queued') continue;
      this.running += 1;
      void this.execute(task).finally(() => {
        this.running -= 1;
        this.pump();
      });
    }
  }

  private async execute(task: SwarmTask): Promise<void> {
    const controller = this.controllers.get(task.id) ?? new AbortController();
    this.controllers.set(task.id, controller);
    const signal = controller.signal;
    try {
      task.status = 'planning';
      task.updatedAt = Date.now();
      this.emit(task, {
        stage: 'plan',
        agentId: 'aegis',
        title: 'Aegis is planning the task',
      });
      this.persist();

      const { plan, source } = await planTask(
        this.platform.config,
        task.prompt,
        task.requestedAgentId,
        signal,
        (provider, model) => {
          task.provider = provider;
          task.model = model;
        },
      );
      if (signal.aborted) return;
      task.planSource = source;
      task.title = plan.title;
      task.subtasks = plan.subtasks.map((subtask) => ({
        id: randomUUID(),
        agentId: subtask.agentId,
        title: subtask.title,
        instruction: subtask.instruction,
        status: 'pending',
        createdAt: Date.now(),
        evidence: [],
      }));
      task.status = 'running';
      this.emit(task, {
        stage: 'plan',
        agentId: 'aegis',
        title: `Plan ready: ${plan.subtasks.length} specialist(s)`,
        detail: plan.subtasks
          .map((subtask) => `${subtask.agentId}: ${subtask.title}`)
          .join('; '),
      });
      this.persist();

      for (const subtask of task.subtasks) {
        if (signal.aborted) return;
        try {
          await runSpecialist(
            this.platform,
            task,
            subtask,
            signal,
            (provider, model) => {
              task.provider = provider;
              task.model = model;
            },
            (event) => this.emit(task, event),
          );
        } catch (error) {
          if (signal.aborted) return;
          subtask.status = 'failed';
          subtask.error =
            error instanceof Error ? error.message : 'Specialist run failed.';
          subtask.completedAt = Date.now();
          this.emit(task, {
            stage: 'error',
            agentId: subtask.agentId,
            title: 'Specialist failed',
            detail: subtask.error,
          });
        }
        this.persist();
      }
      if (signal.aborted) return;

      // Handoff: every specialist hands its markdown deliverable to the
      // orchestrator, which indexes the files in its final reply.
      const handoff = finalizeSwarmRun(task);
      this.emit(task, {
        stage: 'handoff',
        agentId: 'aegis',
        title: `Collected ${task.artifacts?.length ?? 0} specialist artifact(s)`,
        detail: clip(handoff, 500),
      });
      this.persist();

      task.status = 'synthesizing';
      this.emit(task, {
        stage: 'synthesis',
        agentId: 'aegis',
        title: 'Aegis is synthesising the reports',
      });
      this.persist();

      const reports = task.subtasks
        .map((subtask) => {
          const agent =
            SWARM_ROSTER.find((entry) => entry.id === subtask.agentId)?.name ??
            subtask.agentId;
          return `## ${agent}   ${subtask.title}\n${subtask.report ?? subtask.error ?? 'No report.'}`;
        })
        .join('\n\n');
      const system = [
        'You are Aegis, the orchestrator of a local-first agent team.',
        'Write the final answer for the owner from the specialist reports below.',
        'Do not add facts that are not in the reports. Note explicitly when a service was unavailable.',
        'Be direct and useful: a short answer followed by the key evidence and any next step. Maximum 320 words.',
      ].join(' ');
      const user = [
        `Owner request: ${task.prompt}`,
        '',
        reports,
        '',
        handoff,
        '',
        'Specialist evidence index:',
        task.subtasks
          .flatMap((subtask) =>
            subtask.evidence.map(
              (item) => `- ${item.label} [${item.source}]`,
            ),
          )
          .join('\n'),
      ].join('\n');
      const result = await complete(this.platform.config, system, user, signal);
      if (signal.aborted) return;
      const synthesis = result?.text ?? fallbackSynthesis(task);
      // The final reply always ends with the artifact index, so the owner can
      // open every specialist's deliverable by path.
      task.synthesis = assembleFinalReply(synthesis, handoff);
      if (result) {
        task.provider = result.provider;
        task.model = result.model;
      }
      const failed = task.subtasks.filter((s) => s.status === 'failed');
      task.status = failed.length === task.subtasks.length ? 'failed' : 'completed';
      if (task.status === 'failed')
        task.error = 'Every specialist failed. See the task reports for details.';
      task.completedAt = Date.now();
      this.emit(task, {
        stage: 'done',
        agentId: 'aegis',
        title:
          task.status === 'completed'
            ? 'Task completed'
            : 'Task failed',
        detail: clip(task.synthesis, 500),
      });
      this.persist();
    } catch (error) {
      if (signal.aborted) {
        task.status = 'cancelled';
      } else {
        task.status = 'failed';
        task.error =
          error instanceof Error ? error.message : 'The task could not run.';
        this.emit(task, {
          stage: 'error',
          agentId: 'system',
          title: 'Task failed',
          detail: task.error,
        });
      }
      task.updatedAt = Date.now();
      this.persist();
    } finally {
      this.controllers.delete(task.id);
    }
  }
}
