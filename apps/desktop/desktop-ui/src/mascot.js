/*! aegis-mascot — "Aegi", the Aegis mascot. Framework-free, dependency-free. MIT.
 *  A crew of characters (Aegi + one specialist per job) sharing one face and one engine:
 *  a body + two eyes + a mouth, driven by pure functions of time:
 *  pose = STATES[name].pose(t). The same sampler feeds the live DOM renderer and the
 *  static exporter that writes self-contained animated SVG files. */

// ───────────────────────── maths ─────────────────────────
const TAU = Math.PI * 2, N = 64, BASE = 90, CY = 8;
// the brush "A" from the Aegis logo, used as a chest emblem
const EMBLEM = 'M6 12.3C2.7 12 0.7 9.1 1.3 5.3C1.4 4.8 1.4 4.7 1.6 4C1.7 3.6 1.7 3.6 1.1 3.7C0.8 3.7 0.5 3.8 0.5 3.8C-0.7 4 -4.2 4.5 -6.2 4.7C-6.5 4.8 -6.8 4.8 -6.9 4.8C-7 4.9 -7.2 5.2 -8 6.4C-8.9 7.7 -9.2 8.2 -10.3 10.2C-11.5 12.3 -11.7 12.4 -12.2 12.3C-12.7 12.2 -13.5 11.8 -13.8 11.4C-14 11.2 -13.9 10.6 -13.7 10.1C-13.1 8.9 -12.1 7.2 -11 5.6C-10.8 5.2 -10.8 5.2 -11.1 5.2C-12.2 5.4 -16.8 5.5 -17.2 5.3C-17.5 5.2 -19.2 4 -19.4 3.9C-19.7 3.6 -19.7 3.1 -19.5 2.9C-19.2 2.6 -18.8 2.6 -16.5 2.6C-15.6 2.6 -14.5 2.6 -14.1 2.6C-12.6 2.5 -12.1 2.4 -11.7 2.4C-11.5 2.4 -11 2.4 -10.7 2.3C-9.7 2.3 -8.7 2.2 -8.6 2.1C-8.5 2.1 -8.3 1.9 -8.1 1.5C-7.5 0.7 -7 0.1 -6 -1.2C-5.5 -1.9 -4.4 -3 -3.8 -3.7C-1.3 -6.4 -0.6 -7.1 1.1 -8.6C2.5 -9.8 4.2 -11.1 5.1 -11.7C6.9 -12.8 8.8 -12.5 9.4 -11C9.7 -10.1 9.6 -9 8.9 -7.4C8.8 -7.1 8.6 -6.6 8.4 -6.1C8.2 -5.7 7.9 -5 7.8 -4.6C6.9 -2.6 6.2 -0.5 6.2 -0.4C6.2 -0.3 6.3 -0.3 6.8 -0.4C7 -0.5 7.3 -0.5 7.4 -0.5C7.8 -0.6 8.5 -0.8 8.9 -0.9C9.1 -0.9 9.3 -1 9.4 -1C9.8 -1.1 12.8 -1.9 13.5 -2.1C13.7 -2.2 13.9 -2.2 14.1 -2.3C14.3 -2.3 14.7 -2.4 14.9 -2.5C15.6 -2.7 16.4 -2.9 17.2 -3.1C17.6 -3.1 17.9 -3.1 18.6 -2.8C19.3 -2.5 19.7 -2.2 19.7 -1.7C19.7 -1.1 18.7 -0.4 17.9 -0.4C17.6 -0.4 17.4 -0.3 16.6 -0.1C15.7 0.1 14.1 0.6 13.7 0.7C13.5 0.8 13 0.9 12.6 1C12.2 1.1 11.6 1.3 11.3 1.4C9.7 1.8 8 2.2 7.3 2.4C6.9 2.5 6.4 2.6 6.2 2.6C6 2.7 5.7 2.8 5.5 2.8C5 2.9 5 2.9 4.8 3.5C4.4 4.8 4.3 5.7 4.3 6.7C4.3 8 4.6 8.6 5.4 9.1C6.3 9.7 7.9 9.7 10 9.3C10.3 9.2 11 9 11.5 8.8C12.1 8.6 12.5 8.6 12.7 8.9C12.9 9.1 13 9.4 12.8 9.7C12.7 9.9 11.6 11.3 11.4 11.5C10.7 12.1 7.9 12.5 6 12.3ZM-3.5 1.5C-3.2 1.5 -2.7 1.4 -2.5 1.4C-2.4 1.3 -2.2 1.3 -2 1.3C-1.5 1.2 -0.7 1.1 0 1C0.2 0.9 0.5 0.9 0.6 0.9C1.1 0.8 1.3 0.8 1.5 0.7C1.7 0.7 1.9 0.6 2 0.6C2.7 0.5 2.6 0.5 2.8 0.1C3 -0.5 3.8 -2.8 4 -3.2C4 -3.3 4.2 -3.6 4.3 -3.9C4.6 -4.8 5.5 -6.8 5.9 -7.9C6.4 -9.1 6.4 -9.1 5.8 -8.7C4.4 -7.7 3.1 -6.6 0.6 -4C-0.9 -2.5 -1.2 -2.2 -2.8 -0.3C-3.3 0.1 -4.2 1.4 -4.3 1.5C-4.4 1.6 -4.2 1.6 -3.5 1.5Z';
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const sstep = (t, a, b) => { const x = clamp((t - a) / (b - a)); return x * x * (3 - 2 * x); };
const bump = (t, a, b) => (t <= a || t >= b ? 0 : Math.sin(Math.PI * (t - a) / (b - a)) ** 2);
const S = (t, per, ph = 0) => Math.sin(TAU * (t / per + ph));
const win = (t, a, b, e = 0.15) => sstep(t, a, a + e) * (1 - sstep(t, b - e, b));
const pop = (t, a) => sstep(t, a, a + 0.18) * (1 + 0.28 * bump(t, a + 0.04, a + 0.42));
const num = (v, d) => { const k = 10 ** d; const r = Math.round(v * k) / k; return (r === 0 ? 0 : r).toString(); };
const f1 = v => num(v, 1), f2 = v => num(v, 2), f3 = v => num(v, 3);
const mix = (a, b, k) => (Array.isArray(a) ? a.map((v, i) => v + (b[i] - v) * k) : a + (b - a) * k);

// ───────────────────────── body shapes (radial profiles) ─────────────────────────
function fromOutline(pts) {            // closed polygon -> N radii measured from (0, CY), starting at 12 o'clock
  const out = [];
  for (let k = 0; k < N; k++) {
    const th = k * TAU / N - Math.PI / 2, dx = Math.cos(th), dy = Math.sin(th); let best = 0;
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
      const ex = bx - ax, ey = by - ay, den = dx * ey - dy * ex; if (Math.abs(den) < 1e-9) continue;
      const t = (ax * ey - (ay - CY) * ex) / den, u = (ax * dy - (ay - CY) * dx) / den;
      if (t > 0 && u >= -1e-6 && u <= 1 + 1e-6 && t > best) best = t;
    }
    out.push(best);
  }
  return out;
}
const mirror = right => right.concat(right.slice(1, -1).reverse().map(([x, y]) => [-x, y]));
const range = (n, fn) => Array.from({ length: n + 1 }, (_, i) => fn(i / n));
function spline(pts, n = 16) {       // open Catmull-Rom through the given points (end tangents horizontal, so the mirrored outline stays smooth)
  const P = [[-pts[1][0], pts[1][1]], ...pts, [-pts[pts.length - 2][0], pts[pts.length - 2][1]]], out = [];
  for (let i = 1; i < P.length - 2; i++) for (let k = 0; k < n; k++) { const t = k / n, [a, b, c, d] = [P[i - 1], P[i], P[i + 1], P[i + 2]];
    out.push([0, 1].map(j => 0.5 * (2 * b[j] + (c[j] - a[j]) * t + (2 * a[j] - 5 * b[j] + 4 * c[j] - d[j]) * t * t + (3 * b[j] - a[j] - 3 * c[j] + d[j]) * t ** 3))); }
  out.push(pts[pts.length - 1]); return out;
}
const polar = fn => Array.from({ length: N }, (_, k) => fn(k * TAU / N - Math.PI / 2));
const sup = (a, b, n) => polar(th => 1 / ((Math.abs(Math.cos(th)) / a) ** n + (Math.abs(Math.sin(th)) / b) ** n) ** (1 / n));
export const SHAPES = {
  // Aegi — the original soft gumdrop
  aegi: fromOutline(mirror(spline([[0, -78], [27, -73], [48, -53], [60, -22], [68, 14], [71, 46], [64, 73], [42, 87], [0, 90]]))),
  // Posty (mail) — a plump envelope
  mail: sup(80, 66, 5),
  // Chatty (social) — a speech bubble with its tail at the bottom-left
  social: polar(th => { const d = Math.atan2(Math.sin(th - 2.42), Math.cos(th - 2.42)); return 72 + 30 * Math.exp(-((d / 0.17) ** 2)); }),
  // Filo (files) — a folder with its tab at the top-left
  files: fromOutline([[-74, -62], [-26, -62], [-12, -47], [74, -47], [74, 74], [-74, 74]]),
  // Memo (memory) — a little cloud
  memory: polar(th => 70 - 7 * clamp(0.3 - 1.5 * Math.sin(th)) * Math.cos(6 * th) + 3 * Math.sin(th)),
  // Rig (harness) — a flat-topped hex nut
  harness: fromOutline(Array.from({ length: 6 }, (_, i) => [82 * Math.cos(i * TAU / 6), CY + 82 * Math.sin(i * TAU / 6)])),
  // Guard (security) — a soft badge: rounded top, straight sides, rounded-point base
  security: fromOutline(mirror(range(170, s => { const y = -72 + 162 * s; return [y <= -34 ? 66 * (1 - ((-34 - y) / 38) ** 3.2) ** (1 / 3.2) : y <= 4 ? 66 : 66 * (1 - ((y - 4) / 86) ** 1.7), y]; }))),
  // generic alternates
  leaf: fromOutline(mirror(range(160, s => { const y = -78 + 168 * s; return [y <= -10 ? 66 * (1 - ((-10 - y) / 68) ** 2.6) ** (1 / 2.6) : 66 * (1 - ((y + 10) / 100) ** 1.8), y]; }))),
  orb: polar(() => 76), squircle: sup(74, 74, 4),
  blob: polar(th => 74 + 5 * Math.sin(3 * th + 0.6) + 3.5 * Math.sin(2 * th + 2.1)),
  drop: fromOutline(mirror(range(160, s => { const y = -84 + 172 * s; return [y >= 18 ? Math.sqrt(Math.max(0, 70 * 70 - (y - 18) ** 2)) : 70 * (1 - ((18 - y) / 102) ** 1.9), y]; }))),
};
SHAPES.aegis = SHAPES.aegi;   // v1 name kept as an alias
function bodyPath(r) {                 // closed Catmull-Rom through the N radial points, as cubic Béziers
  const P = r.map((v, k) => { const th = k * TAU / N - Math.PI / 2; return [v * Math.cos(th), CY + v * Math.sin(th)]; });
  let d = `M${f1(P[0][0])} ${f1(P[0][1])}`;
  for (let i = 0; i < N; i++) {
    const p0 = P[(i + N - 1) % N], p1 = P[i], p2 = P[(i + 1) % N], p3 = P[(i + 2) % N];
    d += `C${f1(p1[0] + (p2[0] - p0[0]) / 6)} ${f1(p1[1] + (p2[1] - p0[1]) / 6)} ${f1(p2[0] - (p3[0] - p1[0]) / 6)} ${f1(p2[1] - (p3[1] - p1[1]) / 6)} ${f1(p2[0])} ${f1(p2[1])}`;
  }
  return d + 'Z';
}

