// node build.mjs  → notch.html, overlay.html, widgets.html, tray-pill.html (self-contained, CSP-safe)
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const dir = path.dirname(fileURLToPath(import.meta.url)), kit = path.join(dir, 'src/mascot.js'), appUi = path.resolve(dir, '..', 'ui-kit');
fs.mkdirSync(appUi, { recursive: true });
let eng = fs.readFileSync(kit, 'utf8').replace(/^import .*$/gm, '').replace(/^export (default )?/gm, '');
eng = eng.slice(0, eng.indexOf('class AegisMascot'));                  // pose engine only; the pages drive it themselves
const css = fs.readFileSync(path.join(dir, 'src/core.css'), 'utf8'), core = fs.readFileSync(path.join(dir, 'src/core.js'), 'utf8'), cards = fs.readFileSync(path.join(dir, 'src/cards.js'), 'utf8'), lib = fs.readFileSync(path.join(dir, 'src/lib.js'), 'utf8');
fs.copyFileSync(path.join(dir, 'src/annotations.html'), path.join(dir, 'annotations.html'));   // standalone, no shared runtime
for (const f of ['notch', 'overlay', 'widgets', 'tray-pill']) {
  const out = fs.readFileSync(path.join(dir, 'src', f + '.html'), 'utf8').replace('/*CSS*/', () => css).replace('/*ENGINE*/', () => eng).replace('/*CORE*/', () => core).replace('/*CARDS*/', () => cards).replace('/*LIB*/', () => lib);
  fs.writeFileSync(path.join(dir, f + '.html'), out);
  // Electron loads the generated pages from ui-kit. Keep this copy in the
  // same build step so a successful source build cannot leave the app stale.
  fs.copyFileSync(path.join(dir, f + '.html'), path.join(appUi, f + '.html'));
  console.log(f, (out.length / 1024).toFixed(1) + ' KB');
}
fs.copyFileSync(path.join(dir, 'annotations.html'), path.join(appUi, 'annotations.html'));

// showcase.html: one fake Windows desktop with every surface embedded (for review only, not loaded by the app)
{
  const emb = f => { let h = fs.readFileSync(path.join(dir, f + '.html'), 'utf8');
    h = h.replace('</head>', `<style>html,body,html.preview body{background:transparent!important;overflow:hidden!important}#pv,#say,#pvbar{display:none!important}html.preview .stage,html.preview .wrapt{outline:0!important;margin:0 auto!important}html.preview .board{margin:0 auto!important;width:100%!important;max-height:100vh!important}</style></head>`)
         .replace('</body>', `<script>addEventListener('message',e=>{if(String(e.data).startsWith('say:')){const t=e.data.slice(4);A.update({text:'You: '+t,keepState:true});A.hear(t);return}const b=document.querySelector('#pv button[data-k="'+e.data+'"]');if(b)b.click();});<\/script></body>`);
    return h.replace(/&/g, '&amp;').replace(/"/g, '&quot;'); };
  const page = fs.readFileSync(path.join(dir, 'src/showcase.html'), 'utf8').replace(/\{\{(\w[\w-]*)\}\}/g, (_, f) => emb(f));
  fs.writeFileSync(path.join(dir, 'showcase.html'), page); console.log('showcase', (page.length / 1024).toFixed(1) + ' KB');
}
