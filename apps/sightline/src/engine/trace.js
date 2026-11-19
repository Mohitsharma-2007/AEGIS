// A small pixel-to-shape adapter. It models layout, not the meaning of an image.
function downsample(canvas, width, height) {
  const small = document.createElement('canvas');
  small.width = width;
  small.height = height;
  const ctx = small.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(canvas, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height).data;
}
export function fingerprint(canvas) {
  return downsample(canvas, 32, 20);
}
export function difference(a, b) {
  if (!a || !b || a.length !== b.length) return 1;
  let affected = 0;
  for (let i = 0; i < a.length; i += 4) {
    const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
    if (d > 66) affected++;
  }
  return affected / (a.length / 4);
}
const hex = (r, g, b) => '#' + [r, g, b].map(x => Math.round(x).toString(16).padStart(2, '0')).join('');

export function traceFrame(canvas, mode) {
  const W = 38, H = Math.min(28, Math.max(10, Math.round(W * canvas.height / canvas.width)));
  const data = downsample(canvas, W, H);
  const palette = Array.from({length: W * H}, (_, i) => {
    const quant = (v) => Math.min(255, Math.round(v / 44) * 44);
    return hex(quant(data[i * 4]), quant(data[i * 4 + 1]), quant(data[i * 4 + 2]));
  });
  const used = new Uint8Array(W * H), patches = [];
  const same = (x, y, c) => !used[y * W + x] && palette[y * W + x] === c;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (used[i]) continue;
    const c = palette[i];
    let w = 1, h = 1;
    while (x + w < W && same(x + w, y, c)) w++;
    rows: while (y + h < H) {
      for (let k = x; k < x + w; k++) if (!same(k, y + h, c)) break rows;
      h++;
    }
    for (let j = y; j < y + h; j++) used.fill(1, j * W + x, j * W + x + w);
    patches.push({x, y, w, h, c});
  }
  patches.sort((a,b) => b.w*b.h - a.w*a.h);
  const count = new Map();
  for (const c of palette) count.set(c, (count.get(c) || 0) + 1);
  const dominant = [...count].sort((a,b) => b[1]-a[1])[0][0];
  const lum = (c) => (parseInt(c.slice(1,3),16) * .21 + parseInt(c.slice(3,5),16) * .72 + parseInt(c.slice(5,7),16) * .07) / 255;
  const title = mode === '3d' ? 'Screen relief' : 'Screen layout';
  const items = [];
  if (mode === '2d') {
    const cell = Math.min(18, 310 / H);
    const X = 500 - W * cell / 2, Y = 288 - H * cell / 2;
    items.push({type:'rect',x:X-8,y:Y-8,w:W*cell+16,h:H*cell+16,fill:'#f8f8ef',stroke:'#81968b',sw:1.5,radius:10});
    items.push({type:'rect',x:X,y:Y,w:W*cell,h:H*cell,fill:dominant,radius:2});
    for (const r of patches.slice(0, 122)) {
      if (r.c === dominant) continue;
      items.push({type:'rect', x:X+r.x*cell+.25, y:Y+r.y*cell+.25, w:r.w*cell-.5, h:r.h*cell-.5, radius:.5, fill:r.c});
    }
  } else {
    const unit = .27;
    items.push({type:'box',p:[0,-.17,0],s:[W*unit+.32,.30,H*unit+.30],color:'#61786e'});
    items.push({type:'box',p:[0,.012,0],s:[W*unit,.07,H*unit],color:dominant});
    for (const r of patches.slice(0, 94)) {
      if (r.c === dominant) continue;
      const height = .10 + Math.abs(lum(r.c) - lum(dominant)) * .85;
      items.push({type:'box',p:[(r.x+r.w/2-W/2)*unit,height*.50,(r.y+r.h/2-H/2)*unit],s:[r.w*unit-.022,height,r.h*unit-.022],color:r.c});
    }
  }
  return {mode, view:'trace', title, subtitle:'On-device layout trace · colors and geometry only', items, labels:[]};
}