// ───────────────────────── face presets ─────────────────────────
// eye  = [x0,y0, cx,cy, x1,y1, strokeWidth, scaleX, scaleY]  (a round-capped quadratic stroke)
const EYE = {
  open: [-0.5, 0, 0, 0, 0.5, 0, 25, 0.82, 1.3], wide: [-0.5, 0, 0, 0, 0.5, 0, 28, 0.9, 1.38], small: [-0.5, 0, 0, 0, 0.5, 0, 15, 1, 1],
  happy: [-10, 4, 0, -10, 10, 4, 8, 1, 1], sleep: [-10, -2, 0, 7, 10, -2, 7, 1, 1], flat: [-10, 0, 0, 0, 10, 0, 7, 1, 1],
  gt: [-7, -9, 9, 0, -7, 9, 7, 1, 1], lt: [7, -9, -9, 0, 7, 9, 7, 1, 1],
};
const eye = (preset, blink = 0, ky = 1) => { const e = preset.slice(); e[8] *= ky * (1 - 0.9 * blink); return e; };
// mouth = [x0,y0, cx,cy, x1,y1, strokeWidth]
const MOUTH = { smile: [-9, 0, 0, 8, 9, 0, 5], flat: [-7, 2, 0, 2, 7, 2, 5], frown: [-9, 5, 0, -3, 9, 5, 5], oh: [-0.5, 3, 0, 3, 0.5, 3, 15], grin: [-12, -1, 0, 13, 12, -1, 6], hmm: [-8, 4, -1, -1, 8, 0, 5], tiny: [-0.5, 3, 0, 3, 0.5, 3, 8] };

// props = [opacity, x, y, scale, rotation]
const PROP_HOME = { rip0: [0, 8], rip1: [0, 8], ring: [0, 8], q: [60, -80], d0: [44, -84], d1: [63, -95], d2: [86, -102], lens: [40, 34], badge: [62, -64], z0: [56, -70], z1: [56, -70], sp0: [-80, -74], sp1: [86, -30], sp2: [-92, 6], arrow: [0, -90],
  env: [64, -58], plane: [30, -50], bub0: [60, -70], bub1: [-62, -44], heart: [0, -84], doc0: [70, -20], doc1: [70, 20], bulb: [0, -98], gear: [64, -62], term: [64, -62], scan: [0, 8], lock: [62, -64], warn: [62, -66] };
const PROPS = Object.keys(PROP_HOME), GLYPHS = ['ck', 'cx', 'pz', 'bg'];
const hidden = n => [0, PROP_HOME[n][0], PROP_HOME[n][1], 1, 0];
function defaults(shape) {
  const p = { r: SHAPES[shape] || SHAPES.aegi, tx: 0, ty: 0, rot: 0, sx: 1, sy: 1, gx: 0, gy: 0, eL: EYE.open, eR: EYE.open, m: MOUTH.smile, mo: 1, bl: 0, gl: [0, 0, 0, 0], bars: [8, 8, 8, 8, 8, 8], bo: 0, tc: 1, fx: 0, fy: 0 };
  for (const n of PROPS) p[n] = hidden(n);
  return p;
}
const blinkAt = (t, times, len = 0.17) => Math.max(...times.map(a => bump(t, a, a + len)));
const BADGE = (o, s) => [o, 62, -64, s, 0];

