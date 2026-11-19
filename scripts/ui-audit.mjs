// Aegis UI audit.
//
// Drives the live Electron renderer over the Chrome DevTools Protocol:
// walks every sidebar view, screenshots it, then clicks every safe button in
// each view and records any console error or uncaught exception.
//
//   node scripts/ui-audit.mjs [--out docs/audit]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const CDP = process.env.AEGIS_CDP || 'http://127.0.0.1:9222';
const OUT = process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1]
  : 'docs/audit';
const SHOTS = join(OUT, 'screens');
mkdirSync(SHOTS, { recursive: true });

const SKIP =
  /delete|remove|quit|sign out|disconnect|clear|stop|reset|uninstall|revoke|erase|drop|send|publish|deploy|install|update|save|create|add|new|run|execute|apply|confirm|approve|accept|upgrade|restore|voice|microphone|mic\b|pause|resume|capture|screenshot|record|play|download|export|import|attach|upload/i;

const withTimeout = (promise, ms, fallback = undefined) =>
  Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);

const targets = await (await fetch(`${CDP}/json/list`)).json();
const page = targets.find((t) => t.type === 'page' && t.url.startsWith('http://127.0.0.1:4310'));
if (!page) {
  console.error('No Aegis renderer found. Is the desktop shell running?');
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = rej;
});

let id = 0;
const pending = new Map();
let errors = [];
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const mid = ++id;
    pending.set(mid, resolve);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg.result);
    pending.delete(msg.id);
    return;
  }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    errors.push({
      kind: 'console.error',
      text: (msg.params.args || [])
        .map((a) => a.value ?? a.description ?? '')
        .join(' ')
        .slice(0, 300),
    });
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    errors.push({
      kind: 'exception',
      text: String(msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text || '')
        .slice(0, 300),
    });
  }
};

await send('Runtime.enable');
await send('Page.enable');

const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result?.exceptionDetails) {
    return { error: result.exceptionDetails.text };
  }
  return result?.result?.value;
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(name) {
  const res = await withTimeout(
    send('Page.captureScreenshot', { format: 'png' }),
    8000,
    null,
  );
  if (!res?.data) return null;
  const file = join(SHOTS, `${name}.png`);
  writeFileSync(file, Buffer.from(res.data, 'base64'));
  return file;
}

const views = await evaluate(
  `[...document.querySelectorAll('.rail-item')].map(b => b.getAttribute('aria-label')).filter(Boolean)`,
);
console.log('views:', JSON.stringify(views));

const report = { startedAt: new Date().toISOString(), views: [], buttons: [], errors: [] };

for (const view of views) {
  errors = [];
  const slug = view.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  await evaluate(
    `(() => { const b=[...document.querySelectorAll('.rail-item')].find(x=>x.getAttribute('aria-label')===${JSON.stringify(view)}); if(b) b.click(); return !!b; })()`,
  );
  await wait(1200);
  const stats = await evaluate(
    `({
       title: (document.querySelector('.page-heading h1')?.textContent || document.querySelector('h1')?.textContent || '').trim().slice(0,60),
       buttons: document.querySelectorAll('button').length,
       inputs: document.querySelectorAll('input, textarea, select').length,
       images: document.querySelectorAll('img').length,
       errorText: (document.body.innerText.match(/error|failed|could not[^.]{0,40}/i) || [''])[0].slice(0,80),
       hasMain: !!document.querySelector('.main-content'),
    })`,
  );
  const file = await shot(`view-${slug}`);
  report.views.push({ view, ...stats, screenshot: file, errors: [...errors] });
  console.log(
    `VIEW ${view.padEnd(14)} buttons=${String(stats?.buttons ?? 0).padStart(3)} inputs=${String(stats?.inputs ?? 0).padStart(2)} images=${String(stats?.images ?? 0).padStart(2)} errors=${errors.length} shot=${file ? 'yes' : 'no'}`,
  );

  // Click every safe button in this view and watch for runtime errors.
  const buttons = await evaluate(
    `(() => {
       const out = [];
       document.querySelectorAll('button, [role=button]').forEach((b, i) => {
         const label = (b.getAttribute('aria-label') || b.title || b.textContent || '').trim().slice(0, 60);
         if (!label) return;
         out.push({ i, label, disabled: !!b.disabled });
       });
       return out;
     })()`,
  );
  for (const button of buttons ?? []) {
    if (SKIP.test(button.label)) continue;
    if (button.disabled) continue;
    errors = [];
    const clicked = await withTimeout(
      evaluate(
        `(() => { const b=[...document.querySelectorAll('button, [role=button]')][${button.i}]; if(!b) return false; b.click(); return true; })()`,
      ),
      4000,
      false,
    );
    if (!clicked) continue;
    await wait(260);
    if (errors.length) {
      report.buttons.push({ view, label: button.label, errors: [...errors] });
      console.log(`  BUTTON-ERROR ${view} :: ${button.label} :: ${errors[0].text.slice(0, 160)}`);
    } else {
      report.buttons.push({ view, label: button.label, ok: true });
    }
    // Close any modal the click opened so the next click sees the same view.
    await evaluate(
      `(() => { const c=document.querySelector('.modal-backdrop, .dialog-backdrop, [role=dialog] .close, .modal .close'); if(c) c.click(); return true; })()`,
    );
  }
  // Return to the chat view so the next iteration starts clean.
  await evaluate(
    `(() => { const b=[...document.querySelectorAll('.rail-item')].find(x=>x.getAttribute('aria-label')==='Conversation'); if(b) b.click(); return !!b; })()`,
  );
  await wait(400);
}

report.errors = report.buttons.filter((b) => b.errors);
writeFileSync(join(OUT, 'results-ui-audit.json'), JSON.stringify(report, null, 2));
console.log(
  `\nviews=${report.views.length} buttonClicks=${report.buttons.length} buttonsWithErrors=${report.errors.length} screenshots=${SHOTS}`,
);
ws.close();
