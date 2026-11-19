import { defineTool, type ToolDefinition } from '@copilotkit/runtime/v2';
import { z } from 'zod';
import { getGlobalStore } from './store.js';
import {
  indexDocument,
  searchUnifiedMemory,
} from './memory-document-service.js';
import {
  loadShortcuts,
  runShortcut,
  saveShortcuts,
  type Shortcut,
  type ShortcutStep,
} from './shortcuts.js';
import { log } from './log.js';

/**
 * Owner-installed agent capabilities.
 *
 * Exposes persistent memory document management, STAIR & daemon RAG search,
 * and desktop application shortcuts with smart Win32 instance reuse.
 */
export function capabilityTools(scopeId?: string): ToolDefinition[] {
  try {
    const memoryCreateDocTool = defineTool({
      name: 'memory_create_document',
      description:
        'Creates a document, saves it to persistent local memory, and indexes it into the hierarchical STAIR knowledge tree and daemon RAG so it is searchable later.',
      parameters: z.object({
        title: z.string().describe('Title of the document'),
        content: z.string().describe('Content in Markdown or plain text'),
        format: z
          .enum(['markdown', 'text', 'pdf'])
          .optional()
          .default('markdown')
          .describe('Document format'),
      }),
      execute: async (args) => {
        const store = getGlobalStore();
        const doc = store.saveMemoryDocument({
          title: args.title,
          content: args.content,
          format: args.format,
          indexState: 'pending',
        });
        const indexed = await indexDocument(store, doc);
        return {
          ok: true,
          id: indexed.id,
          title: indexed.title,
          indexState: indexed.indexState,
          ragChunks: indexed.ragChunkCount,
          error: indexed.error,
        };
      },
    });

    const memoryUpdateDocTool = defineTool({
      name: 'memory_update_document',
      description:
        'Updates an existing memory document and reindexes it into daemon RAG.',
      parameters: z.object({
        id: z.string().describe('ID of the document to update'),
        title: z.string().optional().describe('New title'),
        content: z.string().optional().describe('New content'),
        format: z.enum(['markdown', 'text', 'pdf']).optional(),
      }),
      execute: async (args) => {
        const store = getGlobalStore();
        const updated = store.updateMemoryDocument(args.id, {
          title: args.title,
          content: args.content,
          format: args.format,
        });
        if (!updated) {
          return { ok: false, error: `Document '${args.id}' not found.` };
        }
        const indexed = await indexDocument(store, updated);
        return {
          ok: true,
          id: indexed.id,
          title: indexed.title,
          indexState: indexed.indexState,
          ragChunks: indexed.ragChunkCount,
          error: indexed.error,
        };
      },
    });

    const memorySearchTool = defineTool({
      name: 'memory_search',
      description:
        'Searches across persistent memory documents and daemon RAG memory. Returns deduplicated hits with sources.',
      parameters: z.object({
        query: z.string().describe('Search query for documents or knowledge'),
      }),
      execute: async (args) => {
        const store = getGlobalStore();
        const results = await searchUnifiedMemory(store, args.query, scopeId);
        return {
          query: args.query,
          count: results.length,
          results,
        };
      },
    });

    const memoryListDocsTool = defineTool({
      name: 'memory_list_documents',
      description:
        'Lists persistent memory documents with their IDs, titles, formats, and indexing states.',
      parameters: z.object({}),
      execute: async () => {
        const store = getGlobalStore();
        const docs = store.memoryDocuments();
        return {
          count: docs.length,
          documents: docs.map((d) => ({
            id: d.id,
            title: d.title,
            format: d.format,
            indexState: d.indexState,
            ragChunkCount: d.ragChunkCount,
            createdAt: d.createdAt,
            updatedAt: d.updatedAt,
          })),
        };
      },
    });

    const memoryReindexTool = defineTool({
      name: 'memory_reindex',
      description:
        'Forces reindexing of a persistent memory document by ID into daemon RAG.',
      parameters: z.object({
        id: z.string().describe('ID of the document to reindex'),
      }),
      execute: async (args) => {
        const store = getGlobalStore();
        const doc = store.memoryDocument(args.id);
        if (!doc) {
          return { ok: false, error: `Document '${args.id}' not found.` };
        }
        const indexed = await indexDocument(store, doc);
        return {
          ok: true,
          id: indexed.id,
          indexState: indexed.indexState,
          ragChunks: indexed.ragChunkCount,
          error: indexed.error,
        };
      },
    });

    const runShortcutTool = defineTool({
      name: 'run_shortcut',
      description:
        'Runs a desktop application shortcut or automation sequence with smart Win32 window reuse (activates running instance rather than spawning duplicates). Seeded shortcuts include: calc, notepad, explorer, chrome, terminal, settings.',
      parameters: z.object({
        shortcut: z
          .string()
          .describe(
            'Name or ID of the shortcut to run, e.g. "calc", "notepad", "chrome", "explorer", "terminal", "settings"',
          ),
      }),
      execute: async (args) => {
        const res = await runShortcut(args.shortcut);
        return {
          ok: res.ok,
          shortcut: res.shortcut?.name ?? args.shortcut,
          output: res.output,
          error: res.error,
        };
      },
    });

    const listShortcutsTool = defineTool({
      name: 'list_shortcuts',
      description:
        'Lists all configured desktop application shortcuts and automations.',
      parameters: z.object({}),
      execute: async () => {
        const shortcuts = loadShortcuts();
        return {
          count: shortcuts.length,
          shortcuts: shortcuts.map((s) => ({
            id: s.id,
            name: s.name,
            description: s.description,
            target: s.target,
            type: s.type,
            hotkey: s.hotkey,
          })),
        };
      },
    });

    const createShortcutTool = defineTool({
      name: 'create_shortcut',
      description:
        'Creates and saves a new application shortcut or automation.',
      parameters: z.object({
        name: z.string().describe('Display name of the shortcut'),
        target: z.string().describe('Executable, command, or URL target'),
        type: z
          .enum(['app', 'command', 'sequence', 'url'])
          .describe('Shortcut type'),
        description: z
          .string()
          .optional()
          .default('')
          .describe('Short explanation of what it does'),
      }),
      execute: async (args) => {
        const shortcuts = loadShortcuts();
        const newSc: Shortcut = {
          id: `sc_${Math.random().toString(36).slice(2, 9)}`,
          name: args.name,
          description: args.description || '',
          target: args.target,
          type: args.type,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        shortcuts.push(newSc);
        saveShortcuts(shortcuts);
        return { ok: true, shortcut: newSc };
      },
    });

    const runSequenceTool = defineTool({
      name: 'run_sequence',
      description:
        'Executes a multi-step sequence of desktop actions or shortcuts in order.',
      parameters: z.object({
        steps: z
          .array(
            z.object({
              action: z.enum(['open_app', 'exec', 'open_url']),
              target: z.string().describe('Target app, command, or url'),
            }),
          )
          .describe('Ordered list of steps to execute'),
      }),
      execute: async (args) => {
        const results: string[] = [];
        for (const step of args.steps as ShortcutStep[]) {
          if (step.action === 'open_app') {
            const res = await runShortcut(step.target);
            results.push(`App ${step.target}: ${res.ok ? 'reused/launched' : res.error}`);
          } else {
            const res = await runShortcut(step.target);
            results.push(`${step.action} ${step.target}: ${res.ok ? 'success' : res.error}`);
          }
        }
        return { ok: true, completedSteps: results.length, log: results };
      },
    });

    return [
      memoryCreateDocTool,
      memoryUpdateDocTool,
      memorySearchTool,
      memoryListDocsTool,
      memoryReindexTool,
      runShortcutTool,
      listShortcutsTool,
      createShortcutTool,
      runSequenceTool,
    ];
  } catch (err) {
    log.warn?.(`Failed to initialize capability tools: ${err}`);
    return [];
  }
}
