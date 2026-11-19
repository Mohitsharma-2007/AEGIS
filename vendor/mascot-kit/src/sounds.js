/*! aegis-sounds — the Aegis UI sound set, synthesised from code (no samples, no dependencies). MIT.
 *  The same recipes render to Float32 samples in Node (-> .wav files) and in the browser/Electron (-> Web Audio). */
export const SR = 44100;
const TAU2 = Math.PI * 2;
const NOTE = { D4: 293.66, A4: 440, B4: 493.88, D5: 587.33, E5: 659.25, Fs5: 739.99, A5: 880, B5: 987.77, D6: 1174.66, Fs6: 1479.98, A6: 1760 };

function rng(seed) { let s = seed >>> 0; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 2147483648 - 1; }; }
/** one pitched voice. type: mallet | bell | soft | blip */
function tone(b, { f, f2 = f, t = 0, d = 0.25, g = 0.5, a = 0.004, type = 'mallet', vib = 0 }) {
  const n0 = Math.round(t * SR), len = Math.min(Math.round(d * SR), b.length - n0), fade = 0.01 * SR; let ph = 0;
  for (let i = 0; i < len; i++) {
    const x = i / SR, k = i / len, fr = f * Math.pow(f2 / f, k * k * (3 - 2 * k)) * (1 + vib * Math.sin(TAU2 * 6 * x));
    ph += TAU2 * fr / SR; let s, e;
    if (type === 'mallet') { s = Math.sin(ph) + 0.32 * Math.sin(4 * ph) * Math.exp(-x * 45) + 0.08 * Math.sin(10 * ph) * Math.exp(-x * 90); e = Math.exp(-x * 5 / d); }
    else if (type === 'bell') { s = Math.sin(ph + 2.1 * Math.exp(-x * 9) * Math.sin(3.5 * ph)) + 0.35 * Math.sin(2 * ph) * Math.exp(-x * 14); e = Math.exp(-x * 4.5 / d); }
    else if (type === 'soft') { s = Math.sin(ph) + 0.16 * Math.sin(2 * ph); e = Math.sin(Math.PI * k) ** 0.8; }
    else { s = Math.sin(ph) + 0.12 * Math.sin(2 * ph); e = Math.exp(-x * 3.5 / d); }
    b[n0 + i] += g * Math.min(1, x / a) * Math.min(1, (len - i) / fade) * e * s;
  }
}
/** band-passed noise sweep (whooshes, clicks) */
function noise(b, { t = 0, d = 0.1, g = 0.3, f0 = 800, f1 = f0, q = 1.4, seed = 7 }) {
  const n0 = Math.round(t * SR), len = Math.min(Math.round(d * SR), b.length - n0), r = rng(seed); let lo = 0, bp = 0;
  for (let i = 0; i < len; i++) {
    const k = i / len, fc = f0 * Math.pow(f1 / f0, k), fk = 2 * Math.sin(Math.PI * Math.min(fc, SR / 6.5) / SR), hi = r() - lo - bp / q;
    bp += fk * hi; lo += fk * bp; b[n0 + i] += g * Math.sin(Math.PI * k) ** 1.5 * bp;
  }
}
function reverb(b, wet) {            // small Schroeder room
  if (!wet) return b; const out = new Float32Array(b.length), acc = new Float32Array(b.length);
  for (const [dl, fb] of [[1557, 0.74], [1617, 0.72], [1491, 0.7], [1422, 0.68]]) { const buf = new Float32Array(dl); let p = 0, lp = 0;
    for (let i = 0; i < b.length; i++) { const y = buf[p]; lp = y * 0.6 + lp * 0.4; buf[p] = b[i] + lp * fb; p = (p + 1) % dl; acc[i] += y * 0.25; } }
  for (const dl of [225, 556]) { const buf = new Float32Array(dl); let p = 0;
    for (let i = 0; i < b.length; i++) { const y = buf[p], x = acc[i]; buf[p] = x + y * 0.5; acc[i] = y - x * 0.5; p = (p + 1) % dl; } }
  for (let i = 0; i < b.length; i++) out[i] = b[i] + wet * acc[i];
  return out;
}

/** Sound packs: same melodies, different timbre. */
export const PACKS = {
  warm: { label: 'Warm (soft mallets)', lead: 'mallet', wet: 0.16, shimmer: 0 },
  crystal: { label: 'Crystal (glassy bells)', lead: 'bell', wet: 0.24, shimmer: 0.22 },
};
const lead = (b, P, f, t, d, g) => { tone(b, { f, t, d, g, type: P.lead }); if (P.shimmer) tone(b, { f: f * 2, t, d: d * 0.7, g: g * P.shimmer, type: 'bell' }); };
const N_ = NOTE;

