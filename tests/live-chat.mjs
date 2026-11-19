// Live chat smoke test against an already-running host (e.g. the one the
// desktop shell supervises). Unlike repro-real-turn.mjs it does not spawn a
// server, so it proves the window's real backend — not a test harness.
//
//   node tests/live-chat.mjs [http://127.0.0.1:4310]
const base = process.argv[2] ?? 'http://127.0.0.1:4310';
const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
};

const health = await (await fetch(`${base}/api/health`)).json();
check('host answers /api/health', health.ok === true, `${health.provider}/${health.model}`);

const workspace = await (await fetch(`${base}/api/workspace`)).json();
const dot = workspace.dots?.[0];
check('workspace has a primary Agent', !!dot?.id);

const created = await fetch(`${base}/api/conversations`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ dotId: dot.id, title: 'Desktop shell check' }),
});
const conversation = await created.json();
check('conversation created', created.status === 201, `status ${created.status}`);

const run = await fetch(`${base}/api/copilotkit/agent/${dot.id}/run`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
  body: JSON.stringify({
    threadId: conversation.id,
    runId: `live-${Date.now()}`,
    state: {},
    tools: [],
    context: [],
    messages: [
      {
        id: `m-${Date.now()}`,
        role: 'user',
        content: 'Reply with one short sentence confirming you are the Aegis agent.',
      },
    ],
    forwardedProps: {},
  }),
});
const body = await run.text();
const runError = body.match(/"type":"RUN_ERROR"[^\n]*/);
const text = [...body.matchAll(/"type":"TEXT_MESSAGE_CONTENT"[^\n]*?"delta":"((?:[^"\\]|\\.)*)"/g)]
  .map((match) => JSON.parse(`"${match[1]}"`))
  .join('');
check('run returned HTTP 200', run.status === 200, `status ${run.status}`);
check('no RUN_ERROR in the stream', !runError, runError?.[0]?.slice(0, 240) ?? '');
check('assistant produced text', text.trim().length > 0);
if (text.trim()) console.log(`assistant: ${text.trim().slice(0, 300)}`);

const stored = await (await fetch(`${base}/api/conversations/${conversation.id}/messages`)).json();
check(
  'turn persisted (user + assistant)',
  stored.messages?.length === 2 &&
    stored.messages[0].role === 'user' &&
    stored.messages[1].role === 'assistant',
  stored.messages?.map((m) => m.role).join(','),
);

const failed = checks.filter((entry) => !entry.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) process.exitCode = 1;
