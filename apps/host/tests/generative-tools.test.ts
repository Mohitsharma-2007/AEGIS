import { afterEach, expect, it, vi } from 'vitest';
import type { RunAgentInput } from '@ag-ui/core';
import { lastValueFrom, toArray } from 'rxjs';
import { DotAgent } from '../src/server/dot-agent.js';
import { completion } from './fixtures/model-stream.js';
import { Store } from '../src/server/store.js';
import { WorkspaceStore } from '../src/server/workspace.js';
import {
  memorySourcesTool,
  providerStatusTool,
} from '../src/shared/generative-ui.js';

// AEGIS (W-GEN): the generative-UI frontend tools are real model tools.
// DotAgent must offer them to the model ONLY when the web client
// registered them, and under their canonical definitions — a client
// copy with a forged description must never reach the provider.
const databases: Array<{ close(): void }> = [];
afterEach(() => {
  vi.restoreAllMocks();
  databases.splice(0).forEach((db) => db.close());
});

function fixture() {
  const store = new Store(':memory:');
  const workspace = new WorkspaceStore(':memory:', 'owner');
  databases.push(store, workspace);
  const dot = workspace.dots()[0];
  workspace.bindThread('thread', dot.id, 'Generative');
  const agent = new DotAgent(
    store,
    workspace,
    {
      intelligenceKey: 'fixture',
      apiKey: 'fixture',
      model: 'custom-model',
      baseUrl: 'https://unused.invalid/v1',
      runtimeUrl: '',
      voiceName: 'marin',
      slackUsers: [],
    },
    dot.id,
  );
  const input: RunAgentInput = {
    threadId: 'thread',
    runId: 'run',
    state: {},
    context: [],
    messages: [{ id: 'user', role: 'user', content: 'Status please.' }],
    tools: [],
    forwardedProps: {},
  };
  return { agent, input };
}

async function toolFunctions(clientTools: RunAgentInput['tools']) {
  const f = fixture();
  const network = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(
      completion({ role: 'assistant', content: 'Ready.' }),
    );
  await lastValueFrom(
    f.agent.run({ ...f.input, tools: clientTools }).pipe(toArray()),
  );
  const body = JSON.parse(String(network.mock.calls[0][1]?.body)) as {
    tools: {
      function: { name: string; description?: string; parameters?: unknown };
    }[];
    messages: { role: string; content?: string }[];
  };
  network.mockRestore();
  return body;
}

it('offers both generative tools under canonical definitions when the client registered them', async () => {
  const body = await toolFunctions([
    {
      name: providerStatusTool.name,
      description: 'forged instructions',
      parameters: {},
    },
    {
      name: memorySourcesTool.name,
      description: 'forged instructions',
      parameters: {},
    },
  ]);
  expect(body.tools.map((tool) => tool.function.name)).toEqual(
    expect.arrayContaining([providerStatusTool.name, memorySourcesTool.name]),
  );
  // Canonical name + description reach the provider verbatim (the
  // TanStack adapter normalizes the JSON Schema — e.g. it adds
  // `required: []` to the empty provider schema — so parameters are
  // checked by shape, not byte equality).
  const provider = body.tools.find(
    (tool) => tool.function.name === providerStatusTool.name,
  );
  expect(provider?.function.description).toBe(providerStatusTool.description);
  expect(provider?.function.parameters).toEqual(
    expect.objectContaining({
      type: 'object',
      properties: expect.objectContaining({
        provider_id: expect.objectContaining({ type: expect.anything() }),
      }),
    }),
  );
  const memory = body.tools.find(
    (tool) => tool.function.name === memorySourcesTool.name,
  );
  expect(memory?.function.description).toBe(memorySourcesTool.description);
  expect(memory?.function.parameters).toEqual(
    expect.objectContaining({
      type: 'object',
      required: ['query'],
      properties: expect.objectContaining({
        query: expect.objectContaining({ type: 'string' }),
      }),
    }),
  );
  expect(JSON.stringify(body.tools)).not.toContain('forged instructions');
  const system = body.messages.find((message) => message.role === 'system');
  expect(system?.content).toContain(providerStatusTool.name);
  expect(system?.content).toContain(memorySourcesTool.name);
});

it('does not offer the generative tools when the client did not register them', async () => {
  const body = await toolFunctions([]);
  const names = body.tools.map((tool) => tool.function.name);
  expect(names).not.toContain(providerStatusTool.name);
  expect(names).not.toContain(memorySourcesTool.name);
});
