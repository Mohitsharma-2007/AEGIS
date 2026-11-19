// Scripted Aegis agent runner.
//
// Drives the CopilotKit v2 run endpoint directly (same protocol the Electron
// client uses) so reliability runs are repeatable without the UI.
//
// usage:
//   node scripts/agent-runner.mjs --prompt "..." [--thread <id>] [--timeout 120]
//   node scripts/agent-runner.mjs --file prompts.json     # [{name, prompt}]
//
// Output: one JSON object per run on stdout, plus a summary line.
import { randomUUID } from 'node:crypto';

const HOST = process.env.AEGIS_HOST || 'http://127.0.0.1:4310';
const DOT = process.env.AEGIS_DOT || '';

function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function resolveDot() {
  if (DOT) return DOT;
  const res = await fetch(`${HOST}/api/workspace`);
  const ws = await res.json();
  const dot = (ws.dots || [])[0];
  if (!dot) throw new Error('no agent (dot) available');
  return dot.id;
}

async function runPrompt(dotId, prompt, { threadId, timeoutMs = 180000 } = {}) {
  let thread = threadId;
  if (!thread) {
    // The runtime only accepts a thread that belongs to this Agent and owner,
    // so create the conversation through the same route the UI uses.
    const created = await fetch(`${HOST}/api/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: HOST, Referer: `${HOST}/` },
      body: JSON.stringify({ dotId, title: `audit ${new Date().toISOString().slice(11, 19)}` }),
    });
    if (!created.ok) {
      return {
        ok: false,
        error: `conversation create failed: HTTP ${created.status} ${(await created.text().catch(() => '')).slice(0, 160)}`,
        durationMs: 0,
      };
    }
    const conversation = await created.json();
    thread = conversation.id ?? conversation.threadId;
    if (!thread) {
      return { ok: false, error: 'conversation create returned no id', durationMs: 0 };
    }
  }
  const runId = randomUUID();
  const body = {
    threadId: thread,
    runId,
    tools: [],
    context: [],
    forwardedProps: {},
    state: {},
    messages: [{ id: randomUUID(), role: 'user', content: prompt }],
  };
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let text = '';
  let reasoning = '';
  const toolCalls = [];
  let runError = null;
  let runStarted = false;
  let runFinished = false;
  const eventTypes = new Set();
  let currentTool = null;
  try {
    const res = await fetch(`${HOST}/api/copilotkit/agent/${dotId}/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        // The CopilotKit handler applies a CORS policy; the browser sends this
        // header on same-origin POSTs, a scripted client must send it too.
        Origin: HOST,
        Referer: `${HOST}/`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => '');
      return {
        ok: false,
        threadId: thread,
        error: `HTTP ${res.status} ${res.statusText} ${detail.slice(0, 200)}`,
        durationMs: Date.now() - started,
      };
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        for (const line of raw.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          let evt;
          try {
            evt = JSON.parse(payload);
          } catch {
            continue;
          }
          eventTypes.add(evt.type);
          if (
            (evt.type === 'TEXT_MESSAGE_CHUNK' ||
              evt.type === 'TEXT_MESSAGE_CONTENT') &&
            typeof evt.delta === 'string'
          )
            text += evt.delta;
          else if (
            evt.type === 'REASONING_MESSAGE_CONTENT' &&
            typeof evt.delta === 'string'
          )
            reasoning += evt.delta;
          else if (evt.type === 'TOOL_CALL_START') {
            currentTool = { name: evt.toolCallId ? 'unknown' : 'unknown', id: evt.toolCallId, args: '' };
            toolCalls.push(currentTool);
          } else if (evt.type === 'TOOL_CALL_ARGS' && currentTool) {
            currentTool.args += evt.delta || '';
          } else if (evt.type === 'TOOL_CALL_END' && currentTool) {
            currentTool.name = evt.toolName || currentTool.name;
          } else if (evt.type === 'TOOL_CALL_RESULT' && currentTool) {
            currentTool.result = String(evt.content ?? '').slice(0, 600);
          } else if (evt.type === 'RUN_ERROR') {
            runError = evt.message || evt.code || 'run error';
          } else if (evt.type === 'RUN_STARTED') runStarted = true;
          else if (evt.type === 'RUN_FINISHED') runFinished = true;
        }
      }
    }
  } catch (error) {
    runError = runError || String(error?.message || error);
  } finally {
    clearTimeout(timer);
  }
  return {
    ok: !runError && text.trim().length > 0,
    threadId: thread,
    runId,
    text: text.trim(),
    reasoning: reasoning.trim().slice(0, 400),
    toolCalls: toolCalls.map((t) => ({ name: t.name, args: (t.args || '').slice(0, 300), result: (t.result || '').slice(0, 300) })),
    runError,
    runStarted,
    runFinished,
    eventTypes: [...eventTypes],
    durationMs: Date.now() - started,
  };
}

const dotId = await resolveDot();
const file = arg('file');
const prompt = arg('prompt');
const timeoutMs = Number(arg('timeout', '180000'));
const threadId = arg('thread');
const label = arg('label', 'run');

let cases = [];
if (file) {
  const raw = JSON.parse(await (await import('node:fs/promises')).readFile(file, 'utf8'));
  cases = Array.isArray(raw) ? raw : [raw];
} else {
  cases = [{ name: label, prompt: prompt || 'Reply with exactly: OK' }];
}

const results = [];
for (const item of cases) {
  const result = await runPrompt(dotId, item.prompt, { threadId: item.threadId || threadId, timeoutMs });
  results.push({ name: item.name, ...result });
  console.log(
    JSON.stringify({
      name: item.name,
      ok: result.ok,
      durationMs: result.durationMs,
      chars: result.text?.length ?? 0,
      tools: result.toolCalls?.map((t) => t.name) ?? [],
      error: result.runError ?? result.error ?? null,
      excerpt: (result.text || '').slice(0, 220),
    }),
  );}

const outFile = arg('out');
if (outFile) {
  const fs = await import('node:fs/promises');
  await fs.writeFile(outFile, JSON.stringify(results, null, 2));
  console.log(`wrote ${outFile}`);
}

const passed = results.filter((r) => r.ok).length;
console.log(
  JSON.stringify({
    summary: true,
    total: results.length,
    passed,
    failed: results.length - passed,
    avgDurationMs: Math.round(results.reduce((a, r) => a + (r.durationMs || 0), 0) / Math.max(1, results.length)),
  }),
);
