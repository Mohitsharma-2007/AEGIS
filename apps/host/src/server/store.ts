import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  Action,
  Detail,
  Memory,
  Result,
  Run,
  Settings,
  Task,
  TaskEvent,
} from '../shared/types.js';

export type Claim = Task & { lease: string };
export const DEFAULT_WORKER_LEASE_MS = 180_000;

let globalStore: Store | null = null;

export function setGlobalStore(store: Store): void {
  globalStore = store;
}

export function getGlobalStore(): Store {
  if (!globalStore) {
    const dbPath = process.env.DATABASE_PATH ?? 'data/aegis.sqlite';
    globalStore = new Store(dbPath);
  }
  return globalStore;
}

export interface MemoryDocument {
  id: string;
  title: string;
  content: string;
  format: string;
  indexState: 'pending' | 'indexed' | 'failed';
  error: string | null;
  createdAt: number;
  updatedAt: number;
  indexedAt: number | null;
  ragChunkCount: number;
  sourcePath: string | null;
  sourceModifiedAt: number | null;
  sourceSizeBytes: number | null;
  /**
   * Memory tier: 'long' memories persist as durable knowledge; 'short'
   * memories are working context (chat/task material) that the owner can
   * keep out of long-term recall.
   */
  tier: 'short' | 'long';
}
const defaults: Settings = {
  name: 'Aegis',
  paused: false,
  researchAllowed: true,
  memoryAllowed: true,
  appsAllowed: false,
  // Locked by default: reload/DevTools shortcuts stay inert until the
  // owner turns Developer options on in Settings.
  developerOptionsEnabled: false,
  wslEnabled: false,
  soundsEnabled: true,
  mascotEnabled: true,
  desktopSurface: 'notch' as const,
  mascotCharacter: 'auto',
  mascotSize: 96,
  mascotShape: 'auto',
  soundPack: 'warm',
  soundVolume: 0.5,
  wakeWordEnabled: false,
  voicePipelineUrl: 'http://127.0.0.1:8766',
  voiceLanguage: 'auto',
};
export class Store {
  private db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS setup_telemetry (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, prompt TEXT NOT NULL, status TEXT NOT NULL, intervalSeconds INTEGER, nextRunAt INTEGER, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, error TEXT, lease TEXT, leaseUntil INTEGER);
      CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, taskId TEXT NOT NULL, status TEXT NOT NULL, startedAt INTEGER NOT NULL, finishedAt INTEGER, result TEXT, error TEXT);
      CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, taskId TEXT NOT NULL, runId TEXT, text TEXT NOT NULL, breakdown TEXT, createdAt INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS memories (id TEXT PRIMARY KEY, text TEXT NOT NULL, createdAt INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS memory_documents (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        format TEXT NOT NULL DEFAULT 'markdown',
        indexState TEXT NOT NULL DEFAULT 'pending',
        error TEXT,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        indexedAt INTEGER,
        stairChunkCount INTEGER DEFAULT 0,
        ragChunkCount INTEGER NOT NULL DEFAULT 0,
        sourcePath TEXT,
        sourceModifiedAt INTEGER,
        sourceSizeBytes INTEGER,
        tier TEXT NOT NULL DEFAULT 'long'
      );
      CREATE INDEX IF NOT EXISTS memory_docs_state ON memory_documents(indexState);
      CREATE INDEX IF NOT EXISTS memory_docs_created ON memory_documents(createdAt DESC);
      CREATE INDEX IF NOT EXISTS tasks_due ON tasks(status, nextRunAt);
      CREATE INDEX IF NOT EXISTS runs_task ON runs(taskId, startedAt);
      CREATE INDEX IF NOT EXISTS events_task ON events(taskId, id);`);
    const memoryDocumentColumns = this.db
      .prepare('PRAGMA table_info(memory_documents)')
      .all() as Array<{ name: string }>;
    const migrations: Array<[string, string]> = [
      ['ragChunkCount', 'INTEGER NOT NULL DEFAULT 0'],
      ['sourcePath', 'TEXT'],
      ['sourceModifiedAt', 'INTEGER'],
      ['sourceSizeBytes', 'INTEGER'],
      ['tier', "TEXT NOT NULL DEFAULT 'long'"],
    ];
    for (const [column, definition] of migrations) {
      if (!memoryDocumentColumns.some((existing) => existing.name === column)) {
        this.db.exec(`ALTER TABLE memory_documents ADD COLUMN ${column} ${definition}`);
      }
    }
    this.db
      .prepare('INSERT OR IGNORE INTO settings VALUES (1, ?)')
      .run(JSON.stringify(defaults));
  }
  setupTelemetryState(): string | undefined {
    return (
      this.db.prepare('SELECT value FROM setup_telemetry WHERE id=1').get() as
        { value: string } | undefined
    )?.value;
  }
  saveSetupTelemetryState(value: string) {
    this.db
      .prepare('INSERT OR REPLACE INTO setup_telemetry VALUES (1, ?)')
      .run(value);
  }
  clearSetupTelemetry() {
    this.db.prepare('DELETE FROM setup_telemetry').run();
  }
  close() {
    this.db.close();
  }
  private transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const value = fn();
      this.db.exec('COMMIT');
      return value;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  settings(): Settings {
    const row = this.db
      .prepare('SELECT value FROM settings WHERE id=1')
      .get() as { value: string };
    return { ...defaults, ...(JSON.parse(row.value) as Partial<Settings>) };
  }
  updateSettings(patch: Partial<Settings>): Settings {
    return this.transaction(() => {
      const previous = this.settings();
      const settings = { ...previous, ...patch };
      this.db
        .prepare('UPDATE settings SET value=? WHERE id=1')
        .run(JSON.stringify(settings));
      if (
        (!previous.paused && settings.paused) ||
        (previous.researchAllowed && !settings.researchAllowed) ||
        (previous.memoryAllowed && !settings.memoryAllowed) ||
        (previous.appsAllowed && !settings.appsAllowed)
      ) {
        const running = this.tasks().filter((t) => t.status === 'running');
        for (const task of running) {
          this.invalidate(
            task,
            'interrupted',
            'Run interrupted because settings changed. Review completed effects before retrying.',
          );
        }
      }
      return settings;
    });
  }
  tasks(): Task[] {
    return this.db
      .prepare('SELECT * FROM tasks ORDER BY createdAt DESC')
      .all() as unknown as Task[];
  }
  task(id: string): Task | undefined {
    return this.db
      .prepare('SELECT * FROM tasks WHERE id=?')
      .get(id) as unknown as Task | undefined;
  }
  createTask(prompt: string, intervalSeconds: number | null = null): Task {
    const now = Date.now();
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO tasks VALUES (?, ?, 'queued', ?, NULL, ?, ?, NULL, NULL, NULL)",
      )
      .run(id, prompt, intervalSeconds, now, now);
    this.event(id, null, 'Task added to the queue.');
    return this.task(id)!;
  }
  detail(id: string): Detail | undefined {
    const task = this.task(id);
    if (!task) return undefined;
    const rows = this.db
      .prepare(
        'SELECT * FROM runs WHERE taskId=? ORDER BY startedAt DESC, rowid DESC',
      )
      .all(id) as unknown as (Omit<Run, 'result'> & {
      result: string | null;
    })[];
    return {
      task,
      runs: rows.map((row) => ({
        ...row,
        result: row.result ? (JSON.parse(row.result) as Result) : null,
      })),
      events: this.db
        .prepare('SELECT * FROM events WHERE taskId=? ORDER BY id')
        .all(id) as unknown as TaskEvent[],
    };
  }
  event(taskId: string, runId: string | null, text?: string, breakdown?: { thought?: string; action?:'tool' | 'api' | 'browser' | 'search' | 'memory' | 'visual' | 'voice' | 'plugin' | 'system'; tool?: string; args?: Record<string, unknown>; result?: unknown; error?: string; contextConsumed?: number; contextRemaining?: number }) {
    const textVal = text ?? '';
    const bd = breakdown ?? {};
    // Serialize breakdown as JSON for storage
    const breakdownJson = JSON.stringify(bd);
    this.db
      .prepare(
        'INSERT INTO events (taskId, runId, text, breakdown, createdAt) VALUES (?, ?, ?, ?, ?)',
      )
      .run(taskId, runId, textVal, breakdownJson, Date.now());
  }
  private invalidate(task: Task, status: string, reason: string) {
    const now = Date.now();
    if (task.lease)
      this.db
        .prepare(
          "UPDATE runs SET status='interrupted', finishedAt=?, error=? WHERE id=? AND status='running'",
        )
        .run(now, reason, task.lease);
    this.db
      .prepare(
        'UPDATE tasks SET status=?, lease=NULL, leaseUntil=NULL, updatedAt=?, error=? WHERE id=?',
      )
      .run(status, now, status === 'interrupted' ? reason : null, task.id);
    this.event(task.id, task.lease, reason);
  }
  action(id: string, action: Action): Task | undefined {
    return this.transaction(() => {
      const task = this.task(id);
      if (!task) return undefined;
      if (action === 'run' && task.status === 'running') return task;
      const status =
        action === 'run'
          ? 'queued'
          : action === 'pause'
            ? 'paused'
            : 'cancelled';
      this.invalidate(
        task,
        status,
        action === 'run' ? 'Task queued for a new run.' : `Task ${status}.`,
      );
      this.db
        .prepare('UPDATE tasks SET error=NULL, nextRunAt=NULL WHERE id=?')
        .run(id);
      return this.task(id);
    });
  }
  schedule(id: string, intervalSeconds: number | null): Task | undefined {
    const task = this.task(id);
    if (!task) return undefined;
    const next =
      intervalSeconds && task.status === 'completed'
        ? Date.now() + intervalSeconds * 1000
        : null;
    this.db
      .prepare(
        'UPDATE tasks SET intervalSeconds=?, nextRunAt=?, updatedAt=? WHERE id=?',
      )
      .run(intervalSeconds, next, Date.now(), id);
    this.event(
      id,
      null,
      intervalSeconds
        ? `Repeats every ${intervalSeconds / 60} minutes after a successful run.`
        : 'Repeat schedule removed.',
    );
    return this.task(id);
  }
  claim(
    now = Date.now(),
    leaseDurationMs = DEFAULT_WORKER_LEASE_MS,
  ): Claim | null {
    return this.transaction(() => {
      const settings = this.settings();
      if (settings.paused || !settings.researchAllowed) return null;
      const expired = this.db
        .prepare("SELECT * FROM tasks WHERE status='running' AND leaseUntil<=?")
        .all(now) as unknown as Task[];
      for (const task of expired)
        this.invalidate(
          task,
          'interrupted',
          'Worker lease expired. Review completed effects before retrying.',
        );
      const task = this.db
        .prepare(
          "SELECT * FROM tasks WHERE status='queued' OR (status='completed' AND nextRunAt IS NOT NULL AND nextRunAt<=?) ORDER BY createdAt LIMIT 1",
        )
        .get(now) as unknown as Task | undefined;
      if (!task) return null;
      const lease = randomUUID();
      this.db
        .prepare(
          "UPDATE tasks SET status='running', lease=?, leaseUntil=?, nextRunAt=NULL, error=NULL, updatedAt=? WHERE id=?",
        )
        .run(lease, now + leaseDurationMs, now, task.id);
      this.db
        .prepare(
          "INSERT INTO runs VALUES (?, ?, 'running', ?, NULL, NULL, NULL)",
        )
        .run(lease, task.id, now);
      this.event(task.id, lease, 'Run started.');
      return { ...this.task(task.id)!, lease };
    });
  }
  owns(claim: Claim): boolean {
    const task = this.task(claim.id);
    return task?.status === 'running' && task.lease === claim.lease;
  }
  finish(claim: Claim, result: Result, now = Date.now()): boolean {
    return this.transaction(() => {
      if (!this.owns(claim)) return false;
      const task = this.task(claim.id)!;
      this.db
        .prepare(
          "UPDATE runs SET status='completed', finishedAt=?, result=? WHERE id=?",
        )
        .run(now, JSON.stringify(result), claim.lease);
      this.db
        .prepare(
          "UPDATE tasks SET status='completed', lease=NULL, leaseUntil=NULL, updatedAt=?, nextRunAt=? WHERE id=?",
        )
        .run(
          now,
          task.intervalSeconds ? now + task.intervalSeconds * 1000 : null,
          claim.id,
        );
      this.event(
        claim.id,
        claim.lease,
        result.sample ? 'Fictional sample brief ready.' : 'Run completed.',
      );
      return true;
    });
  }
  interrupt(claim: Claim, reason: string) {
    this.transaction(() => {
      if (this.owns(claim)) this.invalidate(claim, 'interrupted', reason);
    });
  }
  fail(claim: Claim, error: string) {
    this.transaction(() => {
      if (!this.owns(claim)) return;
      const now = Date.now();
      this.db
        .prepare(
          "UPDATE runs SET status='failed', finishedAt=?, error=? WHERE id=?",
        )
        .run(now, error, claim.lease);
      this.db
        .prepare(
          "UPDATE tasks SET status='failed', lease=NULL, leaseUntil=NULL, error=?, updatedAt=? WHERE id=?",
        )
        .run(error, now, claim.id);
      this.event(claim.id, claim.lease, error);
    });
  }
  memories(): Memory[] {
    return this.db
      .prepare('SELECT * FROM memories ORDER BY createdAt DESC')
      .all() as unknown as Memory[];
  }
  saveMemory(text: string, id: string = randomUUID()): Memory {
    this.db
      .prepare(
        'INSERT INTO memories VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET text=excluded.text',
      )
      .run(id, text, Date.now());
    return this.db
      .prepare('SELECT * FROM memories WHERE id=?')
      .get(id) as unknown as Memory;
  }
  deleteMemory(id: string): boolean {
    return (
      this.db.prepare('DELETE FROM memories WHERE id=?').run(id).changes > 0
    );
  }

  memoryDocuments(): MemoryDocument[] {
    return this.db
      .prepare('SELECT * FROM memory_documents ORDER BY createdAt DESC')
      .all() as unknown as MemoryDocument[];
  }

  memoryDocument(id: string): MemoryDocument | undefined {
    return this.db
      .prepare('SELECT * FROM memory_documents WHERE id=?')
      .get(id) as unknown as MemoryDocument | undefined;
  }

  saveMemoryDocument(doc: {
    id?: string;
    title: string;
    content: string;
    format?: string;
    indexState?: 'pending' | 'indexed' | 'failed';
    error?: string | null;
    indexedAt?: number | null;
    ragChunkCount?: number;
    sourcePath?: string | null;
    sourceModifiedAt?: number | null;
    sourceSizeBytes?: number | null;
    tier?: 'short' | 'long';
  }): MemoryDocument {
    const id = doc.id || randomUUID();
    const now = Date.now();
    const existing = this.memoryDocument(id);
    const format = doc.format || existing?.format || 'markdown';
    const indexState = doc.indexState || existing?.indexState || 'pending';
    const error = doc.error !== undefined ? doc.error : (existing?.error ?? null);
    const indexedAt =
      doc.indexedAt !== undefined ? doc.indexedAt : (existing?.indexedAt ?? null);
    const ragChunkCount = doc.ragChunkCount !== undefined
      ? Math.max(0, Math.floor(doc.ragChunkCount))
      : (existing?.ragChunkCount ?? 0);
    const sourcePath = doc.sourcePath !== undefined ? doc.sourcePath : (existing?.sourcePath ?? null);
    const sourceModifiedAt = doc.sourceModifiedAt !== undefined ? doc.sourceModifiedAt : (existing?.sourceModifiedAt ?? null);
    const sourceSizeBytes = doc.sourceSizeBytes !== undefined ? doc.sourceSizeBytes : (existing?.sourceSizeBytes ?? null);
    const tier = doc.tier || existing?.tier || 'long';
    const createdAt = existing ? existing.createdAt : now;
    const updatedAt = now;

    this.db
      .prepare(
        `INSERT INTO memory_documents (id, title, content, format, indexState, error, createdAt, updatedAt, indexedAt, stairChunkCount, ragChunkCount, sourcePath, sourceModifiedAt, sourceSizeBytes, tier)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           title=excluded.title,
           content=excluded.content,
           format=excluded.format,
           indexState=excluded.indexState,
           error=excluded.error,
           updatedAt=excluded.updatedAt,
           indexedAt=excluded.indexedAt,
           stairChunkCount=0,
           ragChunkCount=excluded.ragChunkCount,
           sourcePath=excluded.sourcePath,
           sourceModifiedAt=excluded.sourceModifiedAt,
           sourceSizeBytes=excluded.sourceSizeBytes,
           tier=excluded.tier`,
      )
      .run(
        id,
        doc.title,
        doc.content,
        format,
        indexState,
        error,
        createdAt,
        updatedAt,
        indexedAt,
        0,
        ragChunkCount,
        sourcePath,
        sourceModifiedAt,
        sourceSizeBytes,
        tier,
      );

    return this.memoryDocument(id)!;
  }

  updateMemoryDocument(
    id: string,
    patch: Partial<MemoryDocument>,
  ): MemoryDocument | undefined {
    const existing = this.memoryDocument(id);
    if (!existing) return undefined;
    return this.saveMemoryDocument({
      id,
      title: patch.title !== undefined ? patch.title : existing.title,
      content: patch.content !== undefined ? patch.content : existing.content,
      format: patch.format !== undefined ? patch.format : existing.format,
      indexState:
        patch.indexState !== undefined ? patch.indexState : existing.indexState,
      error: patch.error !== undefined ? patch.error : existing.error,
      indexedAt:
        patch.indexedAt !== undefined ? patch.indexedAt : existing.indexedAt,
      ragChunkCount:
        patch.ragChunkCount !== undefined
          ? patch.ragChunkCount
          : existing.ragChunkCount,
      sourcePath: patch.sourcePath !== undefined ? patch.sourcePath : existing.sourcePath,
      sourceModifiedAt: patch.sourceModifiedAt !== undefined ? patch.sourceModifiedAt : existing.sourceModifiedAt,
      sourceSizeBytes: patch.sourceSizeBytes !== undefined ? patch.sourceSizeBytes : existing.sourceSizeBytes,
      tier: patch.tier !== undefined ? patch.tier : existing.tier,
    });
  }

  deleteMemoryDocument(id: string): boolean {
    return (
      this.db.prepare('DELETE FROM memory_documents WHERE id=?').run(id).changes > 0
    );
  }

  searchMemoryDocuments(query: string): MemoryDocument[] {
    const q = `%${query.trim()}%`;
    return this.db
      .prepare(
        'SELECT * FROM memory_documents WHERE title LIKE ? OR content LIKE ? ORDER BY updatedAt DESC',
      )
      .all(q, q) as unknown as MemoryDocument[];
  }
}