// ───────────────────────── states ─────────────────────────
// Every pose(t) is periodic over `dur` (seconds), so each state loops cleanly on its own.
// `once` states play a single time in the live component, then fall through to `then`.
export const STATES = {
  idle: { dur: 6, poster: 0, label: 'Idle', when: 'Resting, waiting for input', pose: t => {
    const b = blinkAt(t, [0.6, 3.3, 3.62]);
    return { ty: 2.5 * S(t, 3), sy: 1 + 0.012 * S(t, 3, 0.25), sx: 1 - 0.008 * S(t, 3, 0.25), gx: 5 * win(t, 1.2, 2.8, 0.3) - 5 * win(t, 4, 5.4, 0.3), eL: eye(EYE.open, b), eR: eye(EYE.open, b) };
  } },
  hello: { dur: 2.4, poster: 1.2, once: true, then: 'idle', label: 'Hello / wake', when: 'App launch, wake word heard, greeting', pose: t => {
    const j = bump(t, 0.2, 0.8), h = win(t, 0.25, 2.1, 0.2), sq = 0.1 * bump(t, 0, 0.25) + 0.08 * bump(t, 0.72, 1) - 0.06 * j;
    return { ty: -30 * j, sy: 1 - sq, sx: 1 + sq * 0.7, rot: 9 * S(t, 0.45) * win(t, 0.9, 2, 0.2), eL: mix(EYE.open, EYE.happy, h), eR: mix(EYE.open, EYE.happy, h), m: mix(MOUTH.smile, MOUTH.grin, h), bl: h,
      sp0: [win(t, 0.5, 1.9), -80, -74, 0.7 + 0.5 * bump(t, 0.5, 1.3), 90 * t], sp1: [win(t, 0.8, 2.1), 86, -30, 0.5 + 0.5 * bump(t, 0.8, 1.7), -70 * t] };
  } },
  listening: { dur: 2.4, poster: 0.7, label: 'Listening', when: 'Microphone open, user is speaking', pose: t => {
    const b = blinkAt(t, [1.7]), k0 = (t / 2.4) % 1, k1 = (t / 2.4 + 0.5) % 1, ring = k => [0.6 * (1 - k) * sstep(k, 0, 0.12), 0, 8, 0.95 + 0.42 * k, 0];
    return { rot: -4 + 1.5 * S(t, 2.4), gy: -3, ty: 1.5 * S(t, 2.4, 0.3), eL: eye(EYE.wide, b), eR: eye(EYE.wide, b), m: MOUTH.tiny, rip0: ring(k0), rip1: ring(k1) };
  } },
  thinking: { dur: 3, poster: 0.35, label: 'Thinking', when: 'Model is reasoning / generating a plan', pose: t => {
    const b = blinkAt(t, [2.2]), dot = (n, i) => { const u = (((t - i * 0.22) % 1.5) + 1.5) % 1.5, l = bump(u, 0, 0.6); return [0.4 + 0.6 * l, PROP_HOME[n][0], PROP_HOME[n][1] - 7 * l, 1 + 0.2 * l, 0]; };
    return { rot: 5 + 2 * S(t, 3), gx: 7, gy: -9 + S(t, 1.5), ty: 1.5 * S(t, 3, 0.2), eL: eye(EYE.open, b, 0.85), eR: eye(EYE.open, b, 0.85), m: MOUTH.flat, d0: dot('d0', 0), d1: dot('d1', 1), d2: dot('d2', 2) };
  } },
  searching: { dur: 3.2, poster: 0.8, label: 'Searching', when: 'Web / file / memory search, tool lookups', pose: t => {
    const sw = S(t, 3.2), b = blinkAt(t, [2.5]);
    return { gx: 9 * sw, gy: 4 + 2 * S(t, 1.6), rot: 4 * sw, tx: 3 * sw, eL: eye(EYE.open, b, 0.8), eR: eye(EYE.wide, b), m: MOUTH.tiny, lens: [1, 14 + 38 * sw, 34 + 9 * S(t, 1.6, 0.25), 1, -12 + 10 * sw] };
  } },
  working: { dur: 1.6, poster: 0.3, label: 'Working / loading', when: 'Long task running, tool executing, loading', pose: t => (
    { shape: 'orb', sx: 1 + 0.02 * S(t, 0.8), sy: 1 - 0.02 * S(t, 0.8), gy: 4 + 1.5 * S(t, 0.8), eL: eye(EYE.open, 0, 0.5), eR: eye(EYE.open, 0, 0.5), m: MOUTH.flat, ring: [1, 0, 8, 1, 360 * t / 1.6] }) },
  speaking: { dur: 1.2, poster: 0.1, label: 'Speaking', when: 'TTS audio is playing', pose: t => {
    const a = (0.5 + 0.5 * S(t, 0.4)) * (0.65 + 0.35 * S(t, 1.2, 0.2)), b = blinkAt(t, [0.85]);
    return { sy: 1 + 0.015 * S(t, 0.4), gy: -1, eL: eye(EYE.open, b), eR: eye(EYE.open, b), m: mix(MOUTH.smile, MOUTH.oh, a), bo: 1, bars: [0, 1, 2, 3, 4, 5].map(i => 9 + 20 * Math.abs(S(t, 0.6, [0.1, 0.32, 0.5, 0.05, 0.27, 0.45][i]))) };
  } },
  sending: { dur: 1.6, poster: 0.62, once: true, then: 'thinking', label: 'Sending', when: 'Prompt submitted (Enter / send button)', pose: t => {
    const c = bump(t, 0, 0.35), l = bump(t, 0.25, 0.8), k = sstep(t, 0.3, 1), o = win(t, 0.25, 1.3, 0.2);
    return { sy: 1 - 0.14 * c + 0.12 * l, sx: 1 + 0.1 * c - 0.07 * l, ty: -16 * l, gy: -8 * o, eL: mix(EYE.open, EYE.wide, o), eR: mix(EYE.open, EYE.wide, o), m: mix(MOUTH.smile, MOUTH.oh, l), arrow: [win(t, 0.3, 1.05, 0.12), 0, -98 - 16 * k, 1, 0] };
  } },
  paused: { dur: 3, poster: 0, label: 'Paused', when: 'User paused the agent / playback', pose: t => (
    { ty: 1.5 * S(t, 3), eL: eye(EYE.open, 0, 0.38), eR: eye(EYE.open, 0, 0.38), m: MOUTH.flat, badge: BADGE(1, 1 + 0.05 * S(t, 1.5)), gl: [0, 0, 1, 0] }) },
  cancelled: { dur: 1.8, poster: 0.7, once: true, then: 'idle', label: 'Cancelled', when: 'User cancelled / task aborted', pose: t => {
    const sh = S(t, 0.3) * win(t, 0.1, 1.3, 0.25), c = win(t, 0.05, 1.5, 0.15), o = win(t, 0.15, 1.6, 0.15);
    return { tx: 7 * sh, rot: -3 * sh, sy: 1 - 0.05 * c, eL: mix(EYE.open, EYE.flat, c), eR: mix(EYE.open, EYE.flat, c), m: mix(MOUTH.smile, MOUTH.frown, c), badge: BADGE(o, pop(t, 0.15)), gl: [0, 1, 0, 0] };
  } },
  done: { dur: 2.4, poster: 1.1, once: true, then: 'idle', label: 'Done / success', when: 'Task finished successfully', pose: t => {
    const j = bump(t, 0.1, 0.6), h = win(t, 0.15, 2.1, 0.2), sq = 0.09 * bump(t, 0, 0.18) + 0.07 * bump(t, 0.55, 0.85) - 0.05 * j, o = win(t, 0.35, 2.15, 0.15);
    return { ty: -22 * j, sy: 1 - sq, sx: 1 + 0.7 * sq, eL: mix(EYE.open, EYE.happy, h), eR: mix(EYE.open, EYE.happy, h), m: mix(MOUTH.smile, MOUTH.grin, h), bl: h, badge: BADGE(o, pop(t, 0.35)), gl: [1, 0, 0, 0],
      sp0: [win(t, 0.5, 1.8), -80, -74, 0.6 + 0.5 * bump(t, 0.5, 1.4), 80 * t], sp2: [win(t, 0.8, 2), -92, 6, 0.4 + 0.4 * bump(t, 0.8, 1.7), -60 * t] };
  } },
  notification: { dur: 2.2, poster: 0.5, label: 'Notification', when: 'New message, reminder, something needs attention', pose: t => {
    const hop = bump(t, 0.05, 0.45) + 0.6 * bump(t, 0.5, 0.8), o = win(t, 0.1, 1.8, 0.3), k = clamp((t - 0.15) / 1.2), b = blinkAt(t, [1.9]);
    return { ty: -10 * hop, rot: 5 * o, gx: 6 * o, gy: -6 * o, eL: eye(mix(EYE.open, EYE.wide, o), b), eR: eye(mix(EYE.open, EYE.wide, o), b), m: mix(MOUTH.smile, MOUTH.tiny, o),
      badge: BADGE(1, 1 + 0.2 * bump(t, 0.1, 0.5) + 0.1 * bump(t, 0.55, 0.85)), gl: [0, 0, 0, 1], rip0: [0.7 * (1 - k) * sstep(t, 0.15, 0.25), 62, -64, 0.28 + 0.36 * k, 0] };
  } },
  confused: { dur: 3, poster: 0.75, label: 'Confused', when: "Didn't understand, low confidence, needs clarification", pose: t => {
    const b = blinkAt(t, [1.9]), big = EYE.wide, sm = EYE.small;
    return { wob: 0.3 * (0.5 + 0.5 * S(t, 3)), rot: 8 * S(t, 3), tx: 2 * S(t, 3), gx: 3 * S(t, 1.5), gy: -3, eL: eye(big, b), eR: eye(sm, b), m: MOUTH.hmm,
      q: [1, 60 + 3 * S(t, 1.5), -80 - 4 * S(t, 3, 0.25), 1 + 0.06 * S(t, 1), 10 * S(t, 1.5)] };
  } },
  error: { dur: 2, poster: 0.3, label: 'Error', when: 'Something failed (network, tool, permission)', pose: t => {
    const sh = S(t, 0.125) * win(t, 0.05, 0.65, 0.12);
    return { tx: 6 * sh, ty: 1.5 * S(t, 2), sy: 0.97, eL: EYE.gt, eR: EYE.lt, m: MOUTH.frown, badge: BADGE(1, 1 + 0.07 * S(t, 1)), gl: [0, 1, 0, 0] };
  } },
  sleeping: { dur: 4, poster: 1.4, label: 'Sleeping', when: 'Idle for a long time, do-not-disturb, mic muted', pose: t => {
    const br = S(t, 4), z = (ph, sc) => { const k = (t / 4 + ph) % 1; return [sstep(k, 0, 0.15) * (1 - sstep(k, 0.7, 1)), 52 + 20 * k, -64 - 40 * k, sc * (0.7 + 0.5 * k), -10 + 20 * k]; };
    return { sy: 0.9 + 0.03 * br, sx: 1.04 - 0.015 * br, ty: 6, rot: -3, eL: EYE.sleep, eR: EYE.sleep, m: [-0.5, 3, 0, 3, 0.5, 3, 7 + 2 * br], z0: z(0, 1), z1: z(0.5, 0.75) };
  } },
  celebrate: { dur: 1.6, poster: 0.4, label: 'Celebrate', when: 'Big win, streak, onboarding complete', pose: t => {
    const h = Math.abs(S(t, 1.6)), tw = (ph) => 0.5 + 0.5 * S(t, 0.8, ph);
    return { ty: -18 * h, sy: 0.95 + 0.1 * h, sx: 1.04 - 0.07 * h, rot: 6 * S(t, 1.6), eL: EYE.happy, eR: EYE.happy, m: MOUTH.grin, bl: 1,
      sp0: [0.4 + 0.6 * tw(0), -80, -74, 0.6 + 0.5 * tw(0), 45 * S(t, 1.6)], sp1: [0.4 + 0.6 * tw(0.33), 86, -30, 0.5 + 0.5 * tw(0.33), -45 * S(t, 1.6)], sp2: [0.4 + 0.6 * tw(0.66), -92, 6, 0.4 + 0.45 * tw(0.66), 30 * S(t, 0.8)] };
  } },
  // ───── Posty (mail) ─────
  'mail-incoming': { for: 'mail', dur: 2.4, poster: 1.1, label: 'New mail', when: 'A new email arrived', pose: t => {
    const k = sstep(t, 0.1, 0.6), o = win(t, 0.1, 2.25, 0.15), look = win(t, 0.2, 2.0, 0.25), b = blinkAt(t, [1.7]);
    return { ty: -9 * bump(t, 0.55, 0.95), gx: 6 * look, gy: -6 * look, eL: eye(mix(EYE.open, EYE.wide, look), b), eR: eye(mix(EYE.open, EYE.wide, look), b), m: mix(MOUTH.smile, MOUTH.oh, bump(t, 0.5, 1.2)),
      env: [o, 64, -104 + 46 * k - 8 * bump(t, 0.6, 0.95), 1, -14 + 14 * k + 6 * S(t, 0.6) * win(t, 0.7, 2, 0.2)] };
  } },
  'mail-sending': { for: 'mail', dur: 2, poster: 0.75, label: 'Sending mail', when: 'An email is being sent', pose: t => {
    const c = bump(t, 0, 0.4), l = bump(t, 0.3, 0.9), k = sstep(t, 0.35, 1.25), o = win(t, 0.3, 1.5, 0.2);
    return { sy: 1 - 0.1 * c + 0.07 * l, sx: 1 + 0.07 * c - 0.04 * l, ty: -8 * l, rot: 3 * o, gx: 6 * o, gy: -7 * o, eL: mix(EYE.open, EYE.wide, o), eR: mix(EYE.open, EYE.wide, o), m: mix(MOUTH.smile, MOUTH.oh, l),
      plane: [win(t, 0.3, 1.3, 0.12), 34 + 72 * k, -52 - 56 * k, 1 - 0.3 * k, -6] };
  } },
  'mail-reading': { for: 'mail', dur: 3, poster: 0.6, label: 'Reading mail', when: 'Reading, summarising or sorting the inbox', pose: t => {
    const scan = 1 - 2 * Math.abs(((t / 1.5) % 1) - 0.5) * 2, b = blinkAt(t, [2.4]);
    return { gx: 4 + 5 * scan, gy: 6, rot: 2 * S(t, 3), eL: eye(EYE.open, b, 0.8), eR: eye(EYE.open, b, 0.8), m: MOUTH.tiny, doc0: [1, 70, 34 + 3 * S(t, 3), 1.05, 8 + 2 * S(t, 1.5)] };
  } },
  // ───── Chatty (WhatsApp & socials) ─────
  'social-typing': { for: 'social', dur: 1.8, poster: 0.3, label: 'Typing a reply', when: 'Drafting a chat or social reply', pose: t => {
    const dot = i => { const l = bump((((t - i * 0.18) % 0.9) + 0.9) % 0.9, 0, 0.45); return [1, 46 + i * 14, -73 - 5 * l, 4.2 / [5, 6.5, 8][i], 0]; };
    return { rot: 3 * S(t, 1.8), gx: 5, gy: -5, eL: eye(EYE.open, blinkAt(t, [1.3])), eR: eye(EYE.open, blinkAt(t, [1.3])), bub0: [1, 60, -72, 1.25 + 0.04 * S(t, 0.9), 0], d0: dot(0), d1: dot(1), d2: dot(2) };
  } },
  'social-message': { for: 'social', dur: 2.6, poster: 1.4, label: 'New message', when: 'New WhatsApp / DM / mention', pose: t => {
    const a = win(t, 0.2, 2.3, 0.15), c = win(t, 0.9, 2.4, 0.15);
    return { ty: -7 * bump(t, 0.2, 0.55) - 6 * bump(t, 0.9, 1.25), gx: 6 * win(t, 0.2, 0.9, 0.2) - 6 * win(t, 0.9, 1.9, 0.2), gy: -4 * a, eL: mix(EYE.open, EYE.wide, a), eR: mix(EYE.open, EYE.wide, a), m: mix(MOUTH.smile, MOUTH.grin, c),
      bub0: [a, 62, -68, pop(t, 0.2), 0], bub1: [c, -64, -46, pop(t, 0.9) * 0.9, 0] };
  } },
  'social-react': { for: 'social', dur: 2, poster: 0.9, label: 'Reacting', when: 'Liking, reacting, posting', pose: t => {
    const h = win(t, 0.15, 1.8, 0.2), k = sstep(t, 0.3, 1.6);
    return { ty: -12 * bump(t, 0.15, 0.6), rot: 5 * S(t, 0.5) * win(t, 0.6, 1.7, 0.2), eL: mix(EYE.open, EYE.happy, h), eR: mix(EYE.open, EYE.happy, h), m: mix(MOUTH.smile, MOUTH.grin, h), bl: 1,
      heart: [win(t, 0.3, 1.75, 0.15), 6 * S(t, 0.8), -80 - 24 * k, pop(t, 0.3) * (1 + 0.12 * S(t, 0.4)), 8 * S(t, 0.8)] };
  } },
  // ───── Filo (files) ─────
  'files-organizing': { for: 'files', dur: 2.4, poster: 0.3, label: 'Organising files', when: 'Moving, renaming, sorting files', pose: t => {
    const w = S(t, 2.4), b = blinkAt(t, [1.9]);
    return { gx: 7, gy: 3 * w, rot: 2 * w, eL: eye(EYE.open, b, 0.85), eR: eye(EYE.open, b, 0.85), m: MOUTH.tiny,
      doc0: [1, 84 + 7 * S(t, 2.4, 0.25), -4 + 30 * w, 0.95, 8 * w], doc1: [1, 84 - 7 * S(t, 2.4, 0.25), -4 - 30 * w, 0.95, -8 * w] };
  } },
  'files-upload': { for: 'files', dur: 1.8, poster: 0.7, label: 'Uploading / saving', when: 'Uploading, saving, exporting a file', pose: t => {
    const c = bump(t, 0, 0.35), l = bump(t, 0.25, 0.85), k = sstep(t, 0.3, 1.1), o = win(t, 0.25, 1.4, 0.2);
    return { sy: 1 - 0.1 * c + 0.08 * l, sx: 1 + 0.07 * c - 0.05 * l, ty: -10 * l, gy: -8 * o, eL: mix(EYE.open, EYE.wide, o), eR: mix(EYE.open, EYE.wide, o), m: mix(MOUTH.smile, MOUTH.oh, l),
      doc0: [win(t, 0.3, 1.15, 0.12), 0, -86 - 22 * k, 0.9, 0], arrow: [win(t, 0.45, 1.2, 0.12) * 0.9, 34, -92 - 14 * k, 0.75, 0] };
  } },
  'files-found': { for: 'files', dur: 2.2, poster: 1, label: 'File found', when: 'The file or document was found / opened', pose: t => {
    const h = win(t, 0.2, 1.95, 0.2);
    return { ty: -12 * bump(t, 0.15, 0.6), gx: 6 * h, gy: -6 * h, eL: mix(EYE.open, EYE.happy, h), eR: mix(EYE.open, EYE.happy, h), m: mix(MOUTH.smile, MOUTH.grin, h), bl: h,
      doc0: [win(t, 0.25, 2, 0.15), 64, -68, pop(t, 0.25) * 1.1, 10 + 5 * S(t, 0.9)], sp2: [win(t, 0.6, 1.8), -84, -40, 0.5 + 0.4 * bump(t, 0.6, 1.5), 70 * t] };
  } },
  // ───── Memo (memory) ─────
  'memory-saving': { for: 'memory', dur: 2.4, poster: 0.55, label: 'Remembering', when: 'Saving a fact or preference to memory', pose: t => {
    const k = sstep(t, 0.2, 0.85), ab = bump(t, 0.8, 1.3), h = win(t, 0.85, 2.1, 0.2);
    return { gy: -7 * win(t, 0.1, 0.85, 0.2), sy: 1 + 0.06 * ab, sx: 1 - 0.03 * ab, eL: mix(EYE.open, EYE.happy, h), eR: mix(EYE.open, EYE.happy, h), bl: h,
      d1: [win(t, 0.15, 0.9, 0.08), 0, -116 + 54 * k, 1 - 0.4 * k, 0], rip0: [0.5 * (1 - sstep(t, 0.85, 1.6)) * sstep(t, 0.85, 0.95), 0, -40, 0.15 + 0.4 * sstep(t, 0.85, 1.6), 0], sp0: [win(t, 1, 2), -78, -66, 0.5 + 0.4 * bump(t, 1, 1.8), 60 * t] };
  } },
  'memory-recalling': { for: 'memory', dur: 2.6, poster: 1.4, label: 'Recalling', when: 'Looking something up in memory, "I remember…"', pose: t => {
    const th = win(t, 0, 0.7, 0.15), h = win(t, 0.7, 2.3, 0.2);
    return { gx: 5 * th, gy: -8 * th, rot: 3 * th, ty: -10 * bump(t, 0.65, 1.05), eL: mix(eye(EYE.open, 0, 1 - 0.15 * th), EYE.happy, h), eR: mix(eye(EYE.open, 0, 1 - 0.15 * th), EYE.happy, h), m: mix(mix(MOUTH.smile, MOUTH.flat, th), MOUTH.grin, h),
      bulb: [win(t, 0.65, 2.35, 0.15), 0, -100, pop(t, 0.65), 5 * S(t, 0.8)] };
  } },
  'memory-linking': { for: 'memory', dur: 3, poster: 0.4, label: 'Connecting memories', when: 'Building context, linking notes and past conversations', pose: t => {
    const node = i => { const a = TAU * (t / 3 + i / 3); return [1, 98 * Math.cos(a), 8 + 98 * Math.sin(a), [1.2, 0.85, 0.6][i], 0]; }, a0 = TAU * t / 3;
    return { gx: 6 * Math.cos(a0), gy: 4 * Math.sin(a0), eL: eye(EYE.open, blinkAt(t, [2.1])), eR: eye(EYE.open, blinkAt(t, [2.1])), rip0: [0.22, 0, 8, 1.225, 0], d0: node(0), d1: node(1), d2: node(2) };
  } },
  // ───── Rig (harness) ─────
  'harness-running': { for: 'harness', dur: 1.6, poster: 0.2, label: 'Running tools', when: 'A tool call / command / pipeline step is running', pose: t => (
    { tx: 0.8 * S(t, 0.1), gx: 5, gy: -4, eL: eye(EYE.open, 0, 0.6), eR: eye(EYE.open, 0, 0.6), m: MOUTH.flat, gear: [1, 66, -62, 1.15, 360 * t / 1.6] }) },
  'harness-testing': { for: 'harness', dur: 2.8, poster: 2, label: 'Running checks', when: 'Tests, evals or validations are running', pose: t => {
    const lamp = i => [0.25 + 0.75 * win(t, 0.3 + i * 0.45, 2.6, 0.12), -22 + i * 22, -100, 5.5 / [5, 6.5, 8][i], 0], ok = win(t, 1.75, 2.6, 0.12);
    return { gy: -6 * win(t, 0.2, 1.7, 0.2), eL: mix(eye(EYE.open, 0, 0.8), EYE.happy, ok), eR: mix(eye(EYE.open, 0, 0.8), EYE.happy, ok), m: mix(MOUTH.flat, MOUTH.grin, ok), ty: -8 * bump(t, 1.7, 2.1),
      d0: lamp(0), d1: lamp(1), d2: lamp(2), badge: [ok, 66, -56, pop(t, 1.75), 0], gl: [1, 0, 0, 0] };
  } },
  'harness-building': { for: 'harness', dur: 2, poster: 0.3, label: 'Building', when: 'Writing code, scaffolding, deploying', pose: t => (
    { ty: 1.6 * Math.abs(S(t, 0.25)), gx: 6, gy: -5, rot: 2, eL: eye(EYE.open, blinkAt(t, [1.5]), 0.8), eR: eye(EYE.open, blinkAt(t, [1.5]), 0.8), m: MOUTH.tiny, term: [1, 64, -64 + 2 * S(t, 2), 1, -4 + 2 * S(t, 1)], tc: 0.5 + 0.5 * Math.sign(S(t, 0.5)) }) },
  // ───── Guard (security) ─────
  'security-scanning': { for: 'security', dur: 2.4, poster: 0.45, label: 'Scanning', when: 'Checking permissions, scanning a file / link / request', pose: t => {
    const w = S(t, 2.4);
    return { gy: 5 * w, eL: eye(EYE.open, 0, 0.75), eR: eye(EYE.open, 0, 0.75), m: MOUTH.flat, scan: [0.95, 0, 8 + 66 * w, 1, 0] };
  } },
  'security-locked': { for: 'security', dur: 2.2, poster: 1, label: 'Secured', when: 'Verified, encrypted, access locked', pose: t => {
    const h = win(t, 0.35, 1.9, 0.2), k = sstep(t, 0.4, 1.3);
    return { ty: 5 * bump(t, 0.25, 0.6), sy: 1 - 0.04 * bump(t, 0.25, 0.6), eL: mix(EYE.open, EYE.happy, h), eR: mix(EYE.open, EYE.happy, h), m: mix(MOUTH.smile, MOUTH.grin, h),
      lock: [win(t, 0.3, 2, 0.15), 62, -64, pop(t, 0.3) * 1.1, 0], rip0: [0.5 * (1 - k) * sstep(t, 0.4, 0.5), 0, 8, 0.95 + 0.4 * k, 0] };
  } },
  'security-alert': { for: 'security', dur: 1.6, poster: 0.3, label: 'Security alert', when: 'Risky action, suspicious request, permission needed', pose: t => {
    const sh = S(t, 0.2) * win(t, 0.05, 0.7, 0.12);
    return { tx: 4 * sh, gx: 6, gy: -6, eL: EYE.wide, eR: EYE.wide, m: MOUTH.tiny, warn: [1, 62, -66, 1.1 + 0.14 * S(t, 0.8), 6 * sh], rip0: [0.35 * (0.5 + 0.5 * S(t, 0.8)), 0, 8, 1.02 + 0.06 * S(t, 0.8, 0.25), 0] };
  } },
};
export const STATE_NAMES = Object.keys(STATES);
/** The 16 states every character can play. */
export const COMMON_STATES = STATE_NAMES.filter(s => !STATES[s].for);

