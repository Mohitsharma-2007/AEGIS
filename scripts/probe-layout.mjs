import { spawn } from 'node:child_process';
const c = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--remote-debugging-port=9341', '--user-data-dir=C:/Temp/cdpdbg5',
  '--no-first-run', '--disable-gpu', '--window-size=1536,960', '--force-device-scale-factor=1',
  'about:blank',
], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch('http://127.0.0.1:9341/json/list');
      if (r.ok) {
        const t = await r.json();
        const p = t.find(x => x.type === 'page');
        const ws = new WebSocket(p.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        let id = 1; const pend = new Map();
        ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
        const cdp = (method, params = {}) => new Promise(res => { pend.set(id, res); ws.send(JSON.stringify({ id: id++, method, params })); });
        await cdp('Page.enable');
        await cdp('Runtime.enable');
        await cdp('Page.navigate', { url: 'http://127.0.0.1:4310' });
        await sleep(5000);
        const measure = `(() => {
          const rect = sel => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), display: cs.display, visibility: cs.visibility, left: cs.left, z: cs.zIndex }; };
          return {
            chat: { rail: rect('.icon-rail'), sidebar: rect('.sidebar'), topbar: rect('.topbar'), ws: rect('.workspace') },
          };
        })()`;
        const r0 = await cdp('Runtime.evaluate', { expression: measure, returnByValue: true });
        console.log('CHAT', JSON.stringify(r0.result?.result?.value));

        // click Agents rail item
        await cdp('Runtime.evaluate', { expression: `[...document.querySelectorAll('.icon-rail .rail-item')].find(b => b.getAttribute('aria-label') === 'Agents')?.click()` });
        await sleep(3000);
        const r1 = await cdp('Runtime.evaluate', { expression: measure, returnByValue: true });
        console.log('AGENTS', JSON.stringify(r1.result?.result?.value));

        // expand sidebar via rail-toggle click
        await cdp('Runtime.evaluate', { expression: `document.querySelector('.icon-rail .rail-toggle')?.click()` });
        await sleep(1500);
        const r2 = await cdp('Runtime.evaluate', { expression: measure, returnByValue: true });
        console.log('AGENTS-EXPANDED', JSON.stringify(r2.result?.result?.value));

        ws.close(); c.kill(); process.exit(0);
      }
    } catch (e) { /* retry */ }
    await sleep(400);
  }
  console.log('FAIL'); c.kill(); process.exit(1);
})();
