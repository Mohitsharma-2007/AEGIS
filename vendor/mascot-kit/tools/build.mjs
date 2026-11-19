// Regenerates everything that ships as files: SVGs, WAVs, manifest, preview sheet and the single-file demo.  node tools/build.mjs
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import * as M from '../src/index.js';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..'), W = (p, d) => { const f = path.join(root, p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, d); };
let nSvg = 0, bytes = 0, nTray = 0;
for (const d of ['svg', 'tray/svg']) fs.rmSync(path.join(root, d), { recursive: true, force: true });
for (const character of M.CHARACTER_NAMES) for (const theme of M.VARIANTS) for (const state of M.statesFor(character)) {
  const a = M.renderSVG({ character, state, theme }); W(`svg/animated/${character}/${theme}/${state}.svg`, a); W(`svg/static/${character}/${theme}/${state}.svg`, M.renderSVG({ character, state, theme, animated: false })); nSvg += 2; bytes += a.length;
  W(`tray/svg/${character}/${theme}/${state}.svg`, M.renderTrayIcon({ character, state, theme })); nTray++;
}
for (const pack of Object.keys(M.PACKS)) for (const name of M.SOUND_NAMES) W(`sounds/${pack}/${name}.wav`, M.encodeWav(M.renderSound(name, pack)));
W('manifest.json', JSON.stringify({
  characters: Object.fromEntries(M.CHARACTER_NAMES.map(c => { const C = M.CHARACTERS[c]; return [c, { name: C.name, role: C.role, job: C.job, personality: C.mood, shape: C.shape, palette: C.palette, signatureStates: M.STATE_NAMES.filter(s => M.STATES[s].for === c) }]; })),
  variants: M.VARIANTS, commonStates: M.COMMON_STATES,
  states: Object.fromEntries(M.STATE_NAMES.map(s => [s, { label: M.STATES[s].label, when: M.STATES[s].when, character: M.STATES[s].for || 'any', loopSeconds: M.STATES[s].dur, oneShot: !!M.STATES[s].once, then: M.STATES[s].then || null }])),
  extraThemes: Object.fromEntries(M.THEME_NAMES.map(t => [t, M.THEMES[t]])), shapes: Object.keys(M.SHAPES), statusColors: M.STATUS_COLORS, statusText: M.STATUS_TEXT, widgets: ['pill', 'pet', 'panel', 'card', 'toast'],
  sounds: Object.fromEntries(M.SOUND_NAMES.map(s => [s, { label: M.SOUNDS[s].label, when: M.SOUNDS[s].when, seconds: M.SOUNDS[s].dur, loop: !!M.SOUNDS[s].loop }])), packs: Object.keys(M.PACKS), events: M.EVENTS,
}, null, 2));
// contact sheets (static frames) for a quick visual check
const sheet = (items, cols, cell = 256, bg = '#F4EEE7') => { const rows = Math.ceil(items.length / cols);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${cols * cell}" height="${rows * cell}" viewBox="0 0 ${cols * cell} ${rows * cell}"><rect width="100%" height="100%" fill="${bg}"/>` +
    items.map((o, i) => `<g transform="translate(${(i % cols) * cell} ${Math.floor(i / cols) * cell})">${o.bg ? `<rect width="${cell}" height="${cell}" fill="${o.bg}"/>` : ''}${M.renderSVG({ ...o, animated: false, size: cell }).replace(/<title>.*?<\/title>/, '').replace(/id="a/g, `id="s${i}`).replace(/url\(#a/g, `url(#s${i}`)}</g>`).join('') + '</svg>'; };
const crew = M.CHARACTER_NAMES, sig = c => M.STATE_NAMES.filter(s => M.STATES[s].for === c);
W('preview/crew.svg', sheet(M.VARIANTS.flatMap(theme => crew.map(character => ({ character, theme, state: 'idle', bg: theme === 'dark' ? '#15171A' : null }))), 7, 220));
W('preview/signature.svg', sheet(crew.slice(1).flatMap(character => sig(character).map(state => ({ character, state }))), 6, 220));
W('preview/states.svg', sheet(M.COMMON_STATES.map(state => ({ state })), 4));
W('preview/states-crew.svg', sheet(crew.flatMap(character => ['listening', 'thinking', 'working', 'speaking', 'done', 'error', 'sleeping', 'celebrate'].map(state => ({ character, state }))), 8, 180));
for (const f of ['themes', 'shapes']) for (const e of ['svg', 'png']) fs.rmSync(path.join(root, `preview/${f}.${e}`), { force: true });
// single-file playground (engine + sounds inlined so it runs from file:// and inside sandboxed previews)
const strip = f => fs.readFileSync(path.join(root, f), 'utf8').replace(/^export \* from.*$/gm, '').replace(/^import .*$/gm, '').replace(/^export (default )?/gm, '');
const js = ['mascot', 'sounds', 'events', 'widgets', 'index'].map(f => strip(`src/${f}.js`)).join('\n');
const tpl = f => { const h = fs.readFileSync(path.join(root, 'tools', f), 'utf8'); return { style: h.split('<style>')[1].split('</style>')[0], html: h.split('<body>')[1].split('<script>/*__LIB__*/</script>')[0], script: h.split('<script>').pop().split('</script>')[0] }; };
const PG = tpl('demo.template.html'), DK = tpl('widgets.template.html');
const page = (title, style, body, scripts) => `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${style}</style></head><body>${body}<script>${js}</script>${scripts.map(s => `<script>(() => {${s}})();</script>`).join('')}</body></html>`;
// tiny Markdown -> HTML (enough for the three guides), images inlined so the page is self-contained
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = s => esc(s).replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) => { const f = path.join(root, src); return fs.existsSync(f) ? `<img alt="${alt}" src="data:image/png;base64,${fs.readFileSync(f).toString('base64')}">` : ''; })
  .replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, u) => (/^https?:/.test(u) ? `<a href="${u}" target="_blank" rel="noopener">${t}</a>` : `<b>${t}</b>`)).replace(/\\\|/g, '|');
