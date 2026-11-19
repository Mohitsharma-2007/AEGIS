import { useEffect, useState } from 'react';
import { useAgent } from '@copilotkit/react-core/v2';

export function TaskBreakdownChain({ taskId }: { taskId: string }) {
  const { agent } = useAgent({ agentId: `breakdown-chain-${taskId}` });
  const [breakdowns, setBreakdowns] = useState<{ thought: string; action?: string; tool?: string; error?: string }[]>([]);

  useEffect(() => {
    if (!agent) return;

    const unsub = agent.subscribe({
      onCustomEvent: ({ event }: { event: { name: string; breakdown?: { thought?: string } | undefined } }) => {
        if (event?.name === 'task_breakdown' && event?.breakdown?.thought) {
          const thought = event.breakdown.thought;
          setBreakdowns((prev) => {
            if (prev.some((b) => b.thought === thought)) return prev;
            return [...prev, { thought }];
          });
        }
      },
    });

    return () => unsub.unsubscribe?.();
  }, [agent]);

  // Nothing to show until the agent actually emits breakdown events; an
  // empty "No breakdown yet" box would just be noise in every chat.
  if (!breakdowns.length) return null;

  return (
    <div className="task-breakdown-chain">
      <strong>Chain</strong>
      <ul>
        {breakdowns.map((b, i) => (
          <li key={i}>
            <span>
              {b.thought || 'Action'}
              {b.tool && `: ${b.tool}`}
              {b.action && ` (${b.action})`}
            </span>
            {b.error && <span className="error">Error: {b.error}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}