import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { Store } from '../src/server/store.js';
import { memoryDocumentRoutes } from '../src/server/memory-document-routes.js';
import { setGlobalStore } from '../src/server/store.js';

describe('Memory Document Routes (/api/memory/...)', () => {
  let store: Store;
  let app: Hono;

  beforeEach(() => {
    store = new Store(':memory:');
    setGlobalStore(store);
    app = new Hono();
    app.route('/api', memoryDocumentRoutes(store));
  });

  afterEach(() => {
    store.close();
  });

  it('GET /api/memory/documents returns empty list initially', async () => {
    const res = await app.request('/api/memory/documents');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(0);
  });

  it('POST /api/memory/documents creates, persists and indexes markdown document', async () => {
    const payload = {
      title: 'Aegis Security Guide',
      content: '# Architecture\n\nAegis runs locally.\n\n## Network\n\nAll outbound calls are gated.',
      format: 'markdown',
    };
    const res = await app.request('/api/memory/documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBeDefined();
    expect(body.title).toBe('Aegis Security Guide');
    expect(body.content).toContain('All outbound calls are gated.');
    // indexState is either indexed or pending (if daemon offline)
    expect(['indexed', 'pending']).toContain(body.indexState);
    expect(body.ragChunkCount).toBeGreaterThanOrEqual(0);

    // Verify it is listed
    const listRes = await app.request('/api/memory/documents');
    const list = await listRes.json();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(body.id);
  });

  it('GET /api/memory/documents/:id returns specific document', async () => {
    const doc = store.saveMemoryDocument({
      title: 'DevOps Handbook',
      content: 'Local Docker and serverless pipelines.',
    });

    const res = await app.request(`/api/memory/documents/${doc.id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.title).toBe('DevOps Handbook');

    const notFound = await app.request('/api/memory/documents/non_existent_id');
    expect(notFound.status).toBe(404);
  });

  it('PATCH /api/memory/documents/:id updates and reindexes document', async () => {
    const doc = store.saveMemoryDocument({
      title: 'Original Title',
      content: 'Original content.',
    });

    const res = await app.request(`/api/memory/documents/${doc.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Updated Title',
        content: '# New Section\n\nUpdated content with more detail.',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.title).toBe('Updated Title');
    expect(body.content).toContain('Updated content with more detail.');

    const persisted = store.memoryDocument(doc.id);
    expect(persisted?.title).toBe('Updated Title');
  });

  it('DELETE /api/memory/documents/:id removes document', async () => {
    const doc = store.saveMemoryDocument({
      title: 'Temp Doc',
      content: 'To be deleted.',
    });

    const res = await app.request(`/api/memory/documents/${doc.id}`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(200);

    const check = store.memoryDocument(doc.id);
    expect(check).toBeUndefined();
  });

  it('POST /api/memory/documents/:id/reindex triggers reindexing', async () => {
    const doc = store.saveMemoryDocument({
      title: 'To Reindex',
      content: '# Chapter 1\n\nContent here.',
      indexState: 'pending',
    });

    const res = await app.request(`/api/memory/documents/${doc.id}/reindex`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(doc.id);
    expect(body.ragChunkCount).toBeGreaterThanOrEqual(0);
  });

  it('GET /api/memory/search?q= finds documents by substring', async () => {
    store.saveMemoryDocument({
      title: 'Agent Workflow',
      content: 'Autonomous orchestration using subagents and background tasks.',
    });

    const res = await app.request('/api/memory/search?q=orchestration');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBeGreaterThanOrEqual(1);
    expect(body.results.some((r: any) => r.text.includes('Autonomous orchestration'))).toBe(true);
  });

  it('GET /api/memory/health reports honest health state', async () => {
    store.saveMemoryDocument({
      title: 'Doc A',
      content: 'Content A',
      indexState: 'pending',
    });

    const res = await app.request('/api/memory/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.daemonReachable).toBe('boolean');
    expect(body.documents).toBe(1);
    expect(body.pending).toBe(1);
    expect(typeof body.stairNodes).toBe('number');
  });
});
