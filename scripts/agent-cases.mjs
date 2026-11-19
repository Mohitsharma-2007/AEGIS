#!/usr/bin/env node
// Runs the hardest Aegis use cases through the real Aegis agent (the same
// DotAgent the app uses), so acceptance is decided by agent behaviour and
// tool evidence rather than by hand-written assertions.
//
//   node scripts/agent-cases.mjs            # run the TOP-5 map cases
//   node scripts/agent-cases.mjs T03 G05    # run selected case ids
//
// Results are written to docs/agent-test-runs.md. Requires apps/host to be
// built (npm run build) and provider credentials in .env / .env.local.

import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const host = join(root, 'apps', 'host');
const dist = join(host, 'dist', 'server', 'server');

function loadEnv() {
  const env = { ...process.env };
  for (const file of [join(root, '.env'), join(root, '.env.local')]) {
    if (!existsSync(file)) continue;
    for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#') || !line.includes('=')) continue;
      const at = line.indexOf('=');
      const key = line.slice(0, at).trim().replace(/^export\s+/, '');
      const value = line.slice(at + 1).trim().replace(/^["']|["']$/g, '');
      if (key && !env[key]) env[key] = value;
    }
  }
  return env;
}

const env = loadEnv();
const hostRequire = createRequire(join(resolve(here, '..'), 'apps', 'host', 'package.json'));
const { EventType } = hostRequire('@ag-ui/core');

const load = (path) => import(pathToFileURL(path).href);
const { Store } = await load(join(dist, 'store.js'));
const { WorkspaceStore } = await load(join(dist, 'workspace.js'));
const { DotAgent } = await load(join(dist, 'dot-agent.js'));
const { ComputerService } = await load(join(dist, 'computer-service.js'));
const { resolveProvider, PROVIDERS } = await load(join(dist, 'providers.js'));
const { findCatalogueProvider } = await load(join(dist, 'catalogue.js'));
const {
  intelligenceApiKeyFromEnv,
  intelligenceWsUrlFromEnv,
  computerModeFromEnv,
  agentRunTimeoutMsFromEnv,
} = await load(join(dist, 'platform-config.js'));

const dataDir = join(root, '.aegis-data');
mkdirSync(dataDir, { recursive: true });
// One database per run: a second runner (or a stale one still holding a handle)
// can never overwrite the file another process has open, which is what produced
// a malformed snapshot before.
const database = join(dataDir, `agent-cases-${process.pid}.sqlite`);
// Snapshot the app's database so the runner uses the owner's selected provider
// and permissions, without writing test conversations into their workspace.
const liveDatabase = join(host, 'data', 'aegis.sqlite');

/** A SQLite file is only usable if it opens and passes integrity_check. */
function healthyDatabase(path) {
  if (!existsSync(path)) return false;
  let db;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    const row = db.prepare('PRAGMA integrity_check').get();
    return row?.integrity_check === 'ok';
  } catch {
    return false;
  } finally {
    try {
      db?.close();
    } catch {
      // Ignore close failures on an already-broken handle.
    }
  }
}

// A plain file copy of a live SQLite database (WAL mode, mid-checkpoint) is a
// malformed image, which made every computer/permission write fail with
// "database disk image is malformed". VACUUM INTO always writes a consistent
// snapshot, and anything that still fails integrity is discarded so the Store
// can create a clean database instead of running on a corrupt one.
if (existsSync(liveDatabase)) {
  try {
    rmSync(database, { force: true });
  } catch {
    // Nothing to remove.
  }
  let snapshotted = false;
  try {
    const src = new DatabaseSync(liveDatabase, { readOnly: true });
    try {
      src.exec(`VACUUM INTO '${database.replace(/'/g, "''")}'`);
      snapshotted = healthyDatabase(database);
    } finally {
      src.close();
    }
  } catch {
    // Fall through to the raw copy below.
  }
  if (!snapshotted) {
    try {
      copyFileSync(liveDatabase, database);
    } catch {
      // Fall back to the existing test database.
    }
  }
}
if (!healthyDatabase(database)) {
  // Never run on a corrupt image: let the Store create tables from scratch.
  try {
    rmSync(database, { force: true });
  } catch {
    // Nothing to remove.
  }
}
const store = new Store(database);
const workspace = new WorkspaceStore(database, env.OWNER_ID || 'aegis-owner');
const settings = store.settings();
// AGENT_CASE_PROVIDER / AGENT_CASE_MODEL let a run use a stronger test model
// without changing the owner's saved selection. Every provider that has a key
// is kept as a fallback, so a rate-limited free tier does not end a run.
const forcedProvider = env.AGENT_CASE_PROVIDER?.trim();
const candidates = [];

