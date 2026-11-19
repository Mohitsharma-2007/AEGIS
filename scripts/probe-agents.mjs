import { spawn } from 'node:child_process';
const c = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--remote-debugging-port=9345', '--user-data-dir=C:/Temp/cdpdbg9',
  '--no-first-run', '--disable-gpu', '--window-size=1536,960', '--force-device-scale-factor=1',
  'about:blank',
], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch('http://127.0.0.1:9345/json/list');
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
        await cdp('Runtime.evaluate', { expression: `[...document.querySelectorAll('.icon-rail .rail-item')].find(b => b.getAttribute('aria-label') === 'Agents')?.click()` });
        await sleep(3000);
        const out = {};

        const measure = `(() => ({
          overflowX: document.body.scrollWidth - document.documentElement.clientWidth,
          tabs: [...document.querySelectorAll('.ag-tabs button')].map(b => b.textContent.trim()),
          queries: !!document.querySelector('.ag-mail-panel'),
          threads: document.querySelectorAll('.ag-mail-thread').length,
          harness: !!document.querySelector('.harness-panel, .harness-layout'),
          teamCards: document.querySelectorAll('.ag-team-card').length,
          h1: document.querySelector('h1')?.textContent ?? null,
        }))()`;
        const initial = await cdp('Runtime.evaluate', { expression: measure, returnByValue: true });
        out.initial = initial.result?.result?.value;

        // switch to Team
        await cdp('Runtime.evaluate', { expression: `[...document.querySelectorAll('.ag-tabs button')].find(b => b.textContent.includes('Team'))?.click()` });
        await sleep(1200);
        const team = await cdp('Runtime.evaluate', { expression: measure, returnByValue: true });
        out.team = team.result?.result?.value;

        // switch to Harness
        await cdp('Runtime.evaluate', { expression: `[...document.querySelectorAll('.ag-tabs button')].find(b => b.textContent.includes('Harness'))?.click()` });
        await sleep(2000);
        const harness = await cdp('Runtime.evaluate', { expression: measure, returnByValue: true });
        out.harness = harness.result?.result?.value;

        // back to Queries
        await cdp('Runtime.evaluate', { expression: `[...document.querySelectorAll('.ag-tabs button')].find(b => b.textContent.includes('Queries'))?.click()` });
        await sleep(1500);
        const queries = await cdp('Runtime.evaluate', { expression: measure, returnByValue: true });
        out.queries = queries.result?.result?.value;

        out.consoleErrors = errors.slice(0, 20);
        console.log(JSON.stringify(out, null, 1));
        ws.close(); c.kill(); process.exit(0);
      }
    } catch (e) { /* retry */ }
    await sleep(400);
  }
  console.log('FAIL'); c.kill(); process.exit(1);
})();
