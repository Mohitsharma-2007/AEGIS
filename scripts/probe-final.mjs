import { spawn } from 'node:child_process';
const c = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--remote-debugging-port=9344', '--user-data-dir=C:/Temp/cdpdbg8',
  '--no-first-run', '--disable-gpu', '--window-size=1536,960', '--force-device-scale-factor=1',
  'about:blank',
], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch('http://127.0.0.1:9344/json/list');
      if (r.ok) {
        const t = await r.json();
        const p = t.find(x => x.type === 'page');
        const ws = new WebSocket(p.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        let id = 1; const pend = new Map(); const errors = [];
        ws.onmessage = ev => {
          const m = JSON.parse(ev.data);
          if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
          else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value ?? a.description ?? '').join(' '));
          else if (m.method === 'Runtime.exceptionThrown') { const d = m.params.exceptionDetails; errors.push('EXC ' + (d.text || '') + ' ' + (d.exception?.description ?? '')); }
        };
        const cdp = (method, params = {}) => new Promise(res => { pend.set(id, res); ws.send(JSON.stringify({ id: id++, method, params })); });
        await cdp('Page.enable');
        await cdp('Runtime.enable');
        await cdp('Page.navigate', { url: 'http://127.0.0.1:4310' });
        await sleep(5000);

        const out = {};
        // 1) sidebar restore check: start expanded on chat -> go Files -> back to chat
        const initial = await cdp('Runtime.evaluate', { expression: `(() => { const el = document.querySelector('.sidebar'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), w: Math.round(r.width), display: getComputedStyle(el).display }; })()`, returnByValue: true });
        out.initialSidebar = initial.result?.result?.value;
        await cdp('Runtime.evaluate', { expression: `[...document.querySelectorAll('.icon-rail .rail-item')].find(b => b.getAttribute('aria-label') === 'Files')?.click()` });
        await sleep(2000);
        const filesSidebar = await cdp('Runtime.evaluate', { expression: `(() => { const el = document.querySelector('.sidebar'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), w: Math.round(r.width), display: getComputedStyle(el).display }; })()`, returnByValue: true });
        out.filesSidebar = filesSidebar.result?.result?.value;
        await cdp('Runtime.evaluate', { expression: `[...document.querySelectorAll('.icon-rail .rail-item')].find(b => b.getAttribute('aria-label') === 'Conversation')?.click()` });
        await sleep(2000);
        const backSidebar = await cdp('Runtime.evaluate', { expression: `(() => { const el = document.querySelector('.sidebar'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), w: Math.round(r.width), display: getComputedStyle(el).display }; })()`, returnByValue: true });
        out.backSidebar = backSidebar.result?.result?.value;

        // 2) voice-command navigation via the desktop-action bridge
        await cdp('Runtime.evaluate', { expression: `window.dispatchEvent(new CustomEvent('aegis:desktop-action', { detail: { action: 'voice-command', data: { command: 'open files' } } }))` });
        await sleep(2000);
        const afterVoice = await cdp('Runtime.evaluate', { expression: `({ h1: document.querySelector('main h1')?.textContent ?? null, breadcrumb: document.querySelector('.breadcrumbs')?.innerText?.replace(/\\s+/g,' ') ?? null })`, returnByValue: true });
        out.afterVoiceNav = afterVoice.result?.result?.value;

        out.consoleErrors = errors.slice(0, 20);
        console.log(JSON.stringify(out, null, 1));
        ws.close(); c.kill(); process.exit(0);
      }
    } catch (e) { /* retry */ }
    await sleep(400);
  }
  console.log('FAIL'); c.kill(); process.exit(1);
})();
