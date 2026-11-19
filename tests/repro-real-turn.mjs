// Real-provider turn check: boots the host with the workspace's own
// .env.local (never printed), against a throwaway copy of the database, and
// drives one genuine AG-UI run. This is the reproduction harness for the
// field crash where the server died between sending a chat and replying.
//
//   cd aegis && node tests/repro-real-turn.mjs
//
// Exit code 0 means: health OK, conversation created, run streamed a real
// assistant reply, and the server survived the turn.
import { spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const host = join(root, 'apps', 'host');
const hostDir = existsSync(host) ? host : join(root, 'apps', 'host');
const port = Number(process.env.REPRO_PORT ?? 4321);
const base = `http://127.0.0.1:${port}`;
const work = join(root, '.aegis-data', 'repro');
mkdirSync(work, { recursive: true });
const database = join(work, 'repro.sqlite');
for (const suffix of ['', '-wal', '-shm']) rmSync(`${database}${suffix}`, { force: true });
for (const suffix of ['', '-wal', '-shm']) {
  const source = join(hostDir, 'data', `aegis.sqlite${suffix}`);
  if (existsSync(source)) copyFileSync(source, `${database}${suffix}`);
}
const prompt =
  process.env.REPRO_PROMPT ??
  'Answer in one short sentence: are you receiving this message?';

const child = spawn(
  process.execPath,
  [
    '--env-file-if-exists=.env',
    '--env-file-if-exists=.env.local',
    '--env-file-if-exists=../.env.local',
    '--env-file-if-exists=../../.env.local',
    'dist/server/server/index.js',
  ],
  {
    cwd: hostDir,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      DATABASE_PATH: database,
      AEGIS_LOG_DIR: join(work, 'logs'),
      DO_NOT_TRACK: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
let output = '';
child.stdout.on('data', (d) => (output += d));
child.stderr.on('data', (d) => (output += d));
let exited;
const exitPromise = new Promise((resolve) => {
  child.on('exit', (code, signal) => {
    exited = { code, signal };
    resolve(exited);
  });
});

async function waitFor(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (exited) throw new Error(`server exited during boot: ${JSON.stringify(exited)}`);
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`timed out waiting for ${url}`);
}

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failures += 1;
};

try {
  const health = await (await waitFor(`${base}/api/health`)).json();
  check('host answers /api/health', health.ok === true, JSON.stringify(health));
  check(
    'a provider and model are active',
    !!health.provider && !!health.model,
    JSON.stringify({ provider: health.provider, model: health.model }),
  );
  check('health names the log file', typeof health.log === 'string', String(health.log));

  const workspace = await (await waitFor(`${base}/api/workspace`)).json();
  const dot = workspace.dots?.[0];
  check('workspace has a primary Agent', !!dot?.id);

  const created = await fetch(`${base}/api/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dotId: dot.id, title: 'Real turn repro' }),
  });
  check('conversation created (201)', created.status === 201, `status ${created.status}`);
  const conversation = await created.json();

  const run = await fetch(`${base}/api/copilotkit/agent/${dot.id}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({
      threadId: conversation.id,
      runId: `repro-${Date.now()}`,
      state: {},
      tools: [],
      context: [],
      messages: [
        { id: `m-${Date.now()}`, role: 'user', content: prompt },
      ],
      forwardedProps: {},
    }),
  });
  const body = await run.text();
  const errorEvent = body.match(/"type":"RUN_ERROR"[^\n]*/);
  const text = [...body.matchAll(/"type":"TEXT_MESSAGE_CONTENT"[^\n]*?"delta":"((?:[^"\\]|\\.)*)"/g)]
    .map((match) => JSON.parse(`"${match[1]}"`))
    .join('');
  check('run returned HTTP 200', run.status === 200, `status ${run.status}`);
  check('no RUN_ERROR in the stream', !errorEvent, errorEvent?.[0]?.slice(0, 300) ?? '');
  check('assistant produced text', text.trim().length > 0, body.slice(0, 400));
  if (text.trim()) console.log(`assistant: ${text.trim().slice(0, 400)}`);

  const stored = await (await fetch(`${base}/api/conversations/${conversation.id}/messages`)).json();
  check(
    'turn persisted (user + assistant) for reload hydration',
    Array.isArray(stored.messages) &&
      stored.messages.length === 2 &&
      stored.messages[0].role === 'user' &&
      stored.messages[1].role === 'assistant',
    JSON.stringify(stored).slice(0, 300),
  );

  // Second turn: the model must receive the stored history and the server must
  // append, not duplicate. A follow-up that references the first answer is the
  // cheapest proof the context survived.
  const followUp = await fetch(`${base}/api/copilotkit/agent/${dot.id}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({
      threadId: conversation.id,
      runId: `repro-2-${Date.now()}`,
      state: {},
      tools: [],
      context: [],
      messages: [
        { id: `m2-${Date.now()}`, role: 'user', content: 'What did I just ask you?' },
      ],
      forwardedProps: {},
    }),
  });
  const followBody = await followUp.text();
  check(
    'second turn succeeds with stored context',
    followUp.status === 200 && !followBody.includes('RUN_ERROR'),
    followBody.slice(0, 300),
  );
  const after = await (await fetch(`${base}/api/conversations/${conversation.id}/messages`)).json();
  check(
    'second turn appends without duplicating',
    after.messages?.length === 4,
    JSON.stringify(after.messages?.map((m) => m.role)),
  );

  await new Promise((r) => setTimeout(r, 1500));
  check('host still alive after the turn', !exited, JSON.stringify(exited));
  if (exited) {
    console.log('--- server output ---');
    console.log(output.slice(-4000));
  }
} catch (error) {
  failures += 1;
  console.log(`FAIL repro error: ${error.message}`);
  console.log('--- server output ---');
  console.log(output.slice(-4000));
} finally {
  child.kill('SIGTERM');
  await Promise.race([exitPromise, new Promise((r) => setTimeout(r, 3000))]);
  if (existsSync(join(work, 'logs', 'host.log'))) {
    console.log('--- host.log tail ---');
    const lines = readFileSync(join(work, 'logs', 'host.log'), 'utf8').trim().split('\n');
    console.log(lines.slice(-12).join('\n'));
  }
}
console.log(failures === 0 ? 'REAL TURN PASSED' : `REAL TURN FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
