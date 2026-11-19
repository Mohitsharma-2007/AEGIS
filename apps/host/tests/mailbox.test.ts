import { describe, expect, it } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  agentAddress,
  deleteMail,
  isInternalAddress,
  listMailbox,
  listThreads,
  mailboxDirFor,
  mailboxPaths,
  markRead,
  normalizeAddress,
  ORCHESTRATOR_ADDRESS,
  parseMail,
  readMail,
  sendMail,
  serializeMail,
  setMailboxLimits,
  unreadCount,
  USER_ADDRESS,
} from '../src/server/mailbox';

function tempPaths() {
  const root = mkdtempSync(join(tmpdir(), 'aegis-mailbox-'));
  return mailboxPaths(root);
}

describe('mailbox addresses', () => {
  it('accepts internal addresses and rejects external ones', () => {
    expect(isInternalAddress(USER_ADDRESS)).toBe(true);
    expect(isInternalAddress(ORCHESTRATOR_ADDRESS)).toBe(true);
    expect(isInternalAddress(agentAddress('rfi'))).toBe(true);
    expect(isInternalAddress('agent/rfi@aegis')).toBe(true);
    expect(isInternalAddress('orchestrator@example.com')).toBe(false);
    expect(isInternalAddress('someone@gmail.com')).toBe(false);
    expect(isInternalAddress('agent/..@aegis')).toBe(false);
    expect(isInternalAddress('agent/UPPER@aegis')).toBe(false);
    expect(() => normalizeAddress('me@example.com')).toThrow();
  });
});

describe('mail serialization', () => {
  it('round-trips an envelope with cc and bcc', () => {
    const message = {
      envelope: {
        id: 'm1',
        threadId: 't1',
        from: ORCHESTRATOR_ADDRESS,
        to: [agentAddress('rfi')],
        cc: [USER_ADDRESS],
        bcc: [agentAddress('security')],
        kind: 'task' as const,
        subject: 'Research RFI',
        createdAt: '2026-11-17T10:00:00Z',
        requiresApproval: false,
      },
      body: '## Task\n\nDo the thing.\n',
    };
    const text = serializeMail(message);
    const parsed = parseMail(text);
    expect(parsed.envelope.id).toBe('m1');
    expect(parsed.envelope.to).toEqual([agentAddress('rfi')]);
    expect(parsed.envelope.cc).toEqual([USER_ADDRESS]);
    expect(parsed.envelope.bcc).toEqual([agentAddress('security')]);
    expect(parsed.envelope.kind).toBe('task');
    expect(parsed.body).toContain('Do the thing.');
  });

  it('rejects malformed frontmatter', () => {
    expect(() => parseMail('just a body without frontmatter')).toThrow();
    expect(() => parseMail('---\nid: x\n---\nbody')).toThrow();
  });
});