function addCandidate(candidate) {
  if (!candidate?.apiKey) return;
  if (
    candidates.some(
      (existing) =>
        existing.providerId === candidate.providerId &&
        existing.model === candidate.model,
    )
  )
    return;
  candidates.push(candidate);
}

if (forcedProvider) {
  const forced = resolveProvider(
    { ...env, AEGIS_PROVIDER: forcedProvider },
    undefined,
    findCatalogueProvider,
  );
  if (forced) {
    if (env.AGENT_CASE_MODEL) forced.model = env.AGENT_CASE_MODEL;
    addCandidate(forced);
  }
}
addCandidate(
  resolveProvider(
    env,
    { providerId: settings.providerId, model: settings.providerModel },
    findCatalogueProvider,
  ),
);
for (const id of Object.keys(PROVIDERS)) {
  addCandidate(
    resolveProvider(
      { ...env, AEGIS_PROVIDER: id },
      undefined,
      findCatalogueProvider,
    ),
  );
}
if (!candidates.length) {
  console.error(
    'No provider configured. Add a provider key to .env (or choose one in Aegis Settings) and rerun.',
  );
  process.exit(2);
}
console.log(
  `Providers: ${candidates.map((candidate) => `${candidate.providerId}/${candidate.model}`).join(' → ')}`,
);

const baseConfig = {
  intelligenceKey: intelligenceApiKeyFromEnv(env),
  intelligenceApiUrl: env.INTELLIGENCE_API_URL || undefined,
  intelligenceWsUrl: intelligenceWsUrlFromEnv(env),
  agentRunTimeoutMs: Number(env.AGENT_CASE_TIMEOUT_MS || agentRunTimeoutMsFromEnv(env)),
  webSearchProvider: env.WEB_SEARCH_PROVIDER || 'builtin',
  parallelApiKey: env.PARALLEL_API_KEY,
  browserUrl: env.BROWSER_URL || 'http://127.0.0.1:4311',
  browserSecret: env.BROWSER_SECRET,
  composioApiKey: env.COMPOSIO_API_KEY || undefined,
  computerMode: computerModeFromEnv(env),
  computerLocalRoot: env.AEGIS_COMPUTER_WORKSPACE_DIR?.trim() || undefined,
  browserEngine: 'playwright',
  aegisComputerUrl: env.AEGIS_COMPUTER_URL,
  voiceKey: env.VOICE_API_KEY,
  voiceName: env.VOICE_NAME || 'marin',
  slackUsers: [],
  runtimeUrl: 'http://127.0.0.1:4310/api/copilotkit',
};

function configFor(candidate) {
  return {
    ...baseConfig,
    providerId: candidate.providerId,
    providerApiType: candidate.apiType,
    providerKeyEnv: candidate.keyEnv,
    providerLabel: candidate.label,
    apiKey: candidate.apiKey,
    model: candidate.model,
    baseUrl: candidate.baseUrl,
  };
}

// ONE ComputerService for the whole run, with a run-local profile root. Cases
// then share one browser profile instead of racing over it, and each case is
// stopped before the next starts so no Chromium process outlives its case.
// (A per-case DotAgent used to create its own service, leaving browsers behind
// and locking the profile for the next case.)
const runnerComputers = new ComputerService(
  workspace,
  { ...baseConfig, computerLocalRoot: join(dataDir, 'case-computers') },
  () => store.settings().paused,
);

