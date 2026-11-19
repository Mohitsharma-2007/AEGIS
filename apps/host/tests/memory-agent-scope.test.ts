import { beforeEach, describe, expect, it, vi } from 'vitest';

const { indexDocument } = vi.hoisted(() => ({
  indexDocument: vi.fn(async (_store: unknown, document: unknown) => document),
}));

vi.mock('../src/server/memory-document-service.js', () => ({ indexDocument }));

import type { Store } from '../src/server/store.js';
import { runMemoryAgent } from '../src/server/memory-agent.js';

function memoryStore(): Store {
  return {
    memoryDocuments: () => [],
    memories: () => [],
    saveMemoryDocument: (doc: Record<string, unknown>) => ({
      id: 'memory-test-1',
      title: String(doc.title ?? ''),
      content: String(doc.content ?? ''),
      format: 'memory',
      indexState: 'pending',
    }),
  } as unknown as Store;
}

describe('memory agent scope routing', () => {
  beforeEach(() => indexDocument.mockClear());

  it('sends personal facts to global personal memory', async () => {
    const store = memoryStore();
    const result = await runMemoryAgent(store, {
      text: 'My name is Mohit Sharma.',
      category: 'personal',
    });

    expect(result.stored).toBe(true);
    expect(indexDocument).toHaveBeenCalledWith(
      store,
      expect.objectContaining({ id: 'memory-test-1' }),
      { category: 'personal', scopeId: undefined },
    );
  });

  it('keeps explicitly requested task memories scoped to the current chat', async () => {
    const store = memoryStore();
    const result = await runMemoryAgent(store, {
      text: 'Remember this task outcome: repository tests pass after the update.',
      category: 'task',
      scopeId: 'thread-42',
      force: true,
    });

    expect(result.stored).toBe(true);
    expect(indexDocument).toHaveBeenCalledWith(
      store,
      expect.objectContaining({ id: 'memory-test-1' }),
      { category: 'task', scopeId: 'thread-42' },
    );
  });
});
