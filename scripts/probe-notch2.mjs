import { spawn } from 'node:child_process';
const c = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--remote-debugging-port=9360', '--user-data-dir=C:/Temp/cdpdbg60',
  '--no-first-run', '--disable-gpu', '--window-size=400,400', '--force-device-scale-factor=1',
  'about:blank',
], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch('http://127.0.0.1:9360/json/list');
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
        await cdp('Page.navigate', { url: 'file:///D:/Aegis%202/aegis/apps/desktop/ui-kit/notch.html' });
        await sleep(3000);
        const res = await cdp('Runtime.evaluate', {
          expression: `(() => {
            const island = document.querySelector('.island');
            const compact = document.querySelector('.compact');
            const ws = document.querySelector('.ws');
            return {
              title: document.title,
              hasIsland: !!island,
              hasCompact: !!compact,
              islandRect: island ? { x: Math.round(island.getBoundingClientRect().x), y: Math.round(island.getBoundingClientRect().y), w: Math.round(island.getBoundingClientRect().width), h: Math.round(island.getBoundingClientRect().height) } : null,
              islandClasses: island?.className ?? null,
              bodyText: document.body.innerText.trim().slice(0, 200),
            };
          })()`,
          returnByValue: true,
        });
        console.log(JSON.stringify({ value: res.result?.result?.value, errors: errors.slice(0, 20) }, null, 1));
        ws.close(); c.kill(); process.exit(0);
      }
    } catch { /* retry */ }
    await sleep(400);
  }
  console.log('FAIL'); c.kill(); process.exit(1);
})();