const CASES = [
  {
    id: 'T03',
    title: 'NVIDIA end-to-end brief with citations and a chart',
    prompt:
      'Research NVIDIA using your real tools: open Chrome (reuse the existing window), go to Google, search NVIDIA, and read NVIDIA’s official investor-relations page plus at least two reputable articles. Then answer with: a short executive summary, revenue and segment figures with the period, margins, key risks, and a sources list with links. Include a mermaid flowchart of NVIDIA’s business segments, and a ```chart JSON block (type "bar", labels and values) of segment revenue. Do not invent numbers; mark anything uncertain. Do not just describe what you would do — do it.',
    checks: (r) => ({
      'tool calls': r.tools.length,
      'used browser/computer': r.tools.some((t) => /browser|open_app|desktop|computer|shell/i.test(t)),
      'has links': /https?:\/\//.test(r.reply),
      'has mermaid': /```mermaid/.test(r.reply),
      'has chart': /```chart/.test(r.reply),
    }),
  },
  {
    id: 'O02',
    title: 'Multi-sheet Excel model built from live research',
    prompt:
      'Build a real Excel workbook for NVIDIA using your tools. First gather current public figures (revenue, segment split, margins, guidance) from the web, then create the .xlsx with create_document: one sheet "Overview" with company facts, one sheet "Financials" with a header row and at least four data rows (FY revenue, growth, gross margin, operating margin), and one sheet "Risks". Include a totals row with formulas where it makes sense. Return the download URL and say exactly which sources the figures came from.',
    checks: (r) => ({
      'tool calls': r.tools.length,
      'created document': r.tools.some((t) => /create_document|office_excel/i.test(t)),
      'mentions xlsx': /\.xlsx|downloadUrl|\/api\/documents/i.test(r.reply),
    }),
  },
  {
    id: 'M03',
    title: 'Parallel subagent due diligence synthesised into one brief',
    prompt:
      'Run a parallel due-diligence pass on NVIDIA using spawn_agents with three subagents: one on financials and guidance, one on products and competition, one on risks and regulation. Each subagent must use the web itself. When they return, synthesise a single decision brief with a comparison table, agreement/disagreement between the subagents, and a clear recommendation. Do not do all the work yourself first; delegate, then synthesise.',
    checks: (r) => ({
      'tool calls': r.tools.length,
      'spawned agents': r.tools.filter((t) => /spawn_agents/i.test(t)).length,
      'has table': /\|.+\|/.test(r.reply),
      'has recommendation': /recommend/i.test(r.reply),
    }),
  },
  {
    id: 'B02',
    title: 'Reuse the open Chrome/YouTube window and verify playback',
    prompt:
      'Chrome is already open with a YouTube tab. Using your computer tools, list the running windows/processes, focus the existing Chrome window (do NOT start a second Chrome), find the YouTube tab, and make sure the video is playing (press the play control if paused). Then take a desktop snapshot and tell me the video title you see, the Chrome PID you reused, and whether it was already running.',
    checks: (r) => ({
      'tool calls': r.tools.length,
      'reused window': /reused|already running|pid/i.test(r.reply),
      'took snapshot': r.tools.some((t) => /desktop_snapshot|computer_control|open_app/i.test(t)),
    }),
  },
  {
    id: 'G05',
    title: 'Sandboxed HTML dashboard rendered from agent markup',
    prompt:
      'Create a compact one-page HTML dashboard for NVIDIA (dark theme, KPI cards and one inline SVG bar chart) and return it in a single fenced ```html code block so Aegis renders it inline. Also include a short markdown table of the KPIs above the HTML. Keep the HTML self-contained (no external scripts or fonts).',
    checks: (r) => ({
      'tool calls': r.tools.length,
      'has html fence': /```html/.test(r.reply),
      'self-contained': !/https?:\/\/.+\.(js|css)/i.test(r.reply),
      'has table': /\|.+\|/.test(r.reply),
    }),
  },
];

const wanted = process.argv.slice(2).filter((value) => !value.startsWith('-'));
const selected = wanted.length
  ? CASES.filter((c) => wanted.includes(c.id))
  : CASES;

function runCase(testCase, candidate) {
  const dot = workspace.dots()[0];
  const threadId = `case-${testCase.id}-${randomUUID().slice(0, 8)}`;
  workspace.bindThread(threadId, dot.id, `${testCase.id} ${testCase.title}`);
  const agent = new DotAgent(store, workspace, configFor(candidate), dot.id, false, undefined, runnerComputers);
  const started = Date.now();
  const tools = [];
  let reply = '';
  let error = null;
  const typesSeen = new Set();

  const runInput = {
    threadId,
    runId: `run-${randomUUID()}`,
    state: {},
    context: [],
    messages: [{ id: `msg-${randomUUID()}`, role: 'user', content: testCase.prompt }],
    tools: [],
    forwardedProps: {},
  };

  return new Promise((done) => {
    const timeoutMs = Number(env.AGENT_CASE_TIMEOUT_MS || 300000);
    let settled = false;
    let subscription;
    const finish = (payload) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      subscription.unsubscribe();
      done(payload);
    };
    const timer = setTimeout(() => {
      error = `Timed out after ${Math.round(timeoutMs / 1000)}s`;
      agent.abortRun();
      finish({ ...testCase, threadId, tools, reply, error, types: [...typesSeen], ms: Date.now() - started });
    }, timeoutMs);
    subscription = agent.run(runInput).subscribe({
      next: (event) => {
        typesSeen.add(event.type);
        if (
          (event.type === EventType.TEXT_MESSAGE_CONTENT ||
            event.type === EventType.TEXT_MESSAGE_CHUNK ||
            event.type === EventType.TEXT_MESSAGE_END) &&
          'delta' in event &&
          typeof event.delta === 'string'
        )
          reply += event.delta;
        if (event.type === EventType.TOOL_CALL_START && 'toolCallName' in event)
          tools.push(String(event.toolCallName));
        if (event.type === EventType.RUN_ERROR)
          error = 'message' in event ? String(event.message) : 'run error';
      },
      error: (failure) => {
        error = failure?.message || String(failure);
        finish({ ...testCase, threadId, tools, reply, error, types: [...typesSeen], ms: Date.now() - started });
      },
      complete: () =>
        finish({ ...testCase, threadId, tools, reply, error, types: [...typesSeen], ms: Date.now() - started }),
    });
  });
}

const results = [];
/** Rate-limit/quota failures are a provider problem, not a case failure. */
const providerFailure = (error) =>
  !!error &&
  /429|413|rate limit|tokens per minute|too large|quota|too many requests|insufficient|tool_use_failed|not in request\.tools|did not match schema|invalid_request|404|401|403|no body|not found/i.test(
    error,
  );
const firstLineOf = (text) => String(text || '').split(String.fromCharCode(10))[0];

for (const testCase of selected) {
  process.stdout.write('\n> ' + testCase.id + ' ' + testCase.title + '\n');
  let result;
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    process.stdout.write('  trying ' + candidate.providerId + '/' + candidate.model + '\n');
    result = await runCase(testCase, candidate);
    result.provider = candidate.providerId + '/' + candidate.model;
    if (!providerFailure(result.error) || index === candidates.length - 1) break;
    process.stdout.write('  ' + firstLineOf(result.error).slice(0, 120) + ' -> next provider\n');
  }
  const checks = testCase.checks(result);
  results.push({ ...result, checks });
  // Stop the computer between cases so a browser from this case cannot hold the
  // profile (or a window) the next case expects to start cleanly.
  try {
    await runnerComputers.stop(workspace.dots()[0].id);
  } catch {
    // The case may never have started a computer; nothing to stop.
  }
  process.stdout.write(
    '  ' + (result.error ? firstLineOf(result.error) : 'completed') +
      ' in ' + Math.round(result.ms / 1000) + 's, ' + result.tools.length +
      ' tools: ' + result.tools.join(', ') + '\n',
  );
}

const lines = [];
lines.push('# Aegis agent test runs\n');
lines.push(`Run at ${new Date().toISOString()} · providers ${candidates.map((candidate) => `${candidate.providerId}/${candidate.model}`).join(', ')}
`);
for (const result of results) {
  lines.push(`## ${result.id} — ${result.title}\n`);
  lines.push(`- Thread: \`${result.threadId}\``);
  lines.push(`- Provider: ${result.provider}`);
  lines.push(`- Duration: ${(result.ms / 1000).toFixed(1)}s`);
  lines.push(`- Tools called: ${result.tools.length ? result.tools.join(', ') : 'none'}`);
  lines.push(`- Error: ${result.error ?? 'none'}`);
  lines.push(`- Event types: ${result.types.join(', ') || 'none'}`);
  lines.push('- Evidence:');
  for (const [name, value] of Object.entries(result.checks))
    lines.push(`  - ${name}: ${value}`);
  lines.push('\n<details><summary>Agent reply</summary>\n');
  lines.push('```');
  lines.push(result.reply.slice(0, 6000));
  lines.push('```');
  lines.push('</details>\n');
}
const target = join(root, 'docs', 'agent-test-runs.md');
writeFileSync(target, lines.join('\n'), 'utf8');
console.log(`\nWrote ${target}`);
