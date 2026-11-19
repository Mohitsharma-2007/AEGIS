import { ComputerStore } from './computer-store.js';
import { ConnectionStore } from './connection-store.js';
import { OAuthStore } from './oauth.js';
import { Pages } from './pages.js';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateLearningSettings } from '../shared/learning.js';
import { AEGIS_SURFACE_PRESETS } from './integrations/aegis-surface-presets.js';
import type { CallReceipt, Conversation, Dot, Space } from '../shared/types.js';
export interface LocalThreadMessage {
  id: string;
  threadId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
}
export class WorkspaceStore {
  private db: DatabaseSync;
  readonly pages: Pages;
  readonly computers: ComputerStore;
  readonly connections: ConnectionStore;
  readonly oauth: OAuthStore;
  constructor(
    path: string,
    readonly ownerId: string,
  ) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS spaces(id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, createdAt INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS dots(id TEXT PRIMARY KEY, spaceId TEXT NOT NULL, name TEXT NOT NULL, instructions TEXT NOT NULL, researchAllowed INTEGER NOT NULL, memoryAllowed INTEGER NOT NULL, createdAt INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS thread_bindings(id TEXT PRIMARY KEY, dotId TEXT NOT NULL, ownerId TEXT NOT NULL, title TEXT NOT NULL, createdAt INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS task_threads(taskId TEXT PRIMARY KEY, threadId TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS calls(id TEXT PRIMARY KEY, threadId TEXT NOT NULL, startedAt INTEGER NOT NULL, endedAt INTEGER, status TEXT NOT NULL, transcript TEXT NOT NULL, error TEXT);
      CREATE TABLE IF NOT EXISTS captures(threadId TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS thread_messages(id TEXT PRIMARY KEY, threadId TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, createdAt INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS thread_messages_thread ON thread_messages(threadId, createdAt);
      CREATE TABLE IF NOT EXISTS thread_visuals(id TEXT PRIMARY KEY, threadId TEXT NOT NULL, messageId TEXT NOT NULL, spec TEXT NOT NULL, createdAt INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS thread_visuals_thread ON thread_visuals(threadId, createdAt);`);
    for (const [table, column, definition] of [
      ['dots', 'learningContainerId', 'TEXT'],
      ['dots', 'skillDeliveryEnabled', 'INTEGER NOT NULL DEFAULT 0'],
      ['dots', 'appsAllowed', 'INTEGER NOT NULL DEFAULT 0'],
      ['dots', 'composioToolkits', "TEXT NOT NULL DEFAULT '[]'"],
      ['dots', 'composioSessionId', 'TEXT'],
      ['dots', 'composioPolicyHash', 'TEXT'],
      ['thread_bindings', 'learningContainerId', 'TEXT'],
    ]) {
      if (
        !this.db
          .prepare(`PRAGMA table_info(${table})`)
          .all()
          .some((field) => field.name === column)
      )
        this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
    // Migrate only once: restarting must never restore a revoked grant.
    if (
      !this.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='dot_spaces'",
        )
        .get()
    ) {
      this.db.exec(`BEGIN;
        CREATE TABLE dot_spaces(dotId TEXT NOT NULL, spaceId TEXT NOT NULL, PRIMARY KEY(dotId, spaceId));
        INSERT INTO dot_spaces SELECT id, spaceId FROM dots;
        COMMIT;`);
    }
    this.computers = new ComputerStore(this.db);
    this.connections = new ConnectionStore(this.db);
    this.oauth = new OAuthStore(this.db);
    this.pages = new Pages(this.db, (id) =>
      this.spaces().some((space) => space.id === id),
    );
    if (
      !this.db
        .prepare('PRAGMA table_info(calls)')
        .all()
        .some((column) => column.name === 'anchorMessageId')
    )
      this.db.exec('ALTER TABLE calls ADD COLUMN anchorMessageId TEXT');
    this.removeSurfacePresetDots();
    if (!this.spaces().length) {
      const space = this.createSpace(
        'Everyday',
        'A little space for your day.',
      );
      this.createDot(
        space.id,
        'Aegis',
        'Be thoughtful, practical, and concise. Help the user think clearly and follow through.',
        true,
        true,
      );
      // Aegis is one Orchestrator: specialised work is delegated to
      // ephemeral Hermes subagents at runtime, never to pre-seeded personas.
    }
  }
  // Aegis: remove the legacy surface-preset Agents (Today, Chat, Mail,
  // Calendar, Browser, Files, ...). They were fake personas in the sidebar;
  // tasks now spawn real ephemeral subagents instead. Their conversations go
  // with them so nothing is orphaned.
  private removeSurfacePresetDots() {
    // Both historical separators (em dash and the older padded spaces) are
    // matched; the primary Orchestrator named exactly "Aegis" is kept.
    const rows = this.db
      .prepare("SELECT id, name FROM dots WHERE name LIKE 'Aegis %' AND name != 'Aegis'")
      .all();
    for (const row of rows) {
      this.deleteDot(String(row.id));
    }
  }
  /**
   * Remove an Agent and everything that only exists because of it.
   *
   * The threads it owned go with it (their messages and visuals too), so no
   * conversation is left pointing at a missing Agent. Returns whether a row
   * was actually removed, so the route can answer 404 instead of pretending.
   */
  deleteDot(dotId: string): boolean {
    if (!this.dot(dotId)) return false;
    const threads = this.db
      .prepare('SELECT id FROM thread_bindings WHERE dotId=?')
      .all(dotId);
    for (const thread of threads) {
      this.db
        .prepare('DELETE FROM thread_messages WHERE threadId=?')
        .run(String(thread.id));
      this.db
        .prepare('DELETE FROM thread_visuals WHERE threadId=?')
        .run(String(thread.id));
      this.db
        .prepare('DELETE FROM thread_bindings WHERE id=?')
        .run(String(thread.id));
    }
    this.db.prepare('DELETE FROM dot_spaces WHERE dotId=?').run(dotId);
    this.db.prepare('DELETE FROM computer_permissions WHERE dotId=?').run(dotId);
    this.db.prepare('DELETE FROM dots WHERE id=?').run(dotId);
    return true;
  }
  close() {
    this.db.close();
  }
  spaces(): Space[] {
    return this.db
      .prepare('SELECT * FROM spaces ORDER BY createdAt')
      .all() as unknown as Space[];
  }
  createSpace(name: string, description: string): Space {
    const space = {
      id: randomUUID(),
      name,
      description,
      createdAt: Date.now(),
    };
    this.db
      .prepare('INSERT INTO spaces VALUES (?, ?, ?, ?)')
      .run(space.id, name, description, space.createdAt);
    return space;
  }
  dots(): Dot[] {
    return this.db
      .prepare('SELECT * FROM dots ORDER BY createdAt')
      .all()
      .map((row) => ({
        ...row,
        // AEGIS (W-FIX 2b): tag seeded surface-preset Agents so the
        // client can group them under the one primary Aegis Agent.
        surface: AEGIS_SURFACE_PRESETS.find(
          (preset) => preset.name === row.name,
        )?.surface,
        spaceIds: this.db
          .prepare(
            'SELECT spaceId FROM dot_spaces WHERE dotId=? ORDER BY spaceId',
          )
          .all(String(row.id))
          .map((grant) => String(grant.spaceId)),
        researchAllowed: !!row.researchAllowed,
        memoryAllowed: !!row.memoryAllowed,
        appsAllowed: !!row.appsAllowed,
        composioToolkits: JSON.parse(String(row.composioToolkits ?? '[]')),
        skillDeliveryEnabled: !!row.skillDeliveryEnabled,
      })) as unknown as Dot[];
  }
  dot(id: string) {
    return this.dots().find((dot) => dot.id === id);
  }
  createDot(
    spaceId: string,
    name: string,
    instructions: string,
    researchAllowed: boolean,
    memoryAllowed: boolean,
    spaceIds: string[] = [spaceId],
    learningContainerId: string | null = null,
    skillDeliveryEnabled = false,
    appsAllowed = false,
    composioToolkits: string[] = [],
  ): Dot {
    this.validateSpaceAccess(spaceId, spaceIds);
    validateLearningSettings(learningContainerId, skillDeliveryEnabled);
    const dot: Dot = {
      id: randomUUID(),
      spaceId,
      spaceIds: [...new Set(spaceIds)].sort(),
      name,
      instructions,
      researchAllowed,
      memoryAllowed,
      appsAllowed,
      composioToolkits: [...new Set(composioToolkits)].sort(),
      composioSessionId: null,
      composioPolicyHash: null,
      learningContainerId,
      skillDeliveryEnabled,
      createdAt: Date.now(),
    };
    this.db.exec('BEGIN');
    try {
      this.db
        .prepare(
          'INSERT INTO dots (id, spaceId, name, instructions, researchAllowed, memoryAllowed, createdAt, learningContainerId, skillDeliveryEnabled, appsAllowed, composioToolkits) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          dot.id,
          spaceId,
          name,
          instructions,
          +researchAllowed,
          +memoryAllowed,
          dot.createdAt,
          learningContainerId,
          +skillDeliveryEnabled,
          +appsAllowed,
          JSON.stringify(dot.composioToolkits),
        );
      for (const id of dot.spaceIds)
        this.db.prepare('INSERT INTO dot_spaces VALUES (?, ?)').run(dot.id, id);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return dot;
  }
  canAccessSpace(dotId: string, spaceId: string) {
    return !!this.db
      .prepare('SELECT 1 FROM dot_spaces WHERE dotId=? AND spaceId=?')
      .get(dotId, spaceId);
  }
  private validateSpaceAccess(defaultSpace: string, spaceIds: string[]) {
    if (
      !spaceIds.includes(defaultSpace) ||
      spaceIds.some((id) => !this.spaces().some((space) => space.id === id))
    )
      throw new Error('Space access must include a valid default destination.');
  }
  updateDot(
    id: string,
    patch: Pick<
      Dot,
      | 'name'
      | 'instructions'
      | 'researchAllowed'
      | 'memoryAllowed'
      | 'appsAllowed'
      | 'composioToolkits'
    > & {
      spaceId?: string;
      spaceIds?: string[];
      learningContainerId?: string | null;
      skillDeliveryEnabled?: boolean;
    },
  ): Dot {
    const current = this.dot(id);
    if (!current) throw new Error('Agent not found.');
    const defaultSpace = patch.spaceId ?? current.spaceId;
    const spaceIds = patch.spaceIds ?? current.spaceIds;
    this.validateSpaceAccess(defaultSpace, spaceIds);
    const learningContainerId =
      patch.learningContainerId === undefined
        ? (current.learningContainerId ?? null)
        : patch.learningContainerId;
    const skillDeliveryEnabled =
      patch.skillDeliveryEnabled ?? current.skillDeliveryEnabled ?? false;
    validateLearningSettings(learningContainerId, skillDeliveryEnabled);
    this.db.exec('BEGIN');
    try {
      this.db
        .prepare(
          'UPDATE dots SET name=?, instructions=?, researchAllowed=?, memoryAllowed=?, learningContainerId=?, skillDeliveryEnabled=?, appsAllowed=?, composioToolkits=? WHERE id=?',
        )
        .run(
          patch.name,
          patch.instructions,
          +patch.researchAllowed,
          +patch.memoryAllowed,
          learningContainerId,
          +skillDeliveryEnabled,
          +patch.appsAllowed,
          JSON.stringify([...new Set(patch.composioToolkits)].sort()),
          id,
        );
      this.db
        .prepare('UPDATE dots SET spaceId=? WHERE id=?')
        .run(defaultSpace, id);
      this.db.prepare('DELETE FROM dot_spaces WHERE dotId=?').run(id);
      for (const space of new Set(spaceIds))
        this.db.prepare('INSERT INTO dot_spaces VALUES (?, ?)').run(id, space);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.dot(id)!;
  }
  saveComposioSession(id: string, sessionId: string, policyHash: string) {
    this.db
      .prepare(
        'UPDATE dots SET composioSessionId=?, composioPolicyHash=? WHERE id=?',
      )
      .run(sessionId, policyHash, id);
  }
  conversations(): Conversation[] {
    return this.db
      .prepare(
        'SELECT * FROM thread_bindings WHERE ownerId=? ORDER BY createdAt DESC',
      )
      .all(this.ownerId) as unknown as Conversation[];
  }
  bindThread(id: string, dotId: string, title: string): Conversation {
    const dot = this.dot(dotId);
    if (!dot) throw new Error('Agent not found.');
    const value: Conversation = {
      id,
      dotId,
      ownerId: this.ownerId,
      title,
      createdAt: Date.now(),
      learningContainerId: dot.learningContainerId ?? null,
    };
    this.db
      .prepare(
        'INSERT INTO thread_bindings (id, dotId, ownerId, title, createdAt, learningContainerId) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        id,
        dotId,
        this.ownerId,
        title,
        value.createdAt,
        value.learningContainerId ?? null,
      );
    return value;
  }
  deleteThread(id: string): boolean {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const exists = this.db
        .prepare('SELECT 1 FROM thread_bindings WHERE id=? AND ownerId=?')
        .get(id, this.ownerId);
      if (!exists) {
        this.db.exec('COMMIT');
        return false;
      }
      this.db.prepare('DELETE FROM thread_messages WHERE threadId=?').run(id);
      this.db
        .prepare('DELETE FROM thread_bindings WHERE id=? AND ownerId=?')
        .run(id, this.ownerId);
      this.db.exec('COMMIT');
      return true;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  renameThread(id: string, title: string): Conversation {
    const value = title.trim();
    if (!value || value.length > 120) throw new Error('Conversation title must be 1–120 characters.');
    const result = this.db
      .prepare('UPDATE thread_bindings SET title=? WHERE id=? AND ownerId=?')
      .run(value, id, this.ownerId);
    if (!result.changes) throw new Error('Conversation not found.');
    return this.requireThread(id);
  }
  requireThread(id: string, dotId?: string): Conversation {
    const thread = this.conversations().find((thread) => thread.id === id);
    if (!thread || (dotId && thread.dotId !== dotId))
      throw new Error('Conversation does not belong to this Agent and owner.');
    return thread;
  }
  // Local thread history, used when no CopilotKit Intelligence account is
  // configured (Aegis provider mode). Intelligence mode keeps using the
  // hosted thread store instead.
  appendThreadMessage(
    threadId: string,
    role: 'user' | 'assistant',
    content: string,
  ): LocalThreadMessage {
    this.requireThread(threadId);
    const message: LocalThreadMessage = {
      id: randomUUID(),
      threadId,
      role,
      content,
      createdAt: Date.now(),
    };
    this.db
      .prepare(
        'INSERT INTO thread_messages (id, threadId, role, content, createdAt) VALUES (?, ?, ?, ?, ?)',
      )
      .run(message.id, threadId, role, content, message.createdAt);
    return message;
  }
  // Generative-UI cards are answers too: they are stored beside the message
  // they came with so a reload redraws them instead of losing them.
  appendThreadVisual(threadId: string, messageId: string, spec: string) {
    this.requireThread(threadId);
    this.db
      .prepare(
        'INSERT INTO thread_visuals (id, threadId, messageId, spec, createdAt) VALUES (?, ?, ?, ?, ?)',
      )
      .run(randomUUID(), threadId, messageId, spec, Date.now());
  }
  threadVisuals(threadId: string): {
    id: string;
    messageId: string;
    spec: string;
    createdAt: number;
  }[] {
    this.requireThread(threadId);
    return this.db
      .prepare(
        'SELECT id, messageId, spec, createdAt FROM thread_visuals WHERE threadId=? ORDER BY createdAt, rowid',
      )
      .all(threadId) as unknown as {
      id: string;
      messageId: string;
      spec: string;
      createdAt: number;
    }[];
  }
  threadMessages(threadId: string): LocalThreadMessage[] {
    this.requireThread(threadId);
    return this.db
      .prepare(
        'SELECT * FROM thread_messages WHERE threadId=? ORDER BY createdAt, rowid',
      )
      .all(threadId) as unknown as LocalThreadMessage[];
  }
  bindTask(taskId: string, threadId: string) {
    this.requireThread(threadId);
    this.db
      .prepare('INSERT INTO task_threads VALUES (?, ?)')
      .run(taskId, threadId);
  }
  taskThread(taskId: string): string | undefined {
    const row = this.db
      .prepare('SELECT threadId FROM task_threads WHERE taskId=?')
      .get(taskId);
    return typeof row?.threadId === 'string' ? row.threadId : undefined;
  }
  calls(threadId?: string): CallReceipt[] {
    if (threadId) this.requireThread(threadId);
    return this.db
      .prepare(
        `SELECT * FROM calls ${threadId ? 'WHERE threadId=?' : ''} ORDER BY startedAt DESC`,
      )
      .all(...(threadId ? [threadId] : [])) as unknown as CallReceipt[];
  }
  createCall(threadId: string): CallReceipt {
    this.requireThread(threadId);
    const call: CallReceipt = {
      id: randomUUID(),
      threadId,
      startedAt: Date.now(),
      endedAt: null,
      status: 'connecting',
      transcript: '',
      error: null,
    };
    this.db
      .prepare(
        'INSERT INTO calls(id, threadId, startedAt, endedAt, status, transcript, error) VALUES (?, ?, ?, NULL, ?, ?, NULL)',
      )
      .run(call.id, threadId, call.startedAt, call.status, '');
    return call;
  }
  call(id: string): CallReceipt {
    const call = this.calls().find((call) => call.id === id);
    if (!call) throw new Error('Call not found.');
    this.requireThread(call.threadId);
    return call;
  }
  setCall(
    id: string,
    status: CallReceipt['status'],
    transcript: string,
    error: string | null = null,
  ) {
    const call = this.call(id);
    if (call.endedAt) return call;
    this.db
      .prepare(
        'UPDATE calls SET status=?, transcript=?, error=?, endedAt=? WHERE id=?',
      )
      .run(
        status,
        transcript,
        error,
        status === 'ended' || status === 'failed' ? Date.now() : null,
        id,
      );
    return this.call(id);
  }
  saveLateTranscript(id: string, transcript: string) {
    this.call(id);
    return (
      this.db
        .prepare(
          "UPDATE calls SET transcript=? WHERE id=? AND transcript='' AND endedAt IS NOT NULL",
        )
        .run(transcript, id).changes > 0
    );
  }
  anchorCall(id: string, anchor: string | undefined) {
    this.call(id);
    this.db
      .prepare('UPDATE calls SET anchorMessageId=? WHERE id=?')
      .run(anchor ?? null, id);
  }
  setCallError(id: string, error: string | null) {
    this.call(id);
    this.db.prepare('UPDATE calls SET error=? WHERE id=?').run(error, id);
  }
  saveCapture(threadId: string, value: unknown) {
    this.requireThread(threadId);
    this.db
      .prepare(
        'INSERT INTO captures VALUES (?, ?) ON CONFLICT(threadId) DO UPDATE SET value=excluded.value',
      )
      .run(threadId, JSON.stringify(value));
  }
  capture(threadId: string): unknown {
    this.requireThread(threadId);
    const row = this.db
      .prepare('SELECT value FROM captures WHERE threadId=?')
      .get(threadId);
    return typeof row?.value === 'string' ? JSON.parse(row.value) : null;
  }
}