describe('messenger', () => {
  it('delivers to inboxes, keeps BCC out of recipient copies, and writes audit', () => {
    const paths = tempPaths();
    const message = sendMail(
      paths,
      ORCHESTRATOR_ADDRESS,
      [agentAddress('rfi')],
      'Analyze the market.',
      { cc: [USER_ADDRESS], bcc: [agentAddress('security')], taskId: 't42', kind: 'task' },
    );
    expect(message.envelope.id).toBeTruthy();
    expect(message.envelope.threadId).toBeTruthy();

    // sender sent copy exists
    const sentDir = join(mailboxDirFor(paths, ORCHESTRATOR_ADDRESS), 'sent');
    expect(existsSync(join(sentDir, `${message.envelope.id}.md`))).toBe(true);

    // recipient inbox exists and contains the message; no bcc field
    const rfiInbox = join(mailboxDirFor(paths, agentAddress('rfi')), 'inbox');
    expect(existsSync(join(rfiInbox, `${message.envelope.id}.md`))).toBe(true);
    const rfiCopy = readMail(paths, agentAddress('rfi'), message.envelope.id);
    expect(rfiCopy).not.toBeNull();
    expect(rfiCopy!.envelope.bcc).toBeUndefined();
    expect(rfiCopy!.envelope.deliveredAt).toBeTruthy();
    expect(rfiCopy!.envelope.cc).toEqual([USER_ADDRESS]);

    // BCC recipient got a copy whose `to` is just them
    const secInbox = join(mailboxDirFor(paths, agentAddress('security')), 'inbox');
    expect(existsSync(join(secInbox, `${message.envelope.id}.md`))).toBe(true);
    const secCopy = readMail(paths, agentAddress('security'), message.envelope.id);
    expect(secCopy!.envelope.to).toEqual([agentAddress('security')]);
    expect(secCopy!.envelope.cc).toBeUndefined();

    // audit has the send line
    const audit = readFileSync(join(paths.audit, 'mail.jsonl'), 'utf8');
    expect(audit).toContain('mail.sent');
    expect(audit).toContain(message.envelope.id);
    expect(audit).toContain(agentAddress('security'));
  });

  it('rejects non-internal recipients', () => {
    const paths = tempPaths();
    expect(() =>
      sendMail(paths, ORCHESTRATOR_ADDRESS, ['external@example.com'], 'x'),
    ).toThrow();
    expect(() => sendMail(paths, ORCHESTRATOR_ADDRESS, [], 'x')).toThrow();
  });

  it('tracks read state and unread counts', () => {
    const paths = tempPaths();
    const message = sendMail(paths, ORCHESTRATOR_ADDRESS, [USER_ADDRESS], 'Hello owner.');
    expect(unreadCount(paths, USER_ADDRESS)).toBe(1);
    expect(markRead(paths, USER_ADDRESS, message.envelope.id)).toBe(true);
    expect(unreadCount(paths, USER_ADDRESS)).toBe(0);
    const summary = listMailbox(paths, USER_ADDRESS);
    expect(summary).toHaveLength(1);
    expect(summary[0].readAt).toBeTruthy();
    // markRead is idempotent
    expect(markRead(paths, USER_ADDRESS, message.envelope.id)).toBe(true);
  });

  it('lists threads and supports deletion', () => {
    const paths = tempPaths();
    const a = sendMail(paths, ORCHESTRATOR_ADDRESS, [USER_ADDRESS], 'First', { subject: 'Thread A' });
    const b = sendMail(paths, ORCHESTRATOR_ADDRESS, [USER_ADDRESS], 'Second', { threadId: a.envelope.threadId, inReplyTo: a.envelope.id, subject: 'Re: Thread A' });
    expect(b.envelope.threadId).toBe(a.envelope.threadId);
    const threads = listThreads(paths, USER_ADDRESS);
    expect(threads).toHaveLength(1);
    expect(threads[0].threadId).toBe(a.envelope.threadId);
    expect(threads[0].unread).toBe(2);
    expect(deleteMail(paths, USER_ADDRESS, a.envelope.id)).toBe(true);
    expect(deleteMail(paths, USER_ADDRESS, a.envelope.id)).toBe(false);
    expect(listMailbox(paths, USER_ADDRESS)).toHaveLength(1);
  });

  it('bounds the inbox by message count, archiving the oldest', () => {
    const paths = tempPaths();
    setMailboxLimits(20, 25 * 1024 * 1024);
    for (let i = 0; i < 30; i += 1) {
      sendMail(paths, ORCHESTRATOR_ADDRESS, [USER_ADDRESS], `Bulk ${i}`);
    }
    const inboxDir = join(mailboxDirFor(paths, USER_ADDRESS), 'inbox');
    const count = readdirSync(inboxDir).filter((n) => n.endsWith('.md')).length;
    expect(count).toBeLessThanOrEqual(20);
    // archived messages are moved under archive/<yyyy-mm>/
    const archiveRoot = join(mailboxDirFor(paths, USER_ADDRESS), 'archive');
    let archived = 0;
    for (const month of readdirSync(archiveRoot)) {
      archived += readdirSync(join(archiveRoot, month)).filter((n) => n.endsWith('.md')).length;
    }
    expect(archived).toBeGreaterThanOrEqual(10);
    expect(unreadCount(paths, USER_ADDRESS)).toBeLessThanOrEqual(20);
  });
});
