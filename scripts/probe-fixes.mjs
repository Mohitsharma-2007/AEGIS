import { spawn } from 'node:child_process';
const c = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--remote-debugging-port=9351', '--user-data-dir=C:/Temp/cdpdbg15',
  '--no-first-run', '--disable-gpu', '--window-size=1536,960', '--force-device-scale-factor=1',
  'about:blank',
], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch('http://127.0.0.1:9351/json/list');
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
        const evalJs = async (expr) => (await cdp('Runtime.evaluate', { expression: expr, returnByValue: true })).result?.result?.value;
        const out = {};

        // open a chat thread
        await evalJs(`(() => { const btn = [...document.querySelectorAll('.sidebar button')].find(b => /audit|sse|conversation|16:/.test(b.textContent) && b.closest('.sidebar-scroll')); btn?.click(); })()`);
        await sleep(3500);
        out.chat = await evalJs(`(() => {
          const wa = document.querySelector('.chat-whatsapp');
          const bodyText = document.body.innerText;
          const viewport = document.documentElement.clientHeight;
          const composer = document.querySelector('.chat-composer');
          const transcript = document.querySelector('.chat-transcript');
          const cr = composer ? composer.getBoundingClientRect() : null;
          const tr = transcript ? transcript.getBoundingClientRect() : null;
          return {
            connectorsInChat: ['Microsoft Office 365','Slack Workspace','Windows Voice Access','Google Workspace'].some(s => wa ? wa.innerText.includes(s) : false),
            waExists: !!wa,
            composerVisibleAtBottom: cr ? (viewport - cr.bottom) < 40 && cr.bottom > viewport * 0.6 : null,
            transcriptScrollable: tr ? transcript.scrollHeight >= transcript.clientHeight : null,
            overflowX: document.body.scrollWidth - document.documentElement.clientWidth,
            waText: wa ? wa.innerText.slice(0, 80) : '',
          };
        })()`);

        // Agents placeholder
        await evalJs(`[...document.querySelectorAll('.icon-rail .rail-item')].find(b => b.getAttribute('aria-label') === 'Agents')?.click()`);
        await sleep(2500);
        out.agents = await evalJs(`(() => {
          const ta = document.querySelector('.ag-composer textarea');
          return { placeholder: ta ? ta.placeholder : null, doubleSpace: ta ? /\s{2,}/.test(ta.placeholder) : null };
        })()`);

        // Files page
        await evalJs(`[...document.querySelectorAll('.icon-rail .rail-item')].find(b => b.getAttribute('aria-label') === 'Files')?.click()`);
        await sleep(3000);
        out.files = await evalJs(`(() => {
          const header = document.querySelector('.files-hub-header');
          const tableWrap = document.querySelector('.files-table-wrapper');
          const h = header ? header.getBoundingClientRect() : null;
          const tw = tableWrap ? tableWrap.getBoundingClientRect() : null;
          const pathCell = document.querySelector('.file-path-cell');
          const dateCell = document.querySelector('.file-date-cell');
          return {
            headerW: h ? Math.round(h.width) : null,
            tableW: tw ? Math.round(tw.width) : null,
            widthMatch: h && tw ? Math.abs(h.width - tw.width) < 4 : null,
            pathSingleLine: pathCell ? pathCell.scrollWidth <= pathCell.clientWidth + 1 : null,
            dateNowrap: dateCell ? getComputedStyle(dateCell).whiteSpace : null,
            overflowX: document.body.scrollWidth - document.documentElement.clientWidth,
          };
        })()`);

        out.consoleErrors = errors.slice(0, 20);
        console.log(JSON.stringify(out, null, 1));
        ws.close(); c.kill(); process.exit(0);
      }
    } catch (e) { /* retry */ }
    await sleep(400);
  }
  console.log('FAIL'); c.kill(); process.exit(1);
})();
