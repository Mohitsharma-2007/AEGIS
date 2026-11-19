// CDP inspector: loads a URL in headless Chrome and dumps console errors,
// network failures, and a trimmed accessibility tree.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = process.env.CDP_PORT || '9333';
const URL = process.env.TARGET_URL || 'http://127.0.0.1:4310';
const TIMEOUT = Number(process.env.TIMEOUT_MS || 45000);

const userData = mkdtempSync(join(tmpdir(), 'cdp-aegis-'));
const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${userData}`,
  '--no-first-run',
  '--disable-gpu',
  '--window-size=1536,960',
  '--force-device-scale-factor=1',
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, attempts = 30) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch { /* not up yet */ }
    await sleep(400);
  }
  throw new Error('Chrome CDP did not come up');
}

let nextId = 1;
const pending = new Map();
function cdp(ws, method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function main() {
  const stage = (s) => console.log('[stage] ' + s);
  stage('fetch targets');
  let targets;
  try {
    targets = await getJson(`http://127.0.0.1:${PORT}/json/list`);
  } catch (e) {
    chrome.kill();
    console.error('FAIL: ' + e.message);
    process.exit(1);
  }
  stage('targets: ' + targets.length);
  const page = targets.find((t) => t.type === 'page');
  stage('ws url: ' + page.webSocketDebuggerUrl);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = () => { stage('ws open'); resolve(); };
    ws.onerror = (e) => { stage('ws error ' + e.message); reject(new Error('ws error')); };
  });
  stage('cdp enable');
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
      else p.resolve(msg.result);
    }
  });

  const logs = [];
  const network = [];
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      const args = msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
      logs.push(args);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      logs.push('EXCEPTION: ' + (d.text || '') + ' ' + (d.exception?.description ?? ''));
    } else if (msg.method === 'Network.responseReceived' && msg.params.response.status >= 400) {
      network.push(`${msg.params.response.status} ${msg.params.response.url}`);
    }
  });

  await cdp(ws, 'Page.enable');
  await cdp(ws, 'Runtime.enable');
  await cdp(ws, 'Network.enable');
  await cdp(ws, 'Accessibility.enable');
  await cdp(ws, 'Page.navigate', { url: URL });

  // Wait for network idle-ish: poll for document ready state + a bit.
  for (let i = 0; i < 60; i++) {
    try {
      const s = await cdp(ws, 'Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
      if (s.result.value === 'complete') break;
    } catch { }
    await sleep(500);
  }
  await sleep(3500);

  const ax = await cdp(ws, 'Accessibility.getFullAXTree');
  const ignoreRoles = new Set(['StaticText', 'none', 'generic', 'paragraph', 'linebreak']);
  const lines = [];
  for (const node of ax.nodes) {
    if (ignoreRoles.has(node.role?.value)) continue;
    const name = node.name?.value || '';
    const val = node.value?.value ?? '';
    if (!name && !val) continue;
    const role = node.role?.value || '?';
    const props = Object.entries(node.properties || {})
      .map(([k, v]) => `${k}=${v.value ?? ''}`)
      .filter((p) => ['disabled=true', 'checked=true', 'expanded=true', 'pressed=true'].includes(p))
      .join(' ');
    lines.push(`[${role}] ${name}${val ? ` (= ${val})` : ''}${props ? ` {${props}}` : ''}`);
  }

  const html = await cdp(ws, 'Runtime.evaluate', {
    expression: `document.getElementById('root')?.innerHTML?.length ?? -1`,
    returnByValue: true,
  });

  const title = await cdp(ws, 'Runtime.evaluate', {
    expression: 'document.title',
    returnByValue: true,
  });

  writeFileSync(process.env.OUT || 'cdp-out.txt', [
    `TITLE: ${title.result.value}`,
    `ROOT_HTML_LEN: ${html.result.value}`,
    '',
    '=== CONSOLE ERRORS ===',
    ...logs.slice(0, 60),
    '',
    '=== NETWORK 4xx/5xx ===',
    ...network.slice(0, 100),
    '',
    '=== AX TREE ===',
    ...lines.slice(0, 600),
    '',
  ].join('\n'));

  ws.close();
  chrome.kill();
  console.log('written ' + (process.env.OUT || 'cdp-out.txt'));
}

main().catch((e) => { console.error('ERR', e); chrome.kill(); process.exit(1); });
