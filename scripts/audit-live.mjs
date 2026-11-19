// Live AEGIS audit runner: exercises the running host over real HTTP.
// Usage: node scripts/audit-live.mjs [baseUrl]
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const base = process.argv[2] ?? 'http://127.0.0.1:4310';
const outDir = join(process.cwd(), 'docs', 'aegis-audit');
mkdirSync(outDir, { recursive: true });
const logPath = join(outDir, 'live-runs.jsonl');
writeFileSync(logPath, '');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function record(entry) {
  appendFileSync(logPath, `${JSON.stringify(entry)}\n`);
  const status = entry.pass === true ? 'PASS' : entry.pass === false ? 'FAIL' : 'INFO';
  console.log(
    `[${status}] ${entry.test} ${entry.detail ? `- ${String(entry.detail).slice(0, 160)}` : ''}`,
  );
}

async function messages(sessionId) {
  const res = await fetch(`${base}/api/harness/sessions/${sessionId}/messages`);
  const data = await res.json();
  return data.data ?? [];
}

async function prompt(sessionId, text) {
  const started = Date.now();
  const res = await fetch(`${base}/api/harness/sessions/${sessionId}/prompt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  const body = await res.json();
  return { status: res.status, body, started };
}

/** Waits for a new assistant message after the given message count. */
async function waitForReply(sessionId, previousCount, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const all = await messages(sessionId);
    if (all.length > previousCount) {
      const last = all[all.length - 1];
      if (last.type === 'assistant') return { all, last };
    }
    await sleep(1200);
  }
  return { all: await messages(sessionId), last: null };
}

async function ask(sessionId, text) {
  const before = (await messages(sessionId)).length;
  const sent = await prompt(sessionId, text);
  if (sent.status !== 200 || !sent.body?.success)
    return { ok: false, latencyMs: Date.now() - sent.started, reply: '', status: sent.status };
  const { last } = await waitForReply(sessionId, before);
  return {
    ok: Boolean(last),
    latencyMs: Date.now() - sent.started,
    reply: last?.text ?? '',
    messageId: last?.id,
  };
}

const sessionId = 'sess_audit_live';
const created = await fetch(`${base}/api/harness/sessions`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ title: 'Live audit session' }),
});
const createdBody = await created.json().catch(() => null);
const session =
  createdBody?.data?.id ?? createdBody?.id ?? createdBody?.session?.id ?? sessionId;

// 1 coding test: request node execution, verify the approval gate, then approve
// and read the execution output from the harness.
{
  const code =
    'node: function isPalindrome(s){const t=s.toLowerCase().replace(/[^a-z0-9]/g,"");return t===t.split("").reverse().join("");} console.log([isPalindrome("A man, a plan, a canal: Panama"),isPalindrome("Aegis")].join(","))';
  const before = (await messages(session)).length;
  const sent = await prompt(session, code);
  const replied = await waitForReply(session, before, 30_000);
  const approval = replied.last?.approval;
  record({
    test: 'coding: approval gate raised for node execution',
    command: `POST /api/harness/sessions/${session}/prompt (node: isPalindrome)`,
    observed: { status: sent.status, approval: approval?.status, command: approval?.command },
    pass: Boolean(approval?.id),
  });
  if (approval?.id) {
    const approved = await fetch(
      `${base}/api/harness/sessions/${session}/approve`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ approvalId: approval.id, approved: true }),
      },
    );
    const body = await approved.json();
    const after = await messages(session);
    const execution = after.map((m) => m.execution).filter(Boolean).pop();
    record({
      test: 'coding: node execution result after approval',
      command: `POST /api/harness/sessions/${session}/approve`,
      observed: { status: approved.status, body, execution },
      detail: JSON.stringify(execution ?? body).slice(0, 300),
      pass: Boolean(execution) && JSON.stringify(execution).includes('true,false'),
    });
  }
}

// 3 mathematical tests against the configured model.
const math = [
  { name: 'math-1 arithmetic', prompt: 'What is 17 * 23? Reply with just the number.', expect: '391' },
  {
    name: 'math-2 percentage',
    prompt: 'What is 18.5% of 240? Reply with just the number.',
    expect: '44.4',
  },
  {
    name: 'math-3 word problem',
    prompt:
      'A train travels 240 km in 2.5 hours, then 180 km in 2 hours. What is its average speed for the whole trip in km/h? Reply with just the number.',
    expect: '93.3',
  },
];
for (const item of math) {
  const run = await ask(session, item.prompt);
  const normalized = run.reply.replace(/\s+/g, ' ').trim();
  record({
    test: item.name,
    command: `POST /api/harness/sessions/${session}/prompt`,
    prompt: item.prompt,
    expected: item.expect,
    observed: normalized.slice(0, 200),
    latencyMs: run.latencyMs,
    pass: run.ok && normalized.includes(item.expect),
  });
}

// 20 consecutive agent iterations: same instruction each time, so consistency
// can be judged from the per-iteration output.
for (let i = 1; i <= 20; i += 1) {
  const a = i * 3 + 1;
  const b = i * 2 + 2;
  const expected = String(a + b);
  const promptText = `Iteration ${i}: reply with just the number for ${a} + ${b}.`;
  const run = await ask(session, promptText);
  const reply = run.reply.replace(/\s+/g, ' ').trim();
  record({
    test: `iteration-${String(i).padStart(2, '0')}`,
    command: `POST /api/harness/sessions/${session}/prompt`,
    prompt: promptText,
    expected,
    observed: reply.slice(0, 200),
    latencyMs: run.latencyMs,
    pass: run.ok && new RegExp(`(^|[^0-9])${expected}([^0-9]|$)`).test(reply),
  });
}

const all = await messages(session);
record({
  test: 'session summary',
  observed: { session, messages: all.length, last: all[all.length - 1]?.text?.slice(0, 120) },
  pass: null,
});
console.log(`log: ${logPath}`);
