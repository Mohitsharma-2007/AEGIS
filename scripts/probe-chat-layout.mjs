import { spawn } from 'node:child_process';
const c = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--remote-debugging-port=9353', '--user-data-dir=C:/Temp/cdpdbg17',
  '--no-first-run', '--disable-gpu', '--window-size=1536,960', '--force-device-scale-factor=1',
  'about:blank',
], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch('http://127.0.0.1:9353/json/list');
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
        // click the first thread row explicitly
        await cdp('Runtime.evaluate', { expression: `document.querySelector('.thread-row .nav-item')?.click()` });
        await sleep(4200);
        const res = await cdp('Runtime.evaluate', {
          expression: `(() => {
            const composer = document.querySelector('.chat-composer');
            const transcript = document.querySelector('.chat-transcript');
            const cr = composer ? composer.getBoundingClientRect() : null;
            const tr = transcript ? transcript.getBoundingClientRect() : null;
            const vh = document.documentElement.clientHeight;
            return {
              hasComposer: !!composer,
              hasTranscript: !!transcript,
              composerBottomGap: cr ? Math.round(vh - cr.bottom) : null,
              composerNearBottom: cr ? (vh - cr.bottom) < 40 && cr.top > vh * 0.5 : null,
              transcriptHeight: tr ? Math.round(tr.height) : null,
              transcriptScrollable: tr ? transcript.scrollHeight >= transcript.clientHeight : null,
              connectorsInChat: ['Microsoft Office 365','Slack Workspace','Windows Voice Access','Google Workspace'].some(s => document.querySelector('.chat-whatsapp')?.innerText.includes(s)),
              overflowX: document.body.scrollWidth - document.documentElement.clientWidth,
            };
          })()`,
          returnByValue: true,
        });
        const out = res.result?.result?.value ?? {};
        out.consoleErrors = errors.slice(0, 20);
        console.log(JSON.stringify(out, null, 1));
        ws.close(); c.kill(); process.exit(0);
      }
    } catch { /* retry */ }
    await sleep(400);
  }
  console.log('FAIL'); c.kill(); process.exit(1);
})();