function md(src) {
  const L = src.split('\n'), out = []; let i = 0;
  const cells = r => r.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(c => inline(c.trim()));
  while (i < L.length) { const l = L[i];
    if (l.startsWith('```')) { const b = []; i++; while (i < L.length && !L[i].startsWith('```')) b.push(L[i++]); i++; out.push(`<pre><code>${esc(b.join('\n'))}</code></pre>`); continue; }
    const h = l.match(/^(#{1,4}) (.*)/); if (h) { out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue; }
    if (l.startsWith('|')) { const rows = []; while (i < L.length && L[i].startsWith('|')) rows.push(L[i++]); const body = rows.filter((_, k) => k !== 1);
      out.push(`<div class="tw"><table><thead><tr>${cells(body[0]).map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>${body.slice(1).map(r => `<tr>${cells(r).map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`); continue; }
    if (/^(- |\d+\. )/.test(l)) { const ol = /^\d/.test(l), items = []; while (i < L.length && /^(- |\d+\. )/.test(L[i])) items.push(L[i++].replace(/^(- |\d+\. )/, ''));
      out.push(`<${ol ? 'ol' : 'ul'}>${items.map(x => `<li>${inline(x).replace(/^\[ \] /, '<input type="checkbox"> ')}</li>`).join('')}</${ol ? 'ol' : 'ul'}>`); continue; }
    if (!l.trim()) { i++; continue; }
    const p = []; while (i < L.length && L[i].trim() && !/^(#|\||```|- |\d+\. )/.test(L[i])) p.push(L[i++]); out.push(`<p>${inline(p.join(' '))}</p>`); }
  return out.join('\n');
}
const DOCS = [['Integration guide — hand this to your coding agent', 'INTEGRATION.md'], ['Mascot guide — the crew, states and files', 'MASCOT.md'], ['Sounds guide', 'SOUNDS.md']].filter(d => fs.existsSync(path.join(root, d[1])));
const docCss = `#pg .doc{color:var(--ink);font:14px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
#pg .doc h1{font-size:22px;margin:.6em 0 .5em}#pg .doc h2{font-size:17px;letter-spacing:0;text-transform:none;color:var(--ink);margin:1.6em 0 .5em;padding-top:.6em;border-top:1px solid var(--line)}#pg .doc h3{font-size:15px;margin:1.2em 0 .4em}
#pg .doc code{background:rgba(127,127,127,.15);padding:1px 5px;border-radius:5px;font:12.5px ui-monospace,Consolas,monospace}#pg .doc pre{background:#1F2224;color:#F4EEE7;padding:14px 16px;border-radius:12px;overflow:auto}#pg .doc pre code{background:none;padding:0;color:inherit}
#pg .doc .tw{overflow-x:auto}#pg .doc table{border-collapse:collapse;width:100%;font-size:13px;margin:.6em 0}#pg .doc th,.doc td{border:1px solid var(--line);padding:6px 9px;text-align:left;vertical-align:top}#pg .doc th{background:rgba(127,127,127,.1)}
#pg .doc img{max-width:100%;border-radius:12px;border:1px solid var(--line)}#pg .doc a{color:var(--brand)}#pg .doc li{margin:.2em 0}`;
const guides = DOCS.map(d => `<details class="card guide"><summary>${d[0]} <small>${d[1]}</small></summary><div class="doc">${md(fs.readFileSync(path.join(root, d[1]), 'utf8'))}</div></details>`).join('');
W('demo/index.html', page('Aegi & crew — mascots, sounds and integration guide', PG.style + docCss, PG.html.replace('<!--GUIDES-->', () => guides), [PG.script]));
W('demo/widgets.html', page('Aegi — desktop widgets', DK.style, DK.html, [DK.script]));
fs.rmSync(path.join(root, 'demo/playground.html'), { force: true });
console.log(`tray svgs: ${nTray}`); console.log(`svg files: ${nSvg} (avg animated ${(bytes / (nSvg / 2) / 1024).toFixed(1)} KB), sounds: ${M.SOUND_NAMES.length} x ${Object.keys(M.PACKS).length}`);
