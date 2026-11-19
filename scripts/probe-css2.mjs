import { spawn } from 'node:child_process';
const c = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--remote-debugging-port=9343', '--user-data-dir=C:/Temp/cdpdbg7',
  '--no-first-run', '--disable-gpu', '--window-size=1536,960', '--force-device-scale-factor=1',
  'about:blank',
], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch('http://127.0.0.1:9343/json/list');
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
        await cdp('Runtime.evaluate', { expression: `[...document.querySelectorAll('.icon-rail .rail-item')].find(b => b.getAttribute('aria-label') === 'Agents')?.click()` });
        await sleep(2000);
        await cdp('Runtime.evaluate', { expression: `document.querySelector('.icon-rail .rail-toggle')?.click()` });
        await sleep(1200);
        const expr = `(() => {
          const aside = document.querySelector('.sidebar');
          const cs = aside ? getComputedStyle(aside) : null;
          const rules = [];
          for (const sheet of document.styleSheets) {
            try { for (const rule of sheet.cssRules || []) {
              if (rule.selectorText && rule.selectorText.includes('.sidebar') && rule.selectorText.includes('.template-app')) {
                rules.push(rule.selectorText + ' => ' + rule.style.left + ' / ' + rule.style.width + ' / ' + rule.style.display);
              }
            } } catch (e) { rules.push('ERR ' + e.message); }
          }
          return { left: cs ? cs.left : null, width: cs ? cs.width : null, display: cs ? cs.display : null, asideCls: aside ? aside.className : null, inlineLeft: aside ? aside.style.left : null, inlineWidth: aside ? aside.style.width : null, rules };
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
