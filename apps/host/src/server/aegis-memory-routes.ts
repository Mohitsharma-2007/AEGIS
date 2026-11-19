// AEGIS glue (W-MEM): HTTP routes that surface the Aegis daemon's
// four-layer memory (services/daemon) to the Aegis client.
// Thin proxies over the fail-soft typed client in aegis-daemon.ts  
// a down daemon yields reachable:false payloads, never a 500.
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import {
  callAegisResearchTool,
  deleteAegisCapture,
  getAegisCapture,
  getAegisCaptures,
  getAegisGraph,
  getAegisMemoryState,
  queryAegisGraph,
  searchAegisMemory,
} from './aegis-daemon.js';
import {
  removeDocumentFromStair,
} from './stair-indexer.js';
import { decideMemory } from './memory-agent.js';

import type { Store } from './store.js';
import { getGlobalStore } from './store.js';

export function aegisMemoryRoutes(store?: Store) {
  const app = new Hono();
  const getStore = () => store || getGlobalStore();
  app.get('/aegis-memory/state', async (c) =>
    c.json(await getAegisMemoryState()),
  );
  app.get('/aegis-memory/captures', async (c) => {
    const limit = Number(c.req.query('limit') ?? 50) || 50;
    return c.json(await getAegisCaptures(limit));
  });
  app.get('/aegis-memory/captures/:id', async (c) =>
    c.json(await getAegisCapture(c.req.param('id'))),
  );
  // Owner curation of RAG memory: a capture the owner does not want is
  // removed from retrieval (tree nodes dropped, rows tombstoned).
  app.delete('/aegis-memory/captures/:id', async (c) => {
    const result = await deleteAegisCapture(c.req.param('id'));
    return c.json(result, result.ok ? 200 : 502);
  });
  app.get('/aegis-memory/search', async (c) =>
    c.json(await searchAegisMemory(c.req.query('q') ?? '', {}, c.req.query('scope_id') || undefined)),
  );
  const retiredStairRoute = (c: Context) =>
    c.json({ error: 'staircase_memory_retired', message: 'Use the source document memory library and semantic RAG search.' }, 410);
  app.all('/aegis-memory/tree', retiredStairRoute);
  app.all('/aegis-memory/tree/*', retiredStairRoute);
  // Optimise memory: re-run the memory agent's policy over what is already
  // stored and drop entries it would refuse today (task narration, tool noise,
  // one-off detail), so retrieval stops carrying clutter from earlier builds.
  app.post('/aegis-memory/prune', async (c) => {
    const activeStore = getStore();
    const removed: Array<{ id: string; reason: string; title: string }> = [];
    for (const doc of activeStore.memoryDocuments()) {
      if (doc.format !== 'memory') continue;
      // Memory documents carry `[kind: ...] [source: ...]` header lines.
      const body = doc.content.replace(/^(\[[^\]]*\]\s*)+/, '').trim();
      const decision = decideMemory({ text: body });
      if (decision.accept) continue;
      removeDocumentFromStair(doc.id);
      activeStore.deleteMemoryDocument(doc.id);
      removed.push({
        id: doc.id,
        reason: decision.reason ?? 'not_durable',
        title: doc.title,
      });
    }
    return c.json({ ok: true, removed: removed.length, entries: removed });
  });
  app.get('/aegis-memory/graph', async (c) => {
    const entity = c.req.query('entity');
    return c.json(
      entity ? await queryAegisGraph(entity) : await getAegisGraph(),
    );
  });

  app.all('/aegis-memory/ingest', retiredStairRoute);
  app.all('/aegis-memory/ingest-pdf', retiredStairRoute);

  // AEGIS (W-FIX 2c): Research view -> daemon research connectors
  app.post('/aegis-research/tool', async (c) => {
    const body = z
      .object({
        tool: z.string().min(1).max(100),
        args: z.record(z.string(), z.unknown()).default({}),
      })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success)
      return c.json({ error: 'Invalid research request.' }, 400);
    return c.json(
      await callAegisResearchTool(body.data.tool, body.data.args),
    );
  });
  return app;
}
