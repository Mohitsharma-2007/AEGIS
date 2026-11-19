import { spawn } from 'node:child_process';
const c = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--remote-debugging-port=9347', '--user-data-dir=C:/Temp/cdpdbg11',
  '--no-first-run', '--disable-gpu', '--window-size=1536,960', '--force-device-scale-factor=1',
  'about:blank',
], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch('http://127.0.0.1:9347/json/list');
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
        await sleep(5500);
        await cdp('Runtime.evaluate', { expression: `window.dispatchEvent(new CustomEvent('aegis:penboard', { detail: { open: true, demo: 'pyth' } }))` });
        await sleep(4000);
        const evalIn = async (expr) => {
          const res = await cdp('Runtime.evaluate', { expression: `(() => { const f = document.querySelector('.penboard-stage iframe'); if (!f || !f.contentDocument) return { frame: false }; const w = f.contentWindow; return ${expr}; })()`, returnByValue: true });
          return res.result?.result?.value;
        };
        const out = {};
        out.panel = await evalIn(`({ frame: true, haveApi: typeof w.AegisAnnotateWb === 'object', demos: w.AegisAnnotateWb ? w.AegisAnnotateWb.demos : null, stageCls: w.document.querySelector('#stage')?.className ?? null })`);
        // Try calling the wb api directly
        const direct = await cdp('Runtime.evaluate', { expression: `(() => { const f = document.querySelector('.penboard-stage iframe'); const w = f.contentWindow; w.AegisAnnotateWb.play(w.AegisAnnotateWb.demos.includes('pyth') ? ({ unit: 'px', timeoutMs: 20000, steps: [{ explanation: 'test', drawings: [{ type: 'pythagoras', a: 3, b: 4 }] }] }) : {}); return true; })()`, returnByValue: true });
        out.direct = direct.result?.result?.value;
        await sleep(2500);
        out.afterDirect = await evalIn(`({ paths: w.document.querySelectorAll('#ink path').length, texts: w.document.querySelectorAll('#ink text').length, stageCls: w.document.querySelector('#stage')?.className ?? null, capOn: w.document.querySelector('#cap')?.classList.contains('on') ?? false })`);
        out.consoleErrors = errors.slice(0, 20);
        console.log(JSON.stringify(out, null, 1));
        ws.close(); c.kill(); process.exit(0);
      }
    } catch (e) { /* retry */ }
    await sleep(400);
  }
  console.log('FAIL'); c.kill(); process.exit(1);
})();
