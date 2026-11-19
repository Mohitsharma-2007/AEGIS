// CDP app walkthrough: loads AEGIS, visits every surface, checks layout
// invariants, and collects console errors per view.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = '9334';
const URL = 'http://127.0.0.1:4310';
const userData = mkdtempSync(join(tmpdir(), 'cdp-walk-'));

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
    } else if (msg.method === 'Network.responseReceived' && msg.params.response.status >= 400) {
      badHttp.push(`${msg.params.response.status} ${msg.params.response.url}`);
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

  const report = [];
  const snap = async (label) => {
    const info = await evalJs(`(() => {
      const vw = document.documentElement.clientWidth;
      const vh = document.documentElement.clientHeight;
      const bodyOverflowX = document.body.scrollWidth - vw;
      const sel = (s) => { const el = document.querySelector(s); return el ? (() => {
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), visible: r.width > 0 && r.height > 0 };
      })() : null; };
      const rail = sel('.icon-rail');
      const sidebar = sel('.sidebar');
      const topbar = sel('.topbar');
      const main = sel('.main-content') || sel('.chat-workspace');
      const overlapped = [];
      if (rail && sidebar) {
        if (rail.x + rail.w > sidebar.x && rail.x < sidebar.x + sidebar.w) overlapped.push('rail overlaps sidebar');
      }
      return {
        vw, vh, bodyOverflowX,
        rail, sidebar, topbar, main,
        overlapped,
        navCollapsed: document.querySelector('.app')?.classList.contains('nav-collapsed') ?? null,
        breadcrumb: document.querySelector('.breadcrumbs')?.innerText?.replace(/\\s+/g, ' ') ?? null,
        railButtons: document.querySelectorAll('.icon-rail .rail-item').length,
        sidebarButtons: document.querySelectorAll('.sidebar button').length,
        h1: document.querySelector('main h1')?.textContent ?? null,
        viewTitle: document.querySelector('.page-heading h1')?.textContent ?? null,
      };
    })()`);
    report.push({ view: label, info });
  };

  // Home (chat/empty)
  await snap('chat-empty');

  // Visit every surface via rail buttons (their aria-label matches label)
  const labels = ['Agents', 'Files', 'Memory', 'Research', 'Integrations', 'Companion'];
  for (const label of labels) {
    const clicked = await evalJs(`(() => {
      const btns = [...document.querySelectorAll('.icon-rail .rail-item')];
      const b = btns.find((x) => x.getAttribute('aria-label') === ${JSON.stringify(label)});
      if (!b) return false;
      b.click(); return true;
    })()`);
    await sleep(2500);
    await snap('rail:' + label);
    if (!clicked) report.push({ view: 'rail:' + label, error: 'button not found' });
  }

  // Settings via rail
  await evalJs(`document.querySelector('.icon-rail .rail-settings')?.click()`);
  await sleep(2500);
  await snap('rail:settings');

  // Voice OS via rail
  await evalJs(`document.querySelector('.icon-rail .rail-voice')?.click()`);
  await sleep(2000);
  await snap('voice-os');

  // Chat again, then open a real conversation (click first thread)
  await evalJs(`(() => {
    const rail = document.querySelector('.icon-rail .rail-item[aria-label="Conversation"]');
    rail?.click();
  })()`);
  await sleep(2000);
  const threadClicked = await evalJs(`(() => {
    const t = document.querySelector('.thread-list-item') || [...document.querySelectorAll('button')].find(b => /audit|sse|conversation/i.test(b.textContent) && b.closest('.sidebar'));
    if (!t) return false;
    t.click(); return true;
  })()`);
  await sleep(3500);
  await snap('chat-thread:' + (threadClicked ? 'clicked' : 'none'));

  // Try sending a real message through the composer (should be functional)
  const sendResult = await evalJs(`(() => {
    const ta = document.querySelector('textarea[aria-label="Start a conversation"], .composer textarea');
    if (!ta) return { ok: false, why: 'no textarea' };
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, 'Say hello in one short sentence.');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    const btn = document.querySelector('.composer .send-button');
    if (!btn) return { ok: false, why: 'no send button' };
    if (btn.disabled) return { ok: false, why: 'send disabled' };
    btn.click();
    return { ok: true };
  })()`);
  await sleep(15000);
  const afterSend = await evalJs(`(() => {
    const msgs = [...document.querySelectorAll('.transcript-message, .message, [class*="message"]')];
    return { msgCount: msgs.length, lastText: msgs.at(-1)?.textContent?.slice(0, 200) ?? null };
  })()`);
  report.push({ sendResult, afterSend });

  writeFileSync('cdp-walk.json', JSON.stringify({ report, errors: errors.slice(0, 40), exceptions: exceptions.slice(0, 20), badHttp: badHttp.slice(0, 40) }, null, 2));
  ws.close(); chrome.kill();
  console.log('walk done');
}

main().catch((e) => { console.error('ERR', e); chrome.kill(); process.exit(1); });