// ───────────────────────── the crew ─────────────────────────
// palette: body / detail (tone-on-tone body details) / eye / accent (props) / onAccent / blush / bright (used on dark) / pop (one small highlight colour)
export const CHARACTERS = {
  aegi: { name: 'Aegi', role: 'Lead assistant', mood: 'calm, breathes and glances around', job: 'Talks to you, plans, and hands work to the specialists', shape: 'aegi', morph: true, face: [0, 0],
    palette: { body: '#BA5B45', detail: '#9E4735', eye: '#FBF8F4', accent: '#1F2224', onAccent: '#FBF8F4', blush: '#F3A791', bright: '#D9755C', pop: '#FFC857' } },
  mail: { name: 'Posty', role: 'Mail', job: 'Reads, drafts, sends and sorts email', shape: 'mail', face: [0, 26], mood: 'eager, does a little hop',
    life: t => ({ ty: -9 * bump(t, 2.0, 2.45) - 5 * bump(t, 2.45, 2.8), sy: 1 - 0.05 * bump(t, 1.85, 2.05) + 0.03 * bump(t, 2.0, 2.45), gy: -3 * win(t, 4, 5.3, 0.3) }),
    palette: { body: '#3F6FE0', detail: '#2C55BE', eye: '#FBF8F4', accent: '#1B2440', onAccent: '#FBF8F4', blush: '#8FB0F7', bright: '#6C93F2', pop: '#FFC857' } },
  social: { name: 'Chatty', role: 'WhatsApp & socials', job: 'Handles chats, DMs, mentions and posts', shape: 'social', face: [0, 0], base: { bl: 0.7 }, mood: 'bubbly, sways and smiles',
    life: t => ({ rot: 4 * S(t, 3), ty: 2 * S(t, 1.5), m: mix(MOUTH.smile, MOUTH.grin, win(t, 3.6, 5.2, 0.3)) }),
    palette: { body: '#22A56A', detail: '#178553', eye: '#FBF8F4', accent: '#12301F', onAccent: '#FBF8F4', blush: '#8FE0B8', bright: '#3CC987', pop: '#FF5C7A' } },
  files: { name: 'Filo', role: 'Files', job: 'Finds, organises, uploads and converts files', shape: 'files', face: [0, 18], mood: 'tidy, steady, peeks sideways',
    life: t => ({ ty: 1.2 * S(t, 6), sy: 1, sx: 1, gx: 7 * win(t, 1, 2.2, 0.25) - 7 * win(t, 2.4, 3.2, 0.25), rot: 1.5 * win(t, 4.2, 5.4, 0.3) }),
    palette: { body: '#F2A72E', detail: '#D4891A', eye: '#2B2015', accent: '#2B2015', onAccent: '#FFF8EA', blush: '#E8862A', bright: '#F7BC55', pop: '#FFFFFF' } },
  memory: { name: 'Memo', role: 'Memory', job: 'Remembers facts and preferences, recalls context', shape: 'memory', face: [0, 6], mood: 'dreamy, floats and looks up',
    life: t => ({ ty: -5 + 6 * S(t, 6), tx: 3 * S(t, 6, 0.25), gy: -5 * win(t, 1.4, 3, 0.4), gx: 0, sp0: [0.9 * bump(t, 3.6, 5), 78, -62, 0.45 + 0.25 * bump(t, 3.6, 5), 40 * t] }),
    palette: { body: '#7B5BE6', detail: '#6042C8', eye: '#FBF8F4', accent: '#231A45', onAccent: '#FBF8F4', blush: '#BBA9F8', bright: '#9C82F2', pop: '#FFD166' } },
  harness: { name: 'Rig', role: 'Harness', job: 'Runs tools, commands, tests and builds', shape: 'harness', face: [0, 2], mood: 'focused, ticks like a machine',
    life: t => ({ ty: 0, sy: 1, sx: 1, rot: 6 * sstep(t, 2, 2.2) * (1 - sstep(t, 3.6, 3.8)) - 6 * sstep(t, 4.6, 4.8) * (1 - sstep(t, 5.6, 5.8)), m: MOUTH.flat }),
    palette: { body: '#1596A4', detail: '#0E7683', eye: '#FBF8F4', accent: '#0F2A2F', onAccent: '#FBF8F4', blush: '#84D6DF', bright: '#35B9C7', pop: '#FFB703' } },
  security: { name: 'Guard', role: 'Security', job: 'Checks permissions, scans, locks and warns', shape: 'security', face: [0, -4], mood: 'watchful, stands firm, eyes sweep left and right',
    life: t => ({ ty: 0.8 * S(t, 6), sy: 1, sx: 1, gx: 8 * S(t, 6), m: MOUTH.flat }),
    palette: { body: '#33427F', detail: '#8FA2EE', eye: '#FBF8F4', accent: '#38D39F', onAccent: '#10261F', blush: '#6B7DCB', bright: '#7F93EA', pop: '#38D39F' } },
};
export const CHARACTER_NAMES = Object.keys(CHARACTERS);
/** States a character can play: the 16 common ones + its own signature states. */
export const statesFor = c => STATE_NAMES.filter(s => !STATES[s].for || STATES[s].for === c);

