const SDK_URL = (process.env.AEGIS_ORCHESTRATOR_URL ?? 'http://127.0.0.1:4315').replace(/\/$/, '');

type SdkEvent = { type?: string; data?: { text?: string; message?: string; status?: string } };

/** Run one bounded task through the local SDK orchestrator and return its verified reply. */
export async function runOrchestratorTask(message: string, signal?: AbortSignal): Promise<string> {
  const token = process.env.AEGIS_ORCHESTRATOR_TOKEN;
  if (!token) throw new Error('Agent SDK orchestrator is not configured in this desktop session.');
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const created = await fetch(`${SDK_URL}/v1/session`, {
    method: 'POST', headers, body: JSON.stringify({ message, title: 'Aegis task orchestration' }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000),
  });
  const session = await created.json().catch(() => null) as { sessionId?: string; error?: string; message?: string } | null;
  if (!created.ok || !session?.sessionId) {
    throw new Error(session?.message ?? session?.error ?? `Agent SDK could not start a turn (HTTP ${created.status}).`);
  }
  const deadline = Date.now() + 8 * 60_000;
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    const response = await fetch(`${SDK_URL}/v1/session/${encodeURIComponent(session.sessionId)}/events?format=json`, {
      headers, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000),
    });
    const payload = await response.json().catch(() => null) as { events?: SdkEvent[]; error?: string } | null;
    if (!response.ok) throw new Error(payload?.error ?? `Agent SDK event read failed (HTTP ${response.status}).`);
    const events = payload?.events ?? [];
    const reply = [...events].reverse().find((event) => event.type === 'message.completed')?.data?.text;
    const failed = [...events].reverse().find((event) => event.type === 'turn.failed');
    if (failed) throw new Error(failed.data?.message ?? 'The Agent SDK task failed.');
    if (events.some((event) => event.type === 'turn.completed')) {
      if (!reply) throw new Error('The Agent SDK completed without a reply.');
      return reply;
    }
    await new Promise<void>((resolve, reject) => {
      const done = () => { signal?.removeEventListener('abort', abort); resolve(); };
      const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(signal?.reason); };
      const timer = setTimeout(done, 700);
      signal?.addEventListener('abort', abort, { once: true });
    });
  }
  throw new Error('Agent SDK task exceeded the eight-minute limit.');
}
