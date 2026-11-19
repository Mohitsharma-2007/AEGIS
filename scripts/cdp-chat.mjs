// Real UI chat-turn test: open a thread, type a message, send it, wait for
// the assistant to reply, and report what happened.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = '9335';
const URL = 'http://127.0.0.1:4310';
const userData = mkdtempSync(join(tmpdir(), 'cdp-chat-'));
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${userData}`,
  '--no-first-run', '--disable-gpu', '--window-size=1536,960', '--force-device-scale-factor=1',
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJson(url, attempts = 30) {
  for (let i = 0; i < attempts; i++) {
    try { const res = await fetch(url); if (res.ok) return await res.json(); } catch {}
    await sleep(400);
  }
  throw new Error('CDP not up');
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
const errors = [];
const exceptions = [];
const badHttp = [];
const sseCalls = [];

async function main() {
  const targets = await getJson(`http://127.0.0.1:${PORT}/json/list`);
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id); pending.delete(msg.id);
      msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      errors.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    } else if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      exceptions.push((d.text || '') + ' ' + (d.exception?.description ?? ''));
    } else if (msg.method === 'Network.responseReceived') {
      const r = msg.params.response;
      if (r.status >= 400) badHttp.push(`${r.status} ${r.url}`);
      if (r.url.includes('/api/copilotkit')) sseCalls.push(`${r.status} ${r.mimeType} ${r.url.slice(0, 160)}`);
    }
  });

  await cdp(ws, 'Page.enable');
  await cdp(ws, 'Runtime.enable');
  await cdp(ws, 'Network.enable');
  await cdp(ws, 'Page.navigate', { url: URL });
  for (let i = 0; i < 60; i++) {
    const s = await cdp(ws, 'Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
    if (s.result.value === 'complete') break;
    await sleep(400);
  }
  await sleep(4000);

  const evalJs = async (expression) => {
    const r = await cdp(ws, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { error: r.exceptionDetails.exception?.description ?? r.exceptionDetails.text };
    return r.result.value;
  };

  const report = {};

  // Choose an existing conversation (a real one with content).
  const chosen = await evalJs(`(() => {
    const btn = [...document.querySelectorAll('.sidebar button')].find((b) =>
      /audit|sse|conversation|16:/.test(b.textContent) && b.closest('.sidebar-scroll'));
    if (!btn) return { ok: false, why: 'no thread button' };
    btn.click();
    return { ok: true };
  })()`);
  report.choseThread = chosen;
  await sleep(4000);

  const composer = await evalJs(`(() => {
    const ta = document.querySelector('.chat-composer textarea');
    if (!ta) return { ok: false, why: 'no .chat-composer textarea' };
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, 'Hello! Reply with exactly: ready');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return { ok: true, disabled: ta.disabled };
  })()`);
  report.composer = composer;
  await sleep(600);

  const sendClick = await evalJs(`(() => {
    const btn = document.querySelector('.chat-composer .send-button');
    if (!btn) return { ok: false, why: 'no send button' };
    if (btn.disabled) return { ok: false, why: 'send disabled: ' + (btn.getAttribute('aria-label') || '') };
    btn.click();
    return { ok: true };
  })()`);
  report.sendClick = sendClick;

  // Poll for an assistant reply or error for up to 90s.
  const before = await evalJs(`document.querySelectorAll('.transcript-message, .message-item, [class*="assistant"]').length`);
  report.messagesBefore = before;
  let outcome = 'no answer within 90s';
  const t0 = Date.now();
  while (Date.now() - t0 < 90000) {
    const state = await evalJs(`(() => {
      const msgs = [...document.querySelectorAll('.transcript-message, .message-item, [class*="assistant"]')];
      const body = document.body.innerText;
      const err = document.querySelector('[class*="error"], [class*="notice"]')?.innerText?.slice(0, 200) || null;
      return {
        count: msgs.length,
        last: msgs.at(-1)?.innerText?.slice(0, 300) ?? '',
        sending: /Sending|Thinking|working|…/.test(msgs.at(-1)?.innerText ?? ''),
        err,
        bodyHasReady: /exactly: ready|ready/.test(body),
      };
    })()`);
    if (state.count > before && !state.sending) { outcome = 'reply-arrived'; report.final = state; break; }
    if (state.err && state.err.length > 3) { outcome = 'error-in-dom: ' + state.err; break; }
    await sleep(2000);
  }
  report.outcome = outcome;
  report.consoleErrors = errors.slice(0, 20);
  report.exceptions = exceptions.slice(0, 10);
  report.badHttp = badHttp.slice(0, 20);
  report.copilotkitCalls = sseCalls.slice(0, 20);

  writeFileSync('cdp-chat.json', JSON.stringify(report, null, 2));
  ws.close(); chrome.kill();
  console.log('chat test done');
}
main().catch((e) => { console.error('ERR', e); chrome.kill(); process.exit(1); });
