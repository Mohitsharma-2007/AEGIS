// Aegis internal mail system (Milestone 5).
//
// The orchestrator and agents communicate exclusively through markdown mail
// files stored under `.aegis-data/agent-swarm/mailboxes/`. Each mailbox is a
// directory with `inbox/` and `sent/` trees of `<messageId>.md` files; a
// message is Markdown with a YAML-like frontmatter envelope. Read state is
// kept separately in `reads.json`, delivery is atomic copy/rename, every send
// is appended to `audit/mail.jsonl`, and storage is bounded at write time.
//
// This is an in-app simulation only: addresses are internal
// (`user@aegis`, `orchestrator@aegis`, `agent/<slug>@aegis`) and there is no
// SMTP/Gmail/external gateway.

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export type MailKind =
  | 'task'
  | 'handoff'
  | 'question'
  | 'verification'
  | 'reply'
  | 'progress'
  | 'report'
  | 'approval-request'
  | 'approval-decision';

export const MAIL_KINDS: readonly MailKind[] = [
  'task',
  'handoff',
  'question',
  'verification',
  'reply',
  'progress',
  'report',
  'approval-request',
  'approval-decision',
];

export interface MailEnvelope {
  id: string;
  threadId: string;
  from: string;
  to: string[];
  cc?: string[];
  /** Never written into recipient copies — kept only in the sender's sent/ copy and audit. */
  bcc?: string[];
  inReplyTo?: string;
  taskId?: string;
  milestone?: number;
  kind: MailKind;
  subject?: string;
  createdAt: string;
  deliveredAt?: string;
  requiresApproval?: boolean;
}

export interface MailMessage {
  envelope: MailEnvelope;
  body: string;
}

export interface MailboxPaths {
  root: string;
  user: string;
  orchestrator: string;
  agent: (slug: string) => string;
  audit: string;
}

export const USER_ADDRESS = 'user@aegis';
export const ORCHESTRATOR_ADDRESS = 'orchestrator@aegis';
export const AGENT_ADDRESS_PREFIX = 'agent/';

export const MAILBOX_CAP_MESSAGES = 1000;
export const MAILBOX_CAP_BYTES = 25 * 1024 * 1024;
export const AUDIT_ROTATE_BYTES = 2 * 1024 * 1024;
export const AUDIT_KEEP_LINES = 1000;

// Runtime limits (mutable so tests can exercise bounds cheaply).
let mailboxCapMessages = MAILBOX_CAP_MESSAGES;
let mailboxCapBytes = MAILBOX_CAP_BYTES;

/** Test/ops helper: override per-mailbox storage limits. */
export function setMailboxLimits(messages: number, bytes: number) {
  mailboxCapMessages = messages;
  mailboxCapBytes = bytes;
}

export function agentAddress(slug: string): string {
  return `${AGENT_ADDRESS_PREFIX}${slug}@aegis`;
}

export function isInternalAddress(address: string): boolean {
  if (typeof address !== 'string' || !address.endsWith('@aegis')) return false;
  const local = address.slice(0, -'@aegis'.length);
  if (local === 'user' || local === 'orchestrator') return true;
  if (local.startsWith(AGENT_ADDRESS_PREFIX)) {
    const slug = local.slice(AGENT_ADDRESS_PREFIX.length);
    return /^[a-z0-9][a-z0-9-]{0,63}$/.test(slug);
  }
  return false;
}

export function normalizeAddress(address: string): string {
  const clean = String(address ?? '').trim().toLowerCase();
  if (!isInternalAddress(clean)) {
    throw new Error(
      `Mail address "${address}" is not a valid internal @aegis address.`,
    );
  }
  return clean;
}

/** Split a mailbox address into kind + key. */
export function addressParts(address: string): { kind: 'user' | 'orchestrator' | 'agent'; key: string } {
  const clean = normalizeAddress(address);
  const local = clean.slice(0, -'@aegis'.length);
  if (local === 'user') return { kind: 'user', key: 'user' };
  if (local === 'orchestrator') return { kind: 'orchestrator', key: 'orchestrator' };
  return { kind: 'agent', key: local.slice(AGENT_ADDRESS_PREFIX.length) };
}

/**
 * Build the mailbox directory tree. Creates dirs on first use; the root is
 * derived from the Aegis data root so it survives host restarts.
 */
