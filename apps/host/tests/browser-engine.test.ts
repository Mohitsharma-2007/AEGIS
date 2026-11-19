import { describe, expect, it, vi } from 'vitest';
import type { Browser } from 'playwright';
import {
  BrowseFailure,
  browsePage,
  type BrowseDeps,
} from '../src/browser/index.js';
import { browseEngineRequestFromEnv } from '../src/server/research.js';

// AEGIS: the browser service is Playwright only (Obscura removed). The
// Playwright launch function is stubbed at the module boundary (deps) —
// this tests OUR request/result logic, not Playwright itself.
function fakeBrowser(title: string, failGoto = false) {
  const page = {
    goto: vi.fn(async () => {
      if (failGoto) throw new Error('Navigation exploded.');
      return { status: () => 200 };
    }),
    url: () => 'http://fixture.test/page',
    title: async () => title,
    locator: () => ({
      innerText: async () => `body text from ${title}`,
    }),
    screenshot: async () => Buffer.from('jpeg-bytes'),
  };
  const context = {
    route: vi.fn(async () => {}),
    newPage: async () => page,
  };
  return {
    newContext: async () => context,
    contexts: () => [context],
    close: vi.fn(async () => {}),
  } as unknown as Browser;
}
const guards: BrowseDeps = {
  validate: async (input: string) => ({
    url: new URL(input),
    address: '93.184.215.14',
    family: 4 as const,
  }),
  read: async () => ({ status: 200, headers: {}, body: Buffer.from('') }),
};
const URL_ = 'http://fixture.test/page';

describe('browser engine (Playwright only)', () => {
  it('parses the host-side browse engine request as playwright', () => {
    expect(browseEngineRequestFromEnv({})).toBe('playwright');
    expect(
      browseEngineRequestFromEnv({ AEGIS_BROWSE_ENGINE: 'playwright' }),
    ).toBe('playwright');
    expect(() =>
      browseEngineRequestFromEnv({ AEGIS_BROWSE_ENGINE: 'obscura' }),
    ).toThrow('AEGIS_BROWSE_ENGINE');
    expect(() =>
      browseEngineRequestFromEnv({ AEGIS_BROWSE_ENGINE: 'webkit' }),
    ).toThrow('AEGIS_BROWSE_ENGINE');
  });

  it('serves via Playwright and labels the result', async () => {
    const launchPlaywright = vi.fn(async () => fakeBrowser('playwright'));
    const result = await browsePage(URL_, {
      ...guards,
      launchPlaywright,
    });
    expect(result.engine).toBe('playwright');
    expect(result.title).toBe('playwright');
    expect(result.screenshot).toContain('data:image/jpeg;base64,');
    expect(launchPlaywright).toHaveBeenCalledOnce();
  });

  it('reports a labelled failure when Playwright cannot launch', async () => {
    const launchPlaywright = vi.fn(async () => {
      throw new Error('chromium executable missing');
    });
    const failure = await browsePage(URL_, {
      ...guards,
      launchPlaywright,
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(BrowseFailure);
    expect((failure as BrowseFailure).engine).toBe('playwright');
    expect((failure as BrowseFailure).message).toContain('chromium executable missing');
  });

  it('surface a navigation failure as a labelled failure', async () => {
    const failure = await browsePage(URL_, {
      ...guards,
      launchPlaywright: vi.fn(async () => fakeBrowser('playwright', true)),
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(BrowseFailure);
    expect((failure as BrowseFailure).message).toContain('Navigation exploded');
  });
});
