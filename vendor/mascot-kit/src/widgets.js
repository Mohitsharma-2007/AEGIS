/*! aegis-mascot — desktop widgets: the mascot living in a pill, a desktop pet, a tray flyout panel, a task card and toasts. MIT.
 *  Each widget is plain DOM + one injected stylesheet; it owns a live AegisMascot and exposes the same small controller. */
import { AegisMascot, STATUS_COLORS, STATES } from './mascot.js';
import { EVENTS, STATE_SOUNDS } from './events.js';

/** Default [status, sub-line] shown for each mascot state. Override per call with update({ status, sub }). */
export const STATUS_TEXT = {
  idle: ['Ready', 'Say “Hey Aegis” or press the mic'], hello: ['Hi!', 'Aegis is online'], listening: ['Listening…', 'Go ahead, I’m listening'],
  thinking: ['Thinking…', 'Working out a plan'], searching: ['Searching…', 'Looking things up'], working: ['Working…', 'Running the task'],
  speaking: ['Speaking', 'Answering out loud'], sending: ['Sending…', 'Got it'], paused: ['Paused', 'Press resume to continue'], cancelled: ['Cancelled', 'Stopped'],
  done: ['Done', 'Task finished'], notification: ['Heads up', 'Something needs your attention'], confused: ['Sorry?', 'I didn’t catch that'],
  error: ['Something went wrong', 'Try again'], sleeping: ['Sleeping', 'Do not disturb is on'], celebrate: ['Nice!', 'That went well'],
};
const BUSY = ['thinking', 'searching', 'working', 'sending'];
const I = (d, extra = '') => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;
const ICON = {
  mic: I('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>'), pause: I('<path d="M8 5v14M16 5v14"/>'), play: I('<path d="M7 5l12 7-12 7z"/>'),
  x: I('<path d="M6 6l12 12M18 6L6 18"/>'), send: I('<path d="M12 19V5M5 12l7-7 7 7"/>'), sound: I('<path d="M4 9v6h4l5 4V5L8 9zM17 9a4 4 0 0 1 0 6"/>'), mute: I('<path d="M4 9v6h4l5 4V5L8 9zM17 9l5 6M22 9l-5 6"/>'),
  check: I('<path d="M5 12l5 5 9-10"/>'),
};
const CSS = `
.ae{--ae-bg:#FFFDFA;--ae-fg:#1F2224;--ae-mute:#756C65;--ae-line:#E7DDD3;--ae-soft:#F4EEE7;--ae-accent:#BA5B45;--ae-dot:#9CA3AF;--ae-shadow:0 12px 36px rgba(31,34,36,.18),0 2px 6px rgba(31,34,36,.08);
  font:13px/1.4 "Segoe UI Variable","Segoe UI",system-ui,-apple-system,Roboto,sans-serif;color:var(--ae-fg);box-sizing:border-box;-webkit-font-smoothing:antialiased}
.ae[data-ui=dark]{--ae-bg:#1B1D20;--ae-fg:#F4EEE7;--ae-mute:#9AA0A6;--ae-line:#2E3236;--ae-soft:#25282C;--ae-accent:#D06A51;--ae-shadow:0 14px 40px rgba(0,0,0,.5),0 0 0 1px rgba(255,255,255,.06)}
.ae *{box-sizing:border-box}.ae-m{flex:none;line-height:0}.ae-pill .ae-m,.ae-toast .ae-m{margin:-8px -6px -8px -8px}.ae-panel .ae-m{margin:-10px -8px}.ae-card .ae-m{margin:-14px -12px}.ae-m svg{display:block}
.ae-status{font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ae-sub{color:var(--ae-mute);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ae-dot{width:8px;height:8px;border-radius:50%;background:var(--ae-dot);flex:none;transition:background .25s}
.ae button{font:inherit;color:inherit;background:transparent;border:0;border-radius:9px;width:30px;height:30px;display:grid;place-items:center;cursor:pointer;flex:none;transition:background .15s,color .15s}
.ae button:hover{background:var(--ae-soft)}.ae button.ae-primary{background:var(--ae-accent);color:#fff}.ae button.ae-primary:hover{filter:brightness(1.08)}
.ae button.ae-text{width:auto;padding:0 12px;gap:6px;display:inline-flex;align-items:center;border:1px solid var(--ae-line)}
.ae-wave{display:flex;align-items:center;gap:3px;height:22px;opacity:0;transition:opacity .25s;flex:none}.ae-wave i{width:3px;height:6px;border-radius:2px;background:var(--ae-accent)}
.ae[data-state=listening] .ae-wave,.ae[data-state=speaking] .ae-wave{opacity:1}
.ae[data-state=listening] .ae-wave i,.ae[data-state=speaking] .ae-wave i{animation:ae-wave .7s ease-in-out infinite}
.ae-wave i:nth-child(2){animation-delay:-.45s!important}.ae-wave i:nth-child(3){animation-delay:-.2s!important}.ae-wave i:nth-child(4){animation-delay:-.6s!important}.ae-wave i:nth-child(5){animation-delay:-.3s!important}
@keyframes ae-wave{0%,100%{height:5px}50%{height:20px}}
.ae-bar{height:5px;border-radius:3px;background:var(--ae-soft);overflow:hidden;position:relative}.ae-bar i{position:absolute;left:0;top:0;bottom:0;border-radius:3px;background:var(--ae-accent);transition:width .35s ease}
.ae-bar[data-indet] i{width:35%!important;animation:ae-indet 1.2s ease-in-out infinite}@keyframes ae-indet{0%{left:-35%}100%{left:100%}}
/* pill — compact always-on-top bar */
.ae-pill{display:inline-flex;align-items:center;gap:10px;height:56px;padding:0 10px 0 6px;min-width:290px;max-width:420px;background:var(--ae-bg);border-radius:28px;box-shadow:var(--ae-shadow)}
.ae-pill .ae-info{flex:1;min-width:0}
/* pet — the mascot sitting on the desktop with a speech bubble */
.ae-pet{display:inline-flex;flex-direction:column;align-items:center;gap:2px;position:relative}
.ae-pet .ae-m{cursor:pointer;filter:drop-shadow(0 8px 14px rgba(31,34,36,.22))}
.ae-bubble{background:var(--ae-bg);border-radius:14px;padding:8px 12px;box-shadow:var(--ae-shadow);max-width:230px;position:relative;transition:opacity .25s,transform .25s;text-align:left}
.ae-bubble:after{content:"";position:absolute;left:50%;bottom:-6px;width:12px;height:12px;background:var(--ae-bg);transform:translateX(-50%) rotate(45deg);border-radius:2px}
.ae-pet[data-state=idle] .ae-bubble,.ae-pet[data-state=sleeping] .ae-bubble{opacity:0;transform:translateY(6px);pointer-events:none}
.ae-bubble .ae-sub{white-space:normal}
/* panel — tray flyout */
.ae-panel{width:360px;max-width:100%;background:var(--ae-bg);border-radius:16px;box-shadow:var(--ae-shadow);display:flex;flex-direction:column;overflow:hidden}
.ae-head{display:flex;align-items:center;gap:10px;padding:12px 12px 10px}.ae-head .ae-info{flex:1;min-width:0}.ae-title{font-weight:700;font-size:14px}
.ae-line{display:flex;align-items:center;gap:6px;color:var(--ae-mute);font-size:12px}
.ae-log{padding:4px 12px;display:flex;flex-direction:column;gap:6px;height:150px;overflow:auto;scrollbar-width:thin}
.ae-msg{max-width:86%;padding:7px 10px;border-radius:12px;background:var(--ae-soft);align-self:flex-start;overflow-wrap:anywhere}.ae-msg[data-role=user]{align-self:flex-end;background:var(--ae-accent);color:#fff}
.ae-empty{color:var(--ae-mute);margin:auto;text-align:center}
.ae-steps{padding:6px 14px 2px;display:flex;flex-direction:column;gap:5px}.ae-steps:empty{display:none}
.ae-step{display:flex;align-items:center;gap:8px;color:var(--ae-mute);font-size:12.5px}.ae-step b{width:16px;height:16px;border-radius:50%;border:2px solid var(--ae-line);flex:none;display:grid;place-items:center;color:#fff}
.ae-step[data-s=done]{color:var(--ae-fg)}.ae-step[data-s=done] b{background:#22A45D;border-color:#22A45D}.ae-step[data-s=done] b svg{width:10px;height:10px;stroke-width:3.5}
.ae-step[data-s=active]{color:var(--ae-fg);font-weight:600}.ae-step[data-s=active] b{border-color:var(--ae-accent);border-top-color:transparent;animation:ae-spin .8s linear infinite}@keyframes ae-spin{to{transform:rotate(360deg)}}
.ae-panel .ae-bar{margin:8px 14px 2px}
.ae-foot{display:flex;align-items:center;gap:6px;padding:10px 12px 12px}
.ae-foot input{flex:1;min-width:0;font:inherit;color:inherit;background:var(--ae-soft);border:1px solid transparent;border-radius:10px;height:34px;padding:0 10px;outline:0}.ae-foot input:focus{border-color:var(--ae-accent)}
.ae-foot button{width:34px;height:34px}
.ae-actions{display:flex;gap:6px;padding:0 12px 10px}.ae-actions:empty{display:none}
.ae:not([data-busy]) .ae-busyonly{display:none!important}
/* card — desktop task widget */
.ae-card{width:300px;max-width:100%;background:var(--ae-bg);border-radius:18px;box-shadow:var(--ae-shadow);padding:14px;display:flex;gap:12px;align-items:center}
.ae-card .ae-info{flex:1;min-width:0;display:flex;flex-direction:column;gap:5px}.ae-card .ae-row{display:flex;align-items:center;gap:6px}.ae-card .ae-row .ae-sub{flex:1}
.ae-time{font-variant-numeric:tabular-nums;color:var(--ae-mute);font-size:12px}
/* toast */
.ae-toast{display:flex;align-items:center;gap:10px;width:320px;max-width:100%;background:var(--ae-bg);border-radius:14px;box-shadow:var(--ae-shadow);padding:10px 8px 10px 10px;animation:ae-in .35s cubic-bezier(.2,.9,.3,1.2)}
.ae-toast .ae-info{flex:1;min-width:0}.ae-toast .ae-sub{white-space:normal}.ae-toast[data-out]{animation:ae-out .25s ease forwards}
@keyframes ae-in{from{opacity:0;transform:translateX(24px)}}@keyframes ae-out{to{opacity:0;transform:translateX(24px)}}
@media (prefers-reduced-motion:reduce){.ae *{animation-duration:.01s!important}}`;
let injected = false;
function injectCSS() { if (injected || typeof document === 'undefined') return; injected = true; const s = document.createElement('style'); s.id = 'aegis-widgets-css'; s.textContent = CSS; document.head.appendChild(s); }
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const btn = (act, icon, title, cls = '') => `<button data-act="${act}" title="${title}" aria-label="${title}" class="${cls}">${ICON[icon]}</button>`;
const info = `<div class="ae-info"><div class="ae-status"></div><div class="ae-sub"></div></div>`;
const wave = `<div class="ae-wave"><i></i><i></i><i></i><i></i><i></i></div>`;
const TEMPLATES = {
  pill: () => `<div class="ae-m"></div>${info}${wave}${btn('mic', 'mic', 'Talk', 'ae-idleonly')}${btn('pause', 'pause', 'Pause', 'ae-busyonly')}${btn('cancel', 'x', 'Cancel', 'ae-busyonly')}`,
  pet: () => `<div class="ae-bubble"><div class="ae-status"></div><div class="ae-sub"></div></div><div class="ae-m" data-act="mic" title="Click to talk"></div>`,
  panel: o => `<div class="ae-head"><div class="ae-m"></div><div class="ae-info"><div class="ae-title">${esc(o.title || 'Aegis')}</div><div class="ae-line"><span class="ae-dot"></span><span class="ae-status"></span>${wave}</div></div>${btn('mute', 'sound', 'Mute sounds')}${btn('close', 'x', 'Close')}</div>
    <div class="ae-log"></div><div class="ae-steps"></div><div class="ae-bar ae-busyonly"><i></i></div>
    <div class="ae-actions"><button data-act="pause" class="ae-text ae-busyonly">${ICON.pause}<span>Pause</span></button><button data-act="cancel" class="ae-text ae-busyonly">${ICON.x}<span>Cancel</span></button></div>
    <div class="ae-foot"><input placeholder="${esc(o.placeholder || 'Ask Aegis…')}" aria-label="Message">${btn('mic', 'mic', 'Talk')}${btn('send', 'send', 'Send', 'ae-primary')}</div>`,
  card: o => `<div class="ae-m"></div><div class="ae-info"><div class="ae-row"><span class="ae-dot"></span><div class="ae-status" style="flex:1"></div><span class="ae-time">0:00</span></div><div class="ae-bar"><i></i></div>
    <div class="ae-row"><div class="ae-sub"></div>${btn('pause', 'pause', 'Pause', 'ae-busyonly')}${btn('cancel', 'x', 'Cancel', 'ae-busyonly')}</div></div>`,
  toast: () => `<div class="ae-m"></div>${info}${btn('close', 'x', 'Dismiss')}`,
};
const MASCOT_SIZE = { pill: 62, pet: 150, panel: 70, card: 104, toast: 62 };

