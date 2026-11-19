import { spawn } from 'node:child_process';
const c = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--remote-debugging-port=9346', '--user-data-dir=C:/Temp/cdpdbg10',
  '--no-first-run', '--disable-gpu', '--window-size=1536,960', '--force-device-scale-factor=1',
  'about:blank',
], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch('http://127.0.0.1:9346/json/list');
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

        const out = {};
        // Open the pen board with the Pythagoras demo.
        await cdp('Runtime.evaluate', { expression: `window.dispatchEvent(new CustomEvent('aegis:penboard', { detail: { open: true, demo: 'pyth' } }))` });

        // Wait for iframe load + demo to start drawing.
        let stage = null;
        for (let k = 0; k < 40; k++) {
          const s = await cdp('Runtime.evaluate', {
            expression: `(() => {
              const frame = document.querySelector('.penboard-stage iframe');
              if (!frame || !frame.contentDocument) return null;
              const doc = frame.contentDocument;
              const paths = doc.querySelectorAll('#ink path').length;
              const texts = doc.querySelectorAll('#ink text').length;
              const capOn = doc.querySelector('#cap')?.classList.contains('on') ?? false;
              return { paths, texts, capOn, stageOn: doc.querySelector('#stage')?.classList.contains('on') ?? false };
            })()`,
            returnByValue: true,
          });
          const value = s.result?.result?.value;
          if (value && (value.paths > 0 || value.capOn)) { stage = value; break; }
          await sleep(500);
        }
        out.stage = stage;

        // Wait a bit more for the demo to progress; sample again.
        await sleep(6000);
        const later = await cdp('Runtime.evaluate', {
          expression: `(() => {
            const frame = document.querySelector('.penboard-stage iframe');
            if (!frame || !frame.contentDocument) return null;
            const doc = frame.contentDocument;
            const paths = doc.querySelectorAll('#ink path').length;
            const texts = doc.querySelectorAll('#ink text').length;
            const formulas = [...doc.querySelectorAll('#ink text')].map(t => t.textContent).filter(s => s.includes('²') || s.includes('+'));
            return { paths, texts, formulas: formulas.slice(0, 6), title: doc.title };
          })()`,
          returnByValue: true,
        });
        out.later = later.result?.result?.value;
        out.consoleErrors = errors.slice(0, 20);

        console.log(JSON.stringify(out, null, 1));
        ws.close(); c.kill(); process.exit(0);
      }
    } catch (e) { /* retry */ }
    await sleep(400);
  }
  console.log('FAIL'); c.kill(); process.exit(1);
})();