/** Full pose of `state` at time `t` (seconds). Pure.  who: character id, or { character, shape } */
export function samplePose(state, t, who = 'aegi') {
  const w = typeof who === 'string' ? (CHARACTERS[who] ? { character: who } : { shape: who }) : (who || {}), ch = CHARACTERS[w.character] || CHARACTERS.aegi;
  const st = STATES[state] || STATES.idle, p = defaults(w.shape || ch.shape), o = st.pose(((t % st.dur) + st.dur) % st.dur);
  if (ch.base) Object.assign(p, ch.base);
  const tt = ((t % st.dur) + st.dur) % st.dur; if (state === 'idle' && ch.life) Object.assign(o, ch.life(tt));
  p.fx = ch.face[0]; p.fy = ch.face[1];
  if (o.shape && ch.morph && !w.shape) p.r = SHAPES[o.shape];
  if (o.wob) p.r = mix(p.r, SHAPES.blob, o.wob);
  for (const k in o) if (k !== 'shape' && k !== 'wob' && k in p) p[k] = o[k];
  return p;
}
const lerpPose = (a, b, k) => { const o = {}; for (const key in b) o[key] = mix(a[key], b[key], k); return o; };

// ───────────────────────── themes ─────────────────────────
export const THEMES = {
  terracotta: { label: 'Terracotta (brand)', body: '#BA5B45', eye: '#FBF8F4', accent: '#1F2224', onAccent: '#FBF8F4', blush: '#F3A791' },
  dark: { label: 'Dark', body: '#1F2224', eye: '#FBF8F4', accent: '#D06A51', onAccent: '#FBF8F4', blush: '#D06A51', stroke: '#4A5055', strokeWidth: 3 },
  light: { label: 'Light', body: '#FBF8F4', eye: '#1F2224', accent: '#BA5B45', onAccent: '#FBF8F4', blush: '#F0B4A2', stroke: '#1F2224', strokeWidth: 5 },
  snow: { label: 'Snow (mono, for dark UIs)', body: '#FFFFFF', eye: '#111315', accent: '#FFFFFF', onAccent: '#111315', blush: '#C9CED3', stroke: '#D5DADF', strokeWidth: 3 },
  aurora: { label: 'Aurora (multi)', body: ['#7C5CFF', '#22D3EE', '#34D399'], eye: '#FFFFFF', accent: '#7C5CFF', onAccent: '#FFFFFF', blush: '#C4B5FD' },
  sunset: { label: 'Sunset (multi)', body: ['#FFB347', '#FF5E7E', '#8B5CF6'], eye: '#FFFFFF', accent: '#FF5E7E', onAccent: '#FFFFFF', blush: '#FFD3A6' },
  ocean: { label: 'Ocean (multi)', body: ['#38BDF8', '#2563EB', '#1E1B4B'], eye: '#FFFFFF', accent: '#38BDF8', onAccent: '#0B1220', blush: '#93C5FD' },
  candy: { label: 'Candy (multi)', body: ['#F9A8D4', '#FDE68A', '#A7F3D0'], eye: '#3B2A4A', accent: '#EC4899', onAccent: '#FFFFFF', blush: '#FB7185' },
  neon: { label: 'Neon (dark multi)', body: '#0D0F12', eye: ['#39FF9C', '#22D3EE'], accent: '#FF3DCB', onAccent: '#0D0F12', blush: '#FF3DCB', stroke: ['#39FF9C', '#22D3EE', '#FF3DCB'], strokeWidth: 3.5 },
};
export const THEME_NAMES = Object.keys(THEMES);
/** Every character comes in three variants: 'color' (its own colour), 'dark' and 'light'. Aegi's extra THEMES work on any character too. */
export const VARIANTS = ['color', 'dark', 'light'];
export function characterTheme(character = 'aegi', variant = 'color') {
  const P = (CHARACTERS[character] || CHARACTERS.aegi).palette;
  if (variant === 'dark') return { body: '#1F2224', eye: '#FBF8F4', accent: P.bright, onAccent: '#1F2224', blush: P.bright, stroke: P.bright, strokeWidth: 4, detail: P.bright, pop: P.pop };
  if (variant === 'light') return { body: '#FBF8F4', eye: '#1F2224', accent: P.body, onAccent: '#FBF8F4', blush: P.blush, stroke: P.body, strokeWidth: 5, detail: P.body, pop: P.pop };
  return { body: P.body, eye: P.eye, accent: P.accent, onAccent: P.onAccent, blush: P.blush, detail: P.detail, pop: P.pop };
}
/** Build a custom theme. Any colour may be a string or an array of gradient stops. */
export function createTheme(o = {}, character = 'aegi') { return { ...characterTheme(character, 'color'), label: 'Custom', ...o }; }
export function resolveTheme(t, character = 'aegi') {
  if (t == null || t === 'terracotta' && character !== 'aegi') t = 'color';
  if (typeof t !== 'string') return createTheme(t, character);
  if (VARIANTS.includes(t)) return characterTheme(character, t);
  const T = THEMES[t]; if (!T) return characterTheme(character, 'color');
  return { detail: Array.isArray(T.eye) ? T.eye[0] : T.eye, detailOpacity: 0.35, pop: '#FFC857', ...T };
}

