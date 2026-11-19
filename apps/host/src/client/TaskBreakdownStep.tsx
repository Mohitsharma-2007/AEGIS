import { useEffect, useState } from 'react';
import { useAgent } from '@copilotkit/react-core/v2';

export function TaskBreakdownStep({ taskId }: { taskId: string }) {
  const { agent } = useAgent({ agentId: `breakdown-step-${taskId}` });
  const [steps, setSteps] = useState<string[]>([]);

  useEffect(() => {
    if (!agent) return;

    const unsub = agent.subscribe({
      onCustomEvent: ({ event }: { event: { name: string; breakdown?: { thought?: string } | undefined } }) => {
        if (event?.name === 'task_breakdown' && event?.breakdown?.thought) {
          const thought = event.breakdown.thought;
          setSteps((prev) => [...prev, thought]);
        }
      },
    });

    return () => unsub.unsubscribe?.();
  }, [agent]);

  // Only render once the agent has emitted at least one step, so idle
  // chat surfaces stay clean.
  if (!steps.length) return null;

  return (
    <div className="task-breakdown-step">
      <strong>Step {steps.length}</strong>
      <ul>
        {steps.map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ul>
    </div>
  );
}