/** name -> { dur (s), level (peak 0..1), loop?, label, when, make(buffer, pack) } */
export const SOUNDS = {
  tap: { dur: 0.12, level: 0.32, label: 'Key tap', when: 'Enter key pressed, button pressed, any small click', make: (b, P) => { noise(b, { d: 0.018, g: 0.5, f0: 3200, f1: 1800 }); tone(b, { f: 1250, f2: 900, d: 0.05, g: 0.35, type: 'blip' }); } },
  send: { dur: 0.5, level: 0.6, label: 'Send', when: 'Prompt sent (Enter / send button)', make: (b, P) => { noise(b, { d: 0.16, g: 0.22, f0: 700, f1: 5200, q: 0.9 }); tone(b, { f: 520, f2: 1046, d: 0.12, g: 0.5, type: 'blip' }); lead(b, P, N_.A5, 0.09, 0.3, 0.4); } },
  'send-soft': { dur: 0.5, level: 0.5, label: 'Send (alt, softer)', when: 'Alternative send sound — quieter, for frequent sends', make: (b, P) => { lead(b, P, N_.D5, 0, 0.22, 0.5); lead(b, P, N_.A5, 0.065, 0.3, 0.5); } },
  receive: { dur: 0.5, level: 0.5, label: 'Message received', when: 'Agent reply arrives / first token', make: (b, P) => { lead(b, P, N_.A5, 0, 0.2, 0.45); lead(b, P, N_.Fs5, 0.07, 0.3, 0.5); } },
  'listen-start': { dur: 0.45, level: 0.5, label: 'Listening on', when: 'Mic opens / wake word detected', make: (b, P) => { tone(b, { f: N_.D5, d: 0.13, g: 0.5, type: 'soft' }); tone(b, { f: N_.A5, t: 0.1, d: 0.2, g: 0.5, type: 'soft' }); lead(b, P, N_.A5, 0.1, 0.2, 0.15); } },
  'listen-stop': { dur: 0.45, level: 0.45, label: 'Listening off', when: 'Mic closes / end of speech detected', make: (b, P) => { tone(b, { f: N_.A5, d: 0.13, g: 0.5, type: 'soft' }); tone(b, { f: N_.D5, t: 0.1, d: 0.22, g: 0.5, type: 'soft' }); } },
  pause: { dur: 0.6, level: 0.5, label: 'Pause', when: 'User pauses the agent / playback', make: (b, P) => { lead(b, P, N_.Fs5, 0, 0.22, 0.5); lead(b, P, N_.D5, 0.14, 0.36, 0.5); } },
  resume: { dur: 0.6, level: 0.5, label: 'Resume', when: 'User resumes after a pause', make: (b, P) => { lead(b, P, N_.D5, 0, 0.22, 0.5); lead(b, P, N_.Fs5, 0.14, 0.36, 0.5); } },
  cancel: { dur: 0.45, level: 0.5, label: 'Cancel', when: 'User cancels / stops the task', make: (b, P) => { tone(b, { f: 440, f2: 208, d: 0.16, g: 0.5, type: 'blip' }); tone(b, { f: 150, f2: 110, t: 0.02, d: 0.2, g: 0.4, type: 'blip' }); noise(b, { d: 0.05, g: 0.12, f0: 1500, f1: 500 }); } },
  done: { dur: 1.3, level: 0.62, label: 'Done', when: 'Task finished — the main "work is done" alert', make: (b, P) => { [N_.D5, N_.Fs5, N_.A5, N_.D6].forEach((f, i) => lead(b, P, f, i * 0.075, i === 3 ? 0.9 : 0.3, i === 3 ? 0.55 : 0.42)); tone(b, { f: N_.D6 * 2, t: 0.225, d: 0.7, g: 0.07, type: 'bell' }); } },
  notify: { dur: 1.1, level: 0.58, label: 'Notification', when: 'Reminder, incoming notification, needs attention', make: (b, P) => { tone(b, { f: N_.A5, d: 0.5, g: 0.5, type: 'bell' }); tone(b, { f: N_.D6, t: 0.13, d: 0.8, g: 0.5, type: 'bell' }); if (P.lead === 'mallet') lead(b, P, N_.D6, 0.13, 0.4, 0.2); } },
  error: { dur: 0.6, level: 0.5, label: 'Error', when: 'Something failed', make: (b, P) => { for (const t of [0, 0.13]) { tone(b, { f: 196, t, d: 0.16, g: 0.5, type: 'mallet' }); tone(b, { f: 208, t, d: 0.16, g: 0.3, type: 'mallet' }); } } },
  confused: { dur: 0.65, level: 0.45, label: 'Confused', when: "Didn't understand — ask the user to repeat", make: (b, P) => { tone(b, { f: 520, f2: 440, d: 0.16, g: 0.5, type: 'soft' }); tone(b, { f: 440, f2: 700, t: 0.14, d: 0.3, g: 0.5, type: 'soft', vib: 0.012 }); } },
  wake: { dur: 1.5, level: 0.6, label: 'Wake / startup', when: 'App launch, agent comes online', make: (b, P) => { [N_.D4, N_.A4, N_.D5, N_.Fs5].forEach((f, i) => tone(b, { f, t: i * 0.11, d: 0.75, g: 0.3, type: 'soft' })); lead(b, P, N_.A5, 0.44, 0.9, 0.4); } },
  sleep: { dur: 1.3, level: 0.45, label: 'Sleep / shutdown', when: 'Agent goes idle, do-not-disturb on, app closing', make: (b, P) => { [N_.Fs5, N_.D5, N_.A4].forEach((f, i) => tone(b, { f, t: i * 0.16, d: 0.6, g: 0.4, type: 'soft' })); } },
  celebrate: { dur: 1.6, level: 0.62, label: 'Celebrate', when: 'Big success, milestone', make: (b, P) => { [N_.D5, N_.Fs5, N_.A5, N_.D6, N_.Fs6].forEach((f, i) => lead(b, P, f, i * 0.07, 0.35, 0.4)); [N_.A6, N_.Fs6, N_.A6].forEach((f, i) => tone(b, { f, t: 0.42 + i * 0.1, d: 0.6, g: 0.16, type: 'bell' })); lead(b, P, N_.D6, 0.42, 0.9, 0.4); } },
  'thinking-loop': { dur: 2.0, level: 0.22, loop: true, dry: true, label: 'Thinking (loop)', when: 'Optional quiet bed while the agent works — loops seamlessly', make: (b, P) => { tone(b, { f: N_.D5, t: 0.0, d: 0.5, g: 0.5, type: 'mallet' }); tone(b, { f: N_.A4, t: 0.5, d: 0.5, g: 0.4, type: 'mallet' }); tone(b, { f: N_.D5, t: 1.0, d: 0.5, g: 0.45, type: 'mallet' }); tone(b, { f: N_.Fs5, t: 1.5, d: 0.45, g: 0.35, type: 'mallet' }); } },
};
export const SOUND_NAMES = Object.keys(SOUNDS);

