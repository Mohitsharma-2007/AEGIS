import { spawn } from 'node:child_process';
const c = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--remote-debugging-port=9342', '--user-data-dir=C:/Temp/cdpdbg6',
  '--no-first-run', '--disable-gpu', '--window-size=1536,960', '--force-device-scale-factor=1',
  'about:blank',
], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch('http://127.0.0.1:9342/json/list');
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
        const expr = `(() => {
          const rules = [];
          for (const sheet of document.styleSheets) {
            try {
              for (const rule of sheet.cssRules || []) {
                if (rule.selectorText && rule.selectorText.includes('.template-app')) {
                  if (rule.selectorText.includes('.sidebar')) rules.push(rule.selectorText + ' => ' + rule.cssText.slice(0, 220));
                }
              }
            } catch (e) { rules.push('SHEET ERR ' + e.message); }
          }
          const el = document.querySelector('.sidebar');
          const cs = el ? getComputedStyle(el) : null;
          return { rules: rules.slice(0, 20), left: cs ? cs.left : null, display: cs ? cs.display : null, width: cs ? cs.width : null };
        })()`;
        const res = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true });
        console.log(JSON.stringify(res.result?.result?.value, null, 1));
        ws.close(); c.kill(); process.exit(0);
      }
    } catch (e) { /* retry */ }
    await sleep(400);
  }
  console.log('FAIL'); c.kill(); process.exit(1);
})();
