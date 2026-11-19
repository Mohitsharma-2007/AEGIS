import { serve, type HttpBindings } from '@hono/node-server';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { type Browser, type BrowserContext } from 'playwright';
import { z } from 'zod';
import { validateUrl } from './security.js';
import { readResource } from './transport.js';
import { launchWithFallback } from '../server/browser-launch.js';

// AEGIS: the AEGIS Computer browser is Playwright only. The Obscura
// engine (CDP, tools-bin/obscura) has been removed entirely; there is
// exactly one engine, one launch path, and no engine fallback labels.

export type BrowserEngine = 'playwright';
export type BrowserEngineRequest = 'playwright';

export interface BrowseResult {
  url: string;
  title: string;
  text: string;
  screenshot: string;
  engine: BrowserEngine;
  /** W-FIX 1a: which browser binary served (bundled Chromium or a system
   * Edge/Chrome fallback), when known. */
  browserBinary?: string;
}

/** A browse failure that carries the honest engine label for the reply. */
export class BrowseFailure extends Error {
  constructor(message: string, readonly engine: BrowserEngine) {
    super(message);
    this.name = 'BrowseFailure';
  }
}

/**
 * Injectable seams for tests: the engine launch function and the network
 * guards. Production defaults are the real Playwright transport and the
 * real SSRF/transport guards.
 */
export interface BrowseDeps {
  launchPlaywright?: () => Promise<Browser>;
  validate?: typeof validateUrl;
  read?: typeof readResource;
}

/** Launch the local Playwright Chromium (the AEGIS Computer browser
 * engine), walking the W-FIX 1a ladder in server/browser-launch.ts:
 * bundled Chromium -> full build -> system Edge -> system Chrome ->
 * system executable paths. The winning binary's label rides along on
 * the result so the response can say which binary served. */
export async function launchLocalChromium(): Promise<Browser> {
  const { browser } = await launchWithFallback({
    headless: true,
    args: ['--disable-dev-shm-usage'],
  });
  return browser;
}

async function attemptBrowse(
  url: string,
  deps: Required<Pick<BrowseDeps, 'validate' | 'read'>> & BrowseDeps,
  signal: AbortSignal,
): Promise<Omit<BrowseResult, 'engine'>> {
  let browser: Browser | undefined;
  let mainError: string | undefined;
  let browserBinary: string | undefined;
  try {
    await deps.validate(url);
    signal.throwIfAborted();
    if (deps.launchPlaywright) {
      browser = await deps.launchPlaywright();
    } else {
      const launched = await launchWithFallback({
        headless: true,
        args: ['--disable-dev-shm-usage'],
      });
      browser = launched.browser;
      browserBinary = launched.binary;
    }
    signal.throwIfAborted();
    const context: BrowserContext = await browser.newContext({
      javaScriptEnabled: false,
      serviceWorkers: 'block',
      acceptDownloads: false,
      viewport: { width: 1200, height: 800 },
    });
    let count = 0;
    await context.route('**/*', async (route) => {
      const request = route.request();
      if (
        ++count > 50 ||
        request.method() !== 'GET' ||
        !['document', 'stylesheet', 'image', 'font'].includes(
          request.resourceType(),
        )
      ) {
        await route.abort();
        return;
      }
      try {
        await route.fulfill(await deps.read(request.url(), signal));
      } catch (error) {
        if (request.isNavigationRequest())
          mainError =
            error instanceof Error ? error.message : 'Navigation failed.';
        await route.abort();
      }
    });
    const page = await context.newPage();
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 25_000,
    });
    if (mainError) throw new Error(mainError);
    if (!response || response.status() >= 400)
      throw new Error(
        `Source returned HTTP ${response?.status() ?? 'unknown'}.`,
      );
    await deps.validate(page.url());
    const text = (
      await page.locator('body').innerText({ timeout: 5000 })
    ).slice(0, 30_000);
    const title = await page.title();
    const screenshot = (
      await page.screenshot({ type: 'jpeg', quality: 60, timeout: 5000 })
    ).toString('base64');
    return {
      url: page.url(),
      title,
      text,
      screenshot: `data:image/jpeg;base64,${screenshot}`,
      ...(browserBinary ? { browserBinary } : {}),
    };
  } catch (error) {
    throw new Error(
      mainError ?? (error instanceof Error ? error.message : 'Browser failed.'),
      { cause: error },
    );
  } finally {
    await browser?.close().catch(() => {});
  }
}

