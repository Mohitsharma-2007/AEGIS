import { webSearchProvider } from './parallel.js';
import { createShutdown } from './shutdown.js';
import { reportChannelFailure, safeFailure } from './slack-channel.js';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { readFile } from 'node:fs/promises';
import { Store } from './store.js';
import { Runner } from './runner.js';
import { createApp } from './app.js';
import { resolveAppOrigins } from './app-origin.js';
import { WorkspaceStore } from './workspace.js';
import { Platform } from './platform.js';
import {
  agentRunTimeoutMsFromEnv,
  computerModeFromEnv,
  intelligenceApiKeyFromEnv,
  intelligenceWsUrlFromEnv,
  type PlatformConfig,
} from './platform-config.js';
import { browseEngineRequestFromEnv } from './research.js';
import { resolveProvider } from './providers.js';
import { findCatalogueProvider } from './catalogue.js';
import { aegisComputerUrlFromEnv } from './integrations/aegis-computer-sidecar.js';
import { initLogging, installProcessSafetyNet, log, logPath } from './log.js';
import { installSidecarShutdown } from './sidecar-lifecycle.js';
import { AgentSwarm } from './agent-swarm.js';
import { startMailOrchestrator } from './mail-orchestrator.js';
import { mailboxPaths } from './mailbox.js';
import { aegisRootDir } from './harness.js';
import { scrapeWebPage, scrapeWebPages, webSearch } from './web-scraper.js';

installProcessSafetyNet();
initLogging();
const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 4310);
const ownerToken = process.env.OWNER_TOKEN;
if (
  !['127.0.0.1', '::1', 'localhost'].includes(host) &&
  (!ownerToken || ownerToken.length < 24)
)
  throw new Error(
    'External binding requires an OWNER_TOKEN of at least 24 characters.',
  );
