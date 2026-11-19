import { afterAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { aegisMemoryRoutes } from '../src/server/aegis-memory-routes.js';
import { Store } from '../src/server/store.js';

describe('retired staircase memory routes', () => {
  const store = new Store(':memory:');
  const app = new Hono().route('/api', aegisMemoryRoutes(store));

  afterAll(() => store.close());

  it.each([
    ['GET', '/api/aegis-memory/tree'],
    ['GET', '/api/aegis-memory/tree/address?q=guide'],
    ['DELETE', '/api/aegis-memory/tree/nodes/section-1'],
    ['POST', '/api/aegis-memory/ingest'],
    ['POST', '/api/aegis-memory/ingest-pdf'],
  ])('%s %s returns an explicit retirement response', async (method, path) => {
    const response = await app.request(path, { method });
    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toMatchObject({
      error: 'staircase_memory_retired',
    });
  });
});