export function mailboxPaths(dataRoot: string): MailboxPaths {
  const root = join(dataRoot, 'agent-swarm', 'mailboxes');
  const user = join(root, 'user');
  const orchestrator = join(root, 'orchestrator');
  const audit = join(root, 'audit');
  for (const dir of [root, user, orchestrator, audit]) mkdirSync(dir, { recursive: true });
  return {
    root,
    user,
    orchestrator,
    audit,
    agent: (slug: string) => {
      const dir = join(root, 'agent', String(slug));
      mkdirSync(dir, { recursive: true });
      return dir;
    },
  };
}

// ---------------------------------------------------------------------------
// Markdown + frontmatter serialization
// ---------------------------------------------------------------------------

function serializeScalar(value: string | number | boolean | undefined): string {
  if (value === undefined) return '';
  return String(value);
}

function serializeEnvelope(env: MailEnvelope): string {
  const lines: string[] = [];
  lines.push('---');
  lines.push(`id: ${env.id}`);
  lines.push(`threadId: ${env.threadId}`);
  lines.push(`from: ${env.from}`);
  lines.push('to:');
  for (const to of env.to) lines.push(`  - ${to}`);
  if (env.cc?.length) {
    lines.push('cc:');
    for (const cc of env.cc) lines.push(`  - ${cc}`);
  }
  if (env.bcc?.length) {
    lines.push('bcc:');
    for (const bcc of env.bcc) lines.push(`  - ${bcc}`);
  }
  if (env.inReplyTo) lines.push(`inReplyTo: ${env.inReplyTo}`);
  if (env.taskId) lines.push(`taskId: ${env.taskId}`);
  if (env.milestone !== undefined) lines.push(`milestone: ${env.milestone}`);
  lines.push(`kind: ${env.kind}`);
  if (env.subject) lines.push(`subject: ${env.subject.replace(/\n/g, ' ')}`);
  lines.push(`createdAt: ${env.createdAt}`);
  if (env.deliveredAt) lines.push(`deliveredAt: ${env.deliveredAt}`);
  if (env.requiresApproval) lines.push('requiresApproval: true');
  lines.push('---');
  lines.push('');
  return lines.join('\n');
}

function parseList(lines: string[], index: number, key: string): { values: string[]; next: number } {
  const values: string[] = [];
  let i = index;
  // Lines are `  - value` immediately after `key:`.
  while (i < lines.length) {
    const m = lines[i].match(/^\s+-\s+(.+)$/);
    if (!m) break;
    values.push(m[1].trim());
    i += 1;
  }
  return { values, next: i };
}

export function parseMail(text: string): MailMessage {
  const raw = String(text ?? '');
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!match) throw new Error('Mail file is missing frontmatter.');
  const head = match[1];
  const body = match[2].replace(/^\r?\n/, '');
  const lines = head.split(/\r?\n/);
  const fields = new Map<string, string | string[]>();
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i += 1; continue; }
    const kv = line.match(/^([A-Za-z][A-Za-z0-9]*):\s*(.*)$/);
    if (!kv) { i += 1; continue; }
    const key = kv[1];
    const value = kv[2].trim();
    if (value === '') {
      const parsed = parseList(lines, i + 1, key);
      fields.set(key, parsed.values);
      i = parsed.next;
    } else {
      fields.set(key, value);
      i += 1;
    }
  }
  const str = (key: string): string | undefined => {
    const v = fields.get(key);
    return typeof v === 'string' ? v : undefined;
  };
  const list = (key: string): string[] => {
    const v = fields.get(key);
    return Array.isArray(v) ? v : [];
  };
  const id = str('id');
  const threadId = str('threadId');
  const from = str('from');
  const to = list('to');
  const kind = str('kind');
  if (!id || !threadId || !from || !to.length || !kind || !MAIL_KINDS.includes(kind as MailKind)) {
    throw new Error('Mail file frontmatter is incomplete or invalid.');
  }
  const envelope: MailEnvelope = {
    id,
    threadId,
    from: normalizeAddress(from),
    to: to.map(normalizeAddress),
    kind: kind as MailKind,
    createdAt: str('createdAt') ?? new Date().toISOString(),
  };
  const cc = list('cc');
  if (cc.length) envelope.cc = cc.map(normalizeAddress);
  const bcc = list('bcc');
  if (bcc.length) envelope.bcc = bcc.map(normalizeAddress);
  const inReplyTo = str('inReplyTo');
  if (inReplyTo) envelope.inReplyTo = inReplyTo;
  const taskId = str('taskId');
  if (taskId) envelope.taskId = taskId;
  const milestone = str('milestone');
  if (milestone !== undefined && /^\d+$/.test(milestone)) envelope.milestone = Number(milestone);
  const subject = str('subject');
  if (subject) envelope.subject = subject;
  const deliveredAt = str('deliveredAt');
  if (deliveredAt) envelope.deliveredAt = deliveredAt;
  envelope.requiresApproval = str('requiresApproval') === 'true';
  return { envelope, body };
}

