// Live probe: what does the model call when asked to browse, and does the
// chat-card path get a real preview? Prints tool call names/args and any
// browser screenshot returned.
//
//   node tests/live-browse-probe.mjs [baseUrl] ["prompt"]
const base = process.argv[2] ?? 'http://127.0.0.1:4310';
const prompt =
  process.argv[4] ??
  process.argv[3] ??
  'Open https://example.com in your browser, read the page, and tell me the heading.';

const health = await (await fetch(`${base}/api/health`)).json();
const workspace = await (await fetch(`${base}/api/workspace`)).json();
const dot = workspace.dots?.[0];
const conversation = await (
  await fetch(`${base}/api/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dotId: dot.id, title: 'Browse probe' }),
  })
).json();
console.log(`provider ${health.provider}/${health.model}  thread ${conversation.id}`);

const started = Date.now();
const run = await fetch(`${base}/api/copilotkit/agent/${dot.id}/run`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
  body: JSON.stringify({
    threadId: conversation.id,
    runId: `probe-${Date.now()}`,
    state: {},
    context: [],
    tools: [],
    messages: [{ id: `m-${Date.now()}`, role: 'user', content: prompt }],
    forwardedProps: {},
  }),
});
const body = await run.text();
const ms = Date.now() - started;

for (const line of body.split('\n')) {
  if (!line.startsWith('data:')) continue;
  const raw = line.slice(5).trim();
  if (!raw || raw === '[DONE]') continue;
  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    continue;
  }
  if (event.type === 'TOOL_CALL_START') console.log(`+ ${event.toolCallName}`);
  if (event.type === 'TOOL_CALL_ARGS' && event.delta)
    console.log(`    args ${String(event.delta).slice(0, 220)}`);
  if (event.type === 'TOOL_CALL_RESULT')
    console.log(`    result ${String(event.content).slice(0, 220)}`);
  if (event.type === 'CUSTOM')
    console.log(
      `CUSTOM ${event.name} url=${event.value?.url ?? ''} screenshot=${event.value?.screenshot?.length ?? 0}b64`,
    );
  if (event.type === 'RUN_ERROR') console.log(`ERROR ${event.message}`);
}
console.log(`\n${ms} ms, HTTP ${run.status}`);
const capture = await (
  await fetch(`${base}/api/conversations/${conversation.id}/capture`)
).json();
if (capture?.text)
  console.log(
    `capture: ${capture.text.length} chars, ${capture.sources?.length ?? 0} sources, screenshot ${capture.screenshot ? `${capture.screenshot.length} b64` : 'NONE'}`,
  );
