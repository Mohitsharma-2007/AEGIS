import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { unlinkSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../src/server/store.js';
import {
  indexDocument,
  indexWorkspaceUploads,
  searchUnifiedMemory,
  getMemoryHealth,
} from '../src/server/memory-document-service.js';
import { replaceDocumentNodes } from '../src/server/stair-indexer.js';

describe('Memory Engine & Reconciler', () => {
  let dbPath: string;
  let store: Store;

  beforeEach(() => {
    dbPath = join(tmpdir(), `aegis-mem-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.sqlite`);
    store = new Store(dbPath);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    try {
      store.close();
      if (existsSync(dbPath)) unlinkSync(dbPath);
    } catch {
      // ignore
    }
  });

  it('persists documents to SQLite across restarts', () => {
    const doc = store.saveMemoryDocument({
      title: 'Persistent Document',
      content: 'This document survives restarts.',
      format: 'markdown',
      indexState: 'pending',
    });

    expect(doc.id).toBeDefined();

    // Close and reopen database
    store.close();
    const reopened = new Store(dbPath);

    const retrieved = reopened.memoryDocument(doc.id);
    expect(retrieved).toBeDefined();
    expect(retrieved?.title).toBe('Persistent Document');
    expect(retrieved?.content).toBe('This document survives restarts.');

    const all = reopened.memoryDocuments();
    expect(all.length).toBe(1);
    reopened.close();
  });

  it('migrates existing memory databases to the RAG chunk-count field', () => {
    const legacyPath = join(tmpdir(), `aegis-mem-legacy-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.sqlite`);
    const legacy = new DatabaseSync(legacyPath);
    legacy.exec(`CREATE TABLE memory_documents (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL,
      format TEXT NOT NULL DEFAULT 'markdown', indexState TEXT NOT NULL DEFAULT 'pending',
      error TEXT, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL,
      indexedAt INTEGER, stairChunkCount INTEGER DEFAULT 0
    )`);
    legacy.close();
    const migrated = new Store(legacyPath);
    const doc = migrated.saveMemoryDocument({ title: 'Migrated', content: 'Text', ragChunkCount: 7 });
    expect(doc.ragChunkCount).toBe(7);
    migrated.close();
    unlinkSync(legacyPath);
  });

  it('updates document metadata and index state', () => {
    const doc = store.saveMemoryDocument({
      title: 'Initial',
      content: 'Initial text',
    });

    const updated = store.updateMemoryDocument(doc.id, {
      title: 'Modified',
      indexState: 'indexed',
      indexedAt: Date.now(),
      ragChunkCount: 3,
    });

    expect(updated?.title).toBe('Modified');
    expect(updated?.indexState).toBe('indexed');
    expect(updated?.ragChunkCount).toBe(3);

    const fetched = store.memoryDocument(doc.id);
    expect(fetched?.title).toBe('Modified');
    expect(fetched?.indexState).toBe('indexed');
  });

  it('searches documents by title and content substring', () => {
    store.saveMemoryDocument({
      title: 'Quantum Computing Notes',
      content: 'Qubits, entanglement and superposition.',
    });
    store.saveMemoryDocument({
      title: 'General Cooking Recipes',
      content: 'Pasta, olive oil and garlic.',
    });

    const quantumHits = store.searchMemoryDocuments('entanglement');
    expect(quantumHits.length).toBe(1);
    expect(quantumHits[0].title).toBe('Quantum Computing Notes');

    const cookingHits = store.searchMemoryDocuments('Pasta');
    expect(cookingHits.length).toBe(1);
    expect(cookingHits[0].title).toBe('General Cooking Recipes');

    const noHits = store.searchMemoryDocuments('nonexistentphrasexyz');
    expect(noHits.length).toBe(0);
  });

  it('indexes workspace documents through the daemon memory endpoint and reports actual RAG chunks', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      chunks_created: 4,
      capture_id: 'capture-1',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    const doc = store.saveMemoryDocument({
      title: 'API Specification',
      content: '# Endpoints\n\nGET /users\n\n## Sub-endpoint\n\nPOST /users/create',
    });

    const indexed = await indexDocument(store, doc);
    expect(indexed.indexState).toBe('indexed');
    expect(indexed.ragChunkCount).toBe(4);
  });

  it('keeps documents pending when the daemon refuses or cannot index them', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: 'memory_disabled',
    }), { status: 403, headers: { 'Content-Type': 'application/json' } })));
    const doc = store.saveMemoryDocument({ title: 'Pending source', content: 'Source text.' });
    const indexed = await indexDocument(store, doc);
    expect(indexed.indexState).toBe('pending');
    expect(indexed.error).toContain('memory_disabled');
  });

  it('indexes bounded text files from the workspace upload tray with provenance', async () => {
    const uploadsDir = join(tmpdir(), `aegis-upload-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    mkdirSync(uploadsDir, { recursive: true });
    const sourcePath = join(uploadsDir, 'project-notes.md');
    writeFileSync(sourcePath, '# Project Notes\n\nKeep this document searchable.', 'utf8');
    writeFileSync(join(uploadsDir, 'opaque.pdf'), Buffer.from([0, 1, 2, 3]));
    const request = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      chunks_created: 2,
      capture_id: 'upload-capture',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', request);

    try {
      expect(await indexWorkspaceUploads(store, { uploadsDir })).toBe(1);
      const document = store.memoryDocuments()[0];
      expect(document.title).toBe('project-notes.md');
      expect(document.sourcePath).toBe(sourcePath);
      expect(document.sourceSizeBytes).toBeGreaterThan(0);
      expect(document.ragChunkCount).toBe(2);
      expect(await indexWorkspaceUploads(store, { uploadsDir })).toBe(0);
      expect(request).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(uploadsDir, { recursive: true, force: true });
    }
  });

  it('replaces prior STAIR chunks for the same document without touching other documents', () => {
    const node = (id: string, document_id: string) => ({
      id, doc_title: document_id, leaf_title: id, title: id, title_path: id,
      level: 1, parent_id: null, is_leaf: true, capture_id: null, text: id,
    });
    const existing = [node('doc-a_old-chunk', 'doc-a'), node('doc-b_old-chunk', 'doc-b')];
    const incoming = [node('doc-a_new-chunk', 'doc-a')];
    expect(replaceDocumentNodes(existing, incoming, 'doc-a').map((item) => item.id)).toEqual([
      'doc-b_old-chunk', 'doc-a_new-chunk',
    ]);
  });

  it('searchUnifiedMemory aggregates exact SQLite and semantic RAG without title-only tree results', async () => {
    const doc = store.saveMemoryDocument({
      title: 'Hydra Orchestration',
      content: 'High-speed parallel cluster manager for AI models.',
    });
    await indexDocument(store, doc);

    const results = await searchUnifiedMemory(store, 'Hydra Orchestration');
    expect(results.length).toBeGreaterThanOrEqual(1);
    const hit = results.find((r) => r.title.includes('Hydra Orchestration') || r.text.includes('High-speed parallel'));
    expect(hit).toBeDefined();
    expect(['sqlite', 'daemon_rag']).toContain(hit?.source);
    expect(results.every((result) => result.source !== 'stair')).toBe(true);
  });

  it('getMemoryHealth returns aggregate statistics', async () => {
    store.saveMemoryDocument({
      title: 'Doc 1',
      content: 'Text 1',
      indexState: 'pending',
    });
    store.saveMemoryDocument({
      title: 'Doc 2',
      content: 'Text 2',
      indexState: 'failed',
    });

    const health = await getMemoryHealth(store);
    expect(health.documents).toBe(2);
    expect(health.pending).toBe(1);
    expect(health.failed).toBe(1);
    expect(typeof health.stairNodes).toBe('number');
  });
});
