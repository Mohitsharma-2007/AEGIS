import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { EventType } from '@ag-ui/core';
import { lastValueFrom, toArray } from 'rxjs';
import type { RunAgentInput } from '@ag-ui/core';
import type { PlatformConfig } from './platform-config.js';
import type { Store } from './store.js';
import type { WorkspaceStore } from './workspace.js';
import type { ComputerService } from './computer-service.js';

// Real subagent orchestration: the agent itself decides to fan work out, and
// each subagent is a full Aegis run with the same harness, permissions and
// tools, on its own conversation thread. Nothing here is task-specific; the
// parent passes the brief and reads the answers back.
//
// Depth is tracked with AsyncLocalStorage so a spawned agent can spawn its own
// workers (up to MAX_DEPTH), but cannot recurse forever.
const depthStore = new AsyncLocalStorage<number>();
export const MAX_SUBAGENT_DEPTH = 2;

export function subagentDepth(): number {
  return depthStore.getStore() ?? 0;
}

export interface SubagentBrief {
  name: string;
  task: string;
  /** Optional extra instructions for this worker only. */
  instructions?: string;
}

export interface SubagentResult {
  name: string;
  threadId: string;
  status: 'completed' | 'failed';
  reply: string;
  error?: string;
}

export async function runSubagents(options: {
  store: Store;
  workspace: WorkspaceStore;
  config: PlatformConfig;
  dotId: string;
  agents: SubagentBrief[];
  signal?: AbortSignal;
  /** The host's single ComputerService, so children share the parent's session. */
  computers?: ComputerService;
}): Promise<SubagentResult[]> {
  const depth = subagentDepth();
  if (depth >= MAX_SUBAGENT_DEPTH)
    throw new Error('Subagent depth limit reached; finish this task directly.');

  return depthStore.run(depth + 1, async () => {
    const { DotAgent } = await import('./dot-agent.js');
    return Promise.all(
      options.agents.slice(0, 4).map(async (brief) => {
        const threadId = `sub-${randomUUID()}`;
        const title = brief.name.trim().slice(0, 60) || 'Subagent';
        try {
          options.workspace.bindThread(threadId, options.dotId, title);
        } catch {
          // The thread may already exist for a retry; continue.
        }
        const agent = new DotAgent(
          options.store,
          options.workspace,
          options.config,
          options.dotId,
          false,
          undefined,
          options.computers,
        );
        const prompt = [
          `You are the subagent "${title}". Work only on this brief and report back concisely with findings, files, and next actions. Do not spawn more agents. Use at most about eight tool calls and return one final answer with the evidence you actually gathered.`,
          brief.instructions ? `Additional instructions: ${brief.instructions}` : '',
          `Brief: ${brief.task}`,
        ]
          .filter(Boolean)
          .join('\n\n');

        const input: RunAgentInput = {
          threadId,
          runId: `run-${randomUUID()}`,
          state: {},
          context: [],
          messages: [{ id: `msg-${randomUUID()}`, role: 'user', content: prompt }],
          tools: [],
          forwardedProps: {},
        };

        let reply = '';
        let failure: string | undefined;
        // A child that hangs must not consume the parent's whole turn budget.
        // Give each child a hard deadline that leaves time to synthesise.
        const childBudgetMs = Math.max(
          30_000,
          Math.min(
            100_000,
            (options.config.agentRunTimeoutMs ?? 180_000) - 20_000,
          ),
        );
        let deadline: NodeJS.Timeout | undefined;
        if (options.signal?.aborted) agent.abortRun();
        const onAbort = () => agent.abortRun();
        options.signal?.addEventListener('abort', onAbort, { once: true });
        try {
          const runPromise = lastValueFrom(agent.run(input).pipe(toArray()));
          // The race may reject first; keep the losing promise handled so a
          // late abort cannot become an unhandled rejection.
          void runPromise.catch(() => undefined);
          const events = await Promise.race([
            runPromise,
            new Promise<never>((_, reject) => {
              deadline = setTimeout(() => {
                agent.abortRun();
                reject(
                  new Error(
                    `Subagent exceeded its ${Math.round(childBudgetMs / 1000)}s budget.`,
                  ),
                );
              }, childBudgetMs);
              deadline.unref?.();
            }),
          ]);
          reply = events
            .filter(
              (event) =>
                event.type === EventType.TEXT_MESSAGE_CONTENT &&
                'delta' in event &&
                typeof event.delta === 'string',
            )
            .map((event) => String((event as unknown as { delta: string }).delta))
            .join('');
          const runError = events.find(
            (event) => event.type === EventType.RUN_ERROR,
          );
          if (runError)
            failure =
              'message' in runError && typeof runError.message === 'string'
                ? runError.message
                : 'Subagent run failed.';
        } catch (error) {
          failure =
            error instanceof Error ? error.message : 'Subagent run failed.';
        } finally {
          if (deadline) clearTimeout(deadline);
          options.signal?.removeEventListener('abort', onAbort);
        }

        return {
          name: title,
          threadId,
          status: failure ? ('failed' as const) : ('completed' as const),
          reply: reply.trim() || (failure ? '' : 'Subagent finished without a text reply.'),
          error: failure,
        };
      }),
    );
  });
}
