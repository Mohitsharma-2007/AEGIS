// Notch page inspection (single in-page run): load generated notch.html,
// drive hover/click/settings interactions, collect errors and DOM state.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = '9336';
const userData = mkdtempSync(join(tmpdir(), 'cdp-notch-'));
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
    }
  });
  await cdp(ws, 'Page.enable');
  await cdp(ws, 'Runtime.enable');
  await cdp(ws, 'Page.navigate', { url: 'file:///D:/Aegis 2/aegis/apps/desktop/ui-kit/notch.html' });
  let ready = false;
  for (let k = 0; k < 40; k++) {
    const s = await cdp(ws, 'Runtime.evaluate', { expression: 'document.readyState + "|" + !!document.querySelector("#island")', returnByValue: true });
    const v = s.result?.value ?? '';
    if (v.startsWith('complete|true')) { ready = true; break; }
    await sleep(500);
  }
  console.log('notch ready:', ready);

  const probe = `(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const rect = sel => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), display: getComputedStyle(el).display }; };
    const out = {};
    out.initial = {
      title: document.title,
      island: rect('#island'),
      ws: rect('#ws'),
      deck2: rect('#deck2'),
      bodyW: document.body.scrollWidth,
      vw: document.documentElement.clientWidth,
      hasWs: !!document.querySelector('#ws'),
      fileCount: document.querySelector('#file-count')?.textContent ?? null,
      tcount: document.querySelector('#tcount')?.textContent ?? null,
      hoverCls: document.querySelector('#island')?.className ?? null,
    };

    // hover
    const island = document.querySelector('#island');
    const r0 = island.getBoundingClientRect();
    const hx = r0.left + r0.width / 2, hy = r0.top + r0.height / 2;
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: hx, clientY: hy, bubbles: true }));
    island.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    await sleep(300);
    out.afterHover = {
      islandCls: island.className,
      quickButtons: document.querySelectorAll('#quick button').length,
      quickRect: rect('#quick'),
    };
    await sleep(1400);
    out.afterDwell = { islandCls: island.className, wsCls: document.querySelector('#ws')?.className ?? null, wsRect: rect('#ws'), openCls: island.classList.contains('open') };

    // contextmenu → settings
    island.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: hx, clientY: hy }));
    await sleep(500);
    out.settings = {
      nsetCls: island.classList.contains('nset'),
      nsetRect: rect('#nset'),
      controls: document.querySelectorAll('#nset input, #nset select, #nset button').length,
      cwVal: document.querySelector('#ns-cw')?.value ?? null,
    };
    document.querySelector('#ns-done')?.click();
    await sleep(300);
    out.afterDone = { nsetCls: island.classList.contains('nset') };

    // textarea/input
    const pad = document.querySelector('#pad');
    if (pad) { const s = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set; s.call(pad, 'hello world'); pad.dispatchEvent(new Event('input', { bubbles: true })); }
    const tnew = document.querySelector('#tnew');
    if (tnew) { const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; s.call(tnew, 'a task'); tnew.dispatchEvent(new Event('input', { bubbles: true })); }
    await sleep(200);
    out.words = document.querySelector('#pwords')?.textContent ?? null;
    out.taskCount = document.querySelector('#tcount')?.textContent ?? null;

    // click compact → open workspace
    document.querySelector('#compact')?.click();
    await sleep(400);
    out.afterCompactClick = { openCls: island.classList.contains('open'), wsCls: document.querySelector('#ws')?.className ?? null };

    return out;
  })()`;

  const res = await cdp(ws, 'Runtime.evaluate', { expression: probe, returnByValue: true, awaitPromise: true });
  let report = {};
  if (res.exceptionDetails) {
    report = { error: res.exceptionDetails.exception?.description ?? res.exceptionDetails.text };
  } else {
    report = res.result.value ?? {};
  }
  report.consoleErrors = errors.slice(0, 30);
  report.exceptions = exceptions.slice(0, 20);
  writeFileSync('cdp-notch.json', JSON.stringify(report, null, 2));
  ws.close(); chrome.kill();
  console.log('notch inspect done');
}
main().catch((e) => { console.error('ERR', e); chrome.kill(); process.exit(1); });
