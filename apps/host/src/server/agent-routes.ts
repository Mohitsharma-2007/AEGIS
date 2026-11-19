import os from 'node:os';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  AgentSwarm,
  SWARM_AGENT_IDS,
  type SwarmPlatform,
} from './agent-swarm.js';

/**
 * Agent runtime API. Everything the Agents surface shows is served from
 * the same persisted task store the orchestrator writes to; there is no
 * client-side mock board.
 */
export function agentRoutes(
  platform: SwarmPlatform,
  swarm = new AgentSwarm(platform),
) {
  const app = new Hono();

  const taskBody = z
    .object({
      prompt: z.string().trim().min(3).max(8000),
      dotId: z.string().min(1).optional(),
      agentId: z.enum(SWARM_AGENT_IDS).optional(),
    })
    .strict();

  app.get('/agents', (c) => {
    const tasks = swarm.list();
    return c.json({
      agents: swarm.roster(),
      active: swarm.activeProvider(),
      tasks: {
        total: tasks.length,
        running: tasks.filter(
          (task) =>
            task.status === 'running' ||
            task.status === 'planning' ||
            task.status === 'synthesizing',
        ).length,
        completed: tasks.filter((task) => task.status === 'completed').length,
        failed: tasks.filter((task) => task.status === 'failed').length,
      },
    });
  });

  /**
   * Widget state for surface without the desktop shell (plain browser).
   *
   * It returns the same shape `main.js` broadcasts as `aegis:widgets`, sourced
   * from the host's own state, so the Widgets view is never blank just because
   * Electron is not there to provide OS metrics.
   */
  app.get('/widgets', (c) => {
    const settings = platform.store.settings();
    const active = swarm.activeProvider();
    const tasks = swarm.list();
    const running = tasks.filter((task) =>
      ['running', 'planning', 'synthesizing'].includes(task.status),
    );
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const cpus = os.cpus();
    const times = cpus.reduce(
      (sum, cpu) => {
        const values = Object.values(cpu.times).reduce((a, b) => a + b, 0);
        return { total: sum.total + values, idle: sum.idle + cpu.times.idle };
      },
      { total: 0, idle: 0 },
    );
    const cpuPercent =
      times.total > 0
        ? Math.max(
            0,
            Math.min(100, Math.round((1 - times.idle / times.total) * 100)),
          )
        : 0;
    return c.json({
      model: {
        provider: active.provider,
        model: active.model,
        mode: settings.paused
          ? 'Paused'
          : active.configured
            ? 'Live'
            : 'Assistant',
      },
      agents: swarm.roster().map((agent) => ({
        id: agent.id,
        name: agent.name,
        state: running.some((task) => task.agents.includes(agent.id))
          ? 'working'
          : 'idle',
        task:
          running.find((task) => task.agents.includes(agent.id))?.prompt ?? '',
        progress: null,
      })),
      conversations: { active: platform.workspace.conversations().length },
      voice: {
        stt: 'faster-whisper',
        tts: 'kokoro',
        lang: settings.voiceLanguage,
        available: true,
      },
      security: {
        pending: 0,
        label: settings.paused ? 'Agents paused' : 'Sentinel Active',
        strict: false,
      },
      system: {
        cpuPercent,
        memoryPercent: Math.round(((totalMem - freeMem) / totalMem) * 100),
        usedMemoryGb: ((totalMem - freeMem) / 1024 ** 3).toFixed(1),
        totalMemoryGb: (totalMem / 1024 ** 3).toFixed(1),
        uptimeHours: (os.uptime() / 3600).toFixed(1),
        gpu: null,
      },
      source: 'host',
    });
  });

  app.get('/agents/tasks', (c) => {
    const limit = Math.min(
      Math.max(Number(c.req.query('limit') ?? 40) || 40, 1),
      100,
    );
    return c.json({
      tasks: swarm.list().slice(0, limit),
      active: swarm.activeProvider(),
    });
  });

  app.post('/agents/tasks', async (c) => {
    if (platform.store.settings().paused)
      return c.json({ error: 'Aegis is paused in Settings.' }, 403);
    const parsed = taskBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json(
        {
          error:
            'Send {prompt} (3 8,000 characters), plus an optional dotId and agentId.',
        },
        400,
      );
    const dots = platform.workspace.dots();
    const dotId = parsed.data.dotId ?? dots[0]?.id;
    if (!dotId || !dots.some((dot) => dot.id === dotId))
      return c.json({ error: 'Choose an existing Agent for this task.' }, 400);
    const task = swarm.create(parsed.data.prompt, dotId, parsed.data.agentId);
    return c.json(task, 202);
  });

  app.get('/agents/tasks/:id', (c) => {
    const task = swarm.get(c.req.param('id'));
    return task ? c.json(task) : c.json({ error: 'Task not found.' }, 404);
  });

  app.post('/agents/tasks/:id/cancel', (c) => {
    const task = swarm.cancel(c.req.param('id'));
    return task ? c.json(task) : c.json({ error: 'Task not found.' }, 404);
  });

  app.post('/agents/tasks/:id/retry', (c) => {
    const previous = swarm.get(c.req.param('id'));
    if (!previous) return c.json({ error: 'Task not found.' }, 404);
    if (platform.store.settings().paused)
      return c.json({ error: 'Aegis is paused in Settings.' }, 403);
    const task = swarm.create(
      previous.prompt,
      previous.dotId,
      previous.requestedAgentId,
    );
    return c.json(task, 202);
  });

  app.delete('/agents/tasks/:id', (c) => {
    const task = swarm.cancel(c.req.param('id'));
    return task ? c.json({ ok: true }) : c.json({ error: 'Task not found.' }, 404);
  });

  return app;
}
