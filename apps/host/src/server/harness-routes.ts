// AEGIS harness routes: the Aegis Native Execution Engine.
//
// The old external harness sidecar is gone. Every session,
// prompt, approval and MCP-server operation below is served by the in-process
// native engine (Node / Python / Shell / Tools) with approval gates.

import { Hono } from 'hono';
import { z } from 'zod';
import {
  approveNativeAction,
  createNativeSession,
  getDaemonActivity,
  getDaemonMcp,
  getHarnessStatus,
  getNativeSession,
  getNativeSessionMessages,
  getNativeSessions,
  sendNativePrompt,
} from './harness.js';
import type { PlatformConfig } from './platform-config.js';
import {
  mcpServerSchema,
  readMcpConfig,
  removeMcpServer,
  setMcpServerDisabled,
  upsertMcpServer,
} from './mcp-config.js';

export function harnessRoutes(config?: PlatformConfig) {
  const app = new Hono();

  app.get('/harness/status', async () => {
    return Response.json(await getHarnessStatus());
  });

  app.get('/harness/sessions', async () => {
    getNativeSessions();
    return Response.json({ data: getNativeSessions() });
  });

  app.post('/harness/sessions', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = z
      .object({ title: z.string().trim().max(200).optional() })
      .strict()
      .safeParse(body);
    if (!parsed.success)
      return c.json({ error: 'Invalid session request.' }, 400);

    const created = createNativeSession(parsed.data.title);
    return c.json({
      data: {
        id: created.id,
        title: created.title,
        createdAt: created.createdAt,
      },
    });
  });

  app.get('/harness/sessions/:id/messages', async (c) => {
    const id = c.req.param('id');
    const native = getNativeSession(id);
    return c.json({
      data: getNativeSessionMessages(native ? native.id : id),
    });
  });

  app.post('/harness/sessions/:id/prompt', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = z
      .object({ text: z.string().trim().min(1).max(20_000) })
      .strict()
      .safeParse(body);
    if (!parsed.success)
      return c.json(
        { error: 'Enter a prompt between 1 and 20,000 characters.' },
        400,
      );
    const result = await sendNativePrompt(
      c.req.param('id'),
      parsed.data.text,
      config,
    );
    return c.json(result);
  });

  // Native Approval Gate: Approve or Reject a pending command execution
  app.post('/harness/sessions/:id/approve', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => null);
    const parsed = z
      .object({
        approvalId: z.string().min(1),
        approved: z.boolean(),
      })
      .strict()
      .safeParse(body);
    if (!parsed.success)
      return c.json({ error: 'Send {approvalId: string, approved: boolean}.' }, 400);
    try {
      const result = await approveNativeAction(
        id,
        parsed.data.approvalId,
        parsed.data.approved,
      );
      return c.json(result);
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : 'Approval execution failed.' },
        400,
      );
    }
  });

  // MCP servers: the native harness registry (<product>/.aegis-data/mcp.json).
  app.get('/harness/plugins', async (c) => {
    const file = await readMcpConfig();
    return c.json({ path: file.path, servers: file.servers });
  });

  app.put('/harness/plugins/:name', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = mcpServerSchema.safeParse(
      body && typeof body === 'object'
        ? ((body as Record<string, unknown>).config ?? body)
        : null,
    );
    if (!parsed.success)
      return c.json(
        {
          error:
            'Invalid MCP server config: local servers need type "local" and a command array; remote servers need type "remote" and a url.',
        },
        400,
      );
    try {
      const servers = await upsertMcpServer(c.req.param('name'), parsed.data);
      return c.json({ servers });
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : 'Invalid name.' },
        400,
      );
    }
  });

  app.delete('/harness/plugins/:name', async (c) => {
    const servers = await removeMcpServer(c.req.param('name'));
    return servers
      ? c.json({ servers })
      : c.json({ error: 'MCP server not found.' }, 404);
  });

  app.post('/harness/plugins/:name/toggle', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = z.object({ disabled: z.boolean() }).strict().safeParse(body);
    if (!parsed.success) return c.json({ error: 'Send {disabled: boolean}.' }, 400);
    const servers = await setMcpServerDisabled(
      c.req.param('name'),
      parsed.data.disabled,
    );
    return servers
      ? c.json({ servers })
      : c.json({ error: 'MCP server not found.' }, 404);
  });

  // Daemon forge + activity notices (daemon HTTP API)
  app.get('/harness/daemon-activity', async (c) =>
    c.json(await getDaemonActivity()),
  );
  app.get('/harness/daemon-mcp', async (c) => c.json(await getDaemonMcp()));

  // Swarm dispatch: one native harness session per specialist, prompted at once.
  app.post('/harness/swarm', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = z
      .object({
        agents: z
          .array(
            z.object({
              name: z.string().trim().min(1).max(120),
              prompt: z.string().trim().min(1).max(20_000),
            }),
          )
          .min(1)
          .max(12),
      })
      .strict()
      .safeParse(body);
    if (!parsed.success)
      return c.json({ error: 'Send {agents: [{name, prompt}]}.' }, 400);

    const launched: Array<{ id: string; title: string; status: string }> = [];
    const failures: string[] = [];
    for (const agent of parsed.data.agents) {
      try {
        const session = createNativeSession(`${agent.name} — swarm task`);
        // Swarm specialists answer with the same configured provider as a normal
        // harness prompt; without it every specialist fell back to "model
        // unavailable" while the main harness answered fine.
        const result = await sendNativePrompt(session.id, agent.prompt, config);
        launched.push({
          id: session.id,
          title: agent.name,
          status: result && result.success ? 'running' : 'started',
        });
      } catch (error) {
        failures.push(
          `${agent.name}: ${error instanceof Error ? error.message : 'failed'}`,
        );
      }
    }
    return c.json({ ok: launched.length > 0, launched, failures });
  });

  return app;
}