/** Browse one URL with Playwright. Resolves with the result, or rejects
 * with BrowseFailure when the browse failed. */
export async function browsePage(
  url: string,
  deps: BrowseDeps = {},
  signal: AbortSignal = new AbortController().signal,
): Promise<BrowseResult> {
  const full: Required<Pick<BrowseDeps, 'validate' | 'read'>> & BrowseDeps = {
    validate: deps.validate ?? validateUrl,
    read: deps.read ?? readResource,
    ...deps,
  };
  try {
    const result = await attemptBrowse(url, full, signal);
    return { ...result, engine: 'playwright' };
  } catch (error) {
    throw new BrowseFailure(
      error instanceof Error ? error.message : 'Browser failed.',
      'playwright',
    );
  }
}

export function createBrowserApp(
  secret: string,
  deps: BrowseDeps = {},
) {
  const app = new Hono<{ Bindings: HttpBindings }>();
  app.use('*', bodyLimit({ maxSize: 16_384 }));
  app.use('*', async (c, next) => {
    const supplied = Buffer.from(
      c.req.header('authorization')?.replace(/^Bearer /, '') ?? '',
    );
    const expected = Buffer.from(secret);
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    )
      return c.json({ error: 'Unauthorized', engine: 'playwright' }, 401);
    await next();
  });
  let busy = false;
  app.post('/browse', async (c) => {
    const parsed = z
      .object({
        url: z.string().url().max(2048),
      })
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json({ error: 'A valid URL is required.', engine: 'playwright' }, 400);
    if (busy)
      return c.json(
        { error: 'Browser is busy. Retry shortly.', engine: 'playwright' },
        429,
      );
    busy = true;
    const controller = new AbortController();
    const abort = () =>
      controller.abort(new Error('Browser request cancelled.'));
    const disconnected = () => {
      if (!c.env.outgoing.writableFinished) abort();
    };
    c.req.raw.signal.addEventListener('abort', abort, { once: true });
    c.env.outgoing.on('close', disconnected);
    const deadline = setTimeout(abort, 40_000);
    try {
      const result = await browsePage(parsed.data.url, deps, controller.signal);
      return c.json({
        url: result.url,
        title: result.title,
        text: result.text,
        screenshot: result.screenshot,
        engine: result.engine,
        ...(result.browserBinary ? { browserBinary: result.browserBinary } : {}),
      });
    } catch (error) {
      if (error instanceof BrowseFailure)
        return c.json(
          { error: error.message, engine: error.engine },
          502,
        );
      return c.json(
        { error: error instanceof Error ? error.message : 'Browser failed.', engine: 'playwright' },
        502,
      );
    } finally {
      clearTimeout(deadline);
      c.req.raw.signal.removeEventListener('abort', abort);
      c.env.outgoing.off('close', disconnected);
      busy = false;
    }
  });
  app.get('/health', (c) => {
    return c.json({
      ok: true,
      engine: 'playwright',
      defaultRequest: 'playwright',
    });
  });
  return app;
}

// Entry point only when executed as the browser service (npm run
// browser / browser:start). Importing this module (tests) starts
// nothing and demands no secret.
const isMain =
  !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const secret = process.env.BROWSER_SECRET;
  if (!secret || secret.length < 24)
    throw new Error('BROWSER_SECRET must be at least 24 characters.');
  serve({
    fetch: createBrowserApp(secret).fetch,
    hostname: process.env.BROWSER_HOST ?? '127.0.0.1',
    port: Number(process.env.BROWSER_PORT ?? 4311),
  });
}
