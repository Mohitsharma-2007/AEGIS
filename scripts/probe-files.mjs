import { spawn } from 'node:child_process';
const c = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--remote-debugging-port=9352', '--user-data-dir=C:/Temp/cdpdbg16',
  '--no-first-run', '--disable-gpu', '--window-size=1536,960', '--force-device-scale-factor=1',
  'about:blank',
], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch('http://127.0.0.1:9352/json/list');
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
        await sleep(5500);
        await cdp('Runtime.evaluate', { expression: `[...document.querySelectorAll('.icon-rail .rail-item')].find(b => b.getAttribute('aria-label') === 'Files')?.click()` });
        await sleep(3000);
        const res = await cdp('Runtime.evaluate', {
          expression: `(() => {
            const header = document.querySelector('.files-hub-header');
            const tableWrap = document.querySelector('.files-table-wrapper');
            const inspector = document.querySelector('.file-quick-inspector');
            const h = header ? header.getBoundingClientRect() : null;
            const tw = tableWrap ? tableWrap.getBoundingClientRect() : null;
            const insp = inspector ? inspector.getBoundingClientRect() : null;
            const pathCell = document.querySelector('.file-path-cell');
            const cs = pathCell ? getComputedStyle(pathCell) : null;
            return { headerW: h ? Math.round(h.width) : null, tableW: tw ? Math.round(tw.width) : null, widthMatch: h && tw ? Math.abs(h.width - tw.width) < 4 : null, inspectorBelow: insp && tw ? insp.top >= tw.bottom - 4 : null, pathWhiteSpace: cs ? cs.whiteSpace : null, pathEllipsis: cs ? cs.textOverflow : null, overflowX: document.body.scrollWidth - document.documentElement.clientWidth };
          })()`,
          returnByValue: true,
        });
        console.log(JSON.stringify(res.result?.result?.value, null, 1));
        ws.close(); c.kill(); process.exit(0);
      }
    } catch { /* retry */ }
    await sleep(400);
  }
  console.log('FAIL'); c.kill(); process.exit(1);
})();