export function serializeMail(message: MailMessage): string {
  return serializeEnvelope(message.envelope) + message.body.replace(/^\r?\n/, '') + '\n';
}

// ---------------------------------------------------------------------------
// Messenger
// ---------------------------------------------------------------------------

function ensurePrivateDir(dir: string) {
  mkdirSync(dir, { recursive: true });
}

function listMessages(dir: string): string[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir).filter((name) => name.endsWith('.md'));
  } catch {
    return [];
  }
}

/** Enforce the per-mailbox cap by archiving the oldest messages. */
function enforceMailboxCap(mailboxDir: string) {
  const inbox = join(mailboxDir, 'inbox');
  const messages = listMessages(inbox);
  if (messages.length <= mailboxCapMessages) return;
  const sorted = messages.sort((a, b) => {
    const sa = statSync(join(inbox, a));
    const sb = statSync(join(inbox, b));
    return sa.mtimeMs - sb.mtimeMs;
  });
  const archive = join(mailboxDir, 'archive', new Date().toISOString().slice(0, 7));
  mkdirSync(archive, { recursive: true });
  const overflow = sorted.length - mailboxCapMessages;
  for (const name of sorted.slice(0, overflow)) {
    try {
      renameSync(join(inbox, name), join(archive, name));
    } catch {
      // concurrent archive: skip
    }
  }
  pruneReads(mailboxDir, sorted.slice(0, overflow));
}

function enforceMailboxBytes(mailboxDir: string) {
  const inbox = join(mailboxDir, 'inbox');
  const messages = listMessages(inbox);
  let total = 0;
  let sizes = new Map<string, number>();
  for (const name of messages) {
    try {
      const size = statSync(join(inbox, name)).size;
      sizes.set(name, size);
      total += size;
    } catch {
      // missing file: ignore
    }
  }
  if (total <= mailboxCapBytes) return;
  const sorted = messages.sort((a, b) => (sizes.get(a) ?? 0) - (sizes.get(b) ?? 0));
  const archive = join(mailboxDir, 'archive', new Date().toISOString().slice(0, 7));
  mkdirSync(archive, { recursive: true });
  const evicted: string[] = [];
  for (const name of sorted) {
    if (total <= mailboxCapBytes) break;
    try {
      renameSync(join(inbox, name), join(archive, name));
      total -= sizes.get(name) ?? 0;
      evicted.push(name);
    } catch {
      // skip
    }
  }
  pruneReads(mailboxDir, evicted);
}

