import { spawn } from 'node:child_process';
const c = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--remote-debugging-port=9350', '--user-data-dir=C:/Temp/cdpdbg14',
  '--no-first-run', '--disable-gpu', '--window-size=1536,960', '--force-device-scale-factor=1',
  'about:blank',
], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch('http://127.0.0.1:9350/json/list');
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
        await sleep(6000);
        const out = {};
        out.root = (await cdp('Runtime.evaluate', { expression: `({ rootLen: document.getElementById('root')?.innerHTML.length ?? -1, overlayBefore: !!document.querySelector('.penboard-overlay') })`, returnByValue: true })).result?.result?.value;
        await cdp('Runtime.evaluate', { expression: `window.dispatchEvent(new CustomEvent('aegis:penboard', { detail: { open: true, demo: 'pyth' } }))` });
        await sleep(1500);
        out.afterOpen = (await cdp('Runtime.evaluate', { expression: `({ overlay: !!document.querySelector('.penboard-overlay'), frame: !!document.querySelector('.penboard-stage iframe'), panel: !!document.querySelector('.penboard-panel') })`, returnByValue: true })).result?.result?.value;
        out.consoleErrors = errors.slice(0, 30);
        console.log(JSON.stringify(out, null, 1));
        ws.close(); c.kill(); process.exit(0);
      }
    } catch (e) { /* retry */ }
    await sleep(400);
  }
  console.log('FAIL'); c.kill(); process.exit(1);
})();