/** Mount a widget.  kind: 'pill' | 'pet' | 'panel' | 'card' | 'toast'
 *  opts: { character (crew member), theme (mascot theme: 'color' | 'dark' | 'light' | …), ui: 'light'|'dark', shape, size (mascot px), state, sounds (AegisSounds instance), title, placeholder, follow, timeout (toast ms) }
 *  Returns a controller: { el, mascot, setState, emit, update, say, on, destroy } */
export function mountWidget(target, kind = 'pill', opts = {}) {
  injectCSS();
  const host = typeof target === 'string' ? document.querySelector(target) : target, el = document.createElement('div'), handlers = {};
  el.className = `ae ae-${kind}`; el.dataset.ui = opts.ui || 'light'; el.innerHTML = TEMPLATES[kind](opts); host.appendChild(el);
  const $ = s => el.querySelector(s), compact = kind === 'pill' || kind === 'toast' || kind === 'panel';
  const mascot = new AegisMascot($('.ae-m'), { character: opts.character || 'aegi', theme: opts.theme || 'color', shape: opts.shape || null, size: opts.size || MASCOT_SIZE[kind], state: opts.state || 'idle', follow: !!opts.follow, shadow: kind === 'pet', emblem: !compact });
  let state = null, paused = false, t0 = 0, timer = null, log = [];
  const fire = (act, data) => (handlers[act] || []).concat(handlers['*'] || []).forEach(fn => fn(act, data));
  const api = {
    el, mascot, kind,
    /** Change mascot state + default status text. { silent: true } skips the sound. */
    setState(s, { silent = false, then } = {}) {
      if (s !== state) { mascot.setState(s, { then }); if (!silent && opts.sounds && STATE_SOUNDS[s]) opts.sounds.play(STATE_SOUNDS[s]); }
      state = s; el.dataset.state = s; const busy = BUSY.includes(s) || s === 'paused' || s === 'speaking'; if (busy) el.dataset.busy = ''; else delete el.dataset.busy;
      el.style.setProperty('--ae-dot', STATUS_COLORS[s] || '#9CA3AF'); paused = s === 'paused';
      el.querySelectorAll('[data-act=pause]').forEach(b => { const ic = paused ? ICON.play : ICON.pause; b.title = paused ? 'Resume' : 'Pause'; b.innerHTML = b.classList.contains('ae-text') ? `${ic}<span>${b.title}</span>` : ic; });
      const mic = $('.ae-idleonly'); if (mic) mic.style.display = busy ? 'none' : '';
      const bar = $('.ae-bar'); if (bar) { if (BUSY.includes(s)) bar.dataset.indet = ''; else delete bar.dataset.indet; if (s === 'done') bar.firstElementChild.style.width = '100%'; }
      if ($('.ae-time')) { if (busy && !timer) { t0 = Date.now(); timer = setInterval(() => { const n = Math.floor((Date.now() - t0) / 1000); $('.ae-time').textContent = `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`; }, 500); } if (!busy && timer) { clearInterval(timer); timer = null; } }
      return api.update({ status: (STATUS_TEXT[s] || [STATES[s] ? STATES[s].label : s])[0], sub: (STATUS_TEXT[s] || [0, STATES[s] ? STATES[s].when : ''])[1] || '' });
    },
    /** Fire an app event from the EVENTS map ('mic:start', 'prompt:send', 'agent:done', …). */
    emit(name) { const e = (opts.events || EVENTS)[name]; if (!e) return api; if (e.character) api.setCharacter(e.character); if (e.state) api.setState(e.state, { silent: true }); if (e.sound && opts.sounds) opts.sounds.play(e.sound); return api; },
    /** Update any visible text / data: { status, sub, progress (0..1 | null), steps: [{ label, state: 'todo'|'active'|'done' }], transcript: [{ role, text }] } */
    update({ status, sub, progress, steps, transcript } = {}) {
      if (status != null) el.querySelectorAll('.ae-status').forEach(n => { n.textContent = status; });
      if (sub != null) el.querySelectorAll('.ae-sub').forEach(n => { n.textContent = sub; });
      const bar = $('.ae-bar'); if (bar && progress !== undefined) { if (progress == null) bar.dataset.indet = ''; else { delete bar.dataset.indet; bar.firstElementChild.style.width = `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%`; } }
      const st = $('.ae-steps'); if (st && steps) st.innerHTML = steps.map(x => `<div class="ae-step" data-s="${esc(x.state || 'todo')}"><b>${x.state === 'done' ? ICON.check : ''}</b>${esc(x.label)}</div>`).join('');
      if (transcript) { log = transcript.slice(); api._log(); }
      return api;
    },
    /** Append one transcript line. role: 'user' | 'agent' */
    say(role, text) { log.push({ role, text }); api._log(); if (kind === 'pet' || kind === 'toast') api.update({ sub: text }); return api; },
    _log() { const n = $('.ae-log'); if (!n) return; n.innerHTML = log.length ? log.map(m => `<div class="ae-msg" data-role="${esc(m.role)}">${esc(m.text)}</div>`).join('') : `<div class="ae-empty">Ask anything, or press the mic and talk.</div>`; n.scrollTop = n.scrollHeight; },
    /** Listen for user actions: 'mic' | 'send' (data = text) | 'pause' | 'resume' | 'cancel' | 'mute' (data = muted) | 'close' | '*' */
    on(act, fn) { (handlers[act] || (handlers[act] = [])).push(fn); return api; },
    setTheme(theme) { mascot.setTheme(theme); return api; }, setCharacter(c, o) { if (c !== mascot.o.character) mascot.setCharacter(c, o); return api; }, setUI(ui) { el.dataset.ui = ui; return api; },
    destroy() { clearInterval(timer); mascot.destroy(); el.remove(); },
  };
  el.addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b) return; let act = b.dataset.act, data;
    if (act === 'pause' && paused) act = 'resume';
    if (act === 'send') { const inp = $('input'); data = inp ? inp.value.trim() : ''; if (!data) return; inp.value = ''; }
    if (act === 'mute') { const m = !(b.dataset.on === '1'); b.dataset.on = m ? '1' : '0'; b.innerHTML = m ? ICON.mute : ICON.sound; if (opts.sounds) opts.sounds.enabled = !m; data = m; }
    if (act === 'close' && kind === 'toast') return api.dismiss();
    fire(act, data);
  });
  const inp = $('input'); if (inp) inp.addEventListener('keydown', e => { if (e.key === 'Enter') { if (opts.sounds) opts.sounds.play('tap'); $('[data-act=send]').click(); } });
  if (kind === 'toast') { api.dismiss = () => { el.dataset.out = ''; setTimeout(() => api.destroy(), 260); fire('close'); }; if (opts.timeout !== 0) setTimeout(() => el.isConnected && api.dismiss(), opts.timeout || 5000); }
  api._log(); api.setState(opts.state || 'idle', { silent: true });
  if (opts.status || opts.sub) api.update({ status: opts.status, sub: opts.sub });
  return api;
}

