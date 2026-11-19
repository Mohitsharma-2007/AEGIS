import { expect, it, vi } from 'vitest';
import { EventType, type RunAgentInput } from '@ag-ui/core';
import { Observable } from 'rxjs';

// The orchestration tool must drive real DotAgent runs. Mocking the agent
// module keeps this focused on the contract: brief in, own thread, reply out.
const runs: RunAgentInput[] = [];
vi.mock('../src/server/dot-agent.js', () => ({
  DotAgent: class {
    run(input: RunAgentInput) {
      runs.push(input);
      return new Observable<unknown>((subscriber) => {
        subscriber.next({ type: EventType.RUN_STARTED });
        subscriber.next({
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId: 'm1',
          delta: 'Data centre revenue grew 112% year over year.',
        });
        subscriber.complete();
      });
    }
    abortRun() {}
  },
}));

import { runSubagents, subagentDepth } from '../src/server/subagents';

function fixture() {
  const bound: Array<{ threadId: string; dotId: string; title: string }> = [];
  const workspace = {
    bindThread: (threadId: string, dotId: string, title: string) => {
      bound.push({ threadId, dotId, title });
    },
  };
  return { workspace, bound };
}

it('passes the brief to a subagent on its own thread and returns its reply', async () => {
  runs.length = 0;
  const { workspace, bound } = fixture();
  const results = await runSubagents({
    store: {} as never,
    workspace: workspace as never,
    config: {} as never,
    dotId: 'aegi',
    agents: [
      {
        name: 'Financials researcher',
        task: 'Find NVIDIA data-centre revenue and growth.',
        instructions: 'Cite the filing.',
      },
    ],
  });

  expect(bound).toHaveLength(1);
  expect(bound[0].dotId).toBe('aegi');
  expect(bound[0].title).toBe('Financials researcher');
  expect(bound[0].threadId).toBe(results[0].threadId);

  expect(runs).toHaveLength(1);
  const prompt = String(runs[0].messages[0].content);
  expect(prompt).toContain('Financials researcher');
  expect(prompt).toContain('Find NVIDIA data-centre revenue and growth.');
  expect(prompt).toContain('Cite the filing.');
  expect(runs[0].threadId).toBe(results[0].threadId);

  expect(results).toEqual([
    expect.objectContaining({
      name: 'Financials researcher',
      status: 'completed',
      reply: 'Data centre revenue grew 112% year over year.',
    }),
  ]);
  expect(subagentDepth()).toBe(0);
});

it('caps fan-out at four agents and reports failures without throwing', async () => {
  const { workspace } = fixture();
  const results = await runSubagents({
    store: {} as never,
    workspace: workspace as never,
    config: {} as never,
    dotId: 'aegi',
    agents: Array.from({ length: 6 }, (_, index) => ({
      name: `Worker ${index + 1}`,
      task: `Task ${index + 1}`,
    })),
  });
  expect(results).toHaveLength(4);
  expect(results.every((result) => result.status === 'completed')).toBe(true);
});