const database = process.env.DATABASE_PATH ?? 'data/aegis.sqlite';
const store = new Store(database);
const workspace = new WorkspaceStore(
  database,
  process.env.OWNER_ID ?? 'aegis-owner',
);
// Aegis provider registry: stored Settings selection wins over ENV, which
// wins over the first configured provider; legacy OPENAI_* is the fallback
// inside resolveProvider. Intelligence stays optional and untouched.
const storedSettings = store.settings();
const resolvedProvider = resolveProvider(
  process.env,
  {
    providerId: storedSettings.providerId,
    model: storedSettings.providerModel,
  },
  findCatalogueProvider,
);
const config: PlatformConfig = {
  intelligenceKey: intelligenceApiKeyFromEnv(process.env),
  intelligenceApiUrl: process.env.INTELLIGENCE_API_URL || undefined,
  intelligenceWsUrl: intelligenceWsUrlFromEnv(process.env),
  providerId: resolvedProvider?.providerId,
  providerApiType: resolvedProvider?.apiType,
  providerKeyEnv: resolvedProvider?.keyEnv,
  providerLabel: resolvedProvider?.label,
  apiKey: resolvedProvider?.apiKey,
  model: resolvedProvider?.model,
  baseUrl: resolvedProvider?.baseUrl ?? 'https://api.openai.com/v1',
  agentRunTimeoutMs: agentRunTimeoutMsFromEnv(process.env),
  webSearchProvider: webSearchProvider(process.env.WEB_SEARCH_PROVIDER),
  parallelApiKey: process.env.PARALLEL_API_KEY,
  browserUrl: process.env.BROWSER_URL,
  browserSecret: process.env.BROWSER_SECRET,
  composioApiKey: process.env.COMPOSIO_API_KEY || undefined,
  computerSupervisorUrl: process.env.COMPUTER_SUPERVISOR_URL,
  computerSupervisorToken: process.env.COMPUTER_SUPERVISOR_TOKEN,
  computerToken: process.env.COMPUTER_TOKEN,
  computerNamespace: process.env.COMPUTER_NAMESPACE,
  computerMode: computerModeFromEnv(process.env),
  computerLocalRoot:
    process.env.AEGIS_COMPUTER_WORKSPACE_DIR?.trim() || undefined,
  browserEngine: browseEngineRequestFromEnv(process.env),
  aegisComputerUrl: aegisComputerUrlFromEnv(process.env),
  voiceKey: process.env.VOICE_API_KEY ?? process.env.OPENAI_API_KEY,
  voiceModel: process.env.VOICE_MODEL,
  voiceName: process.env.VOICE_NAME ?? 'marin',
  voiceBaseUrl: process.env.VOICE_BASE_URL,
  sttEndpoint: process.env.STT_ENDPOINT,
  ttsEndpoint: process.env.TTS_ENDPOINT,
  slackChannel: process.env.SLACK_CHANNEL_NAME,
  slackTeam: process.env.SLACK_TEAM_ID,
  slackUsers: (process.env.SLACK_USER_IDS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
  slackDotId: process.env.SLACK_DOT_ID || undefined,
  runtimeUrl: `http://${host === '::1' ? '[::1]' : '127.0.0.1'}:${port}/api/copilotkit`,
  ownerToken,
};
const platform = new Platform(store, workspace, config);
const swarm = new AgentSwarm(platform);
const researchConfig = {
  mode: 'live' as const,
  apiKey: config.apiKey,
  model: config.model,
  baseUrl: config.baseUrl,
  webSearchProvider: config.webSearchProvider,
  parallelApiKey: config.parallelApiKey,
  browserUrl: config.browserUrl,
  browserSecret: config.browserSecret,
  browserEngine: 'playwright' as const,
};
const runner = new Runner(
  store,
  researchConfig,
  async (claim, _memories, signal, progress) => {
    const threadId = workspace.taskThread(claim.id);
    if (!threadId)
      throw new Error(
        'This legacy task has no Intelligence conversation. Create a new scheduled task from a conversation.',
      );
    progress('Running this task in its Intelligence conversation.');
    const text = await platform.turn(threadId, claim.prompt, signal, {
      aegisSource: 'scheduled_task',
    });
    return { text, sources: [], sample: false };
  },
  config.agentRunTimeoutMs,
);
const wsOrigin = new URL(
  config.intelligenceWsUrl ?? 'wss://realtime.intelligence.copilotkit.ai',
).origin;
// The voice UI talks to the local Pipecat pipeline over a WebSocket, so that
// origin has to be allowed explicitly by connect-src (CSP is not bypassed by
// WebSocket). Read the setting per request so changing the pipeline URL in
// Settings takes effect without restarting the host.
function websocketOrigin(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return `${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}`;
  } catch {
    return undefined;
  }
}
function voiceConnectOrigins() {
  let configured: string | undefined;
  try {
    configured = store.settings().voicePipelineUrl;
  } catch {
    // The database may be unavailable during boot; the env/default covers it.
  }
  const candidates = [
    configured,
    process.env.VOICE_PIPELINE_URL,
    'http://127.0.0.1:8766',
    // The Windows Voice Bridge streams commands and spoken answers from a
    // separate local service.
    process.env.WINDOWS_VOICE_URL,
    'http://127.0.0.1:8767',
  ];
  const origins = new Set<string>();
  for (const candidate of candidates) {
    const origin = websocketOrigin(candidate);
    if (!origin) continue;
    origins.add(origin);
    // The same local pipeline may be referenced as localhost or 127.0.0.1.
    if (origin.includes('//127.0.0.1')) {
      origins.add(origin.replace('//127.0.0.1', '//localhost'));
    } else if (origin.includes('//localhost')) {
      origins.add(origin.replace('//localhost', '//127.0.0.1'));
    }
  }
  return [...origins];
}
const app = createApp({
  store,
  runner,
  config: researchConfig,
  ownerToken,
  origin: resolveAppOrigins(process.env.APP_ORIGIN, process.env.NODE_ENV),
  platform,
  swarm,
});
// The orchestrator consumes `task` mail from its own mailbox, dispatches each
// through the swarm, and replies by mail with a markdown report once the task
// completes — owner and agents talk entirely over the internal @aegis bus.
startMailOrchestrator({
  paths: mailboxPaths(aegisRootDir()),
  isPaused: () => platform.store.settings().paused,
  dispatchTask: async ({ prompt }) => {
    const dotId = platform.workspace.dots()[0]?.id;
    if (!dotId) throw new Error('No Agent is available to run this mail task.');
    return swarm.create(prompt, dotId);
  },
  getTask: (taskId) => swarm.get(taskId),
});
function generateNonce(): string {
  const buf = crypto.getRandomValues(new Uint8Array(16));
  return Buffer.from(buf).toString('base64');
}

