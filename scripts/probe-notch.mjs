import { spawn } from 'node:child_process';
const c = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', '--remote-debugging-port=9340', '--user-data-dir=C:/Temp/cdpdbg4',
  '--no-first-run', '--disable-gpu', 'about:blank',
], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch('http://127.0.0.1:9340/json/list');
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
        await cdp('Page.navigate', { url: 'file:///D:/Aegis 2/aegis/apps/desktop/ui-kit/notch.html' });
        let ready = false;
        let lastState = '';
        for (let k = 0; k < 30; k++) {
          const s = await cdp('Runtime.evaluate', { expression: 'location.href + " | " + document.readyState + " | body=" + !!document.body', returnByValue: true });
          lastState = s.result?.value ?? JSON.stringify(s);
          if (typeof lastState === 'string' && lastState.includes('complete') && lastState.includes('body=true')) { ready = true; break; }
          await sleep(500);
        }
        console.log('READY:', ready, '| lastState:', lastState);
        const res = await cdp('Runtime.evaluate', { expression: `({ title: document.title, bodyLen: document.body.innerHTML.length, island: !!document.querySelector('#island'), ids: [...document.querySelectorAll('[id]')].slice(0,40).map(e=>e.id) })`, returnByValue: true });
        console.log(JSON.stringify({ value: res.result?.result?.value, exc: res.result?.exceptionDetails?.exception?.description || res.result?.exceptionDetails?.text || null }, null, 1));
        ws.close(); c.kill(); process.exit(0);
      }
    } catch (e) { /* retry */ }
    await sleep(400);
  }
  console.log('FAIL'); c.kill(); process.exit(1);
})();
