import { aegisMemoryRoutes } from './aegis-memory-routes.js';
import { mailRoutes } from './mail-routes.js';
import { agentRoutes } from './agent-routes.js';
import { AgentSwarm } from './agent-swarm.js';
import { harnessRoutes } from './harness-routes.js';
import { whatsappRoutes } from './whatsapp-routes.js';
import { oauthRoutes } from './oauth.js';
import { researchWebRoutes } from './research-web.js';
import { freeApiRoutes } from './free-api-routes.js';
import { computerRoutes } from './computer-routes.js';
import { connectionRoutes } from './connection-routes.js';
import { marketplaceRoutes } from './marketplace-routes.js';
import { visualRoutes } from './visual-routes.js';
import { memoryDocumentRoutes } from './memory-document-routes.js';
import { startMemoryReconciler } from './memory-document-service.js';
import { hooksRoutes } from './hooks.js';
import { sandboxRoutes } from './sandbox.js';
import { shortcutsRoutes } from './shortcuts.js';
import { setGlobalStore } from './store.js';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { Store } from './store.js';
import { Runner } from './runner.js';
import { configured, type Config } from './research.js';
import type { Platform } from './platform.js';
import { VoiceService } from './voice.js';
import { workspaceRoutes } from './workspace-routes.js';
import { log } from './log.js';
import { PROVIDERS, listProviders } from './providers.js';
import { envEntries, envFilePath, writeEnv } from './env-store.js';
import {
  catalogueView,
  fetchLiveModels,
  findCatalogueProvider,
  getCatalogue,
} from './catalogue.js';
const interval = z.number().int().min(60).max(31_536_000).nullable();
export interface AppOptions {
  store: Store;
  runner: Runner;
  config: Config;
  ownerToken?: string;
  origin?: string | string[];
  platform?: Platform;
  /** Shared swarm instance so the mail orchestrator and the agent API run the same task queue. */
  swarm?: AgentSwarm;
}
export function createApp({
  store,
  runner,
  config,
  ownerToken,
  origin,
  platform,
  swarm,
}: AppOptions) {
  const app = new Hono();
  app.use(
    '/api/*',
    bodyLimit({
      // Chat image attachments travel as data URLs through the AG-UI
      // runtime endpoint, so the API needs room for a few images. The UI
      // caps each image at 4 MB and each text file at 512 KB.
      maxSize: 24_000_000,
      onError: (c) => c.json({ error: 'Request is too large.' }, 413),
    }),
  );
  app.use('/api/*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    c.header('X-Content-Type-Options', 'nosniff');
    const requestUrl = new URL(c.req.url);
    const origins = origin
      ? Array.isArray(origin)
        ? origin
        : [origin]
      : undefined;
    const originHostnames = origins
      ? origins
          .map((o) => {
            try {
              return new URL(o).hostname;
            } catch {
              return '';
            }
          })
          .filter(Boolean)
      : [];
    const allowedHosts = new Set([
      'localhost',
      '127.0.0.1',
      '[::1]',
      ...originHostnames,
    ]);
    if (!ownerToken && !allowedHosts.has(requestUrl.hostname))
      return c.json({ error: 'Unrecognized host.' }, 403);
    const requestOrigin = c.req.header('origin');
    const allowedOrigins = new Set(origins ?? [new URL(c.req.url).origin]);
    if (requestOrigin && !allowedOrigins.has(requestOrigin))
      return c.json({ error: 'Cross-origin requests are not allowed.' }, 403);
    if (c.req.header('sec-fetch-site') === 'cross-site')
      return c.json({ error: 'Cross-site requests are not allowed.' }, 403);
    if (ownerToken) {
      const expected = Buffer.from(ownerToken);
      const supplied = Buffer.from(
        c.req.header('authorization')?.replace(/^Bearer /, '') ?? '',
      );
      if (
        expected.length !== supplied.length ||
        !timingSafeEqual(expected, supplied)
      )
        return c.json(
          { error: 'Enter your owner access token to unlock Aegis.' },
          401,
        );
    }
    // A JSON content type is only required when the request actually carries a
    // body. Bodyless POST/DELETE calls (reindex, delete a shortcut, delete a
    // memory document) are legitimate and used by external tooling; demanding
    // a content-type for them answered 415 "Use application/json." to a
    // request that had nothing to encode.
    // The body stream is not a reliable signal on its own: a bodiless DELETE
    // still exposes a Request body in Node, which rejected the marketplace
    // Remove button with 415. A declared content type or actual bytes are the
    // signals that the caller meant to send something.
    const declaredType = c.req.header('content-type');
    const contentLength = c.req.header('content-length');
    const hasBody =
      (contentLength !== undefined && Number(contentLength) > 0) ||
      c.req.header('transfer-encoding') !== undefined ||
      declaredType !== undefined;
    if (
      !['GET', 'HEAD'].includes(c.req.method) &&
      hasBody &&
      !c.req.header('content-type')?.includes('application/json')
    )
      return c.json({ error: 'Use application/json.' }, 415);
    await next();
  });
  setGlobalStore(store);
  startMemoryReconciler(store);

  // Mount memory document routes at both /api and root (e.g. /api/memory/documents and /memory/documents)
  app.route('/api', memoryDocumentRoutes(store));
  app.route('', memoryDocumentRoutes(store));

  // Mount lifecycle hooks, sandbox, and app shortcuts at both /api and root
  app.route('/api', hooksRoutes());
  app.route('', hooksRoutes());
  app.route('/api', sandboxRoutes());
  app.route('', sandboxRoutes());
  app.route('/api', shortcutsRoutes());
  app.route('', shortcutsRoutes());

  app.route('/api', aegisMemoryRoutes(store));
  app.route('/api', mailRoutes());
  app.route('/api', freeApiRoutes());
  app.route('/api', harnessRoutes(platform?.config));
  app.route('/api', whatsappRoutes());
  app.route('/api/marketplace', marketplaceRoutes());
  if (platform) app.route('/api', visualRoutes(platform.config));
  app.route('/api/research', researchWebRoutes());
  if (platform) app.route('/api', agentRoutes(platform, swarm));
  if (platform) {
    // The local Pipecat voice service uses the same provider and model the
    // owner selected for Aegis. Expose only connection metadata here; local
    // Ollama-compatible providers do not require a secret API key.
    app.get('/api/voice/provider', (c) =>
      c.json({
        providerId: platform.config.providerId ?? null,
        model: platform.config.model ?? null,
        baseUrl: platform.config.baseUrl,
      }),
    );
    const oauthOrigin =
      (Array.isArray(origin) ? origin[0] : origin)?.replace(/\/$/, '') ??
      'http://127.0.0.1:4310';
    app.route('/api/oauth', oauthRoutes(platform.workspace.oauth, oauthOrigin));
  }
  if (platform)
    app.route(
      '/api',
      computerRoutes(platform.computers, {
        browserUrl: platform.config.browserUrl,
        browserSecret: platform.config.browserSecret,
      }),
    );
  if (platform)
    app.route(
      '/api',
      connectionRoutes(platform.workspace, platform.connections),
    );
  const voice = platform ? new VoiceService(platform) : undefined;
  if (platform && voice) app.route('/api', workspaceRoutes(platform, voice));
  if (platform) {
    app.get('/api/providers', async (c) => {
      const catalogue = await getCatalogue();
      return c.json({
        providers: listProviders(process.env),
        catalogue: catalogueView(process.env, catalogue),
        catalogueSource: catalogue.source,
        active: {
          providerId: platform.config.providerId,
          model: platform.config.model,
          baseUrl: platform.config.baseUrl,
        },
      });
    });
    app.get('/api/providers/:id/models', async (c) => {
      const id = c.req.param('id');
      const registry = PROVIDERS[id];
      const external = registry ? undefined : findCatalogueProvider(id);
      if (!registry && !external)
        return c.json({ error: 'Unknown provider.' }, 404);
      const definition = {
        apiType: (registry ? registry.apiType : external?.apiType) as
          'openai' | 'anthropic' | 'other',
        baseUrl: registry
          ? process.env[registry.baseUrlEnv]?.trim() || registry.baseUrl
          : (external?.baseUrl as string),
        keyEnv: registry ? registry.keyEnv : (external?.keyEnv as string),
      };
      const catalogueModels = registry
        ? registry.models
        : (external?.models ?? []);
      const defaultModel = registry
        ? registry.defaultModel
        : external?.defaultModel;
      if (c.req.query('live') === '1') {
        try {
          const models = await fetchLiveModels(definition, process.env);
          return c.json({
            providerId: id,
            models,
            source: 'live' as const,
            defaultModel,
          });
        } catch {
          // Live list unavailable (not configured, upstream error,  ):
          // fall back to the catalogue list and say so.
          return c.json({
            providerId: id,
            models: catalogueModels,
            source: 'catalogue' as const,
            defaultModel,
          });
        }
      }
      return c.json({
        providerId: id,
        models: catalogueModels,
        source: 'catalogue' as const,
        defaultModel,
      });
    });
    app.get('/api/env', (c) =>
      c.json({ path: envFilePath(), entries: envEntries() }),
    );
    app.put('/api/env', async (c) => {
      const parsed = z
        .object({
          values: z.record(
            z.string().min(1).max(80),
            z.union([z.string().max(4000), z.null()]),
          ),
        })
        .strict()
        .safeParse(await c.req.json().catch(() => null));
      if (!parsed.success)
        return c.json({ error: 'Invalid environment values.' }, 400);
      try {
        const entries = writeEnv(parsed.data.values);
        // Provider keys take effect immediately for the next turn.
        if (platform.config.providerId) {
          try {
            platform.applyProviderSelection(
              platform.config.providerId,
              platform.config.model,
            );
          } catch {
            // The selected provider may be a catalogue entry that needs a
            // restart; the saved value is still applied on next boot.
          }
        }
        return c.json({ path: envFilePath(), entries });
      } catch (error) {
        return c.json(
          {
            error:
              error instanceof Error
                ? error.message
                : 'Could not save environment values.',
          },
          400,
        );
      }
    });
    const voicePipelineBase = () =>
      (
        store.settings().voicePipelineUrl ||
        process.env.VOICE_PIPELINE_URL ||
        'http://127.0.0.1:8766'
      ).replace(/\/$/, '');
    app.get('/api/voice/pipeline', async (c) => {
      const base = voicePipelineBase();
      try {
        const response = await fetch(`${base}/health`, {
          signal: AbortSignal.timeout(2000),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const info = (await response.json().catch(() => ({}))) as Record<
          string,
          unknown
        >;
        return c.json({ ok: true, url: base, ...info });
      } catch (error) {
        return c.json({
          ok: false,
          url: base,
          error:
            error instanceof Error
              ? error.message
              : 'Voice pipeline is not reachable.',
        });
      }
    });
    app.post('/api/voice/tts', async (c) => {
      const parsed = z
        .object({
          text: z.string().trim().min(1).max(4000),
          language: z.enum(['auto', 'en', 'hi', 'hinglish']).optional(),
        })
        .strict()
        .safeParse(await c.req.json().catch(() => null));
      if (!parsed.success) return c.json({ error: 'Text is required.' }, 400);
      const base = voicePipelineBase();
      try {
        const response = await fetch(`${base}/api/tts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(parsed.data),
          signal: AbortSignal.timeout(60_000),
        });
        if (!response.ok)
          return c.json(
            { error: `Voice pipeline TTS failed (${response.status}).` },
            502,
          );
        const audio = await response.arrayBuffer();
        return c.body(audio, 200, {
          'Content-Type': response.headers.get('content-type') ?? 'audio/wav',
          'Cache-Control': 'no-store',
        });
      } catch (error) {
        return c.json(
          {
            error:
              error instanceof Error
                ? `Voice pipeline is unavailable: ${error.message}`
                : 'Voice pipeline is unavailable.',
          },
          502,
        );
      }
    });
    // --- Windows Voice Bridge (command-only access through the Windows
    // speech engine) ---------------------------------------------------
    const windowsVoiceBase = () =>
      (process.env.WINDOWS_VOICE_URL || 'http://127.0.0.1:8767').replace(
        /\/$/,
        '',
      );
    app.get('/api/voice/windows', async (c) => {
      const base = windowsVoiceBase();
      try {
        const response = await fetch(`${base}/health`, {
          signal: AbortSignal.timeout(4000),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const info = (await response.json().catch(() => ({}))) as Record<
          string,
          unknown
        >;
        return c.json({ ok: true, url: base, ...info });
      } catch (error) {
        return c.json({
          ok: false,
          url: base,
          error:
            error instanceof Error
              ? error.message
              : 'Windows Voice Bridge is not reachable.',
        });
      }
    });
    app.get('/api/voice/windows/commands', async (c) => {
      const base = windowsVoiceBase();
      try {
        const response = await fetch(`${base}/api/commands`, {
          signal: AbortSignal.timeout(4000),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return c.json(await response.json());
      } catch (error) {
        return c.json(
          {
            error:
              error instanceof Error
                ? error.message
                : 'Windows Voice Bridge is not reachable.',
          },
          502,
        );
      }
    });
    app.post('/api/voice/windows/execute', async (c) => {
      const parsed = z
        .object({ text: z.string().trim().min(1).max(300) })
        .strict()
        .safeParse(await c.req.json().catch(() => null));
      if (!parsed.success)
        return c.json({ error: 'A command is required.' }, 400);
      const base = windowsVoiceBase();
      try {
        const response = await fetch(`${base}/api/execute`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(parsed.data),
          signal: AbortSignal.timeout(15000),
        });
        const body = await response.json().catch(() => ({}));
        return c.json(body, response.ok ? 200 : 502);
      } catch (error) {
        return c.json(
          {
            error:
              error instanceof Error
                ? error.message
                : 'Windows Voice Bridge is not reachable.',
          },
          502,
        );
      }
    });
    app.post('/api/voice/windows/privacy-settings', async (c) => {
      const base = windowsVoiceBase();
      try {
        const response = await fetch(`${base}/api/open-privacy-settings`, {
          method: 'POST',
          signal: AbortSignal.timeout(8000),
        });
        const body = await response.json().catch(() => ({}));
        return c.json(body, response.ok ? 200 : 502);
      } catch (error) {
        return c.json(
          {
            error:
              error instanceof Error
                ? error.message
                : 'Windows Voice Bridge is not reachable.',
          },
          502,
        );
      }
    });
    app.put('/api/providers', async (c) => {
      const parsed = z
        .object({
          providerId: z.string().min(1),
          model: z.string().trim().min(1).max(200).optional(),
        })
        .strict()
        .safeParse(await c.req.json().catch(() => null));
      if (!parsed.success)
        return c.json({ error: 'Choose a known provider.' }, 400);
      try {
        const setup = platform.applyProviderSelection(
          parsed.data.providerId,
          parsed.data.model,
        );
        return c.json({
          providers: listProviders(process.env),
          active: {
            providerId: platform.config.providerId,
            model: platform.config.model,
            baseUrl: platform.config.baseUrl,
          },
          setup,
        });
      } catch (error) {
        return c.json(
          {
            error:
              error instanceof Error
                ? error.message
                : 'Could not save the provider selection.',
          },
          400,
        );
      }
    });
  }
  app.get('/api/state', (c) =>
    c.json({
      settings: store.settings(),
      tasks: store.tasks(),
      memories: store.memories(),
      mode: config.mode,
      configured: configured(config),
    }),
  );
  app.post('/api/tasks', async (c) => {
    const parsed = z
      .object({
        prompt: z.string().trim().min(3).max(4000),
        intervalSeconds: interval.optional(),
        threadId: z.string().optional(),
      })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json(
        {
          error:
            'Enter a request between 3 and 4,000 characters; repeat intervals must be at least 60 seconds.',
        },
        400,
      );
    if (!store.settings().researchAllowed)
      return c.json({ error: 'Research is disabled in Settings.' }, 403);
    if (platform) {
      if (platform.setup().missing.length)
        return c.json(
          { error: `Setup required: ${platform.setup().missing.join(', ')}.` },
          503,
        );
      if (!parsed.data.threadId)
        return c.json(
          { error: 'Select a conversation for this scheduled task.' },
          400,
        );
      try {
        platform.workspace.requireThread(parsed.data.threadId);
      } catch {
        return c.json(
          { error: 'Conversation is not owned by this workspace.' },
          403,
        );
      }
    }
    const task = store.createTask(
      parsed.data.prompt,
      parsed.data.intervalSeconds,
    );
    if (platform && parsed.data.threadId)
      platform.workspace.bindTask(task.id, parsed.data.threadId);
    return c.json(task, 201);
  });
  app.get('/api/tasks/:id', (c) => {
    const detail = store.detail(c.req.param('id'));
    return detail ? c.json(detail) : c.json({ error: 'Task not found.' }, 404);
  });
  app.post('/api/tasks/:id/actions', async (c) => {
    const parsed = z
      .object({ action: z.enum(['run', 'pause', 'cancel']) })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Unknown task action.' }, 400);
    if (parsed.data.action === 'run' && !store.settings().researchAllowed)
      return c.json({ error: 'Research is disabled in Settings.' }, 403);
    const task = store.action(c.req.param('id'), parsed.data.action);
    if (parsed.data.action !== 'run') runner.abort(c.req.param('id'));
    return task ? c.json(task) : c.json({ error: 'Task not found.' }, 404);
  });
  app.put('/api/tasks/:id/schedule', async (c) => {
    const parsed = z
      .object({ intervalSeconds: interval })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json(
        { error: 'Repeat interval must be 60 seconds to one year, or null.' },
        400,
      );
    const task = store.schedule(c.req.param('id'), parsed.data.intervalSeconds);
    return task ? c.json(task) : c.json({ error: 'Task not found.' }, 404);
  });
  app.patch('/api/settings', async (c) => {
    const parsed = z
      .object({
        name: z.string().trim().min(1).max(40).optional(),
        paused: z.boolean().optional(),
        researchAllowed: z.boolean().optional(),
        memoryAllowed: z.boolean().optional(),
        appsAllowed: z.boolean().optional(),
        developerOptionsEnabled: z.boolean().optional(),
        wslEnabled: z.boolean().optional(),
        soundsEnabled: z.boolean().optional(),
        mascotEnabled: z.boolean().optional(),
        desktopSurface: z.enum(['notch', 'mascot']).optional(),
        mascotCharacter: z
          .enum([
            'auto',
            'aegi',
            'mail',
            'social',
            'files',
            'memory',
            'harness',
            'security',
          ])
          .optional(),
        mascotSize: z.number().int().min(64).max(160).optional(),
        mascotShape: z
          .enum(['auto', 'orb', 'squircle', 'blob', 'leaf', 'drop'])
          .optional(),
        soundPack: z.enum(['classic', 'glassy', 'warm']).optional(),
        soundVolume: z.number().min(0).max(1).optional(),
        wakeWordEnabled: z.boolean().optional(),
        voicePipelineUrl: z.string().url().max(300).optional(),
        voiceLanguage: z.enum(['auto', 'en', 'hi', 'hinglish']).optional(),
      })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid settings.' }, 400);
    const previous = store.settings();
    const settings = store.updateSettings(parsed.data);
    if (
      settings.paused ||
      !settings.researchAllowed ||
      previous.memoryAllowed !== settings.memoryAllowed ||
      previous.appsAllowed !== settings.appsAllowed
    )
      runner.abortAll();
    if (settings.paused) voice?.abortAll();
    else void voice?.resumePending();
    return c.json(settings);
  });
  app.get('/api/memories', (c) => c.json({ memories: store.memories() }));
  app.post('/api/memories', async (c) => {
    const parsed = z
      .object({ text: z.string().trim().min(1).max(2000) })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json(
        { error: 'Memory must be between 1 and 2,000 characters.' },
        400,
      );
    return c.json(store.saveMemory(parsed.data.text), 201);
  });
  app.put('/api/memories/:id', async (c) => {
    const parsed = z
      .object({ text: z.string().trim().min(1).max(2000) })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json(
        { error: 'Memory must be between 1 and 2,000 characters.' },
        400,
      );
    if (!store.memories().some((m) => m.id === c.req.param('id')))
      return c.json({ error: 'Memory not found.' }, 404);
    return c.json(store.saveMemory(parsed.data.text, c.req.param('id')));
  });
  app.delete('/api/memories/:id', (c) =>
    store.deleteMemory(c.req.param('id'))
      ? c.json({ ok: true })
      : c.json({ error: 'Memory not found.' }, 404),
  );
  app.onError((error, c) => {
    // A request failure must leave a trace: the field failure looked like a
    // dead network because nothing recorded why the request died.
    log.error(
      `API request failed: ${c.req.method} ${new URL(c.req.url).pathname}`,
      error,
    );
    // Bad input is the caller's mistake, not a server fault. Answering 500 for
    // a missing query parameter made every malformed request look like a
    // crash, so validation failures now return 400 with the real reasons.
    if (error instanceof z.ZodError) {
      return c.json(
        {
          error: 'Invalid request.',
          issues: error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
        400,
      );
    }
    return c.json(
      {
        error:
          'The server could not complete this request. Check server logs and database access.',
      },
      500,
    );
  });
  return app;
}
