import { aeroScene, labKind } from './aero/scenes.js';
// Scene data is deliberately declarative. No code, links, HTML, or shader source.
const TYPES_2D = new Set(['rect', 'ellipse', 'line', 'arrow', 'poly', 'text']);
const TYPES_3D = new Set(['box', 'sphere', 'cylinder', 'cone', 'capsule', 'torus', 'plate', 'arrow', 'line']);
const PRESETS = new Set(['pcb', 'fan', 'tokenStack']);
const TILE_FORMS=new Set(['block','chip','board','ring','tube','sphere','panel','flow','pin','screen']);
const COLORS = /^#(?:[a-f\d]{3}|[a-f\d]{6})$/i;
export const DEFAULT_COLOR = '#468776';
export function color(value, fallback, allowNone = false) {
  return typeof value === 'string' && (COLORS.test(value) || (allowNone && value === 'none')) ? value : fallback;
}
function number(value, lo, hi, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(hi, Math.max(lo, value)) : fallback;
}
function string(value, length, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, length) : fallback;
}
function vector(value, size, lo, hi, fallback = 0) {
  return Array.from({ length: size }, (_, i) => number(Array.isArray(value) ? value[i] : null, lo, hi, fallback));
}
const list = (v) => Array.isArray(v) ? v : [];

export function validateScene(value, { mode, presets = false } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a scene JSON object.');
  if (value.mode !== '2d' && value.mode !== '3d') throw new Error('Scene mode must be “2d” or “3d”.');
  if (mode && value.mode !== mode) throw new Error(`Expected a ${mode.toUpperCase()} scene.`);
  // Lab exports refer to closed, original exhibits, never to a custom solver obstacle or meshes.
  const exhibit=presets&&labKind(value);
  if(exhibit)return aeroScene(exhibit,value.mode);
  const is3D = value.mode === '3d';
  const items = list(value.items).slice(0, 160).flatMap((v) => {
    if (!v || typeof v !== 'object' || typeof v.type !== 'string') return [];
    const type = v.type;
    const stage=presets&&Number.isInteger(v.step)?{step:number(v.step,0,9)}:{};
    if (is3D) {
      if (presets && PRESETS.has(type)) return [{type,...stage,...(type==='pcb'&&v.variant==='camera'?{variant:'camera'}:{})}];
      if(presets&&type==='tile')return [{type,...stage,form:TILE_FORMS.has(v.form)?v.form:'block',p:vector(v.p,3,-32,32),s:vector(v.s,3,.1,10,1),color:color(v.color,DEFAULT_COLOR),index:number(v.index,0,9),label:string(v.label,22)}];
      if (!TYPES_3D.has(type)) return [];
      const item = { type,...stage,p:vector(v.p,3,-32,32),color:color(v.color,DEFAULT_COLOR) };
      if (type === 'line' || type === 'arrow') {
        if (!Array.isArray(v.to)) return [];
        item.to = vector(v.to, 3, -32, 32);
        item.width = number(v.width, .015, .8, .075);
      } else {
        item.s = vector(v.s, 3, .025, 24, 1);
        if (Array.isArray(v.r)) item.r = vector(v.r, 3, -360, 360);
        if (v.metal != null) item.metal = number(v.metal, 0, 1, 0);
        if (v.opacity != null) item.opacity = number(v.opacity, .12, 1, 1);
        if (type === 'plate') {
          item.points = list(v.points).slice(0, 28).map(pt => vector(pt, 2, -18, 18));
          if (item.points.length < 3) return [];
        }
      }
      return [item];
    }
    if (!TYPES_2D.has(type)) return [];
    const item={type,...stage,x:number(v.x,-500,1400),y:number(v.y,-250,800)};
    if (v.opacity != null) item.opacity = number(v.opacity, .08, 1, 1);
    if (type === 'text') {
      item.text = string(v.text, 160);
      if (!item.text) return [];
      item.fill = color(v.fill, '#263b34');
      item.size = number(v.size, 8, 82, 21);
      item.align = ['start', 'middle', 'end'].includes(v.align) ? v.align : 'start';
      item.weight = number(v.weight, 400, 800, 500);
      if(v.mono===true&&presets)item.mono=true;
      if(v.hand===true&&presets)item.hand=true;
    } else if (type === 'line' || type === 'arrow') {
      item.to = vector(v.to, 2, -500, 1400);
      item.stroke = color(v.stroke, '#587168');
      item.sw = number(v.sw, .5, 20, 2.5);
      if (v.dash) item.dash = true;
    } else {
      item.fill = color(v.fill, '#bed9c5', true);
      if (v.stroke != null) item.stroke = color(v.stroke, 'none', true);
      if (v.sw != null) item.sw = number(v.sw, .5, 20, 2);
      if (type === 'poly') {
        item.points = list(v.points).slice(0, 100).map(pt => vector(pt, 2, -500, 1400));
        if (item.points.length < 2) return [];
      } else {
        item.w = number(v.w, 1, 1500, 120);
        item.h = number(v.h, 1, 800, 70);
        if (type === 'rect') item.radius = number(v.radius, 0, 64, 9);
      }
    }
    return [item];
  });
  if (!items.length) throw new Error('The scene did not contain any supported drawing elements.');
  const labels = list(value.labels).slice(0, 10).flatMap((v) => {
    const text = string(v?.text, 44);
    if (!text || !Array.isArray(v.at)) return [];
    const label = { text, at: vector(v.at, is3D ? 3 : 2, is3D ? -32 : -500, is3D ? 32 : 1400) };
    const detail = string(v.detail, 200);
    if (detail) label.detail = detail;
    if (Array.isArray(v.anchor)) label.anchor = vector(v.anchor, 2, .08, .92, .5);
    return [label];
  });
  const steps=presets?list(value.story?.steps).slice(0,8).flatMap(v=>{const title=string(v?.title,48);return title?[{title,note:string(v?.note,180),focus:Number.isInteger(v?.focus)&&v.focus>=0&&v.focus<labels.length?v.focus:null,...(Array.isArray(v.point)&&v.point.length===(is3D?3:2)&&v.point.every(Number.isFinite)?{point:vector(v.point,is3D?3:2,is3D?-32:-500,is3D?32:1400)}:{})}]:[];}):[];
  return {
    mode: value.mode,
    title: string(value.title, 68, 'Untitled scene'),
    subtitle: string(value.subtitle, 124),
    items, labels,
    ...(steps.length?{story:{steps}}:{}),
    ...(presets&&['asset','schematic'].includes(value.quality)?{quality:value.quality}:{}),
    ...(presets && ['pcb', 'camera', 'fan', 'tokens', 'trace'].includes(value.view) ? { view: value.view } : {}),
  };
}

export function sceneFromText(text, options) {
  let s = String(text).trim();
  if (s.startsWith('```')) s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return validateScene(JSON.parse(s), options);
}