function readReads(mailboxDir: string): Record<string, string> {
  const file = join(mailboxDir, 'reads.json');
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writeReads(mailboxDir: string, reads: Record<string, string>) {
  writeFileSync(join(mailboxDir, 'reads.json'), JSON.stringify(reads, null, 2), {
    mode: 0o600,
  });
}

function pruneReads(mailboxDir: string, archivedNames: string[]) {
  if (!archivedNames.length) return;
  const reads = readReads(mailboxDir);
  let changed = false;
  for (const name of archivedNames) {
    const id = name.replace(/\.md$/, '');
    if (id in reads) {
      delete reads[id];
      changed = true;
    }
  }
  if (changed) writeReads(mailboxDir, reads);
}

function appendAudit(paths: MailboxPaths, entry: Record<string, unknown>) {
  const line = JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n';
  appendFileSync(join(paths.audit, 'mail.jsonl'), line, { mode: 0o600 });
  // Rotate: keep the newest AUDIT_KEEP_LINES lines once over AUDIT_ROTATE_BYTES.
  const file = join(paths.audit, 'mail.jsonl');
  try {
    if (statSync(file).size > AUDIT_ROTATE_BYTES) {
      const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
      if (lines.length > AUDIT_KEEP_LINES) {
        writeFileSync(file, lines.slice(-AUDIT_KEEP_LINES).join('\n') + '\n', { mode: 0o600 });
      }
    }
  } catch {
    // ignore rotation errors
  }
}

export interface SendOptions {
  threadId?: string;
  inReplyTo?: string;
  taskId?: string;
  milestone?: number;
  kind?: MailKind;
  subject?: string;
  requiresApproval?: boolean;
  cc?: string[];
  bcc?: string[];
}

/**
 * Send a markdown mail message. Throws on non-internal addresses, empty
 * recipients, or a missing body. Returns the stored message with delivery
 * timestamps.
 */
export function sendMail(
  paths: MailboxPaths,
  from: string,
  to: string[],
  body: string,
  options: SendOptions = {},
): MailMessage {
  const sender = normalizeAddress(from);
  if (!to.length) throw new Error('Mail needs at least one recipient.');
  const recipients = to.map(normalizeAddress);
  const id = randomUUID();
  const threadId = options.threadId ?? randomUUID();
  const kind = options.kind ?? (options.requiresApproval ? 'approval-request' : 'task');
  const envelope: MailEnvelope = {
    id,
    threadId,
    from: sender,
    to: recipients,
    kind,
    subject: options.subject,
    createdAt: new Date().toISOString(),
    requiresApproval: options.requiresApproval,
  };
  if (options.cc?.length) envelope.cc = options.cc.map(normalizeAddress);
  if (options.bcc?.length) envelope.bcc = options.bcc.map(normalizeAddress);
  if (options.inReplyTo) envelope.inReplyTo = options.inReplyTo;
  if (options.taskId) envelope.taskId = options.taskId;
  if (options.milestone !== undefined) envelope.milestone = options.milestone;
  const message: MailMessage = { envelope, body: String(body ?? '') };

  const senderDir = mailboxDirFor(paths, sender);
  const sentDir = join(senderDir, 'sent');
  ensurePrivateDir(sentDir);
  const sentCopy: MailMessage = {
    envelope: { ...envelope, bcc: envelope.bcc ? [...envelope.bcc] : undefined },
    body: message.body,
  };
  writeFileSync(join(sentDir, `${id}.md`), serializeMail(sentCopy), { mode: 0o600 });

  // Deliver to each recipient. BCC recipients get the same body but no
  // recipient-visible CC/BCC list in their copy.
  const deliveredTo = new Set<string>([sender]);
  for (const recipient of recipients) {
    if (deliveredTo.has(recipient)) continue;
    deliveredTo.add(recipient);
    const dir = mailboxDirFor(paths, recipient);
    const inboxDir = join(dir, 'inbox');
    ensurePrivateDir(inboxDir);
    const delivered: MailEnvelope = {
      ...envelope,
      bcc: undefined,
      deliveredAt: new Date().toISOString(),
    };
    const deliveredMessage: MailMessage = { envelope: delivered, body: message.body };
    writeFileSync(join(inboxDir, `${id}.md`), serializeMail(deliveredMessage), { mode: 0o600 });
    enforceMailboxCap(dir);
    enforceMailboxBytes(dir);
  }
  if (envelope.bcc?.length) {
    for (const bcc of envelope.bcc) {
      if (deliveredTo.has(bcc)) continue;
      deliveredTo.add(bcc);
      const dir = mailboxDirFor(paths, bcc);
      const inboxDir = join(dir, 'inbox');
      ensurePrivateDir(inboxDir);
      const delivered: MailEnvelope = {
        ...envelope,
        to: [bcc],
        cc: undefined,
        bcc: undefined,
        deliveredAt: new Date().toISOString(),
      };
      const deliveredMessage: MailMessage = { envelope: delivered, body: message.body };
      writeFileSync(join(inboxDir, `${id}.md`), serializeMail(deliveredMessage), { mode: 0o600 });
      enforceMailboxCap(dir);
      enforceMailboxBytes(dir);
    }
  }

  appendAudit(paths, {
    event: 'mail.sent',
    messageId: id,
    threadId,
    from: sender,
    to: recipients,
    cc: envelope.cc ?? [],
    bcc: envelope.bcc ?? [],
    kind,
    taskId: envelope.taskId ?? null,
    requiresApproval: envelope.requiresApproval ?? false,
  });
  return message;
}

export function mailboxDirFor(paths: MailboxPaths, address: string): string {
  const parts = addressParts(address);
  return parts.kind === 'agent' ? paths.agent(parts.key) : parts.kind === 'user' ? paths.user : paths.orchestrator;
}

export function readMail(paths: MailboxPaths, address: string, messageId: string): MailMessage | null {
  const dir = mailboxDirFor(paths, address);
  for (const sub of ['inbox', 'sent']) {
    const file = join(dir, sub, `${messageId}.md`);
    if (existsSync(file)) {
      try {
        return parseMail(readFileSync(file, 'utf8'));
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function markRead(paths: MailboxPaths, address: string, messageId: string): boolean {
  const dir = mailboxDirFor(paths, address);
  const inboxFile = join(dir, 'inbox', `${messageId}.md`);
  if (!existsSync(inboxFile)) return false;
  const reads = readReads(dir);
  if (!(messageId in reads)) {
    reads[messageId] = new Date().toISOString();
    writeReads(dir, reads);
    appendAudit(paths, {
      event: 'mail.read',
      messageId,
      address: normalizeAddress(address),
    });
  }
  return true;
}

export interface MailSummary {
  id: string;
  threadId: string;
  from: string;
  to: string[];
  kind: MailKind;
  subject?: string;
  createdAt: string;
  deliveredAt?: string;
  readAt?: string;
  taskId?: string;
  requiresApproval?: boolean;
}

export function listMailbox(paths: MailboxPaths, address: string): MailSummary[] {
  const dir = mailboxDirFor(paths, address);
  const inboxDir = join(dir, 'inbox');
  const reads = readReads(dir);
  const out: MailSummary[] = [];
  for (const name of listMessages(inboxDir)) {
    const id = name.replace(/\.md$/, '');
    try {
      const message = parseMail(readFileSync(join(inboxDir, name), 'utf8'));
      out.push({
        id: message.envelope.id,
        threadId: message.envelope.threadId,
        from: message.envelope.from,
        to: message.envelope.to,
        kind: message.envelope.kind,
        subject: message.envelope.subject,
        createdAt: message.envelope.createdAt,
        deliveredAt: message.envelope.deliveredAt,
        readAt: reads[id],
        taskId: message.envelope.taskId,
        requiresApproval: message.envelope.requiresApproval,
      });
    } catch {
      // unreadable mail file: skip; it is not exposed to recipients
    }
  }
  return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function unreadCount(paths: MailboxPaths, address: string): number {
  return listMailbox(paths, address).filter((m) => !m.readAt).length;
}

/** List all threads a mailbox shares (by threadId, newest message first). */
export function listThreads(paths: MailboxPaths, address: string): { threadId: string; subject?: string; lastAt: string; unread: number }[] {
  const mail = listMailbox(paths, address);
  const byThread = new Map<string, { subject?: string; lastAt: string; unread: number }>();
  for (const m of mail) {
    const existing = byThread.get(m.threadId);
    if (!existing || m.createdAt > existing.lastAt) {
      byThread.set(m.threadId, {
        subject: m.subject,
        lastAt: m.createdAt,
        unread: (existing?.unread ?? 0) + (m.readAt ? 0 : 1),
      });
    } else if (!m.readAt) {
      existing.unread += 1;
    }
  }
  return [...byThread.entries()]
    .map(([threadId, meta]) => ({ threadId, ...meta }))
    .sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1));
}

export function deleteMail(paths: MailboxPaths, address: string, messageId: string): boolean {
  const dir = mailboxDirFor(paths, address);
  const inboxFile = join(dir, 'inbox', `${messageId}.md`);
  if (!existsSync(inboxFile)) return false;
  rmSync(inboxFile, { force: true });
  const reads = readReads(dir);
  if (messageId in reads) {
    delete reads[messageId];
    writeReads(dir, reads);
  }
  appendAudit(paths, { event: 'mail.deleted', messageId, address: normalizeAddress(address) });
  return true;
}