// ───────────────────────── pose -> attributes ─────────────────────────
const quad = v => `M${f1(v[0])} ${f1(v[1])}Q${f1(v[2])} ${f1(v[3])} ${f1(v[4])} ${f1(v[5])}`;
function attrs(p) {
  const A = {}, set = (k, a, v) => { (A[k] || (A[k] = {}))[a] = v; };
  set('bt', '@translate', `${f1(p.tx)} ${f1(p.ty)}`); set('br', '@rotate', `${f2(p.rot)} 0 ${BASE}`); set('bs', '@scale', `${f3(p.sx)} ${f3(p.sy)}`);
  set('body', 'd', bodyPath(p.r)); set('rim', 'd', bodyPath(p.r.map(v => v - 9)));
  set('sh', '@translate', `${f1(p.tx)} 108`); set('shs', '@scale', f3(clamp(1 + p.ty / 70, 0.45, 1.1) * p.sx));
  set('face', '@translate', `${f1(p.gx + (p.fx || 0))} ${f1(p.gy + (p.fy || 0))}`);
  for (const e of ['eL', 'eR']) { const v = p[e]; set(e, 'd', quad(v)); set(e, 'stroke-width', f1(v[6])); set(e + 's', '@scale', `${f3(v[7])} ${f3(v[8])}`); }
  set('m', 'd', quad(p.m)); set('m', 'stroke-width', f1(p.m[6])); set('m', 'opacity', f2(p.mo)); set('bl', 'opacity', f2(p.bl));
  for (const n of PROPS) { const v = p[n]; set(n, 'opacity', f2(v[0])); set(n, '@translate', `${f1(v[1])} ${f1(v[2])}`); set(n + 'r', '@rotate', f1(v[4])); set(n + 's', '@scale', f3(v[3])); }
  GLYPHS.forEach((g, i) => set('g_' + g, 'opacity', f2(p.gl[i])));
  set('tcur', 'opacity', f2(p.tc));
  set('bars', 'opacity', f2(p.bo)); p.bars.forEach((h, i) => { set('b' + i, 'y', f1(CY - h / 2)); set('b' + i, 'height', f1(h)); });
  return A;
}

