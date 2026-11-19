// Aegis internal mail API (Milestone 5): markdown-mail communication between
// the orchestrator, agents, and the owner. This is an in-app simulation —
// addresses are internal @aegis only and nothing leaves the device.
import { Hono } from 'hono';
import { z } from 'zod';
import {
  agentAddress,
  deleteMail,
  listMailbox,
  listThreads,
  mailboxPaths,
  markRead,
  readMail,
  sendMail,
  unreadCount,
  USER_ADDRESS,
  ORCHESTRATOR_ADDRESS,
} from './mailbox.js';
import { aegisRootDir } from './harness.js';
import { SWARM_ROSTER } from './agent-swarm.js';

export const MAIL_KIND_ENUM = [
  'task',
  'handoff',
  'question',
  'verification',
  'reply',
  'progress',
  'report',
  'approval-request',
  'approval-decision',
] as const;

export function mailRoutes() {
  const app = new Hono();
  const paths = mailboxPaths(aegisRootDir());

  const knownAddresses = (): string[] => {
    const roster = SWARM_ROSTER.map((agent) => agentAddress(agent.id));
    return [USER_ADDRESS, ORCHESTRATOR_ADDRESS, ...roster];
  };

  // Mailbox roster: every address the owner/agents can address.
  app.get('/mail/agents', (c) =>
    c.json({
      user: USER_ADDRESS,
      orchestrator: ORCHESTRATOR_ADDRESS,
      agents: SWARM_ROSTER.map((agent) => ({
        address: agentAddress(agent.id),
        id: agent.id,
        name: agent.name,
        role: agent.role,
        description: agent.description,
        capabilities: agent.capabilities,
        kind: agent.kind,
      })),
    }),
  );

  // A mailbox summary: unread count + threads.
  app.get('/mail/me', (c) => {
    const address = z.enum(knownAddresses() as [string, ...string[]])
      .safeParse(String(c.req.query('address') ?? USER_ADDRESS));
    const resolved = address.success ? address.data : USER_ADDRESS;
    return c.json({
      address: resolved,
      unread: unreadCount(paths, resolved),
      threads: listThreads(paths, resolved),
    });
  });

  // Full inbox of one mailbox.
  app.get('/mail/inbox', (c) => {
    const address = String(c.req.query('address') ?? USER_ADDRESS);
    return c.json({ address, messages: listMailbox(paths, address) });
  });

  // One full thread (messages that belong to a threadId, newest first).
  app.get('/mail/thread', (c) => {
    const threadId = String(c.req.query('threadId') ?? '');
    const address = String(c.req.query('address') ?? USER_ADDRESS);
    if (!threadId) return c.json({ error: 'threadId is required' }, 400);
    const messages = listMailbox(paths, address).filter(
      (message) => message.threadId === threadId,
    );
    return c.json({ threadId, address, messages });
  });

  // Read a single message with its markdown body.
  app.get('/mail/message/:id', (c) => {
    const address = String(c.req.query('address') ?? USER_ADDRESS);
    const message = readMail(paths, address, c.req.param('id'));
    if (!message) return c.json({ error: 'Message not found' }, 404);
    markRead(paths, address, message.envelope.id);
    return c.json(message);
  });

  // Send markdown mail (internal addresses only).
  app.post('/mail/send', async (c) => {
    const body = z
      .object({
        from: z.string().min(1).max(120),
        to: z.array(z.string().min(1).max(120)).min(1).max(20),
        cc: z.array(z.string().min(1).max(120)).max(20).optional(),
        subject: z.string().max(200).optional(),
        body: z.string().min(1).max(20000),
        kind: z.enum(MAIL_KIND_ENUM).optional(),
        threadId: z.string().max(120).optional(),
        inReplyTo: z.string().max(120).optional(),
        taskId: z.string().max(200).optional(),
        requiresApproval: z.boolean().optional(),
      })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'Invalid mail payload.' }, 400);

    // Security: only allow the authenticated owner (user@aegis) to send mail
    // via the API. Prevents sender spoofing as orchestrator or agents.
    const sender = body.data.from.toLowerCase();
    if (sender !== USER_ADDRESS) {
      return c.json(
        { error: `Sender "${body.data.from}" not authorized. Only ${USER_ADDRESS} can send mail via the API.` },
        403,
      );
    }

    try {
      const sent = sendMail(paths, body.data.from, body.data.to, body.data.body, {
        subject: body.data.subject,
        kind: body.data.kind,
        threadId: body.data.threadId,
        inReplyTo: body.data.inReplyTo,
        taskId: body.data.taskId,
        requiresApproval: body.data.requiresApproval,
        cc: body.data.cc,
      });
      return c.json(sent, 201);
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : 'Could not send mail.' },
        400,
      );
    }
  });

  // Mark a message as read.
  app.post('/mail/:id/read', async (c) => {
    const address = String(c.req.query('address') ?? USER_ADDRESS);
    const ok = markRead(paths, address, c.req.param('id'));
    if (!ok) return c.json({ error: 'Message not found' }, 404);
    return c.json({ ok: true });
  });

  // Delete a message from a mailbox.
  app.delete('/mail/:id', (c) => {
    const address = String(c.req.query('address') ?? USER_ADDRESS);
    const ok = deleteMail(paths, address, c.req.param('id'));
    if (!ok) return c.json({ error: 'Message not found' }, 404);
    return c.json({ ok: true });
  });

  return app;
}