/** Render one sound to mono Float32 samples at SR. */
export function renderSound(name, pack = 'warm') {
  const s = SOUNDS[name], P = PACKS[pack] || PACKS.warm; if (!s) throw new Error('unknown sound: ' + name);
  let b = new Float32Array(Math.ceil(s.dur * SR)); s.make(b, P); if (!s.dry) b = reverb(b, P.wet);
  let peak = 0; for (const v of b) peak = Math.max(peak, Math.abs(v));
  const g = s.level / (peak || 1), fade = Math.round(0.015 * SR);
  for (let i = 0; i < b.length; i++) b[i] *= g * Math.min(1, (b.length - i) / fade);
  return b;
}
/** Float32 -> 16-bit mono WAV bytes. */
export function encodeWav(samples, sr = SR) {
  const out = new DataView(new ArrayBuffer(44 + samples.length * 2)), w = (o, s) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); out.setUint32(4, 36 + samples.length * 2, true); w(8, 'WAVEfmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true);
  out.setUint32(24, sr, true); out.setUint32(28, sr * 2, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true); w(36, 'data'); out.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) out.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), true);
  return new Uint8Array(out.buffer);
}

/** Browser / Electron-renderer player. No audio files needed: sounds are synthesised on first use and cached.
 *  const sfx = new AegisSounds({ pack: 'warm', volume: 0.6 });  sfx.play('send'); */
export class AegisSounds {
  constructor({ pack = 'warm', volume = 0.6, enabled = true } = {}) { this.pack = pack; this.volume = volume; this.enabled = enabled; this.cache = {}; this.loops = {}; }
  _ctx() { if (!this.ctx) { const C = window.AudioContext || window.webkitAudioContext; this.ctx = new C(); this.out = this.ctx.createGain(); this.out.connect(this.ctx.destination); } if (this.ctx.state === 'suspended') this.ctx.resume(); this.out.gain.value = this.volume; return this.ctx; }
  _buffer(name) { const id = this.pack + '/' + name; if (!this.cache[id]) { const data = renderSound(name, this.pack), buf = this._ctx().createBuffer(1, data.length, SR); buf.getChannelData(0).set(data); this.cache[id] = buf; } return this.cache[id]; }
  /** Play a sound once. opts: { volume (0..1 multiplier), rate (playback speed) } */
  play(name, { volume = 1, rate = 1, loop = false } = {}) {
    if (!this.enabled || !SOUNDS[name]) return null; const ctx = this._ctx(), src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = this._buffer(name); src.playbackRate.value = rate; src.loop = loop; g.gain.value = volume; src.connect(g).connect(this.out); src.start(); return src;
  }
  /** Start / stop a looping bed (e.g. 'thinking-loop'). */
  startLoop(name = 'thinking-loop', opts = {}) { this.stopLoop(name); this.loops[name] = this.play(name, { ...opts, loop: true }); }
  stopLoop(name = 'thinking-loop') { const s = this.loops[name]; if (s) { try { s.stop(); } catch {} delete this.loops[name]; } }
  setPack(pack) { if (PACKS[pack]) this.pack = pack; return this; }
  setVolume(v) { this.volume = v; if (this.out) this.out.gain.value = v; return this; }
  /** Pre-render everything (call after the first user gesture to avoid first-play latency). */
  preload(names = SOUND_NAMES) { names.forEach(n => this._buffer(n)); return this; }
}
