// Live proof that the model can draw: run a real turn that offers the
// show_visual generative-UI tool and report whether the model called it and
// with which spec. No server is started; point it at a running host.
//
//   node tests/live-visual.mjs [baseUrl] ["prompt"]
import { visualUiTool } from '../apps/host/dist/server/shared/visual-ui.js';

const base = process.argv[2] ?? 'http://127.0.0.1:4310';
const prompt =
  process.argv[3] ??
  'Show me a small chart of these three monthly signups: January 12, February 18, March 15. Draw it as a bar chart with one stat tile for the total.';

const health = await (await fetch(`${base}/api/health`)).json();
console.log(`provider: ${health.provider}/${health.model}`);
if (!health.ok) {
  console.error('host is not healthy');
  process.exit(1);
}

const workspace = await (await fetch(`${base}/api/workspace`)).json();
const dot = workspace.dots?.[0];
const created = await fetch(`${base}/api/conversations`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ dotId: dot.id, title: 'Generative UI check' }),
});
const conversation = await created.json();
console.log(`conversation: ${conversation.id}`);

const run = await fetch(`${base}/api/copilotkit/agent/${dot.id}/run`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
  body: JSON.stringify({
    threadId: conversation.id,
    runId: `visual-${Date.now()}`,
    state: {},
    context: [],
    // What the real chat sends when it mounts useFrontendTool(show_visual).
    tools: [visualUiTool],
    messages: [{ id: `m-${Date.now()}`, role: 'user', content: prompt }],
    forwardedProps: {},
  }),
});
const body = await run.text();

const calls = [...body.matchAll(/"type":"TOOL_CALL_START"[^\n]*/g)].map((match) => match[0]);
const args = [...body.matchAll(/"type":"TOOL_CALL_ARGS"[^\n]*/g)].map((match) => match[0]);
const text = [...body.matchAll(/"type":"TEXT_MESSAGE_CONTENT"[^\n]*?"delta":"((?:[^"\\]|\\.)*)"/g)]
  .map((match) => JSON.parse(`"${match[1]}"`))
  .join('');
const error = body.match(/"type":"RUN_ERROR"[^\n]*/);

console.log(`HTTP ${run.status}`);
console.log('tool calls:');
for (const call of calls) console.log(`  ${call.slice(0, 160)}`);
for (const arg of args) console.log(`  args: ${arg.slice(0, 600)}`);
console.log('error:', error ? error[0].slice(0, 300) : 'none');
console.log('assistant text:', text.trim().slice(0, 400));

const visual = calls.some((call) => call.includes('show_visual'));
if (visual) {
  console.log('\nPASS  the model called show_visual');
} else {
  console.log('\nFAIL  the model did not call show_visual');
  process.exitCode = 1;
}
