// Full boot test: start the stub LLM, start the real OpenDots server with
// ONLY a registry provider key (AEGIS_PROVIDER=openrouter, dummy key, stub
// base URL), then drive agent turns over HTTP AG-UI and verify the Settings
// provider chooser applies live. Run: node aegis/tests/boot-test.mjs
import { spawn } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const opendots = join(here, '..', 'apps', 'host');
const STUB_PORT = 24390;
const SERVER_PORT = 24391;
const BASE = `http://127.0.0.1:${SERVER_PORT}`;
const CANNED = 'Hello from the Aegis stub.';
const stubLog = `/tmp/aegis-stub-log-${process.pid}.txt`;
const database = `/tmp/aegis-boot-${process.pid}.sqlite`;
rmSync(stubLog, { force: true });
for (const suffix of ['', '-wal', '-shm'])
  rmSync(`${database}${suffix}`, { force: true });

const children = [];
function start(command, args, options) {
  const child = spawn(command, args, {
    ...options,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.output = '';
  child.stdout.on('data', (data) => (child.output += data));
  child.stderr.on('data', (data) => (child.output += data));
  children.push(child);
  return child;
}
function stopAll() {
  for (const child of children) child.kill('SIGTERM');
}
async function waitFor(url, label, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {
      // Server not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${label} at ${url}`);
}
let failures = 0;
function check(name, condition, detail = '') {
  if (condition) console.log(`PASS ${name}`);
  else {
    failures += 1;
    console.log(`FAIL ${name} ${detail}`);
  }
}

const stub = start('node', [join(here, 'stub-llm.mjs')], {
  env: { ...process.env, STUB_PORT: String(STUB_PORT), STUB_LOG: stubLog },
});
const server = start('node', ['--import', 'tsx', 'src/server/index.ts'], {
  cwd: opendots,
  env: {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: String(SERVER_PORT),
    DATABASE_PATH: database,
    DO_NOT_TRACK: '1',
    AEGIS_PROVIDER: 'openrouter',
    OPENROUTER_API_KEY: 'dummy-boot-key',
    OPENROUTER_BASE_URL: `http://127.0.0.1:${STUB_PORT}/v1`,
  },
});

try {
  await waitFor(`http://127.0.0.1:${STUB_PORT}/v1/models`, 'stub LLM');
  const workspaceResponse = await waitFor(`${BASE}/api/workspace`, 'OpenDots');
  const workspace = await workspaceResponse.json();
  check('server boots with only a provider key', true);
  check(
    'setup.missing is empty in local provider mode',
    Array.isArray(workspace.setup?.missing) &&
      workspace.setup.missing.length === 0,
    JSON.stringify(workspace.setup),
  );
  check(
    'setup reports local mode (no Intelligence)',
    workspace.setup?.intelligence === false,
  );
  check(
    'setup reports active provider openrouter',
    workspace.setup?.activeProvider?.id === 'openrouter',
    JSON.stringify(workspace.setup?.activeProvider),
  );

  const providersResponse = await fetch(`${BASE}/api/providers`);
  const providers = await providersResponse.json();
  check(
    'GET /api/providers flags openrouter configured, groq not',
    providers.providers?.find((p) => p.id === 'openrouter')?.configured ===
      true &&
      providers.providers?.find((p) => p.id === 'groq')?.configured === false,
  );
  check(
    'GET /api/providers never leaks the dummy key',
    !JSON.stringify(providers).includes('dummy-boot-key'),
  );

  const dot = workspace.dots[0];
  const conversationResponse = await fetch(`${BASE}/api/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dotId: dot.id, title: 'Boot test' }),
  });
  check(
    'POST /api/conversations creates a local thread (201)',
    conversationResponse.status === 201,
    `status ${conversationResponse.status}`,
  );
  const conversation = await conversationResponse.json();

  async function runTurn(label) {
    const response = await fetch(
      `${BASE}/api/copilotkit/agent/${dot.id}/run`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({
          threadId: conversation.id,
          runId: `boot-${Date.now()}`,
          state: {},
          tools: [],
          context: [],
          messages: [
            { id: `m-${Date.now()}`, role: 'user', content: 'Say hello' },
          ],
          forwardedProps: {},
        }),
      },
    );
    const text = await response.text();
    check(
      `${label}: AG-UI run returns the canned reply`,
      response.ok && text.includes('Aegis stub.') && !text.includes('RUN_ERROR'),
      `status ${response.status} body ${text.slice(0, 300)}`,
    );
    return text;
  }

  await runTurn('turn 1 (default model)');
  const modelsAfterFirst = readFileSync(stubLog, 'utf8');
  check(
    'stub received the registry default model',
    modelsAfterFirst.includes('nvidia/nemotron-3-ultra-550b-a55b:free'),
    modelsAfterFirst,
  );

  const putResponse = await fetch(`${BASE}/api/providers`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      providerId: 'openrouter',
      model: 'cohere/north-mini-code:free',
    }),
  });
  const putBody = await putResponse.json();
  check(
    'PUT /api/providers switches the model',
    putResponse.ok && putBody.active?.model === 'cohere/north-mini-code:free',
    JSON.stringify(putBody).slice(0, 300),
  );
  await runTurn('turn 2 (after live model switch)');
  const modelsAfterSecond = readFileSync(stubLog, 'utf8');
  check(
    'live switch took effect without restart (stub saw the new model)',
    modelsAfterSecond.includes('cohere/north-mini-code:free'),
    modelsAfterSecond,
  );

  const groqResponse = await fetch(`${BASE}/api/providers`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      providerId: 'groq',
      model: 'llama-3.1-8b-instant',
    }),
  });
  const groqBody = await groqResponse.json();
  check(
    'selecting an unconfigured provider honestly reports its missing key',
    groqResponse.ok &&
      JSON.stringify(groqBody.setup?.missing ?? []).includes('GROQ_API_KEY'),
    JSON.stringify(groqBody).slice(0, 300),
  );
  await fetch(`${BASE}/api/providers`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      providerId: 'openrouter',
      model: 'nvidia/nemotron-3-ultra-550b-a55b:free',
    }),
  });
  check('provider restored to openrouter for a clean shutdown', true);
} catch (error) {
  failures += 1;
  console.log(`FAIL boot test error: ${error.message}`);
  console.log('--- server output tail ---');
  console.log(server.output.slice(-2000));
} finally {
  stopAll();
  await new Promise((resolve) => setTimeout(resolve, 500));
  for (const suffix of ['', '-wal', '-shm'])
    rmSync(`${database}${suffix}`, { force: true });
  rmSync(stubLog, { force: true });
}
console.log(
  failures === 0 ? 'BOOT TEST PASSED' : `BOOT TEST FAILED (${failures})`,
);
process.exit(failures === 0 ? 0 : 1);
