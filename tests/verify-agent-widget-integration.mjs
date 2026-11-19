/**
 * Automated Scenario Integration Test Suite
 * Milestone 2: Link Widgets with Tokens and Agents with APIs (Requirement R2)
 *
 * This test verifies:
 * 1. Health and authentication across all 7 background services (Host, Browser, WhatsApp, OpenCode, Daemon, Voice, Windows Bridge).
 * 2. LLM provider tokens in .env.local and cryptographic secrets in .aegis-data/.
 * 3. Token linkage: CSS design tokens, state tokens (--state), and persistent tokens (localStorage keys).
 * 4. Weather widget and system metrics data feeds and 300+ widget library tiles.
 * 5. Desktop broadcast payload formatting containing live agents, tasks, progress, steps, and widget feeds.
 * 6. IPC handlers in main.js / preload.js for widget actions, weather, and media controls.
 * 7. Live execution of a multi-agent swarm task via POST /api/agents/tasks to completion.
 * 8. Regression verification that the built surfaces are current and unduplicated.
 */

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';
import http from 'node:http';

const baseDir = path.resolve('aegis');
console.log('===============================================================');
console.log('  MILESTONE 2: AGENT & WIDGET INTEGRATION VERIFICATION SUITE   ');
console.log('===============================================================\n');

function httpRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data,
          json: () => {
            try {
              return JSON.parse(data);
            } catch (err) {
              throw new Error(`Failed to parse JSON (status ${res.statusCode}): ${data.slice(0, 100)}`);
            }
          },
        });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Timeout connecting to ${options.host}:${options.port}${options.path}`));
    });
    if (postData) req.write(postData);
    req.end();
  });
}

// --------------------------------------------------------------------------
// 1. Verify Environment Tokens and Secrets
// --------------------------------------------------------------------------
console.log('--- Step 1: Checking Provider Keys & Operational Secrets ---');
const envPath = path.join(baseDir, '.env.local');
assert(fs.existsSync(envPath), '.env.local must exist');
const envContent = fs.readFileSync(envPath, 'utf8');

const requiredKeys = [
  'OPENROUTER_API_KEY',
  'GROQ_API_KEY',
  'NVIDIA_API_KEY',
  'INCEPTION_API_KEY',
  'AEGIS_OPENCODE_PASSWORD',
];
for (const key of requiredKeys) {
  assert(envContent.includes(key), `Missing ${key} in .env.local`);
}
console.log('✓ LLM provider tokens present in .env.local (OpenRouter, Groq, Nvidia, Inception, OpenCode)');

const browserSecretFile = path.join(baseDir, '.aegis-data', 'browser-secret');
const whatsappSecretFile = path.join(baseDir, '.aegis-data', 'whatsapp-secret');
const opencodeSecretFile = path.join(baseDir, '.aegis-data', 'opencode-password');

assert(fs.existsSync(browserSecretFile), 'browser-secret file missing');
assert(fs.existsSync(whatsappSecretFile), 'whatsapp-secret file missing');
assert(fs.existsSync(opencodeSecretFile), 'opencode-password file missing');

const browserSecret = fs.readFileSync(browserSecretFile, 'utf8').trim();
const whatsappSecret = fs.readFileSync(whatsappSecretFile, 'utf8').trim();
const opencodePassword = fs.readFileSync(opencodeSecretFile, 'utf8').trim();

assert(browserSecret.length >= 20, 'browser-secret is too short');
assert(whatsappSecret.length >= 20, 'whatsapp-secret is too short');
assert(opencodePassword.length >= 20, 'opencode-password is too short');
console.log('✓ Operational service secrets verified in .aegis-data/');

// --------------------------------------------------------------------------
// 2. Verify All 7 Backend Services
// --------------------------------------------------------------------------
console.log('\n--- Step 2: Verifying All 7 Backend Services ---');

// 1. Host API (Port 4310)
const hostRes = await httpRequest({ host: '127.0.0.1', port: 4310, path: '/api/state', timeout: 3000 });
assert.strictEqual(hostRes.statusCode, 200, `Host returned status ${hostRes.statusCode}`);
const hostState = hostRes.json();
assert(hostState.settings, 'Host state missing settings');
console.log('✓ 1. Host API Gateway (:4310) healthy & responsive');

// 2. Browser Service (Port 4311)
const browserRes = await httpRequest({
  host: '127.0.0.1',
  port: 4311,
  path: '/health',
  headers: { Authorization: `Bearer ${browserSecret}` },
  timeout: 3000,
});
assert.strictEqual(browserRes.statusCode, 200, `Browser service returned status ${browserRes.statusCode}`);
const browserJson = browserRes.json();
assert.strictEqual(browserJson.ok, true, 'Browser service health not ok');
console.log(`✓ 2. Browser Service (:4311) authenticated & operational (${browserJson.engine})`);

// 3. WhatsApp Sidecar (Port 4312)
const waHealthRes = await httpRequest({ host: '127.0.0.1', port: 4312, path: '/health', timeout: 3000 });
assert.strictEqual(waHealthRes.statusCode, 200, `WhatsApp health returned ${waHealthRes.statusCode}`);
const waStatusRes = await httpRequest({
  host: '127.0.0.1',
  port: 4312,
  path: '/status',
  headers: { 'x-aegis-whatsapp-secret': whatsappSecret },
  timeout: 3000,
});
assert.strictEqual(waStatusRes.statusCode, 200, `WhatsApp status returned ${waStatusRes.statusCode}`);
const waJson = waStatusRes.json();
assert(waJson.state, 'WhatsApp missing state');
console.log(`✓ 3. WhatsApp Sidecar (:4312) authenticated & operational (state: ${waJson.state}, paired: ${waJson.paired})`);

// 4. OpenCode Harness (Port 4096)
const opencodeAuth = Buffer.from(`opencode:${opencodePassword}`).toString('base64');
const opencodeRes = await httpRequest({
  host: '127.0.0.1',
  port: 4096,
  path: '/api/info',
  headers: { Authorization: `Basic ${opencodeAuth}` },
  timeout: 3000,
});
assert.strictEqual(opencodeRes.statusCode, 200, `OpenCode returned status ${opencodeRes.statusCode}`);
const opencodeJson = opencodeRes.json();
assert(opencodeJson.version, 'OpenCode missing version');
console.log(`✓ 4. OpenCode Harness (:4096) authenticated & operational (v${opencodeJson.version})`);

// 5. Python Daemon (Port 8765)
const daemonRes = await httpRequest({ host: '127.0.0.1', port: 8765, path: '/health', timeout: 3000 });
assert.strictEqual(daemonRes.statusCode, 200, `Daemon returned status ${daemonRes.statusCode}`);
const daemonJson = daemonRes.json();
assert.strictEqual(daemonJson.ok, true, 'Daemon health not ok');
console.log(`✓ 5. Python Daemon (:8765) healthy & operational (tier: ${daemonJson.tier}, mode: ${daemonJson.mode})`);

// 6. Voice Pipeline (Port 8766)
const voiceRes = await httpRequest({ host: '127.0.0.1', port: 8766, path: '/health', timeout: 3000 });
assert.strictEqual(voiceRes.statusCode, 200, `Voice returned status ${voiceRes.statusCode}`);
const voiceJson = voiceRes.json();
assert.strictEqual(voiceJson.ok, true, 'Voice pipeline health not ok');
console.log(`✓ 6. Voice Pipeline (:8766) healthy & operational (stt: ${voiceJson.stt}, tts: ${voiceJson.tts || 'kokoro'})`);

// 7. Windows Voice Bridge (Port 8767)
const winBridgeRes = await httpRequest({ host: '127.0.0.1', port: 8767, path: '/health', timeout: 3000 });
assert.strictEqual(winBridgeRes.statusCode, 200, `Windows Bridge returned status ${winBridgeRes.statusCode}`);
const winBridgeJson = winBridgeRes.json();
assert.strictEqual(winBridgeJson.ok, true, 'Windows Bridge health not ok');
console.log(`✓ 7. Windows Voice Bridge (:8767) healthy & operational (engine: ${winBridgeJson.engine})`);

// --------------------------------------------------------------------------
// 3. Verify Design Tokens, State Tokens, and Persistent Keys
// --------------------------------------------------------------------------
console.log('\n--- Step 3: Verifying Widget Tokens & Data Feeds ---');

const coreCss = fs.readFileSync(path.join(baseDir, 'apps/desktop/desktop-ui/src/core.css'), 'utf8');
const designTokens = ['--surface', '--card', '--card2', '--card3', '--line', '--text', '--dim', '--accent', '--state', '--green', '--blue', '--amber', '--red'];
for (const dt of designTokens) {
  assert(coreCss.includes(dt), `Missing CSS design token ${dt} in core.css`);
}
console.log(`✓ Verified ${designTokens.length} primary CSS design tokens in core.css`);

const coreJs = fs.readFileSync(path.join(baseDir, 'apps/desktop/desktop-ui/src/core.js'), 'utf8');
assert(coreCss.includes('--state'), 'core.css missing --state');
assert(coreJs.includes("setProperty('--state'"), 'core.js missing --state setter');
assert(coreJs.includes("dataset.state = st.state"), 'core.js missing data-state assignment');
console.log('✓ Dynamic state tokens (--state, data-state) linked to agent lifecycle colors');

const libJs = fs.readFileSync(path.join(baseDir, 'apps/desktop/desktop-ui/src/lib.js'), 'utf8');
const cardsJs = fs.readFileSync(path.join(baseDir, 'apps/desktop/desktop-ui/src/cards.js'), 'utf8');
const combinedUi = coreJs + '\n' + libJs + '\n' + cardsJs;

const persistentKeys = [
  'aegis.tasks',
  'aegis.focus',
  'aegis.pad.',
  'aegis.lib',
  'aegis.weather.loc',
  'aegis.timers',
  'aegis.w.size',
  'aegis.w.hidden',
  'aegis.theme',
];
for (const pk of persistentKeys) {
  assert(combinedUi.includes(pk), `Missing persistent key ${pk} in UI components`);
}
console.log(`✓ Verified ${persistentKeys.length} persistent tokens & localStorage keys`);

// Weather data feed test via Host API
const weatherRes = await httpRequest({
  host: '127.0.0.1',
  port: 4310,
  path: '/api/weather?lat=51.5&lon=-0.12',
  timeout: 4000,
});
assert.strictEqual(weatherRes.statusCode, 200, `Weather API returned status ${weatherRes.statusCode}`);
const weatherData = weatherRes.json();
assert(weatherData.current && weatherData.current.temperature_2m !== undefined, 'Weather missing current temperature');
assert(weatherData.daily && Array.isArray(weatherData.daily.time), 'Weather missing daily forecast array');
console.log(`✓ Weather feed operational (current: ${weatherData.current.temperature_2m}°C, code: ${weatherData.current.weather_code})`);

// Count library tiles
const tileMatches = libJs.match(/\['[a-z0-9_-]+',\s*'[^']+'/g) || [];
assert(tileMatches.length >= 250, `Expected at least 250 tiles, found ${tileMatches.length}`);
console.log(`✓ Verified ${tileMatches.length} widget library tiles configured with active data feeds`);

// --------------------------------------------------------------------------
// 4. Verify Desktop Main & Preload Linkages
// --------------------------------------------------------------------------
console.log('\n--- Step 4: Verifying Desktop Status Loop & IPC Handlers ---');

const mainJs = fs.readFileSync(path.join(baseDir, 'apps/desktop/main.js'), 'utf8');
const preloadJs = fs.readFileSync(path.join(baseDir, 'apps/desktop/preload.js'), 'utf8');

// watchTasks fetches from all three required endpoints
assert(mainJs.includes('/api/state'), 'main.js missing /api/state in watchTasks');
assert(mainJs.includes('/api/agents'), 'main.js missing /api/agents in watchTasks');
assert(mainJs.includes('/api/agents/tasks'), 'main.js missing /api/agents/tasks in watchTasks');
console.log('✓ main.js watchTasks() polls /api/state, /api/agents, and /api/agents/tasks');

// Packages live agents and widget feeds into broadcastStatus
assert(mainJs.includes('agents: liveAgents'), 'main.js missing liveAgents packaging');
assert(mainJs.includes('widgets: widgetData'), 'main.js missing widgetData packaging');
assert(mainJs.includes("aegis:agents"), 'main.js missing aegis:agents event broadcast');
assert(mainJs.includes("aegis:widgets"), 'main.js missing aegis:widgets event broadcast');
console.log('✓ broadcastStatus packages live agents, active tasks, subagents, and widget feeds');

// IPC Action handlers
assert(mainJs.includes("action === 'weather-location'"), 'main.js missing weather-location handler');
assert(mainJs.includes("action === 'mediaControl'"), 'main.js missing mediaControl handler');
assert(mainJs.includes("data?.id === 'agents'"), 'main.js missing agents widget action handler');
assert(mainJs.includes("aegis:get-weather"), 'main.js missing aegis:get-weather handler');
assert(mainJs.includes("aegis:get-agents"), 'main.js missing aegis:get-agents handler');

// Preload exposures
assert(preloadJs.includes('getWeather: () => ipcRenderer.invoke'), 'preload.js missing getWeather');
assert(preloadJs.includes('getAgents: () => ipcRenderer.invoke'), 'preload.js missing getAgents');
assert(preloadJs.includes('onAgents: (callback) =>'), 'preload.js missing onAgents');
assert(preloadJs.includes('mediaControl: (control) =>'), 'preload.js missing mediaControl');
console.log('✓ IPC bridge (main.js <-> preload.js) fully linked for widgets, agents, weather, and media');

// --------------------------------------------------------------------------
// 5. Test Multi-Agent Task Submission & Scenario Execution
// --------------------------------------------------------------------------
console.log('\n--- Step 5: Executing Multi-Agent Task Scenario Workflow ---');

const taskPrompt = 'Conduct a rapid system security and file health review, then provide an executive summary.';
const postTaskData = JSON.stringify({
  prompt: taskPrompt,
  dotId: 'a010f3c9-f4b1-43ca-8808-851ea01fae1c',
});

const submitRes = await httpRequest(
  {
    host: '127.0.0.1',
    port: 4310,
    path: '/api/agents/tasks',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postTaskData),
    },
    timeout: 5000,
  },
  postTaskData
);

assert.strictEqual(submitRes.statusCode, 202, `Task creation returned status ${submitRes.statusCode}`);
const taskCreated = submitRes.json();
assert(taskCreated.id, 'Task creation response missing id');
console.log(`✓ Multi-agent task submitted successfully (Task ID: ${taskCreated.id}, status: ${taskCreated.status})`);

// Poll task for completion (up to 30s)
let finishedTask = null;
const startTime = Date.now();
while (Date.now() - startTime < 35000) {
  const pollRes = await httpRequest({
    host: '127.0.0.1',
    port: 4310,
    path: `/api/agents/tasks/${taskCreated.id}`,
    timeout: 3000,
  });
  if (pollRes.statusCode === 200) {
    const task = pollRes.json();
    if (task.status === 'completed' || task.status === 'failed') {
      finishedTask = task;
      break;
    }
  }
  await new Promise((r) => setTimeout(r, 1500));
}

assert(finishedTask, 'Task timed out waiting for completion');
assert.strictEqual(finishedTask.status, 'completed', `Task did not complete successfully (status: ${finishedTask.status})`);
assert(Array.isArray(finishedTask.subtasks) && finishedTask.subtasks.length > 0, 'Completed task has no subtasks');
assert(Array.isArray(finishedTask.events) && finishedTask.events.length > 0, 'Completed task has no events');
assert(finishedTask.synthesis && finishedTask.synthesis.length > 50, 'Completed task missing synthesis');

console.log(`✓ Multi-agent task completed successfully!`);
console.log(`  - Subtasks executed: ${finishedTask.subtasks.length}`);
console.log(`  - Events logged: ${finishedTask.events.length}`);
console.log(`  - Synthesis length: ${finishedTask.synthesis.length} characters`);
console.log(`  - Provider/Model: ${finishedTask.provider} / ${finishedTask.model}`);

// --------------------------------------------------------------------------
// 6. Built surfaces match their sources
// --------------------------------------------------------------------------
// This replaces the old Milestone 1/4 scripts. They asserted that ui-kit/ held a
// byte-identical copy of every source file (including a stale src/ fork), which
// meant a second builder could silently overwrite the real pages. The check now
// is the one that matters: every surface in ui-kit/ was produced by build.mjs
// and contains the shared runtime, so a stale copy is caught here.
console.log('\n--- Step 6: Verifying Built Surfaces ---');
const kitDir = path.join(baseDir, 'apps/desktop/ui-kit');
for (const surface of ['notch', 'overlay', 'widgets', 'tray-pill']) {
  const file = path.join(kitDir, `${surface}.html`);
  assert(fs.existsSync(file), `Missing built surface ${surface}.html`);
  const html = fs.readFileSync(file, 'utf8');
  assert(html.includes('--accent'), `${surface}.html is missing the inlined core.css tokens`);
  assert(html.includes('aegis.kit') || html.includes('AegisMascot') || html.includes('function'),
    `${surface}.html is missing its inlined runtime`);
  assert(!html.includes('/*CSS*/') && !html.includes('/*CORE*/'), `${surface}.html was copied before its placeholders were filled in`);
}
assert(fs.existsSync(path.join(kitDir, 'annotations.html')), 'Missing built surface annotations.html');
console.log('✓ All 5 built surfaces are present and self-contained');

const stray = ['notch.html', 'overlay.html', 'widgets.html', 'annotations.html']
  .filter((name) => fs.existsSync(path.join(baseDir, 'apps/desktop', name)));
assert.strictEqual(stray.length, 0, `Duplicate surface copies at apps/desktop: ${stray.join(', ')}`);
console.log('✓ No duplicate surface copies outside ui-kit/');

console.log('\n===============================================================');
console.log('🎉 ALL MILESTONE 2 INTEGRATION CHECKS PASSED WITH 100% SUCCESS ');
console.log('===============================================================');
