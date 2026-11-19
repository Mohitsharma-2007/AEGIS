// Computer routes: HTTP surface for the Aegis computer service.
//
// The service owns permissions, audit and provisioning; in local mode the
// desktop actions it exposes are executed through the agent-desktop adapter
// (see computer-service.ts → agent-desktop.ts). There is no screenshot stream
// and no preview window here: the caller drives the real desktop.
import { Hono } from 'hono';
import { z } from 'zod';
import { computerInputs } from '../shared/computer-types.js';
import type { ComputerService } from './computer-service.js';
import {
  lastAnnotation,
  publishAnnotation,
  subscribeAnnotations,
  type AnnotationPayload,
} from './agent-desktop-annotations.js';

const BROWSER_KINDS = new Set(['browser', 'shell', 'files']);

function statusFor(message: string): 400 | 403 | 404 | 503 {
  if (/permission is disabled/i.test(message)) return 403;
  if (/not configured/i.test(message)) return 503;
  if (/invalid response/i.test(message)) return 503;
  if (/Agent not found/i.test(message)) return 404;
  return 400;
}

export function computerRoutes(
  service: ComputerService,
  options: { browserUrl?: string; browserSecret?: string } = {},
) {
  const app = new Hono();

  const fail = (message: string) =>
    Response.json({ error: message }, { status: statusFor(message) });

  const guarded = async (run: () => Promise<unknown>) => {
    try {
      return Response.json(await run());
    } catch (error) {
      return fail(
        error instanceof Error ? error.message : 'Computer request failed.',
      );
    }
  };

  app.get('/dots/:id/computer', (c) =>
    guarded(() => service.status(c.req.param('id'))),
  );

  app.post('/dots/:id/computer/start', (c) =>
    guarded(() => service.start(c.req.param('id'))),
  );

  app.post('/dots/:id/computer/stop', (c) =>
    guarded(() => service.stop(c.req.param('id'))),
  );

  app.post('/dots/:id/computer/take', (c) =>
    guarded(() => service.control(c.req.param('id'), 'take')),
  );

  app.post('/dots/:id/computer/release', (c) =>
    guarded(() => service.control(c.req.param('id'), 'release')),
  );

  app.put('/dots/:id/computer/permissions', async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== 'object')
      return c.json({ error: 'Invalid computer request.' }, 400);
    return guarded(() => service.permissions(c.req.param('id'), body));
  });

  app.post('/dots/:id/computer/actions', async (c) => {
    const raw = await c.req.text().catch(() => '');
    let body: unknown;
    try {
      body = JSON.parse(raw || 'null');
    } catch {
      return c.json({ error: 'Invalid JSON request.' }, 400);
    }
    const parsed = z
      .object({
        action: z.string().trim().min(1),
        input: z.unknown().optional(),
        actor: z.enum(['owner', 'agent']).optional(),
      })
      .strict()
      .safeParse(body);
    if (!parsed.success)
      return c.json({ error: 'Invalid computer request.' }, 400);
    const id = c.req.param('id');
    const action = parsed.data.action;
    if (!Object.hasOwn(computerInputs, action))
      return c.json({ error: 'Unknown computer action.' }, 400);
    return guarded(() =>
      service.action(
        id,
        action as keyof typeof computerInputs,
        parsed.data.input ?? {},
        parsed.data.actor ?? 'owner',
      ),
    );
  });

  /**
   * Agent SDK bridge. Bearer-protected and routed through the same permission
   * checks as the owner UI, so an agent cannot widen its own computer access.
   */
  app.post('/orchestrator/computer', async (c) => {
    const expected = process.env.AEGIS_ORCHESTRATOR_TOKEN?.trim();
    const provided = (c.req.header('authorization') ?? '')
      .replace(/^Bearer\s+/i, '')
      .trim();
    if (!expected || !provided || provided !== expected)
      return c.json({ error: 'Unauthorized.' }, 401);

    const raw = await c.req.text().catch(() => '');
    let body: unknown;
    try {
      body = JSON.parse(raw || 'null');
    } catch {
      return c.json({ error: 'Invalid JSON request.' }, 400);
    }
    const parsed = z
      .object({
        dotId: z.string().trim().min(1),
        command: z.string().trim().min(1),
        args: z.array(z.unknown()).optional(),
      })
      .strict()
      .safeParse(body);
    if (!parsed.success) return c.json({ error: 'Invalid computer request.' }, 400);

    const command = parsed.data.command;
    if (!Object.hasOwn(computerInputs, command))
      return c.json({ error: 'Unknown computer action.' }, 400);
    const input =
      parsed.data.args && parsed.data.args.length > 0
        ? parsed.data.args.length === 1 &&
          parsed.data.args[0] &&
          typeof parsed.data.args[0] === 'object' &&
          !Array.isArray(parsed.data.args[0])
          ? parsed.data.args[0]
          : { args: parsed.data.args }
        : {};
    return guarded(() =>
      service.action(
        parsed.data.dotId,
        command as keyof typeof computerInputs,
        input,
        'agent',
      ),
    );
  });

  // Which permission kinds an action needs, for clients that want to explain a
  // 403 without duplicating the server's classification.
  app.get('/computer/action-kinds', (c) =>
    c.json({
      kinds: [...BROWSER_KINDS],
      actions: Object.keys(computerInputs),
    }),
  );

  /**
   * Annotation stream for the overlay. Marker payloads only — no pixels, no
   * previews: the overlay is drawn on top of the owner's real desktop.
   */
  app.get('/computer/desktop/annotations/stream', () => {
    const encoder = new TextEncoder();
    let unsubscribe = () => {};
    let ping: ReturnType<typeof setInterval> | undefined;
    const stream = new ReadableStream({
      start(controller) {
        const send = (event: unknown) => {
          try {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
            );
          } catch {
            // stream already closed
          }
        };
        unsubscribe = subscribeAnnotations(send);
        ping = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(': ping\n\n'));
          } catch {
            // stream already closed
          }
        }, 15_000);
      },
      cancel() {
        unsubscribe();
        if (ping) clearInterval(ping);
      },
    });
    return new Response(stream, {
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
      },
    });
  });

  app.get('/computer/desktop/annotations/:sessionId', (c) =>
    c.json({ event: lastAnnotation(c.req.param('sessionId')) ?? null }),
  );

  /** Publish a marker payload directly (math/annotation demo and tests). */
  app.post('/computer/desktop/annotate', async (c) => {
    const body = (await c.req.json().catch(() => null)) as
      | { sessionId?: unknown; payload?: unknown }
      | null;
    if (!body || typeof body.payload !== 'object' || body.payload === null)
      return c.json({ error: 'A marker payload is required.' }, 400);
    const sessionId =
      typeof body.sessionId === 'string' && body.sessionId.trim()
        ? body.sessionId.trim()
        : 'manual';
    return c.json(
      publishAnnotation(sessionId, body.payload as AnnotationPayload),
    );
  });

  /**
   * Live site preview for the Browser pane and generative web cards. The
   * renderer calls this; the Playwright browser service owns the real page,
   * its SSRF guard and its secret, so the host proxies with that secret.
   */
  app.post('/browse-preview', async (c) => {
    const parsed = z
      .object({ url: z.string().url().max(2048) })
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json({ error: 'A valid URL is required.' }, 400);
    const base = (options.browserUrl ?? process.env.BROWSER_URL ?? '').replace(
      /\/$/,
      '',
    );
    const secret = options.browserSecret ?? process.env.BROWSER_SECRET ?? '';
    if (!base || !secret)
      return c.json(
        {
          error:
            'Browser is not configured: set BROWSER_URL and BROWSER_SECRET.',
          engine: 'playwright',
        },
        503,
      );
    try {
      const response = await fetch(`${base}/browse`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${secret}`,
        },
        body: JSON.stringify({ url: parsed.data.url }),
        signal: AbortSignal.timeout(45_000),
      });
      const data = (await response.json().catch(() => ({}))) as {
        url?: string;
        title?: string;
        text?: string;
        screenshot?: string;
        engine?: string;
        error?: string;
      };
      if (!response.ok)
        return c.json(
          {
            error:
              data.error ?? `Browser preview failed (${response.status}).`,
            engine: 'playwright',
          },
          502,
        );
      return c.json({
        url: data.url ?? parsed.data.url,
        title: data.title ?? '',
        text: data.text ?? '',
        screenshot: data.screenshot ?? '',
        engine: data.engine ?? 'playwright',
      });
    } catch (error) {
      return c.json(
        {
          error:
            error instanceof Error
              ? error.message
              : 'Browser preview failed.',
          engine: 'playwright',
        },
        502,
      );
    }
  });

  return app;
}
