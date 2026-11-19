/* Aegis desktop surfaces: shared runtime (state, live mascot, voice level, weather). */
const A = (() => {
  { let th = new URLSearchParams(location.search).get('theme'); try { th = th || localStorage.getItem('aegis.theme'); } catch {} if (th === 'light') document.documentElement.dataset.theme = 'light'; }   // dark is the default look
  const api = window.aegis || null, ovl = window.aegisOverlay || null, PREVIEW = !api && !ovl;
  const $ = (s, r = document) => r.querySelector(s), c01 = x => Math.min(1, Math.max(0, x)), tnow = () => performance.now() / 1000;
  const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const store = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
  const subs = {}, on = (n, f) => { (subs[n] = subs[n] || []).push(f); return f; }, emit = (n, a) => (subs[n] || []).forEach(f => { try { f(a); } catch (e) { console.error(e); } });
  const ICON = { mic: '<path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><path d="M12 18v4"/>', open: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>', grid: '<rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2"/>', notch: '<rect x="3" y="5" width="18" height="6" rx="3"/><path d="M7 15h10M7 19h6"/>', x: '<path d="M18 6 6 18M6 6l12 12"/>', up: '<path d="m18 15-6-6-6 6"/>', down: '<path d="m6 9 6 6 6-6"/>', pet: '<path d="M6 21V11a6 6 0 0 1 12 0v10Z"/><path d="M10 12v1M14 12v1"/>', pin: '<path d="M12 21s-6-5.3-6-10a6 6 0 0 1 12 0c0 4.700-6 10-6 10Z"/><circle cx="12" cy="11" r="2"/>', stop: '<rect x="7" y="7" width="10" height="10" rx="2"/>',
    play: '<path d="M8 5v14l11-7Z" fill="currentColor"/>', pause: '<path d="M8 5v14M16 5v14" stroke-width="3"/>', next: '<path d="M5 5v14l9-7ZM17 5v14" fill="currentColor"/>', prev: '<path d="M19 5v14l-9-7ZM7 5v14" fill="currentColor"/>',
    cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M10 2v4M14 2v4M10 18v4M14 18v4M2 10h4M2 14h4M18 10h4M18 14h4"/><rect x="10" y="10" width="4" height="4"/>', shield: '<path d="M12 3 5 6v5c0 4.500 3 8 7 10 4-2 7-5.500 7-10V6Z"/><path d="m9 12 2 2 4-4"/>', chat: '<path d="M4 5h11v8H9l-4 3Z"/><path d="M15 9h5v8l-3-2h-6v-2"/>', cloud: '<path d="M7 18a4 4 0 0 1-.5-8A6 6 0 0 1 18 9.500 4.300 4.300 0 0 1 17.500 18Z"/>',
    agent: '<path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 0V7a3 3 0 0 0-3-3Z"/><path d="M12 8h4M12 12h6M12 16h4"/>', bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4Z"/><path d="M10 21h4"/>', check: '<path d="m5 12 5 5 9-10"/>', alarm: '<circle cx="12" cy="13" r="7"/><path d="M12 9v4l2.500 2M5 4 2.500 6.500M19 4l2.500 2.500"/>',
    cal: '<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M4 10h16M8 3v4M16 3v4"/>', bt: '<path d="m7 7 10 10-5 4V3l5 4L7 17"/>', wifi: '<path d="M2 9a15 15 0 0 1 20 0M5.500 12.500a10 10 0 0 1 13 0M9 16a5 5 0 0 1 6 0"/><circle cx="12" cy="19.500" r=".8" fill="currentColor"/>', batt: '<rect x="2" y="8" width="17" height="9" rx="2.500"/><path d="M22 11v3"/>',
    heart: '<path d="M12 20S4 15 4 9.500A4.500 4.500 0 0 1 12 7a4.500 4.500 0 0 1 8 2.500C20 15 12 20 12 20Z" fill="currentColor"/>', moon: '<path d="M14 3a8 8 0 1 0 7 10.500A6.500 6.500 0 0 1 14 3Z" fill="currentColor"/>', walk: '<circle cx="12" cy="4.500" r="2"/><path d="M12 8v6M8 10h8M12 14l-3 6M12 14l3 6"/>', flame: '<path d="M12 3c1 3 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9Z" fill="currentColor"/>',
    card: '<rect x="3" y="6" width="18" height="13" rx="3"/><path d="M3 10.500h18M7 15h3"/>', box: '<path d="m12 3 8 4.500v9L12 21l-8-4.500v-9Z"/><path d="m4 7.500 8 4.500 8-4.500M12 12v9"/>', nav: '<path d="m4 11 16-7-7 16-2-7Z"/>', video: '<rect x="3" y="7" width="12" height="10" rx="2.500"/><path d="m15 11 6-3v8l-6-3"/>', phone: '<path d="M5 4h4l2 5-2.500 1.500a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z"/>',
    search: '<circle cx="11" cy="11" r="6.500"/><path d="m20 20-4.300-4.300"/>', plus: '<path d="M12 5v14M5 12h14"/>', timer: '<circle cx="12" cy="13.500" r="7"/><path d="M12 9.500v4M10 3h4"/>', vol: '<path d="M4 10v4h4l5 4V6l-5 4Z"/><path d="M16.500 9a4.500 4.500 0 0 1 0 6"/>', chart: '<path d="M3 17l5-5 4 3 8-9"/><path d="M16 6h4v4"/>', gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.600 5.600l2.100 2.100M16.300 16.300l2.100 2.100M5.600 18.400l2.100-2.100M16.300 7.700l2.100-2.100"/>', sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.500 1.500M17.500 17.500 19 19M5 19l1.500-1.500M17.500 6.500 19 5"/>', drop: '<path d="M12 3s6 6.500 6 11a6 6 0 0 1-12 0c0-4.500 6-11 6-11Z"/>', bed: '<path d="M3 18v-7h13a4 4 0 0 1 4 4v3M3 14h17M3 7v4M7 11V9h4v2"/>', send: '<path d="m5 12 14-7-5 14-2.500-5.500Z"/>' };
  const icon = n => `<svg class="i" viewBox="0 0 24 24">${ICON[n]}</svg>`;
  document.querySelectorAll('[data-i]').forEach(e => { e.insertAdjacentHTML('afterbegin', icon(e.dataset.i)); });

  // ── state ──
  const COLORS = { idle: '#5FD3A0', hello: '#5FD3A0', listening: '#F07167', thinking: '#F2B84B', searching: '#9C82F2', working: '#5B9BF5', sending: '#5B9BF5', speaking: '#E07A5F', notification: '#E07A5F', done: '#5FD3A0', celebrate: '#5FD3A0', error: '#F07167', confused: '#F2B84B', paused: '#8A8F94', cancelled: '#8A8F94', sleeping: '#8A8F94' };
  const BUSY = ['working', 'thinking', 'searching', 'sending'], W = {}, notes = [];
  const st = { state: 'idle', text: '', character: 'aegi', running: 0, listening: false, busy: false, history: [], label: 'Ready', color: COLORS.idle, task: { progress: null, steps: [], tools: null, text: '' } };
  const setData = o => { if (!o || typeof o !== 'object') return; for (const k in o) W[k] = o[k]; emit('data', W); };
  let noteId = 0;
  /** notify({ title, body, kind: 'info' | 'done' | 'error' | 'ask', steps, progress, actions }) */
  function notify(n) { if (!n) return; if (typeof n === 'string') n = { title: n }; const last = notes[0]; if (last && last.title === (n.title || '') && last.body === (n.body || n.detail || '') && Date.now() - last.at < 2500) return; n = { kind: 'info', ...n, title: n.title || 'Aegis', body: n.body || n.detail || '', id: n.id || 'n' + (++noteId), at: Date.now() }; notes.unshift(n); notes.length = Math.min(notes.length, 20); emit('notify', n); emit('data', W); }
  const normSteps = (a, idx) => (Array.isArray(a) ? a : []).map((x, i) => { const o = typeof x === 'string' ? { text: x } : { ...x }; o.text = o.text || o.title || o.label || ''; o.state = o.state || (o.done ? 'done' : typeof idx === 'number' ? (i < idx ? 'done' : i === idx ? 'now' : 'todo') : 'todo'); return o; });
  const norm = s => { s = String(s || '').toLowerCase().trim(); return s === 'running' ? 'working' : s === 'ready' ? 'idle' : s; };
  const guess = v => { const l = String(v || '').toLowerCase(); return l.includes('listen') ? 'listening' : l.includes('working') || l.includes('running') ? 'working' : l.includes('think') || l.includes('queued') ? 'thinking' : l.includes('search') ? 'searching' : l.includes('speak') ? 'speaking' : l.includes('done') || l.includes('finish') || l.includes('complete') ? 'done' : l.includes('fail') || l.includes('error') ? 'error' : 'idle'; };
  function update(p = {}) {
    const prev = st.state, prevText = st.text;
    if (p.character) st.character = String(p.character);
    if (typeof p.running === 'number') st.running = p.running;
    if (p.text !== undefined) { const v = String(p.text == null ? '' : p.text).trim(); st.text = /^(idle|ready)$/i.test(v) ? '' : v; }
    if (p.state) st.state = norm(p.state); else if (p.text !== undefined && !p.keepState) st.state = guess(p.text);
    if (typeof p.progress === 'number') st.task.progress = Math.max(0, Math.min(100, p.progress)); if (p.steps) st.task.steps = normSteps(p.steps, p.step); else if (typeof p.step === 'number') st.task.steps = normSteps(st.task.steps.map(x => ({ text: x.text })), p.step); if (p.tools != null) st.task.tools = p.tools;
    st.listening = st.state === 'listening'; st.busy = BUSY.includes(st.state); if (st.busy && st.text) st.task.text = st.text;
    st.label = st.state === 'idle' ? 'Ready' : st.state[0].toUpperCase() + st.state.slice(1); st.color = COLORS[st.state] || COLORS.idle;
    document.documentElement.style.setProperty('--state', st.color);
    document.documentElement.dataset.state = st.state;
    const isNew = st.text && st.text !== prevText;
    if (isNew) { st.history.unshift({ at: new Date(), state: st.state, text: st.text }); st.history.length = Math.min(st.history.length, 6); }
    emit('change', st); if (prev !== st.state) emit('state', st); if (isNew) emit('message', st);
    if (prev !== st.state && st.state === 'done') { const done = st.task.steps.map(x => ({ ...x, state: 'done' })); notify({ kind: 'done', title: 'Task finished', body: (st.text && !/^done\.?$/i.test(st.text) ? st.text : st.task.text) || 'Completed', steps: done }); st.task = { progress: null, steps: [], tools: null, text: '' }; }
    else if (prev !== st.state && st.state === 'error') notify({ kind: 'error', title: 'Needs attention', body: st.text || 'The last step failed' });
    else if (st.state === 'idle' && prev !== 'idle') st.task.progress = null;
  }
  // The host owns microphone state. Ask it to toggle the shared session and
  // wait for its status event instead of painting a guessed listening state.
  const toggleVoice = () => api?.voice?.();
  const setHover = over => api?.hover?.(over);

  // ── voice level: real level from the host when it sends one, otherwise a speech-like envelope ──
  let ext = 0, extAt = -1e9, lv = 0, extLive = false;
  const pushLevel = v => { ext = c01(+v || 0); extAt = performance.now(); };
  const synth = t => { const g = Math.sin(t * 2.1) + Math.sin(t * 3.7 + 1.3); return c01((0.5 + 0.5 * Math.sin(t * 13)) * (0.6 + 0.4 * Math.sin(t * 5.3 + 0.7)) * (g > -1.1 ? 1 : 0.06)); };
  const frames = []; const onFrame = f => frames.push(f);
  (function loop() { const t = tnow(), live = performance.now() - extAt < 350; extLive = live; const target = live ? ext : st.state === 'speaking' ? synth(t) : st.state === 'listening' ? 0.55 * synth(t * 0.8 + 3) : 0; lv += (target - lv) * 0.4; for (const f of frames) { try { f(t, lv); } catch (e) { console.error(e); } } requestAnimationFrame(loop); })();
  let barEls = [], barAt = 0;
  let pulseEl, pulseAt = 0;
  let barsFrameAt = 0;
  onFrame(t => { if (t - barsFrameAt < 1 / 24) return; barsFrameAt = t; if (t - barAt > 0.6) { barAt = t; barEls = [...document.querySelectorAll('.bars')].filter(b => b.getClientRects().length).map(b => [...b.children]); } for (const it of barEls) it.forEach((b, i) => { const ph = i * 1.7, v = Math.max(lv * (0.55 + 0.45 * Math.sin(t * 9 + ph)), (st.busy ? 0.35 : 0) * (0.5 + 0.5 * Math.sin(t * 4 + ph)), 0.16 + 0.06 * Math.sin(t * 1.6 + ph)); b.style.transform = `scaleY(${v.toFixed(3)})`; }); if (pulseEl === undefined || t - pulseAt > 2) { pulseAt = t; pulseEl = document.querySelector('[data-pulse]'); } if (pulseEl && pulseEl.getClientRects().length) pulseEl.style.setProperty('--pulse', (1 + 0.04 * Math.sin(t * 1.5) + 0.28 * lv).toFixed(3)); });   // Animate only visible cards, at a bounded rate.

  // ── live mascot (same engine as the in-app character) ──
  const TALK = [-4, 3, 0, 6, 4, 3, 13], mascots = []; let uid = 0;
  function mascot(el, size, o = {}) {
    const m = { el, size, character: o.character || null, vr: 0, r: 0, swx: 0, popAt: -9, fid: null, fidAt: -9, state: 'idle', t0: tnow(), from: null, bAt: 0, g: [0, 0], gt: [0, 0], last: 0, fps: o.fps || 30, uid: 'aw' + (++uid), pose: null };
    el.classList.add('mm');
    m.play = s => { if (!STATES[s]) s = 'idle'; if (s === m.state && !STATES[s].once) return; m.from = m.pose; m.bAt = tnow(); m.state = s; m.t0 = tnow(); m.popAt = tnow(); };
    m.sway = (vx = 0) => { m.swx = Math.max(-1, Math.min(1, vx)); };   // drag velocity -1..1: the body leans and wobbles back like jelly
    m.fidget = name => { m.fid = name || ['wiggle', 'stretch', 'peek', 'nod'][Math.floor(Math.random() * 4)]; m.fidAt = tnow(); };
    m.react = s => { if (STATES[s]) { m.state = ''; m.play(s); } };
    m.hop = (h = 1) => { m.hopAt = tnow(); m.hopH = h; m.hopDir = Math.random() < 0.5 ? -1 : 1; }; m.hopAt = -9; m.hopH = 1; m.lively = !!o.lively; m.nextLife = tnow() + 3; m.mouseAt = -9;
    m.resize = s => { m.size = s; };
    if (o.state) m.play(o.state); else on('state', () => m.play(st.state));
    m.set = (ch, s) => { if (ch) m.character = ch; if (s && s !== m.state) m.play(s); };
    onFrame((T, a) => {
      if (!el.isConnected || !el.getClientRects().length) return;
      if (T - m.last < 1 / m.fps - 0.004) return; m.last = T;
      const ch = CHARACTERS[m.character || st.character] ? (m.character || st.character) : 'aegi', S0 = STATES[m.state] || STATES.idle, base = o.state || st.state;
      if (S0.once && T - m.t0 >= S0.dur) m.play(base !== m.state && STATES[base] && !STATES[base].once ? base : (S0.then || 'idle'));
      let p = samplePose(m.state, T - m.t0, ch);
      if (m.from) { const k = (T - m.bAt) / 0.3; if (k < 1) p = lerpPose(m.from, p, k * k * (3 - 2 * k)); else m.from = null; }
      m.pose = p; const q = { ...p };
      if (a > 0.015 && (m.state === 'speaking' || (extLive && m.state !== 'listening')) && Array.isArray(q.m) && q.m.length === TALK.length) { q.m = mix(q.m, TALK, c01(a * 1.25)); q.ty -= 3 * a; q.sy *= 1 + 0.035 * a; q.sx *= 1 - 0.02 * a; }
      else if (m.state === 'listening') { q.sy *= 1 + 0.02 * a; }
      // hop with anticipation (crouch), flight (stretch) and landing (squash + settle)
      const hh = (T - m.hopAt) / 0.72; if (hh > 0 && hh < 1) { const H = m.hopH; if (hh < 0.16) { const c = Math.sin(Math.PI * hh / 0.16 * 0.5); q.sy *= 1 - 0.13 * H * c; q.sx *= 1 + 0.09 * H * c; q.ty += 3 * H * c; } else if (hh < 0.7) { const a2 = (hh - 0.16) / 0.54, b = 4 * a2 * (1 - a2); q.ty -= 20 * H * b; q.sy *= 1 + 0.10 * H * (1 - Math.abs(2 * a2 - 1)) + 0.03; q.sx *= 1 - 0.06 * H * (1 - Math.abs(2 * a2 - 1)); q.rot += 4 * H * Math.sin(Math.PI * 2 * a2) * (m.hopDir || 1); } else { const l = (hh - 0.7) / 0.3, s = Math.exp(-4 * l) * Math.cos(l * Math.PI * 3); q.sy *= 1 - 0.12 * H * s; q.sx *= 1 + 0.09 * H * s; q.ty += 2.5 * H * Math.max(0, s); } }
      // every state change gets a little squash-and-stretch pop
      const pk = (T - m.popAt) / 0.5; if (pk > 0 && pk < 1 && m.popAt > 0.6) { const s = Math.exp(-5 * pk) * Math.sin(pk * Math.PI * 4); q.sy *= 1 + 0.07 * s; q.sx *= 1 - 0.05 * s; }
      // jelly spring for dragging / nudges
      m.vr += (m.swx * 16 - m.r) * 0.16; m.vr *= 0.84; m.r += m.vr; m.swx *= 0.9; if (Math.abs(m.r) > 0.05) { q.rot += m.r; q.tx += m.r * 0.5; q.sx *= 1 + Math.abs(m.r) * 0.003; }
      // small idle fidgets so the character never loops the same way twice
      if (m.fid) { const f = (T - m.fidAt) / 0.9; if (f >= 1) m.fid = null; else { const e = Math.sin(Math.PI * f); if (m.fid === 'wiggle') q.rot += 6 * e * Math.sin(f * Math.PI * 6); else if (m.fid === 'stretch') { q.sy *= 1 + 0.08 * e; q.sx *= 1 - 0.05 * e; q.ty -= 3 * e; } else if (m.fid === 'peek') { q.rot += 9 * e; q.tx += 5 * e; if ('gx' in q) q.gx += 6 * e; } else if (m.fid === 'nod') { q.ty += 3 * e * Math.abs(Math.sin(f * Math.PI * 3)); q.sy *= 1 - 0.03 * e * Math.abs(Math.sin(f * Math.PI * 3)); } } }
      // lean a touch toward whatever it is looking at
      q.rot += m.g[0] * 2.2; q.tx += m.g[0] * 1.6;
      if (m.lively && T > m.nextLife) { m.nextLife = T + 2.5 + Math.random() * 4; if (T - m.mouseAt > 2.5) { const r = Math.random(); if (m.state === 'idle' && r < 0.18) m.hop(0.6); else if (m.state === 'idle' && r < 0.42) m.fidget(); else if (r < 0.85) { m.gt = [(Math.random() * 2 - 1) * 0.9, (Math.random() - 0.6) * 0.6]; setTimeout(() => { if (tnow() - m.mouseAt > 2) m.gt = [0, 0]; }, 1100); } } }
      m.g[0] += (m.gt[0] - m.g[0]) * 0.18; m.g[1] += (m.gt[1] - m.g[1]) * 0.18;
      if ('gx' in q) q.gx += m.g[0] * 7; if ('gy' in q) q.gy += m.g[1] * 5;
      el.innerHTML = markup(attrs(q), null, resolveTheme('color', ch), { size: m.size, uid: m.uid, character: ch, title: 'Aegis', shadow: o.shadow !== false });
    });
    mascots.push(m); return m;
  }
  // Mascot gaze: coalesced to one animation frame and measured at most every
  // 120ms. Measuring every mascot on every mousemove forced a layout on each
  // event, which is what made the notch feel like it was hanging.
  let gazeAt = 0, gazeX = 0, gazeY = 0, gazeFrame = 0;
  const applyGaze = () => {
    gazeFrame = 0;
    const t = tnow();
    if (t - gazeAt < 0.12) return;
    gazeAt = t;
    for (const m of mascots) {
      if (!m.el.isConnected || !m.el.getClientRects().length) continue;
      const r = m.el.getBoundingClientRect();
      const dx = gazeX - (r.left + r.width / 2), dy = gazeY - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy) || 1, k = Math.min(1, d / 160);
      m.gt = [dx / d * k, dy / d * k];
      m.mouseAt = t;
    }
  };
  document.addEventListener('mousemove', e => {
    gazeX = e.clientX; gazeY = e.clientY;
    if (gazeFrame) return;
    gazeFrame = requestAnimationFrame(applyGaze);
  }, { passive: true });
  document.addEventListener('mouseleave', () => { for (const m of mascots) m.gt = [0, 0]; });

  // ── weather ──
  const WX = { data: null, status: 'loading', loc: store.get('aegis.weather.loc', null) };
  const kindOf = c => c == null ? 'cloud' : c === 0 ? 'clear' : c <= 2 ? 'partly' : c === 3 ? 'cloud' : c <= 48 ? 'fog' : c <= 57 ? 'drizzle' : c <= 67 ? 'rain' : c <= 77 ? 'snow' : c <= 82 ? 'rain' : c <= 86 ? 'snow' : 'storm';
  const kindOfText = s => { s = String(s || '').toLowerCase(); return /thunder|storm/.test(s) ? 'storm' : /snow|sleet|hail/.test(s) ? 'snow' : /drizzle/.test(s) ? 'drizzle' : /rain|shower/.test(s) ? 'rain' : /fog|mist|haze|smoke/.test(s) ? 'fog' : /part|few|scatter/.test(s) ? 'partly' : /cloud|overcast/.test(s) ? 'cloud' : /clear|sun|fair/.test(s) ? 'clear' : 'cloud'; };
  const DESC = { clear: 'Clear', partly: 'Partly cloudy', cloud: 'Cloudy', fog: 'Fog', drizzle: 'Drizzle', rain: 'Rain', snow: 'Snow', storm: 'Thunderstorm' };
  const pick = (o, ...k) => { for (const x of k) if (o[x] != null) return o[x]; };
  function wxSet(w, source) {
    if (!w || typeof w !== 'object') return; const code = pick(w, 'code', 'weatherCode', 'weather_code'), cond = pick(w, 'condition', 'desc', 'summary', 'description'), temp = pick(w, 'temp', 'temperature', 'tempC', 'temperature_2m');
    if (temp == null || isNaN(+temp)) return; const kind = w.kind || (code != null ? kindOf(+code) : kindOfText(cond));
    WX.data = { temp: +temp, kind, desc: cond || DESC[kind], city: pick(w, 'city', 'location', 'name') || WX.loc?.name || '', hi: pick(w, 'high', 'hi', 'max'), lo: pick(w, 'low', 'lo', 'min'), feels: pick(w, 'feels', 'feelsLike'), humidity: w.humidity, wind: w.wind, uv: pick(w, 'uv', 'uvIndex'), rain: pick(w, 'rain', 'precipitation'), sunset: w.sunset, day: w.day || [], night: w.isDay === false || w.isDay === 0 || w.night === true,
      hours: (pick(w, 'hours', 'hourly') || []).slice(0, 4).map(h => ({ label: h.label || (h.time ? new Date(h.time).toLocaleTimeString([], { hour: 'numeric' }) : ''), temp: +h.temp, kind: h.kind || (h.code != null ? kindOf(+h.code) : kindOfText(h.condition)), night: h.isDay === false || h.isDay === 0 })), sample: !!w.sample, source };
    WX.status = 'ok'; emit('weather', WX);
  }
  async function wxFetch() {
    try { if (api?.getWeather) { const w = await api.getWeather(); if (w) { wxSet(w, 'host'); return; } } } catch {}
    if (WX.data && WX.data.source === 'host') return;
    if (!WX.loc) { if (PREVIEW) wxSample(); else { WX.status = 'need-loc'; emit('weather', WX); } return; }
    try {
      const u = `https://api.open-meteo.com/v1/forecast?latitude=${WX.loc.lat}&longitude=${WX.loc.lon}&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day,precipitation&hourly=temperature_2m,weather_code,is_day&daily=temperature_2m_max,temperature_2m_min,uv_index_max,sunset&forecast_days=2&timezone=auto`;
      const j = await (await fetch(u)).json(), c = j.current, i0 = Math.max(0, j.hourly.time.findIndex(x => x > c.time));
      wxSet({ temp: c.temperature_2m, code: c.weather_code, city: WX.loc.name, high: j.daily.temperature_2m_max[0], low: j.daily.temperature_2m_min[0], feels: c.apparent_temperature, humidity: c.relative_humidity_2m, wind: c.wind_speed_10m, isDay: c.is_day, uv: j.daily.uv_index_max && j.daily.uv_index_max[0], rain: c.precipitation, sunset: j.daily.sunset && j.daily.sunset[0], day: j.hourly.time.slice(0, 24).map((x, k) => ({ h: k, temp: j.hourly.temperature_2m[k] })),
        hours: [0, 1, 2, 3].map(k => ({ time: j.hourly.time[i0 + k * 2], temp: j.hourly.temperature_2m[i0 + k * 2], code: j.hourly.weather_code[i0 + k * 2], isDay: j.hourly.is_day[i0 + k * 2] })) }, 'open-meteo');
    } catch { if (PREVIEW) wxSample(); else if (!WX.data) { WX.status = 'offline'; emit('weather', WX); } }
  }
  const wxSample = () => wxSet({ temp: 24, code: 2, city: WX.loc?.name || 'Sample city', high: 27, low: 15, sample: true, isDay: 1, feels: 24, humidity: 38, uv: 3, rain: 0, sunset: '2026-01-01T17:42', day: Array.from({ length: 24 }, (_, h) => ({ h, temp: 17 + 9 * Math.max(0, Math.sin((h - 6) / 12 * Math.PI)) })), hours: [['3 PM', 26, 1], ['5 PM', 24, 2], ['7 PM', 21, 3], ['9 PM', 18, 61]].map(h => ({ label: h[0], temp: h[1], code: h[2] })) }, 'sample');
  async function wxSearch(name) {
    name = String(name || '').trim(); if (!name) return false;
    try { const j = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(name)}`)).json(), r = j.results && j.results[0]; if (!r) return false; WX.loc = { name: r.name, lat: r.latitude, lon: r.longitude }; }
    catch { if (!PREVIEW) return false; WX.loc = { name, lat: 0, lon: 0 }; }
    store.set('aegis.weather.loc', WX.loc); api?.action?.('weather-location', WX.loc); if (WX.data) WX.data.source = ''; await wxFetch(); return true;
  }
  window.addEventListener('storage', e => { if (e.key === 'aegis.weather.loc') { WX.loc = store.get('aegis.weather.loc', null); wxFetch(); } });
  const deg = v => (v == null || isNaN(+v) ? '–' : Math.round(+v) + '°');
  function wxIcon(kind, night, s = 24) {
    const cloud = (x = '') => `<path ${x} d="M7.5 18a4 4 0 0 1-.6-7.95A5.5 5.5 0 0 1 17.6 9.6 4.2 4.2 0 0 1 17 18Z" fill="var(--card2)" stroke="var(--text)" stroke-width="1.5" stroke-linejoin="round"/>`;
    const sun = (cx, cy, r) => `<g class="spin" style="transform-origin:${cx}px ${cy}px"><circle cx="${cx}" cy="${cy}" r="${r}" fill="#F2B84B"/>${[0, 45, 90, 135, 180, 225, 270, 315].map(a => `<path d="M${cx} ${cy - r - 1.6}v-2" stroke="#F2B84B" stroke-width="1.6" stroke-linecap="round" transform="rotate(${a} ${cx} ${cy})"/>`).join('')}</g>`;
    const moon = (x, y, k) => `<path transform="translate(${x} ${y}) scale(${k})" d="M14 3a7 7 0 1 0 7 9.500A6 6 0 0 1 14 3Z" fill="#C9C2F5"/>`;
    const drops = c => [8.5, 12, 15.500].map(x => `<path class="drop" d="M${x} 19.500l-1 2.500" stroke="${c}" stroke-width="1.6" stroke-linecap="round"/>`).join('');
    let b = '';
    if (kind === 'clear') b = night ? moon(0, 0, 1) : sun(12, 12, 4.6);
    else if (kind === 'partly') b = (night ? moon(8, -1, 0.62) : sun(16.500, 7.500, 3.2)) + `<g class="drift">${cloud()}</g>`;
    else if (kind === 'cloud') b = `<g class="drift">${cloud()}</g>`;
    else if (kind === 'fog') b = cloud('transform="translate(0 -3)"') + '<path class="drift" d="M6 19h12M8 22h8" stroke="var(--dim)" stroke-width="1.6" stroke-linecap="round"/>';
    else if (kind === 'rain' || kind === 'drizzle') b = cloud('transform="translate(0 -3)"') + drops('#5B9BF5');
    else if (kind === 'snow') b = cloud('transform="translate(0 -3)"') + [8.5, 12, 15.500].map(x => `<circle class="drop" cx="${x}" cy="20" r="1.1" fill="#DCE8F5"/>`).join('');
    else b = cloud('transform="translate(0 -3)"') + '<path class="bolt" d="M12.500 15l-2.500 4h3l-1.500 3.500" fill="none" stroke="#F2B84B" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>';
    return `<svg class="wxi" width="${s}" height="${s}" viewBox="0 0 24 24">${b}</svg>`;
  }
  // ── host wiring (same contract as before, plus optional level / weather) ──
  // ---- intent router: what the user said → a command or a notch view (English + Hinglish keywords) ----
  const INTENTS = [
    ['cmd:task', /^(add (a )?(task|to-?do)|remind me to|new task|task)\b[: ]*/], ['cmd:focus-stop', /\b(stop|pause|end)\b.*\b(focus|pomodoro)\b/], ['cmd:focus', /\b(focus|pomodoro)\b/], ['cmd:workspace', /\b(workspace|my tasks|to-?do list|notepad|my notes)\b/],
    ['cmd:close', /^(close|dismiss|never ?mind|cancel that|band karo|hata do)\b/],
    ['cmd:widgets-hide', /\b(hide|close|band)\b.*\bwidgets?\b/], ['cmd:widgets', /\bwidgets?\b/],
    ['cmd:mascot', /\b(show|hide|toggle)\b.*\bmascot\b/], ['cmd:notch', /\b(hide|toggle)\b.*\bnotch\b/],
    ['cmd:open', /\b(open|launch|show|kholo|khol)\b.*\b(aegis|ae?jis|ejs|app|dashboard|main window)\b|\b(aegis|app)\b.*\b(kholo|khol do)\b/],
    ['timer', /\b(timer|countdown|stopwatch)\b/], ['alarms', /\b(alarms?|wake me)\b/],
    ['clock', /\btime\b|\bsamay\b|kitne baje|\bbaj[ea]\b|o'?clock/],
    ['live:flight', /\b(flights?|boarding|plane|gate)\b/], ['live:ride|drop|cab', /\b(ride|cab|uber|ola|driver|taxi)\b/], ['live:charg', /\b(charging|charger|ev)\b/], ['live:order|pickup', /\b(order|pickup|pick up|food)\b/], ['live:lap', /\blaps?\b/],
    ['tracking', /\b(package|parcel|delivery|courier|shipment)\b/], ['navigation', /\b(directions?|navigat\w*|route|how far)\b/],
    ['schedule', /\b(date|calendar|schedule|agenda|events?|meetings?|tareekh|tarikh|tithi|what day|which day|today)\b/],
    ['weather', /\b(weather|temperature|rain\w*|forecast|umbrella|mausam|sunset|humid\w*)\b/],
    ['media', /\b(songs?|music|track|playing|play|pause|gaana|gana|volume|spotify|next song)\b/],
    ['system', /\b(gpu|cpu|ram|memory|vram|resources?|system (usage|load)|performance)\b/],
    ['devices', /\b(devices?|bluetooth|headphones?|earbuds?|airpods|connected|battery)\b/],
    ['market', /\b(stocks?|shares?|price|market|bitcoin|btc|crypto|nifty|sensex|eth)\b/],
    ['health', /\b(health|steps|sleep|calories?|heart ?rate|pulse)\b/], ['payment', /\b(payments?|spend|spent|expenses?|bills?|transactions?|kharcha)\b/],
    ['notes', /\b(notifications?|what (did|have) you (do|done)|activity|done so far)\b/], ['security', /\b(permissions?|security)\b/], ['model', /\b(model|provider)\b/],
    ['call', /\bcall\b/], ['agents', /\b(sub-?agents?|agents?|workers?|delegat\w*|what are you doing|working on|task status|progress)\b/], ['ask', /\b(type|keyboard|ask bar)\b/],
  ];
  /** intent("what's the time?") → { view: 'clock' } · intent('open aegis') → { cmd: 'open' } · null when nothing matches */
  const intent = text => { const t = String(text || '').toLowerCase().replace(/^(you|user)\s*:\s*/, '').replace(/^(hey |ok |okay )?(aegis|ae?jis|ejs)[,!. ]*/, '').trim(); if (!t) return null; for (const [id, re] of INTENTS) if (re.test(t)) { const [a, b] = id.split(':'); return a === 'cmd' ? { cmd: b, text: t } : { view: a, q: b || '', text: t }; } return null; };
  let lastHeard = '', lastHeardAt = 0;
  const hear = text => { const now = Date.now(); if (!text || (text === lastHeard && now - lastHeardAt < 4000)) return; lastHeard = text; lastHeardAt = now; emit('heard', { text, intent: intent(text) }); };
  // ---- subagents: W.agents = [{ id, name, character, state, task, progress, parent }] ----
  const DONE_ST = ['idle', 'done', 'paused', 'error', 'cancelled'], agentKey = a => a.id || a.name;
  const activeAgents = () => (W.agents || []).filter(a => !DONE_ST.includes(a.state));
  let seenAgents = null;
  on('data', () => { const list = W.agents || [], cur = new Map(list.map(a => [agentKey(a), a.state])); if (seenAgents) for (const a of list) { const was = seenAgents.get(agentKey(a)); if (was === undefined && !DONE_ST.includes(a.state)) emit('spawn', a); else if (was !== undefined && was !== a.state && a.state === 'done') emit('agent-done', a); else if (was !== undefined && DONE_ST.includes(was) && !DONE_ST.includes(a.state)) emit('spawn', a); } seenAgents = cur; });
  /** agentEvent('spawn' | 'update' | 'done' | 'remove', agent): incremental alternative to sending the whole `agents` array */
  const agentEvent = (type, a) => { if (!a) return; const list = (W.agents || []).slice(), i = list.findIndex(x => agentKey(x) === agentKey(a)); if (type === 'remove') { if (i >= 0) list.splice(i, 1); } else { const next = { ...(i >= 0 ? list[i] : { state: 'working' }), ...a }; if (type === 'done') { next.state = 'done'; next.progress = 100; } if (i >= 0) list[i] = next; else list.push(next); } setData({ agents: list }); };
  const ingest = p => {
    if (p && typeof p === 'object') {
      if (p.weather) wxSet(p.weather, 'host'); if (typeof p.level === 'number') pushLevel(p.level);
      if (p.widgets) setData(p.widgets); if (p.media !== undefined) setData({ media: p.media }); if (Array.isArray(p.agents || p.subagents)) setData({ agents: p.agents || p.subagents }); if (p.agent && typeof p.agent === 'object') agentEvent(p.agent.event || 'update', p.agent); if (p.x) setData({ x: { ...(W.x || {}), ...p.x } }); if (p.metrics) sysSet(p.metrics);
      if (p.notice || p.notification) notify(p.notice || p.notification);
      if (p.view) emit('view', typeof p.view === 'string' ? { id: p.view } : p.view); if (p.heard || p.query) hear(p.heard || p.query);
      const text = p.status ?? p.text ?? p.prompt;
      if (text !== undefined || p.state || p.character || typeof p.runningCount === 'number' || typeof p.progress === 'number' || p.steps || typeof p.step === 'number' || p.tools != null) update({ state: p.state || (text === undefined ? st.state : undefined), text, character: p.character, running: p.runningCount, progress: p.progress, steps: p.steps, step: p.step, tools: p.tools });
    } else update({ text: p });
  };
  const EVENTS = { 'mic:start': ['listening', 'Listening…'], 'mic:stop': ['thinking', 'Thinking…'], 'agent:thinking': ['thinking', 'Thinking…'], 'agent:working': ['working', 'Working…'], 'agent:done': ['done', 'Done'], 'app:idle': ['idle', ''], 'tts:start': ['speaking'], 'speak:start': ['speaking'], 'agent:speaking': ['speaking'], 'tts:stop': ['idle'], 'tts:end': ['idle'], 'speak:end': ['idle'] };
  api?.onStatus?.(ingest); ovl?.onStatus?.(text => ingest(text));
  api?.onUpdate?.(patch => { if (patch?.transcript?.length) { const l = patch.transcript[patch.transcript.length - 1]; if (l.role === 'user') hear(l.text); update({ text: `${l.role === 'user' ? 'You' : 'Aegis'}: ${l.text}`, keepState: true }); } else if (patch) ingest(patch); });
  api?.onEvent?.((ev, data) => { const name = typeof ev === 'string' ? ev : ev?.type; if (/^(sub)?agent:(spawn|start|update|progress|done|finish|remove|end)$/.test(name || '') && data && typeof data === 'object') return agentEvent(/spawn|start/.test(name) ? 'spawn' : /done|finish/.test(name) ? 'done' : /remove|end/.test(name) ? 'remove' : 'update', data); const e = EVENTS[name]; if (e) update(e.length > 1 ? { state: e[0], text: e[1] } : { state: e[0] }); if ((name === 'voice:level' || name === 'tts:level' || name === 'mic:level')) pushLevel(typeof data === 'number' ? data : ev?.level); });
  api?.onLevel?.(pushLevel); api?.onWeather?.(w => wxSet(w, 'host')); api?.onWidgets?.(setData); api?.onNotify?.(notify);
  // system metrics (same getSystemMetrics() the shell already exposes)
  const hist = { cpu: [], mem: [], gpu: [] };
  function sysSet(d) { if (!d) return; const v = { cpu: d.cpuPercent ?? d.cpu, mem: d.memoryPercent ?? d.mem, gpu: d.gpuPercent ?? d.gpu, used: d.usedMemoryGb, total: d.totalMemoryGb, up: d.uptimeHours }; for (const k of ['cpu', 'mem', 'gpu']) if (v[k] != null) { hist[k].push(+v[k]); if (hist[k].length > 14) hist[k].shift(); } W.system = { ...v, hist }; emit('data', W); }
  const sysPoll = async () => { try { sysSet(await api?.getSystemMetrics?.()); } catch {} };
  /** Widget action → host. Media goes through the existing mediaControl(); the rest through action('widget', …). */
  function act(id, action, value) {
    if (id === 'app') return action === 'talk' ? toggleVoice() : action === 'open' ? api?.show?.() : action === 'widgets' ? api?.toggleWidgets?.() : action === 'notch' ? api?.toggleNotch?.() : action === 'mascot' ? api?.toggleMascot?.() : undefined;
    if (id === 'media') { if (action === 'volume') { W.media = { ...(W.media || {}), volume: value }; emit('data', W); api?.action?.('volume', { value }); return; } if (action === 'playPause' && W.media) { W.media = { ...W.media, playing: !W.media.playing }; emit('data', W); } return api?.mediaControl?.(action); }
    if (id === 'ask') { hear(value); return api?.ask ? api.ask(value) : api?.action?.('ask', { text: value }); }
    if (id === '__never') return api?.ask ? api.ask(value) : api?.action?.('ask', { text: value });
    api?.action?.('widget', { id, action, value }); if (action === 'open') api?.show?.();
  }

  // ── clock ──
  const tick = () => emit('tick', new Date()); setInterval(tick, 1000);
  const hm = d => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // ── browser preview only: a small strip to try every state. Never shown inside the app. ──
  if (PREVIEW) {
    document.documentElement.classList.add('preview');
    const demo = { Idle: ['idle', ''], Listen: ['listening', 'Listening…'], Think: ['thinking', 'Thinking about your request…'], Speak: ['speaking', 'Aegis: All 42 tests passed. Want me to push the branch?'], Error: ['error', 'Failed: could not reach the voice daemon'] };
    const STEPS = ['Search academic sources', 'Extract relevant information', 'Compare findings', 'Prepare final report'];
    const POOL = [['Web researcher', 'memory', 'Searching 14 sources'], ['Mail drafter', 'mail', 'Writing reply to Priya'], ['File sorter', 'files', 'Organising Downloads'], ['Code reviewer', 'harness', 'Reading pull request #42'], ['Fact checker', 'security', 'Verifying 6 claims'], ['Summariser', 'social', 'Condensing the report']]; let spawnN = 0;
    const spawnDemo = () => { const p = POOL[spawnN % POOL.length], id = 'sub' + (++spawnN), a = { id, name: p[0], character: p[1], task: p[2], state: 'working', progress: 0, parent: 'Aegis', model: 'gemini-flash', tools: 2, log: ['> plan: 3 steps', '> tool: search("' + p[2].toLowerCase() + '")', '> reading results…'] }; agentEvent('spawn', a); if (st.state === 'idle') update({ state: 'working', text: 'Delegating to ' + activeAgents().length + ' subagent' + (activeAgents().length > 1 ? 's' : '') }); let pr = 0; const iv = setInterval(() => { const me = (W.agents || []).find(x => x.id === id); if (!me) return clearInterval(iv); if (me.state === 'paused') return; pr += 4 + Math.random() * 6; if (pr >= 100) { clearInterval(iv); agentEvent('done', { id }); setTimeout(() => { agentEvent('remove', { id }); if (!activeAgents().length && st.state === 'working') update({ state: 'done', text: 'All subagents finished' }); }, 3500); } else agentEvent('update', { id, progress: Math.round(pr), state: pr > 55 ? 'working' : 'searching', tools: 2 + Math.floor(pr / 20) }); }, 700); };
    const runTask = () => { let i = 0; update({ state: 'working', text: 'Research agent: analysing 12 papers', steps: STEPS, step: 0, progress: 4, tools: 0, running: 2 }); const iv = setInterval(() => { i++; if (i >= 16) { clearInterval(iv); update({ state: 'done', text: 'Done: report on 12 papers is ready', running: 0 }); return; } update({ state: i % 5 === 2 ? 'searching' : 'working', text: `Research agent: ${STEPS[Math.min(3, i >> 2)].toLowerCase()}`, step: Math.min(3, i >> 2), progress: Math.round(i / 16 * 100), tools: i >> 1, keepState: false }); }, 900); };
    addEventListener('DOMContentLoaded', () => { const b = document.createElement('div'); b.id = 'pv'; b.innerHTML = '<span>Preview</span>' + [...Object.keys(demo), 'Run task', 'Notify', 'Spawn'].map(k => `<button data-k="${k}">${k}</button>`).join(''); document.body.appendChild(b); b.addEventListener('click', e => { const k = e.target.dataset.k; if (k === 'Run task') runTask(); else if (k === 'Spawn') spawnDemo(); else if (k === 'Notify') notify({ kind: 'ask', title: 'Permission needed', body: 'Research agent wants to read Documents/papers', actions: ['Allow', 'Deny'] }); else if (k) update({ state: demo[k][0], text: demo[k][1] }); }); });
    const now = Date.now();
    setData({ agents: [{ name: 'Research agent', character: 'memory', state: 'working', task: 'Analysing research papers', progress: 68 }, { name: 'Mail agent', character: 'mail', state: 'thinking', task: 'Drafting reply to Priya', progress: 30 }, { name: 'Files agent', character: 'files', state: 'done', task: 'Sorted 48 downloads', progress: 100 }, { name: 'Security', character: 'security', state: 'idle', task: 'Watching permissions' }],
      voice: { stt: 'Local STT', lang: 'English', tts: 'Kokoro' }, security: { pending: 2 }, model: { provider: 'Gemini', model: '2.5', mode: 'Cloud inference', status: 'Connected' }, conversations: { active: 4 },
      schedule: { more: 16, items: [{ title: 'Quick exercise', start: '7:00', end: '7:30', color: '#F2555A' }, { title: 'Check emails', start: '9:00', end: '9:15', color: '#4ADE80' }, { title: 'Prioritize tasks', start: '9:30', end: '10:00', color: '#5B9BF5' }] },
      alarms: [{ id: 'a1', time: '07:30', repeat: 'Once', on: false }, { id: 'a2', time: '08:00', repeat: 'Daily', on: true }, { id: 'a3', time: '08:45', repeat: 'Once', on: false }],
      media: { title: 'Blue Hour', artist: 'Orrin', app: 'Spotify', position: 93, duration: 190, playing: true, volume: 69 },
      devices: [{ name: 'Headset', kind: 'audio', battery: 81, connected: true }, { name: 'Mouse', kind: 'input', battery: 43, connected: true }, { name: 'Keyboard', kind: 'input', battery: 67, connected: true }],
      health: { sleep: '4h 22min', steps: 8367, calories: 351, heart: 82 }, market: [{ symbol: 'BTC', name: 'Bitcoin', price: 35103.8, change: 0.14, currency: '$', points: [30, 28, 31, 27, 26, 33, 41, 44, 39, 37, 40, 46] }],
      payment: { month: 'This month', total: 104.02, currency: '$', last4: '9412', latest: { name: 'Coffee shop', amount: 5.42 } }, live: [{ id: 'ride', icon: 'nav', title: 'Drop-off in 12 min', value: '4.2 km', progress: 64, color: 'green', sub: 'White sedan · arriving 6:48 PM' }, { id: 'flight', glyph: '✈', title: 'Flight · on time', value: '1h 42m', from: 'DEL', to: 'BOM', progress: 38, color: 'blue' }, { id: 'ev', glyph: '⚡', title: 'Charging', value: '78%', progress: 78, color: 'green', sub: '22 min to full' }, { id: 'hr', icon: 'heart', title: 'Heart rate', value: '72 bpm', color: 'red', sub: 'Resting' }, { id: 'lap', icon: 'timer', title: 'Lap 4', value: '1:42.6', color: 'amber', sub: 'Best 1:39.8' }, { id: 'order', glyph: '☕', title: 'Order ready for pickup', value: '#214', color: 'accent', sub: 'Counter 2' }], tracking: { title: 'Package', status: 'Out for delivery', eta: '2 PM', progress: 62, stops: 4, by: 'Courier' },
      navigation: { next: 'Turn right in 20 m', destination: 'Office', distance: '8.0 km', eta: '16 min' }, meeting: { title: 'Design review', start: new Date(now + 12 * 60000).toISOString(), people: 'Priya, Arjun +2', app: 'Meet' },
      call: { name: 'Lena', agent: 'Call agent', startedAt: now - 264000, status: 'On call' }, status: { wifi: 'Home-5G', bluetooth: 3, battery: 76, charging: true }, replies: ['Please repeat', 'Got it. Thanks!'] });
    sysSet({ cpuPercent: 31, memoryPercent: 58, gpuPercent: 42, usedMemoryGb: 9.3, totalMemoryGb: 16, uptimeHours: 5 }); setInterval(() => sysSet({ cpuPercent: 20 + Math.round(Math.random() * 40), memoryPercent: 55 + Math.round(Math.random() * 8), gpuPercent: 25 + Math.round(Math.random() * 45), usedMemoryGb: 9.3, totalMemoryGb: 16, uptimeHours: 5 }), 2500);
    setInterval(() => { const m = W.media; if (m && m.playing) { m.position = (m.position + 1) % m.duration; emit('data', W); } }, 1000);
  }
  const start = () => { update({ state: 'idle', text: '' }); tick(); wxFetch(); setInterval(wxFetch, 15 * 60 * 1000); };
  return { api, PREVIEW, $, esc, st, on, emit, update, toggleVoice, setHover, intent, hear, activeAgents, agentEvent, tnow, onFrame, mascot, wxIcon, wxSearch, wxFetch, WX, deg, hm, icon, level: () => lv, pushLevel, start, W, notes, notify, setData, act, store, COLORS, refreshSystemMetrics: sysPoll };
})();