app.use('*', async (c, next) => {
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'no-referrer');
  const connectSources = [wsOrigin, ...voiceConnectOrigins()].join(' ');
  const isPenboard = c.req.path.startsWith('/penboard');
  const nonce = isPenboard ? generateNonce() : undefined;
  const scriptSrc = isPenboard
    ? `script-src 'self' 'nonce-${nonce}'`
    : `script-src 'self'`;
  const baseCsp = `default-src 'self'; ${scriptSrc}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ${connectSources}; media-src 'self' blob:; frame-ancestors 'self'; base-uri 'self'; form-action 'self'`;
  c.header('Content-Security-Policy', baseCsp);
  if (nonce) c.header('X-CSP-Nonce', nonce);
  await next();
});
// Health probe for the launcher, the desktop shell and the client's
// connection chip. It must answer even when setup is incomplete.
app.get('/api/health', (c) => {
  let database = 'ok';
  try {
    store.settings();
  } catch {
    database = 'error';
  }
  return c.json({
    ok: database === 'ok',
    service: 'aegis-host',
    version: '0.1.0',
    uptimeSeconds: Math.round(process.uptime()),
    database,
    provider: platform.config.providerId ?? null,
    model: platform.config.model ?? null,
    localMode: platform.localMode,
    log: logPath() ?? null,
  });
});

// Web scraper routes
app.post('/api/scrape', async (c) => {
  const { url } = await c.req.json().catch(() => ({}));
  if (!url || typeof url !== 'string') {
    return c.json({ error: 'URL is required' }, 400);
  }
  try {
    const result = await scrapeWebPage(url);
    return c.json({ ok: true, ...result });
  } catch (error) {
    return c.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Scrape failed',
    }, 500);
  }
});

app.post('/api/scrape-multi', async (c) => {
  const { urls } = await c.req.json().catch(() => ({}));
  if (!urls || !Array.isArray(urls)) {
    return c.json({ error: 'URLs array is required' }, 400);
  }
  try {
    const results = await scrapeWebPages(urls);
    return c.json({ ok: true, results });
  } catch (error) {
    return c.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Scrape failed',
    }, 500);
  }
});

app.post('/api/web-search', async (c) => {
  const { query, maxResults } = await c.req.json().catch(() => ({}));
  if (!query || typeof query !== 'string') {
    return c.json({ error: 'Query is required' }, 400);
  }
  try {
    const results = await webSearch(query, maxResults || 10);
    return c.json({ ok: true, results });
  } catch (error) {
    return c.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Search failed',
    }, 500);
  }
});

app.get('/api/*', (c) => c.json({ error: 'Not found.' }, 404));

// Serve penboard.html with CSP nonce injected into inline scripts.
// This avoids 'unsafe-inline' in CSP by using a per-request nonce.
app.get('/penboard', async (c) => {
  const nonce = c.req.header('X-CSP-Nonce');
  if (!nonce) {
    return c.text('CSP nonce missing', 500);
  }
  try {
    const html = await readFile('./public/penboard.html', 'utf8');
    const injected = html.replace(/<script>/g, `<script nonce="${nonce}">`);
    c.header('Content-Type', 'text/html; charset=utf-8');
    return c.html(injected);
  } catch {
    return c.text('Penboard not found', 404);
  }
});

app.use('/*', serveStatic({ root: './dist/client' }));
app.get('*', serveStatic({ path: './dist/client/index.html' }));
const server = serve({ fetch: app.fetch, hostname: host, port }, (info) => {
  log.info('Aegis host listening', {
    url: `http://${host}:${info.port}`,
    database,
    provider: platform.config.providerId ?? null,
    model: platform.config.model ?? null,
    localMode: platform.localMode,
    intelligence: !!config.intelligenceKey,
    log: logPath() ?? null,
  });
  runner.start();
  void platform
    .start()
    .catch((error) =>
      reportChannelFailure(
        'Slack Channels activation failed; check setup status',
        [safeFailure(error)],
      ),
    );
});
server.on('error', (error) => {
  log.error('HTTP server error', error);
});
const shutdown = createShutdown({
  stopRunner: () => runner.stop(),
  stopPlatform: () => platform.stop(),
  closeServer: () =>
    new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    ),
  exit: (code) => process.exit(code),
  report: (operation, error) =>
    reportChannelFailure(operation, [safeFailure(error)]),
});
// Stop any lazily spawned WhatsApp sidecar before the host exits.
installSidecarShutdown();
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
