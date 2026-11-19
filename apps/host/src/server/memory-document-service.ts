import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import type { Store, MemoryDocument } from './store.js';
import {
  callAegisResearchTool,
  getAegisMemoryState,
  rememberAegisMemory,
  searchAegisMemory,
} from './aegis-daemon.js';
import { log } from './log.js';
import { aegisRootDir } from './harness.js';

export interface UnifiedMemorySearchResult {
  id: string;
  title: string;
  text: string;
  source: 'sqlite' | 'stair' | 'daemon_rag';
  score?: number;
  docId?: string;
  path?: string;
}

export type DocumentClass =
  | 'report'
  | 'contract'
  | 'manual'
  | 'notes'
  | 'email'
  | 'slides'
  | 'spreadsheet'
  | 'code'
  | 'resume'
  | 'research'
  | 'chat-log'
  | 'memory'
  | 'other';

const CLASS_SIGNALS: Array<[DocumentClass, RegExp]> = [
  ['contract', /\b(agreement|contract|party|parties|hereby|clause|indemnif|terms and conditions|signature)\b/i],
  ['resume', /\b(curriculum vitae|resume|work experience|education|skills|references)\b/i],
  ['slides', /\b(slide|deck|agenda|keynote|presentation|takeaways)\b/i],
  ['spreadsheet', /\b(spreadsheet|worksheet|column|row|budget|forecast|pivot)\b/i],
  ['report', /\b(report|assessment|analysis|findings|executive summary|recommendation)\b/i],
  ['manual', /\b(manual|guide|installation|troubleshoot|step [0-9]|procedure|how to)\b/i],
  ['research', /\b(abstract|methodology|literature review|citation|et al|doi|references)\b/i],
  ['notes', /\b(meeting notes|todo|action items|minutes|agenda item)\b/i],
  ['email', /\b(from:|to:|subject:|dear |regards,|forwarded message)\b/i],
  ['chat-log', /\b(user:|assistant:|you said|transcript)\b/i],
  ['code', /\b(function |class |import |const |def |return |package )\b/],
];

/**
 * Classify a document so memory can be structured by document class rather
 * than storing an undifferentiated blob. Cheap, deterministic (no model call),
 * and used both on ingest and when listing documents.
 */
export function classifyDocument(title: string, content: string): DocumentClass {
  const filename = title.toLowerCase();
  if (/\.(pptx?|key)$/.test(filename)) return 'slides';
  if (/\.(xlsx?|csv)$/.test(filename)) return 'spreadsheet';
  if (/\.(ts|tsx|js|jsx|py|go|rs|java|sh)$/.test(filename)) return 'code';
  if (/\.(md|txt|pdf|docx?|rtf)$/.test(filename)) {
    // fall through to content signals for a more specific class
  }
  // Agent captures carry their own typed header — that is the strongest
  // signal available, so trust it over keyword scoring.
  if (/\[kind:\s*(fact|preference|event|instruction|note)\]/i.test(content)) {
    return 'memory';
  }
  const sample = `${title}\n${content.slice(0, 4000)}`;
  let best: { cls: DocumentClass; hits: number; at: number } = {
    cls: 'other',
    hits: 0,
    at: Number.MAX_SAFE_INTEGER,
  };
  CLASS_SIGNALS.forEach(([cls, pattern], index) => {
    const matches = sample.match(new RegExp(pattern.source, 'gi'));
    const hits = matches ? matches.length : 0;
    if (hits > best.hits || (hits === best.hits && hits > 0 && index < best.at)) {
      best = { cls, hits, at: index };
    }
  });
  return best.hits >= 1 ? best.cls : 'other';
}

export interface MemoryHealth {
  daemonReachable: boolean;
  documents: number;
  pending: number;
  failed: number;
  stairNodes: number;
  lastSyncAt: number | null;
  lastError: string | null;
}

let lastSyncAt: number | null = null;
let lastError: string | null = null;
let reconcilerTimer: NodeJS.Timeout | null = null;
let isReconciling = false;

const TEXT_UPLOAD_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.csv', '.json', '.yaml', '.yml', '.toml',
  '.ini', '.py', '.ts', '.tsx', '.js', '.jsx', '.sh', '.html', '.css',
  '.xml', '.log', '.sql', '.rs', '.go', '.java', '.c', '.cpp', '.h',
]);
const MAX_WORKSPACE_UPLOAD_BYTES = 1_000_000;
const MAX_WORKSPACE_UPLOADS_PER_PASS = 4;