/** Show a toast: toast('#toasts', { state: 'done', status: 'Done', sub: 'Report saved', theme, ui, sounds, timeout }) */
export function toast(target, opts = {}) { const t = mountWidget(target, 'toast', { ...opts, state: opts.state || 'notification' }); if (opts.sounds && STATE_SOUNDS[opts.state || 'notification']) opts.sounds.play(STATE_SOUNDS[opts.state || 'notification']); return t; }

/** Drive several widgets as one: const hub = linkWidgets([pill, pet, panel]); hub.setState('listening'); hub.on('cancel', fn) */
export function linkWidgets(widgets) {
  const all = (m, sndFirst) => (...a) => { widgets.forEach((w, i) => { if (m === 'setState' && i > 0) w.setState(a[0], { ...(a[1] || {}), silent: true }); else if (m === 'emit' && i > 0) { const e = EVENTS[a[0]]; if (e && e.character) w.setCharacter(e.character); if (e && e.state) w.setState(e.state, { silent: true }); } else w[m](...a); }); return hub; };
  const hub = { widgets, setState: all('setState'), emit: all('emit'), update: all('update'), say: all('say'), setTheme: all('setTheme'), setCharacter: all('setCharacter'), setUI: all('setUI'), on(act, fn) { widgets.forEach(w => w.on(act, fn)); return hub; } };
  return hub;
}