// ───────────────────────── markup ─────────────────────────
let UID = 0;
function markup(vals, anim, theme, { live = false, size, title = 'Aegis mascot', uid = 'am' + (UID++), emblem = true, rim = false, shadow = true, character = 'aegi' } = {}) {
  const defs = [], paint = (c, id) => {
    if (!Array.isArray(c)) return c;
    defs.push(`<linearGradient id="${uid}${id}" gradientUnits="userSpaceOnUse" x1="-60" y1="-80" x2="60" y2="90">${c.map((s, i) => `<stop offset="${f2(i / (c.length - 1))}" stop-color="${s}"/>`).join('')}</linearGradient>`);
    return `url(#${uid}${id})`;
  };
  const T = theme, det = T.detail || (Array.isArray(T.eye) ? T.eye[0] : T.eye), dO = T.detailOpacity ?? 1, pp = T.pop || '#FFC857', flatBody = Array.isArray(T.body) ? T.body[1] : T.body, body = paint(T.body, 'b'), eyec = paint(T.eye, 'e'), stroke = T.stroke ? paint(T.stroke, 's') : null, acc = T.accent, on = T.onAccent;
  const E = (tag, key, extra = '', inner = '') => {
    let a = ''; const v = vals[key] || {};
    for (const k in v) a += k[0] === '@' ? ` transform="${k.slice(1)}(${v[k]})"` : ` ${k}="${v[k]}"`;
    const kids = inner + ((anim && anim[key]) || '');
    return `<${tag}${live ? ` data-k="${key}"` : ''}${a}${extra ? ' ' + extra : ''}${kids ? `>${kids}</${tag}>` : '/>'}`;
  };
  const prop = (n, content) => E('g', n, '', E('g', n + 'r', '', E('g', n + 's', '', content)));
  const line = `fill="none" stroke-linecap="round" stroke-linejoin="round"`;
  const eyeEl = (k, x) => `<g transform="translate(${x} -17)">${E('g', k + 's', '', E('path', k, `${line} stroke="${eyec}"`))}</g>`;
  const star = 'M0 -15Q2 -2 15 0Q2 2 0 15Q-2 2 -15 0Q-2 -2 0 -15Z';
  const lj = `stroke-linecap="round" stroke-linejoin="round"`;
  const FEATURE = {
    aegi: `<path transform="translate(0 48)" d="${EMBLEM}" fill="${Array.isArray(T.eye) ? T.eye[0] : T.eye}" fill-opacity="${T.emblemOpacity ?? 0.5}" fill-rule="evenodd"/>`,
    mail: `<path d="M-71 -47L0 -13L71 -47" fill="none" stroke="${det}" stroke-opacity="${dO}" stroke-width="7" ${lj}/><circle cy="-13" r="7.5" fill="${pp}"/>`,
    social: `<g transform="translate(52 -50)"><circle r="15" fill="${pp}" stroke="${flatBody}" stroke-width="4"/><path d="M-3 -4L1 -7V7" fill="none" stroke="#fff" stroke-width="4" ${lj}/></g>`,
    files: `<path d="M-72 -26H72" fill="none" stroke="${det}" stroke-opacity="${dO}" stroke-width="6" ${lj}/><rect x="-22" y="50" width="44" height="11" rx="5.5" fill="${det}" fill-opacity="${dO}"/>`,
    memory: `<path transform="translate(0 52) scale(.62)" d="M0 -15Q2 -2 15 0Q2 2 0 15Q-2 2 -15 0Q-2 -2 0 -15Z" fill="${pp}"/><circle cx="-22" cy="50" r="3.5" fill="${pp}" opacity=".8"/><circle cx="22" cy="50" r="3.5" fill="${pp}" opacity=".8"/><path d="M-18 50H-10M10 50H18" stroke="${pp}" stroke-width="2.5" opacity=".7" ${lj}/>`,
    harness: [0, 1, 2, 3, 4, 5].map(i => `<circle cx="${f1(63 * Math.cos(i * TAU / 6))}" cy="${f1(CY + 63 * Math.sin(i * TAU / 6))}" r="5" fill="${det}" fill-opacity="${dO}"/>`).join('') + `<path d="M-13 49L-5 55L-13 61M1 61H14" fill="none" stroke="${pp}" stroke-width="5" ${lj}/>`,
    security: E('path', 'rim', `fill="none" stroke="${det}" stroke-opacity="${0.55 * dO}" stroke-width="4" stroke-linejoin="round"`) + `<circle cy="44" r="8" fill="${pp}"/><path d="M-4.5 48L-7 63H7L4.5 48Z" fill="${pp}" stroke="${pp}" stroke-width="2" stroke-linejoin="round"/>`,
  };
  const paper = (extra = '') => `<path d="M-13 -17H5L13 -9V17H-13Z" fill="${on}" stroke="${acc}" stroke-width="4" ${lj}/><path d="M5 -17V-9H13" fill="none" stroke="${acc}" stroke-width="4" ${lj}/><path d="M-7 -2H7M-7 5H7M-7 12H2" fill="none" stroke="${acc}" stroke-width="3" stroke-opacity=".6" ${lj}/>${extra}`;
  const svg =
    (shadow ? E('g', 'sh', '', E('g', 'shs', '', `<ellipse rx="46" ry="6.5" fill="#000" opacity=".11"/>`)) : '') +
    prop('rip0', `<circle r="80" fill="none" stroke="${acc}" stroke-width="4"/>`) + prop('rip1', `<circle r="80" fill="none" stroke="${acc}" stroke-width="4"/>`) +
    prop('ring', `<path d="M0 -106A106 106 0 0 1 91.8 -53M0 106A106 106 0 0 1 -91.8 53" ${line} stroke="${acc}" stroke-width="7"/>`) +
    E('g', 'bars', `fill="${acc}"`, [-116, -104, -92, 92, 104, 116].map((x, i) => E('rect', 'b' + i, `x="${x - 3.5}" width="7" rx="3.5"`)).join('')) +
    E('g', 'bt', '', E('g', 'br', '', `<g transform="translate(0 ${BASE})">${E('g', 'bs', '', `<g transform="translate(0 -${BASE})">` +
      (emblem && character === 'files' ? `<g transform="rotate(5 30 -40)"><rect x="-4" y="-76" width="62" height="60" rx="7" fill="${pp}" stroke="${det}" stroke-width="3"/><path d="M8 -64H44" ${line} stroke="${det}" stroke-width="4" stroke-opacity=".55"/></g>` : '') +
      E('path', 'body', `fill="${body}"${stroke ? ` stroke="${stroke}" stroke-width="${T.strokeWidth || 3}" stroke-linejoin="round"` : ''}`) +
      (rim ? E('path', 'rim', `fill="none" stroke="${Array.isArray(T.eye) ? T.eye[0] : T.eye}" stroke-opacity="${T.rimOpacity ?? 0.2}" stroke-width="3" stroke-linejoin="round"`) : '') +
      (emblem ? FEATURE[character] || FEATURE.aegi : '') +
      E('g', 'face', '', E('g', 'bl', `fill="${T.blush}"`, `<circle cx="-44" cy="5" r="9"/><circle cx="44" cy="5" r="9"/>`) + eyeEl('eL', -24) + eyeEl('eR', 24) +
        `<g transform="translate(0 11)">${E('path', 'm', `${line} stroke="${eyec}"`)}</g>`) + '</g>')}</g>`)) +
    prop('q', `<path d="M-10 -12C-10 -26 10 -26 10 -12C10 -3 0 -4 0 6" ${line} stroke="${acc}" stroke-width="7.5"/><circle cy="19" r="5" fill="${acc}"/>`) +
    prop('lens', `<circle r="18" fill="${on}" fill-opacity=".28" stroke="${acc}" stroke-width="7"/><path d="M14 14L29 29" ${line} stroke="${acc}" stroke-width="9"/>`) +
    prop('badge', `<circle r="21" fill="${acc}"/>` +
      E('path', 'g_ck', `d="M-9 0L-3 7L10 -7" ${line} stroke="${on}" stroke-width="6"`) + E('path', 'g_cx', `d="M-7 -7L7 7M7 -7L-7 7" ${line} stroke="${on}" stroke-width="6"`) +
      E('path', 'g_pz', `d="M-6 -8V8M6 -8V8" ${line} stroke="${on}" stroke-width="6.5"`) + E('g', 'g_bg', '', `<path d="M0 -10V2" ${line} stroke="${on}" stroke-width="6.5"/><circle cy="10.5" r="3.6" fill="${on}"/>`)) +
    ['z0', 'z1'].map(n => prop(n, `<path d="M-7 -7H7L-7 7H7" ${line} stroke="${acc}" stroke-width="5"/>`)).join('') +
    ['sp0', 'sp1', 'sp2'].map(n => prop(n, `<path d="${star}" fill="${acc}"/>`)).join('') +
    prop('env', `<rect x="-20" y="-14" width="40" height="28" rx="5" fill="${on}" stroke="${acc}" stroke-width="4.5"/><path d="M-18 -11L0 3L18 -11" fill="none" stroke="${acc}" stroke-width="4.5" ${lj}/><circle cx="20" cy="-14" r="7.5" fill="${pp}" stroke="${acc}" stroke-width="2.5"/>`) +
    prop('plane', `<path d="M-20 4L21 -15L8 19L-1 6Z" fill="${on}" stroke="${acc}" stroke-width="4.5" ${lj}/><path d="M-1 6L21 -15" fill="none" stroke="${acc}" stroke-width="4" ${lj}/>`) +
    prop('bub0', `<path d="M-22 -15H22Q30 -15 30 -7V7Q30 15 22 15H-8L-20 25V15H-22Q-30 15 -30 7V-7Q-30 -15 -22 -15Z" fill="${on}" stroke="${acc}" stroke-width="4.5" ${lj}/>`) +
    prop('bub1', `<path d="M-22 -15H22Q30 -15 30 -7V7Q30 15 22 15H20V25L8 15H-22Q-30 15 -30 7V-7Q-30 -15 -22 -15Z" fill="${pp}" stroke="${acc}" stroke-width="4.5" ${lj}/><path d="M-15 -4H15M-15 5H5" fill="none" stroke="#fff" stroke-width="4" ${lj}/>`) +
    prop('heart', `<path d="M0 15C-24 0 -19 -17 -9 -17C-4 -17 0 -13 0 -9C0 -13 4 -17 9 -17C19 -17 24 0 0 15Z" fill="${pp}" stroke="${acc}" stroke-width="4" ${lj}/>`) +
    prop('doc0', paper()) + prop('doc1', paper()) +
    prop('bulb', `<path d="M0 -40V-33M-27 -29L-22 -24M27 -29L22 -24" fill="none" stroke="${pp}" stroke-width="5" ${lj}/><path d="M-9 8C-9 1 -17 -2 -17 -11A17 17 0 0 1 17 -11C17 -2 9 1 9 8Z" fill="${pp}" stroke="${acc}" stroke-width="4.5" ${lj}/><path d="M-7 15H7" fill="none" stroke="${acc}" stroke-width="5" ${lj}/>`) +
    prop('gear', `<path d="${Array.from({ length: 8 }, (_, i) => { const a = i * TAU / 8, P = (r, d) => `${f1(r * Math.cos(a + d))} ${f1(r * Math.sin(a + d))}`; return `${i ? 'L' : 'M'}${P(15, -0.26)}L${P(22, -0.16)}L${P(22, 0.16)}L${P(15, 0.26)}`; }).join('')}Z" fill="${on}" stroke="${acc}" stroke-width="4.5" ${lj}/><circle r="6" fill="${pp}" stroke="${acc}" stroke-width="3.5"/>`) +
    prop('term', `<rect x="-26" y="-19" width="52" height="38" rx="8" fill="${acc}"/><path d="M-15 -7L-7 0L-15 7" fill="none" stroke="${pp}" stroke-width="4.5" ${lj}/>` + E('path', 'tcur', `d="M0 8H12" fill="none" stroke="${on}" stroke-width="4.5" stroke-linecap="round"`)) +
    prop('scan', `<path d="M-88 0H88" stroke="${pp}" stroke-width="12" stroke-linecap="round" opacity=".28"/><path d="M-88 0H88" stroke="${pp}" stroke-width="4.5" stroke-linecap="round"/>`) +
    prop('lock', `<path d="M-9 -4V-11A9 9 0 0 1 9 -11V-4" fill="none" stroke="${acc}" stroke-width="5.5" ${lj}/><rect x="-16" y="-5" width="32" height="25" rx="6" fill="${acc}"/><path d="M0 5V11" stroke="${on}" stroke-width="5" stroke-linecap="round"/>`) +
    prop('warn', `<path d="M0 -19L21 16H-21Z" fill="#FFB020" stroke="#FFB020" stroke-width="9" ${lj}/><path d="M0 -8V4" stroke="#2A1A00" stroke-width="5.5" stroke-linecap="round"/><circle cy="12" r="3.4" fill="#2A1A00"/>`) +
    ['d0', 'd1', 'd2'].map((n, i) => prop(n, `<circle r="${[5, 6.5, 8][i]}" fill="${acc}"/>`)).join('') +
    prop('arrow', `<path d="M0 13V-12M-10 -2L0 -12L10 -2" ${line} stroke="${acc}" stroke-width="7.5"/>`);
  const dim = size ? ` width="${size}" height="${size}"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-128 -128 256 256"${dim} role="img" aria-label="${title}"><title>${title}</title>${defs.length ? `<defs>${defs.join('')}</defs>` : ''}${svg}</svg>`;
}

/** Render a standalone SVG string.
 *  renderSVG({ state, theme, shape, animated: true })  -> looping, self-animating SVG (SMIL, no JS)
 *  renderSVG({ state, theme, shape, animated: false, t }) -> frozen frame at time t (default: the state's poster frame)
 *  character = 'aegi' | 'mail' | 'social' | 'files' | 'memory' | 'harness' | 'security' (sets shape + colours + body details)
 *  theme = 'color' (the character's own colour) | 'dark' | 'light' | any THEMES name | a custom theme object
 *  emblem (default true) = the logo "A" on the chest, shadow (default true) = ground shadow, rim (default false) = an inner outline ring. */
export function renderSVG({ state = 'idle', character = 'aegi', theme = 'color', shape, animated = true, t, size, fps = 20, title, emblem = true, rim = false, shadow = true } = {}) {
  const st = STATES[state] || STATES.idle, T = resolveTheme(theme, character), who = { character, shape }, opt = { size, title: title || `${(CHARACTERS[character] || CHARACTERS.aegi).name} — ${st.label}`, uid: 'a', emblem: emblem && !shape, rim, shadow, character };
  if (!animated) return markup(attrs(samplePose(state, t ?? st.poster, who)), null, T, opt);
  const n = Math.max(2, Math.round(st.dur * fps)), frames = []; for (let i = 0; i <= n; i++) frames.push(attrs(samplePose(state, i === n ? 0 : st.dur * i / n, who)));
  const anim = {}, first = frames[0];
  for (const key in first) for (const a in first[key]) {
    const v = frames.map(f => f[key][a]); if (v.every(x => x === v[0])) continue;
    const keep = v.map((x, i) => i === 0 || i === n || !(v[i - 1] === x && v[i + 1] === x));       // drop redundant samples
    const vals = v.filter((_, i) => keep[i]).join(';'), times = v.map((_, i) => f3(i / n)).filter((_, i) => keep[i]).join(';');
    const common = `values="${vals}" keyTimes="${times}" dur="${st.dur}s" repeatCount="indefinite"`;
    anim[key] = (anim[key] || '') + (a[0] === '@' ? `<animateTransform attributeName="transform" type="${a.slice(1)}" ${common}/>` : `<animate attributeName="${a}" ${common}/>`);
  }
  return markup(first, anim, T, opt);
}

