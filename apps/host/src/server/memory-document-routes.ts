import { Hono } from 'hono';
import { z } from 'zod';
import type { Store } from './store.js';
import {
  classifyDocument,
  getMemoryHealth,
  indexDocument,
  searchUnifiedMemory,
} from './memory-document-service.js';
import { removeDocumentFromStair } from './stair-indexer.js';
import { runMemoryAgent } from './memory-agent.js';

export function memoryDocumentRoutes(store: Store) {
  const app = new Hono();

  // GET /memory/documents — every document is reported with its detected
  // class so the memory surface can group by document type.
  app.get('/memory/documents', (c) => {
    return c.json(
      store.memoryDocuments().map((doc) => ({
        ...doc,
        documentClass: classifyDocument(doc.title, doc.content),
      })),
    );
  });

  // POST /memory/capture — the structured write path for agents: a typed
  // fact/preference/instruction with provenance, context and importance.
  // Identical content is deduplicated instead of stored twice.
  app.post('/memory/capture', async (c) => {
    const body = z
      .object({
        text: z.string().trim().min(1).max(20000),
        title: z.string().trim().min(1).max(200).optional(),
        source: z.string().trim().min(1).max(120).optional(),
        kind: z
          .enum(['fact', 'preference', 'event', 'instruction', 'note'])
          .optional(),
        context: z.string().trim().max(2000).optional(),
        importance: z.number().min(0).max(1).optional(),
        force: z.boolean().optional(),
      })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return c.json({ error: 'text is required (1-20000 chars).' }, 400);
    }
    // Every capture goes through the memory agent: it decides whether this is
    // a durable fact worth keeping, and rejects task narration and clutter.
    const decision = await runMemoryAgent(store, {
      text: body.data.text,
      source: body.data.source ?? 'agent',
      kind: body.data.kind,
      context: body.data.context,
      force: body.data.force === true,
    });
    if (!decision.stored) {
      return c.json(
        {
          ok: false,
          stored: false,
          reason: decision.reason,
          duplicateOf: decision.duplicateOf,
        },
        200,
      );
    }
    const saved = decision.id ? store.memoryDocument(decision.id) : undefined;
    return c.json(saved ?? { ok: true, stored: true, id: decision.id }, 201);
  });

  // POST /memory/documents
  app.post('/memory/documents', async (c) => {
    const body = z
      .object({
        title: z.string().min(1),
        content: z.string().min(1),
        format: z.string().optional().default('markdown'),
      })
      .safeParse(await c.req.json().catch(() => null));

    if (!body.success) {
      return c.json({ error: 'Title and content are required.' }, 400);
    }

    const doc = store.saveMemoryDocument({
      title: body.data.title,
      content: body.data.content,
      format: body.data.format,
      indexState: 'pending',
    });

    // Run indexing
    const indexed = await indexDocument(store, doc);
    return c.json(indexed, 201);
  });

  // GET /memory/documents/:id
  app.get('/memory/documents/:id', (c) => {
    const doc = store.memoryDocument(c.req.param('id'));
    if (!doc) {
      return c.json({ error: 'Document not found' }, 404);
    }
    return c.json(doc);
  });

  // PATCH /memory/documents/:id
  app.patch('/memory/documents/:id', async (c) => {
    const id = c.req.param('id');
    const existing = store.memoryDocument(id);
    if (!existing) {
      return c.json({ error: 'Document not found' }, 404);
    }

    const body = z
      .object({
        title: z.string().min(1).optional(),
        content: z.string().min(1).optional(),
        format: z.string().optional(),
      })
      .safeParse(await c.req.json().catch(() => null));

    if (!body.success) {
      return c.json({ error: 'Invalid update payload' }, 400);
    }

    const updated = store.updateMemoryDocument(id, {
      ...body.data,
      indexState: 'pending',
      error: null,
    });

    if (!updated) {
      return c.json({ error: 'Document not found' }, 404);
    }

    const indexed = await indexDocument(store, updated);
    return c.json(indexed);
  });

  // DELETE /memory/documents/:id
  app.delete('/memory/documents/:id', (c) => {
    const id = c.req.param('id');
    const existing = store.memoryDocument(id);
    const ok = store.deleteMemoryDocument(id);
    if (!ok) {
      return c.json({ error: 'Document not found' }, 404);
    }
    removeDocumentFromStair(id, existing?.title);
    return c.json({ ok: true, deleted: id });
  });

  // PATCH /memory/documents/:id/tier — classify a document as short-term
  // (working context) or long-term (durable knowledge).
  app.patch('/memory/documents/:id/tier', async (c) => {
    const id = c.req.param('id');
    const body = z
      .object({ tier: z.enum(['short', 'long']) })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return c.json({ error: 'tier must be "short" or "long".' }, 400);
    }
    const updated = store.updateMemoryDocument(id, { tier: body.data.tier });
    if (!updated) {
      return c.json({ error: 'Document not found' }, 404);
    }
    return c.json(updated);
  });

  // POST /memory/documents/:id/reindex
  app.post('/memory/documents/:id/reindex', async (c) => {
    const id = c.req.param('id');
    const existing = store.memoryDocument(id);
    if (!existing) {
      return c.json({ error: 'Document not found' }, 404);
    }

    const indexed = await indexDocument(store, existing);
    return c.json(indexed);
  });

  // GET /memory/search?q=
  app.get('/memory/search', async (c) => {
    const q = c.req.query('q') ?? '';
    const scopeId = c.req.query('scope_id') || undefined;
    const hits = await searchUnifiedMemory(store, q, scopeId);
    return c.json({ query: q, count: hits.length, results: hits });
  });

  // GET /memory/health
  app.get('/memory/health', async (c) => {
    const health = await getMemoryHealth(store);
    return c.json(health);
  });

  return app;
}