/** Index supported text files saved by the workspace/Notch file tray. */
export async function indexWorkspaceUploads(
  store: Store,
  options: { uploadsDir?: string; maxFiles?: number } = {},
): Promise<number> {
  const uploadsDir = options.uploadsDir ?? join(aegisRootDir(), '.aegis-data', 'uploads');
  const maxFiles = Math.max(1, Math.min(options.maxFiles ?? MAX_WORKSPACE_UPLOADS_PER_PASS, 20));
  let indexed = 0;
  try {
    const entries = await readdir(uploadsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !TEXT_UPLOAD_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue;
      const sourcePath = resolve(join(uploadsDir, entry.name));
      const info = await stat(sourcePath);
      if (info.size < 1 || info.size > MAX_WORKSPACE_UPLOAD_BYTES) continue;
      const id = `upload_${createHash('sha256').update(sourcePath.toLowerCase()).digest('hex').slice(0, 32)}`;
      const existing = store.memoryDocument(id);
      if (
        existing && existing.sourceModifiedAt === Math.trunc(info.mtimeMs) &&
        existing.sourceSizeBytes === info.size
      ) continue;

      const content = await readFile(sourcePath, 'utf8');
      if (!content.trim() || content.includes('\u0000')) continue;
      const document = store.saveMemoryDocument({
        id,
        title: basename(sourcePath),
        content,
        format: extname(sourcePath).slice(1).toLowerCase() || 'text',
        indexState: 'pending',
        error: null,
        sourcePath,
        sourceModifiedAt: Math.trunc(info.mtimeMs),
        sourceSizeBytes: info.size,
      });
      await indexDocument(store, document);
      indexed += 1;
      if (indexed >= maxFiles) break;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      log.warn?.(`Workspace document indexing skipped: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return indexed;
}

/**
 * Workspace documents use the daemon's chunked RAG index as their single
 * retrieval index. The local STAIR tree is intentionally not populated until
 * its research and product contract are settled.
 */
export async function indexDocument(
  store: Store,
  doc: MemoryDocument,
  memoryScope: { category?: 'personal' | 'task' | 'document' | 'preference' | 'note'; scopeId?: string } = {},
): Promise<MemoryDocument> {
  // Persist source text and build RAG chunks through the daemon memory API.
  let daemonSuccess = false;
  let daemonError: string | null = null;
  let ragChunkCount = doc.ragChunkCount ?? 0;
  try {
    const docClass = classifyDocument(doc.title, doc.content);
    const response = await rememberAegisMemory({
      // The class header gives retrieval the document type as context, so a
      // "report" and a "contract" with similar wording stay distinguishable.
      text: `[document class: ${docClass}]\n${doc.title}\n\n${doc.content}`,
      source: `doc:${doc.id}`,
      category: memoryScope.category ?? 'document',
      scopeId: memoryScope.scopeId,
    });
    const result = response.result;
    if (response.reachable && result?.ok === true) {
      daemonSuccess = true;
      const count = result.chunks_created;
      if (typeof count === 'number' && Number.isFinite(count)) {
        ragChunkCount = Math.max(0, Math.floor(count));
      }
    } else {
      daemonError = typeof result?.error === 'string'
        ? result.error
        : response.detail ?? 'The daemon did not confirm memory indexing.';
    }
  } catch (err) {
    daemonError = err instanceof Error ? err.message : String(err);
  }

  if (daemonSuccess) {
    lastSyncAt = Date.now();
    lastError = null;
    return (
      store.updateMemoryDocument(doc.id, {
        indexState: 'indexed',
        indexedAt: Date.now(),
        error: null,
        ragChunkCount,
      }) ?? doc
    );
  } else {
    const failureReason = daemonError || 'Python memory daemon unreachable or offline';
    lastError = failureReason;
    return (
      store.updateMemoryDocument(doc.id, {
        indexState: 'pending',
        error: failureReason,
        ragChunkCount,
      }) ?? doc
    );
  }
}

/**
 * Host-side unified memory search. SQLite provides exact document matches;
 * daemon RAG provides semantic chunk matches. Avoid title-only tree hits.
 */
export async function searchUnifiedMemory(
  store: Store,
  query: string,
  scopeId?: string,
): Promise<UnifiedMemorySearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const results: UnifiedMemorySearchResult[] = [];
  const seenContent = new Set<string>();

  const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();

  // 1. SQLite substring search from persistent documents
  try {
    const sqliteDocs = store.searchMemoryDocuments(trimmed);
    const terms = trimmed.toLowerCase().split(/\s+/).filter(Boolean);
    for (const doc of sqliteDocs) {
      const norm = normalize(doc.content.slice(0, 160));
      if (!seenContent.has(norm)) {
        seenContent.add(norm);
        // Score by how many query terms actually occur in the document, and
        // return an excerpt, not the whole file.
        const lower = doc.content.toLowerCase();
        const hits = terms.filter((term) => lower.includes(term)).length;
        const score = terms.length ? Math.min(1, hits / terms.length) : 0.3;
        results.push({
          id: `doc_${doc.id}`,
          docId: doc.id,
          title: doc.title,
          text: doc.content.slice(0, 1200),
          source: 'sqlite',
          score: Math.max(0.15, score),
        });
      }
    }
  } catch {
    // best-effort
  }

  // 2. Python daemon RAG search
  try {
    const daemonHits = await searchAegisMemory(trimmed, {}, scopeId);
    if (daemonHits && Array.isArray(daemonHits.results)) {
      for (let i = 0; i < daemonHits.results.length; i++) {
        const hit = daemonHits.results[i] as {
          id?: string;
          title?: string;
          content?: string;
          text?: string;
          score?: number;
          source?: string;
        };
        const text = hit.content || hit.text || '';
        const title = hit.title || 'Daemon Knowledge';
        const norm = normalize(text.slice(0, 160) || title);
        if (!seenContent.has(norm)) {
          seenContent.add(norm);
          results.push({
            id: hit.id || `daemon_${i}_${Date.now()}`,
            title,
            text,
            source: 'daemon_rag',
            score: typeof hit.score === 'number' ? hit.score : 0.85,
            path: hit.source,
          });
        }
      }
    }
  } catch {
    // best-effort
  }

  return results;
}

/**
 * Returns memory subsystem health across daemon RAG and workspace documents.
 */
export async function getMemoryHealth(store: Store): Promise<MemoryHealth> {
  const docs = store.memoryDocuments();
  const pending = docs.filter((d) => d.indexState === 'pending').length;
  const failed = docs.filter((d) => d.indexState === 'failed').length;
  const daemonReachable = await getAegisMemoryState()
    .then((state) => Boolean(state.reachable))
    .catch(() => false);

  return {
    daemonReachable,
    documents: docs.length,
    pending,
    failed,
    // Kept in the response for older UI clients; staircase indexing is dormant.
    stairNodes: 0,
    lastSyncAt,
    lastError,
  };
}

/**
 * Reconciles pending and failed documents every 60s in the background.
 * Unref'd timer, never throws into boot or turn.
 */
export function startMemoryReconciler(store: Store): void {
  if (reconcilerTimer) return;

  const runReconcile = async () => {
    if (isReconciling) return;
    isReconciling = true;
    try {
      const docs = store.memoryDocuments();
      const needsIndex = docs.filter(
        (d) => d.indexState === 'pending' || d.indexState === 'failed' ||
          (d.content.trim().length > 0 && d.ragChunkCount === 0),
      );

      // Retry pending/failed docs and repair old false-positive indexed
      // records that predate real RAG chunk counts.
      for (const doc of needsIndex) {
        await indexDocument(store, doc).catch(() => undefined);
      }

      // Notch and workspace drops write files directly into uploads/. Only
      // read bounded, known-text formats, and avoid waking the daemon while it
      // is offline. Binary files remain available in Files but are not embedded.
      const daemon = await getAegisMemoryState().catch(() => ({ reachable: false }));
      if (daemon.reachable && store.settings().memoryAllowed) {
        await indexWorkspaceUploads(store);
      }
    } catch (err) {
      log.warn?.(`Memory reconciler encountered error: ${err}`);
    } finally {
      isReconciling = false;
    }
  };

  // Run initial non-blocking cycle after 2 seconds
  const initialTimer = setTimeout(() => {
    void runReconcile();
  }, 2000);
  initialTimer.unref();

  // Run standing 60s background cycle
  reconcilerTimer = setInterval(() => {
    void runReconcile();
  }, 60_000);
  reconcilerTimer.unref();
}

export function stopMemoryReconciler(): void {
  if (reconcilerTimer) {
    clearInterval(reconcilerTimer);
    reconcilerTimer = null;
  }
}