/** Status colours used by tray icons and widgets. */
export const STATUS_COLORS = { idle: null, hello: '#22C55E', listening: '#EF4444', thinking: '#F59E0B', searching: '#F59E0B', working: '#3B82F6', speaking: '#22C55E', sending: '#3B82F6',
  paused: '#9CA3AF', cancelled: '#9CA3AF', done: '#22C55E', notification: '#EF4444', confused: '#F59E0B', error: '#DC2626', sleeping: '#6B7280', celebrate: '#22C55E',
  'mail-incoming': '#EF4444', 'mail-sending': '#3B82F6', 'mail-reading': '#F59E0B', 'social-typing': '#3B82F6', 'social-message': '#EF4444', 'social-react': '#22C55E',
  'files-organizing': '#3B82F6', 'files-upload': '#3B82F6', 'files-found': '#22C55E', 'memory-saving': '#3B82F6', 'memory-recalling': '#22C55E', 'memory-linking': '#F59E0B',
  'harness-running': '#3B82F6', 'harness-testing': '#F59E0B', 'harness-building': '#3B82F6', 'security-scanning': '#F59E0B', 'security-locked': '#22C55E', 'security-alert': '#DC2626' };
/** Simplified square icon for the system tray / taskbar / favicons: body + eyes only, plus a status dot. Readable at 16px. */
export function renderTrayIcon({ state = 'idle', character = 'aegi', theme = 'color', shape, dot = true, size } = {}) {
  const ch = CHARACTERS[character] || CHARACTERS.aegi, T = resolveTheme(theme, character), sh = shape || ch.shape, p = samplePose(state, (STATES[state] || STATES.idle).poster, { character, shape: sh }), flat = c => (Array.isArray(c) ? c[0] : c);
  const grad = Array.isArray(T.body) ? `<defs><linearGradient id="t" gradientUnits="userSpaceOnUse" x1="-60" y1="-80" x2="60" y2="90">${T.body.map((c, i) => `<stop offset="${f2(i / (T.body.length - 1))}" stop-color="${c}"/>`).join('')}</linearGradient></defs>` : '';
  const eyeT = (v, x) => { const e = v.slice(); e[6] = Math.max(e[6] * 1.25, 13); return `<g transform="translate(${x} ${-12 + ch.face[1]}) scale(${f3(Math.min(1.15, v[7] * 1.2))} ${f3(Math.max(0.3, v[8]) * 1.15)})"><path d="${quad(e)}" fill="none" stroke="${flat(T.eye)}" stroke-width="${f1(e[6])}" stroke-linecap="round"/></g>`; };
  const c = dot && STATUS_COLORS[state];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-92 -86 184 184"${size ? ` width="${size}" height="${size}"` : ''}>${grad}<path d="${bodyPath(SHAPES[sh] || SHAPES.aegi)}" fill="${grad ? 'url(#t)' : T.body}"${T.stroke ? ` stroke="${flat(T.stroke)}" stroke-width="${(T.strokeWidth || 3) * 1.6}"` : ''}/>${eyeT(p.eL, -28)}${eyeT(p.eR, 28)}${c ? `<circle cx="58" cy="64" r="30" fill="${c}" stroke="#fff" stroke-width="7"/>` : ''}</svg>`;
}

// ───────────────────────── live component ─────────────────────────
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
export class AegisMascot {
  /** @param target element or selector  @param opts { character, state, theme, shape, size, follow, autoplay, onStateEnd } */
  constructor(target, opts = {}) {
    this.el = typeof target === 'string' ? document.querySelector(target) : target;
    this.o = { state: 'idle', character: 'aegi', theme: 'color', shape: null, size: 160, follow: false, autoplay: true, emblem: true, rim: false, shadow: true, ...opts };
    this.state = this.o.state; this.t0 = now(); this.from = null; this.blendStart = 0; this.gaze = [0, 0]; this.gazeTarget = [0, 0]; this.playing = false;
    this.reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this._tick = this._tick.bind(this); this._move = this._move.bind(this);
    this._mount(); if (this.o.follow) this.follow(true); if (this.o.autoplay) this.play(); else this._draw(this._pose(now()));
  }
  _mount() {
    const p = this.last || samplePose(this.state, 0, this._who());
    this.el.innerHTML = markup(attrs(p), null, resolveTheme(this.o.theme, this.o.character), { live: true, size: this.o.size, character: this.o.character, title: (CHARACTERS[this.o.character] || CHARACTERS.aegi).name, emblem: this.o.emblem && !this.o.shape, rim: this.o.rim, shadow: this.o.shadow });
    this.nodes = {}; this.el.querySelectorAll('[data-k]').forEach(n => { this.nodes[n.dataset.k] = n; }); this.cache = {};
  }
  _who() { return { character: this.o.character, shape: this.o.shape || undefined }; }
  _pose(T) {
    const st = STATES[this.state]; let t = T - this.t0;
    if (st.once && t >= st.dur) { const next = this._then || st.then || 'idle'; this._then = null; this.o.onStateEnd && this.o.onStateEnd(this.state); this.setState(next); return this._pose(T); }
    let p = samplePose(this.state, this.reduced ? st.poster : t, this._who());
    if (this.from) { const k = clamp((T - this.blendStart) / 0.34); if (k >= 1) this.from = null; else p = lerpPose(this.from, p, 1 - (1 - k) ** 3); }
    this.gaze = mix(this.gaze, this.gazeTarget, 0.12); p.gx += this.gaze[0]; p.gy += this.gaze[1];
    return (this.last = p);
  }
  _draw(p) {
    const A = attrs(p);
    for (const key in A) { const node = this.nodes[key]; if (!node) continue;
      for (const a in A[key]) { const id = key + a, v = A[key][a]; if (this.cache[id] === v) continue; this.cache[id] = v;
        if (a[0] === '@') node.setAttribute('transform', `${a.slice(1)}(${v})`); else node.setAttribute(a, v); } }
  }
  _tick() { if (!this.playing) return; this._draw(this._pose(now())); this.raf = requestAnimationFrame(this._tick); }
  _move(e) { const r = this.el.getBoundingClientRect(), dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2), d = Math.hypot(dx, dy) || 1, k = Math.min(1, d / 260); this.gazeTarget = [9 * k * dx / d, 7 * k * dy / d]; }
  /** Morph to another state. `then` overrides what a one-shot state falls back to. */
  setState(name, { then } = {}) { if (!STATES[name]) return this; this.from = this.last || null; this.blendStart = now(); this.state = name; this.t0 = this.blendStart; this._then = then || null; if (!this.playing) this._draw(this._pose(now())); return this; }
  setTheme(theme) { this.o.theme = theme; this._mount(); return this; }
  /** Override the body shape (null = back to the character's own shape). */
  setShape(shape) { if (shape == null || SHAPES[shape]) { this.from = this.last; this.blendStart = now(); this.o.shape = shape || null; this._mount(); } return this; }
  /** Swap to another crew member: the body morphs, colours and details change. Signature states of the old character fall back to idle. */
  setCharacter(character, { theme, state } = {}) {
    if (!CHARACTERS[character]) return this;
    this.from = this.last; this.blendStart = now(); this.o.character = character; this.o.shape = null; if (theme !== undefined) this.o.theme = theme;
    const f = STATES[this.state].for; if (state && STATES[state]) { this.state = state; this.t0 = this.blendStart; } else if (f && f !== character) { this.state = 'idle'; this.t0 = this.blendStart; }
    this._mount(); if (!this.playing) this._draw(this._pose(now())); return this;
  }
  setSize(px) { this.o.size = px; const s = this.el.firstElementChild; if (s) { s.setAttribute('width', px); s.setAttribute('height', px); } return this; }
  follow(on = true) { if (typeof window === 'undefined') return this; window[on ? 'addEventListener' : 'removeEventListener']('pointermove', this._move); if (!on) this.gazeTarget = [0, 0]; return this; }
  play() { if (!this.playing) { this.playing = true; this.raf = requestAnimationFrame(this._tick); } return this; }
  pause() { this.playing = false; cancelAnimationFrame(this.raf); return this; }
  destroy() { this.pause(); this.follow(false); this.el.innerHTML = ''; }
}

/** <aegis-mascot character="mail" state="thinking" theme="dark" shape="aegis" size="120" body="#f00" eye="#fff" accent="#000" follow></aegis-mascot> */
export function defineElement(tag = 'aegis-mascot') {
  if (typeof customElements === 'undefined' || customElements.get(tag)) return;
  customElements.define(tag, class extends HTMLElement {
    static get observedAttributes() { return ['state', 'character', 'theme', 'shape', 'size', 'body', 'eye', 'accent']; }
    _theme() { const c = {}; for (const k of ['body', 'eye', 'accent']) if (this.hasAttribute(k)) c[k] = this.getAttribute(k); const base = this.getAttribute('theme') || 'color'; return Object.keys(c).length ? { ...resolveTheme(base, this.getAttribute('character') || 'aegi'), ...c } : base; }
    connectedCallback() { this.style.display = 'inline-block'; this.mascot = new AegisMascot(this, { state: this.getAttribute('state') || 'idle', character: this.getAttribute('character') || 'aegi', theme: this._theme(), shape: this.getAttribute('shape') || null, size: +this.getAttribute('size') || 160, follow: this.hasAttribute('follow') }); }
    disconnectedCallback() { this.mascot && this.mascot.destroy(); }
    attributeChangedCallback(n, _, v) { const m = this.mascot; if (!m) return; if (n === 'state') m.setState(v); else if (n === 'character') m.setCharacter(v, { theme: this._theme() }); else if (n === 'shape') m.setShape(v); else if (n === 'size') m.setSize(+v); else m.setTheme(this._theme()); }
  });
}
