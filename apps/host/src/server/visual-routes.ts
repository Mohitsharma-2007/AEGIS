import { Hono } from 'hono';
import { z } from 'zod';
import type { PlatformConfig } from './platform-config.js';

/**
 * AEGIS Visual Layer.
 *
 * The desktop shell owns a transparent, always-on-top window. The owner draws
 * a region over any application and asks a question; this route turns that
 * request into a strict scene description the overlay can animate. The model is
 * asked for a compact, diagram-shaped answer rather than prose. A deterministic
 * fallback keeps the layer useful when the provider is slow or unavailable.
 */

const pointSchema = z.array(z.number()).length(2);

const elementSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('box'),
    x: z.number(),
    y: z.number(),
    w: z.number(),
    h: z.number(),
    label: z.string().max(60).default(''),
    sub: z.string().max(120).optional(),
    color: z.string().max(24).optional(),
    depth: z.number().min(0).max(60).optional(),
  }),
  z.object({
    type: z.literal('circle'),
    x: z.number(),
    y: z.number(),
    r: z.number(),
    label: z.string().max(60).optional(),
    color: z.string().max(24).optional(),
  }),
  z.object({
    type: z.literal('arrow'),
    x1: z.number(),
    y1: z.number(),
    x2: z.number(),
    y2: z.number(),
    label: z.string().max(60).optional(),
    color: z.string().max(24).optional(),
    curve: z.number().optional(),
  }),
  z.object({
    type: z.literal('label'),
    x: z.number(),
    y: z.number(),
    text: z.string().max(140),
    color: z.string().max(24).optional(),
  }),
  z.object({
    type: z.literal('flow'),
    points: z.array(pointSchema).min(2).max(14),
    label: z.string().max(60).optional(),
    color: z.string().max(24).optional(),
  }),
]);

const sceneSchema = z.object({
  title: z.string().min(1).max(110),
  summary: z.string().min(1).max(700),
  accent: z.string().max(24).optional(),
  elements: z.array(elementSchema).min(1).max(48),
  steps: z
    .array(
      z.object({
        title: z.string().max(90),
        body: z.string().max(320),
      }),
    )
    .max(6)
    .optional(),
});

export type VisualScene = z.infer<typeof sceneSchema>;

const requestSchema = z.object({
  prompt: z.string().trim().min(1).max(2400),
  strokes: z
    .array(z.object({ points: z.array(pointSchema).max(600) }))
    .max(30)
    .optional(),
  screen: z.string().max(4_000_000).optional(),
});

const SYSTEM = `You are AEGIS Visual Layer, a real-time visual intelligence engine rendered as a transparent overlay on the owner's Windows desktop.
Answer with a diagram, not an essay. Return ONLY valid JSON with this exact shape:
{"title":"...","summary":"...","accent":"#38bdf8","elements":[...],"steps":[{"title":"...","body":"..."}]}

Allowed elements:
{"type":"box","x":0,"y":0,"w":160,"h":90,"label":"COMPRESSOR","sub":"25:1 pressure","color":"#38bdf8","depth":18}
{"type":"circle","x":0,"y":0,"r":70,"label":"COMBUSTOR","color":"#f59e0b"}
{"type":"arrow","x1":0,"y1":0,"x2":200,"y2":0,"label":"compressed air","color":"#38bdf8","curve":18}
{"type":"label","x":0,"y":0,"text":"Mach 3 · 1,020 m/s","color":"#e2e8f0"}
{"type":"flow","points":[[0,0],[200,20],[400,0]],"label":"airflow","color":"#22d3ee"}

Rules:
- Coordinate space is 1000 wide by 700 high, origin top-left. Keep every element inside it.
- Draw the actual mechanism: 6 to 18 elements with boxes for parts, arrows/flows for motion and energy, labels for real numbers, and a short caption per part.
- Use depth on boxes for a subtle 3D/isometric look.
- Place the diagram in the centre/right of the canvas; the owner's drawing is the region of interest.
- Keep labels under 6 words. The summary is 1-3 sentences of real insight (physics, speed, drag, pressure, temperature) and must not invent precise numbers you are unsure about.
- If the owner's drawing or screenshot is unclear, still give the best conceptual diagram for the named subject.
- No markdown, no code fences, no text outside the JSON.`;

function fallbackScene(prompt: string): VisualScene {
  const p = prompt.toLowerCase();
  if (/jet|fighter|aircraft|mach|thrust|afterburner|engine|turbine|compressor/.test(p)) {
    return {
      title: 'Fighter-jet engine · intake to thrust',
      summary:
        'A jet engine accelerates a small mass of air to a very high speed. The inlet slows supersonic air through shock waves, the compressor raises pressure, fuel burns at nearly constant pressure, and the turbine extracts just enough work to drive the compressor before the nozzle accelerates the exhaust. At Mach 3 the airframe is also heated by ram rise and skin friction, so drag and thermal limits matter as much as raw thrust.',
      accent: '#38bdf8',
      elements: [
        { type: 'label', x: 70, y: 92, text: 'AEGIS · PROPULSION EXPLAINER', color: '#7dd3fc' },
        { type: 'flow', points: [[40, 220], [180, 210], [330, 215], [520, 205], [720, 210], [960, 220]], label: 'supersonic airflow', color: '#22d3ee' },
        { type: 'box', x: 70, y: 300, w: 160, h: 130, label: 'INTAKE', sub: 'shock cone · slows air', color: '#38bdf8', depth: 22 },
        { type: 'box', x: 270, y: 290, w: 170, h: 150, label: 'COMPRESSOR', sub: 'pressure ↑ 25:1', color: '#60a5fa', depth: 26 },
        { type: 'box', x: 480, y: 300, w: 160, h: 130, label: 'COMBUSTOR', sub: 'fuel · 2,200 K', color: '#f59e0b', depth: 22 },
        { type: 'box', x: 680, y: 300, w: 140, h: 130, label: 'TURBINE', sub: 'drives compressor', color: '#a78bfa', depth: 20 },
        { type: 'box', x: 850, y: 315, w: 110, h: 100, label: 'NOZZLE', sub: 'accelerates exhaust', color: '#f472b6', depth: 16 },
        { type: 'arrow', x1: 230, y1: 365, x2: 266, y2: 365, color: '#7dd3fc' },
        { type: 'arrow', x1: 440, y1: 365, x2: 476, y2: 365, color: '#7dd3fc' },
        { type: 'arrow', x1: 640, y1: 365, x2: 676, y2: 365, color: '#7dd3fc' },
        { type: 'arrow', x1: 820, y1: 365, x2: 846, y2: 365, color: '#7dd3fc' },
        { type: 'label', x: 80, y: 500, text: 'Mach 3 · ~1,020 m/s', color: '#e2e8f0' },
        { type: 'label', x: 420, y: 500, text: 'drag ∝ v² · heat soak', color: '#fbbf24' },
        { type: 'label', x: 740, y: 500, text: 'thrust ≈ ṁ · (vₑ − v₀)', color: '#4ade80' },
        { type: 'label', x: 70, y: 610, text: 'compression adds pressure · combustion adds heat · nozzle turns heat into speed', color: '#94a3b8' },
      ],
      steps: [
        { title: 'Slow the air', body: 'The inlet and shock cone reduce supersonic flow to subsonic speed, trading kinetic energy for pressure and heat.' },
        { title: 'Compress and burn', body: 'The compressor raises pressure; fuel is added and burned at high temperature while pressure stays roughly constant.' },
        { title: 'Extract and accelerate', body: 'The turbine drives the compressor; the remaining hot gas expands through the nozzle and leaves at high velocity, producing thrust.' },
        { title: 'Mach 3 limits', body: 'Ram rise and skin friction heat the airframe, while drag grows with the square of speed. That is why thermal management and inlet design dominate at Mach 3.' },
      ],
    };
  }
  if (/wind|turbine|blade|drag|rotor|generator|energy/.test(p)) {
    return {
      title: 'Wind turbine · wind to electricity',
      summary:
        'The rotor extracts kinetic energy from moving air. Blade shape turns lift into torque, the shaft spins a generator, and the control system pitches the blades to hold an efficient tip-speed ratio. Drag on the blades and tower is the main loss, and Betz’s limit caps the extractable fraction of the wind’s power at about 59%.',
      accent: '#4ade80',
      elements: [
        { type: 'label', x: 70, y: 92, text: 'AEGIS · ENERGY EXPLAINER', color: '#86efac' },
        { type: 'flow', points: [[30, 230], [170, 225], [310, 235], [450, 225], [620, 235], [950, 225]], label: 'wind · 12 m/s', color: '#22d3ee' },
        { type: 'circle', x: 300, y: 380, r: 120, label: 'ROTOR · 3 blades', color: '#4ade80' },
        { type: 'circle', x: 300, y: 380, r: 18, label: 'HUB', color: '#a7f3d0' },
        { type: 'box', x: 470, y: 340, w: 180, h: 110, label: 'GEARBOX', sub: 'torque ↑ speed', color: '#60a5fa', depth: 18 },
        { type: 'box', x: 700, y: 330, w: 180, h: 130, label: 'GENERATOR', sub: 'mechanical → electrical', color: '#f59e0b', depth: 22 },
        { type: 'arrow', x1: 420, y1: 390, x2: 466, y2: 390, label: 'torque', color: '#4ade80' },
        { type: 'arrow', x1: 650, y1: 390, x2: 696, y2: 390, label: 'shaft', color: '#4ade80' },
        { type: 'flow', points: [[790, 330], [810, 260], [900, 240]], label: 'grid', color: '#fbbf24' },
        { type: 'label', x: 80, y: 520, text: 'lift on blade → torque', color: '#e2e8f0' },
        { type: 'label', x: 430, y: 520, text: 'tip-speed ratio λ ≈ 7', color: '#93c5fd' },
        { type: 'label', x: 700, y: 520, text: 'drag on tower/blades', color: '#fca5a5' },
        { type: 'label', x: 70, y: 620, text: 'Betz limit: at most ~59% of the wind’s kinetic energy can be extracted', color: '#94a3b8' },
      ],
      steps: [
        { title: 'Capture the wind', body: 'Blades are aerofoils. Moving air creates lift and a pressure difference, which produces torque about the hub.' },
        { title: 'Convert torque', body: 'The gearbox trades low-speed, high-torque rotation for the higher speed the generator needs.' },
        { title: 'Make electricity', body: 'The generator converts mechanical rotation into electrical power; the pitch system keeps the rotor at its efficient tip-speed ratio.' },
        { title: 'Losses', body: 'Blade drag, tower drag, gearbox friction and generator losses reduce output. Betz’s limit is the theoretical ceiling.' },
      ],
    };
  }
  return {
    title: 'Visual explanation',
    summary: `A visual breakdown of “${prompt}”. Aegis places the mechanism, its energy flow and the numbers that matter on the layer so the idea can be read while you keep working.`,
    accent: '#38bdf8',
    elements: [
      { type: 'label', x: 70, y: 92, text: 'AEGIS · LIVE EXPLANATION', color: '#7dd3fc' },
      { type: 'box', x: 90, y: 250, w: 220, h: 130, label: 'INPUT', sub: 'what enters the system', color: '#38bdf8', depth: 20 },
      { type: 'box', x: 390, y: 230, w: 240, h: 170, label: 'MECHANISM', sub: 'the process that changes it', color: '#a78bfa', depth: 24 },
      { type: 'box', x: 710, y: 250, w: 200, h: 130, label: 'RESULT', sub: 'the observable outcome', color: '#4ade80', depth: 20 },
      { type: 'arrow', x1: 314, y1: 315, x2: 386, y2: 315, label: 'energy', color: '#7dd3fc' },
      { type: 'arrow', x1: 634, y1: 315, x2: 706, y2: 315, label: 'output', color: '#4ade80' },
      { type: 'flow', points: [[90, 460], [330, 440], [580, 470], [900, 450]], label: 'flow of the explanation', color: '#22d3ee' },
      { type: 'label', x: 70, y: 580, text: 'Draw a region · ask a question · Aegis builds the layer', color: '#94a3b8' },
    ],
    steps: [
      { title: 'Frame it', body: 'Name the system and the boundary you care about.' },
      { title: 'Trace it', body: 'Follow the input, the transformation and the output.' },
      { title: 'Measure it', body: 'Put the numbers that decide the behaviour on the diagram.' },
    ],
  };
}

function parseScene(text: string): VisualScene | null {
  const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = sceneSchema.parse(JSON.parse(trimmed.slice(start, end + 1)));
    return clampScene(parsed);
  } catch {
    return null;
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function clampScene(scene: VisualScene): VisualScene {
  const elements = scene.elements.map((element) => {
    if (element.type === 'box')
      return {
        ...element,
        x: clamp(element.x, 0, 1000),
        y: clamp(element.y, 0, 700),
        w: clamp(element.w, 20, 500),
        h: clamp(element.h, 20, 300),
        depth: element.depth === undefined ? 14 : clamp(element.depth, 0, 40),
      };
    if (element.type === 'circle')
      return {
        ...element,
        x: clamp(element.x, 0, 1000),
        y: clamp(element.y, 0, 700),
        r: clamp(element.r, 8, 220),
      };
    if (element.type === 'arrow')
      return {
        ...element,
        x1: clamp(element.x1, 0, 1000),
        y1: clamp(element.y1, 0, 700),
        x2: clamp(element.x2, 0, 1000),
        y2: clamp(element.y2, 0, 700),
      };
    if (element.type === 'label')
      return {
        ...element,
        x: clamp(element.x, 0, 1000),
        y: clamp(element.y, 0, 700),
      };
    return {
      ...element,
      points: element.points.map(([x, y]) => [clamp(x, 0, 1000), clamp(y, 0, 700)] as [number, number]),
    };
  });
  return { ...scene, elements };
}

async function modelScene(
  config: PlatformConfig,
  prompt: string,
  strokes: string,
  screen: string | undefined,
): Promise<VisualScene | null> {
  const apiKey = config.apiKey?.trim();
  const model = config.model?.trim();
  if (!apiKey || !model || config.providerApiType === 'anthropic') return null;
  const base = config.baseUrl.replace(/\/+$/, '');
  if (!/^https?:\/\//.test(base)) return null;

  const userText = `Owner request: ${prompt}\nDrawing: ${strokes || 'no strokes; use the named subject.'}\n${
    screen ? 'A screenshot of the desktop is attached. Use it only if you can actually interpret it.' : ''
  }`;
  const userContent = screen
    ? [
        { type: 'text', text: userText },
        { type: 'image_url', image_url: { url: screen } },
      ]
    : userText;

  for (const mode of ['json', 'plain'] as const) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 14_000);
    try {
      const response = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0.35,
          max_tokens: 1800,
          ...(mode === 'json' ? { response_format: { type: 'json_object' } } : {}),
          messages: [
            { role: 'system', content: SYSTEM },
            { role: 'user', content: mode === 'json' ? userContent : userText },
          ],
        }),
        signal: controller.signal,
      });
      if (!response.ok) continue;
      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const text = data.choices?.[0]?.message?.content;
      if (typeof text !== 'string') continue;
      const scene = parseScene(text);
      if (scene) return scene;
    } catch {
      // Try the next mode / fall through to the deterministic scene.
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Plan mode: the same request, answered with a Sightline scene plan.
//
// Sightline owns colour, geometry, spacing, labels and playback. This route
// only decides meaning — kind, title, summary, asset and 2–5 parts — which is
// exactly the contract compilePlan() in apps/sightline consumes.
// ---------------------------------------------------------------------------

const PLAN_KINDS = ['process', 'anatomy', 'assembly', 'comparison', 'cycle', 'forces', 'hierarchy', 'unclear'];
const PLAN_FORMS = ['block', 'chip', 'board', 'ring', 'tube', 'sphere', 'panel', 'flow', 'pin', 'screen'];
const PLAN_ASSETS = ['none', 'pi5', 'pi_camera', 'next_token', 'axial_fan'];

const planPartSchema = z.object({
  name: z.string().min(1).max(80),
  note: z.string().max(200).optional(),
  form: z.string().max(24).optional(),
});

const planSchema = z.object({
  kind: z.string().max(24).optional(),
  title: z.string().min(1).max(120),
  summary: z.string().max(400).optional(),
  asset: z.string().max(24).optional(),
  parts: z.array(planPartSchema).max(12).optional(),
});

const planRequestSchema = z.object({
  prompt: z.string().trim().min(1).max(2400),
  region: z.string().max(600).optional(),
  mode: z.enum(['2d', '3d']).optional(),
});

const PLAN_SYSTEM = `You plan concise visuals for a fixed drawing engine. Return one JSON object only. No code, no markdown, no coordinates, no colors.
Shape: {"kind":"process","title":"Water filtration","summary":"Remove particles in stages.","asset":"none","parts":[{"name":"Intake","note":"Water enters the system.","form":"tube"}]}
Pick one kind: process, anatomy, assembly, comparison, cycle, forces, hierarchy, unclear.
Pick asset "none" unless the topic clearly matches: pi5 (Raspberry Pi 5), pi_camera (Pi 5 attaching a camera), next_token (LLM next-token training), axial_fan (how an axial fan moves air). For an asset, send an empty parts array.
Otherwise give 2–5 parts in explanatory order, each name ≤ 26 characters, note ≤ 75 characters, form from block, chip, board, ring, tube, sphere, panel, flow, pin, screen.
Illustrate real mechanism and the numbers that matter; never invent precise values you are unsure about. Use "unclear" and no parts if the subject cannot be identified.`;

function tidyText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, max) : '';
}

function pick<T extends string>(values: readonly T[], value: unknown): T | null {
  const key = tidyText(value, 24).toLowerCase().replace(/[\s-]+/g, '_');
  return (values as readonly string[]).includes(key) ? (key as T) : null;
}

function normalizePlan(value: unknown) {
  const parsed = planSchema.safeParse(value);
  if (!parsed.success) return null;
  const raw = parsed.data;
  const seen = new Set<string>();
  const parts = (raw.parts || [])
    .map((part, index) => {
      const name = tidyText(part.name, 33);
      if (!name || seen.has(name.toLowerCase())) return null;
      seen.add(name.toLowerCase());
      return {
        name,
        note: tidyText(part.note, 100),
        form: pick(PLAN_FORMS, part.form) || ['block', 'chip', 'panel', 'ring', 'tube'][index % 5],
      };
    })
    .filter((part): part is { name: string; note: string; form: string } => !!part)
    .slice(0, 5);
  return {
    kind: pick(PLAN_KINDS, raw.kind) || 'process',
    title: tidyText(raw.title, 66) || 'Visual explanation',
    summary: tidyText(raw.summary, 145),
    asset: pick(PLAN_ASSETS, raw.asset) || 'none',
    parts,
  };
}

function labFor(prompt: string): 'engine' | 'wind' | null {
  const p = prompt.toLowerCase();
  if (/turbofan|jet\s*engine|jet\b|fighter|aircraft|mach\s*\d|afterburner|compressor|turbine engine|thrust/.test(p)) return 'engine';
  if (/wind\s*turbine|wind\s*tunnel|airfoil|aerofoil|blade|rotor|airflow|aerodynamic|wing\b|drag\b/.test(p)) return 'wind';
  return null;
}

function fallbackPlan(prompt: string) {
  const p = prompt.toLowerCase();
  if (/water|filter|purif/.test(p))
    return {
      kind: 'process',
      title: 'Water filtration',
      summary: 'Particles are removed in stages as water moves through the system.',
      asset: 'none',
      parts: [
        { name: 'Intake', note: 'Raw water enters the treatment path.', form: 'tube' },
        { name: 'Filter bed', note: 'Porous media traps suspended particles.', form: 'panel' },
        { name: 'Outlet', note: 'Filtered water leaves the unit.', form: 'flow' },
      ],
    };
  if (/neural|transformer|llm|token|model/.test(p))
    return {
      kind: 'process',
      title: 'Next-token prediction',
      summary: 'A prefix of tokens becomes the input; the model predicts the token that follows.',
      asset: 'next_token',
      parts: [],
    };
  if (/raspberry\s*pi|camera|ribbon/.test(p))
    return { kind: 'anatomy', title: 'Raspberry Pi 5', summary: 'An overview of the single-board computer.', asset: 'pi5', parts: [] };
  return {
    kind: 'process',
    title: tidyText(prompt, 60) || 'Visual explanation',
    summary: 'Input, mechanism and result, drawn as one readable sequence.',
    asset: 'none',
    parts: [
      { name: 'Input', note: 'What enters the system.', form: 'tube' },
      { name: 'Mechanism', note: 'The process that changes it.', form: 'panel' },
      { name: 'Result', note: 'The observable outcome.', form: 'flow' },
    ],
  };
}

async function modelPlan(config: PlatformConfig, prompt: string, region: string): Promise<unknown | null> {
  const apiKey = config.apiKey?.trim();
  const model = config.model?.trim();
  if (!apiKey || !model || config.providerApiType === 'anthropic') return null;
  const base = config.baseUrl.replace(/\/+$/, '');
  if (!/^https?:\/\//.test(base)) return null;

  for (const jsonMode of [true, false]) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 11_000);
    try {
      const response = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          temperature: 0.3,
          max_tokens: 900,
          ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
          messages: [
            { role: 'system', content: PLAN_SYSTEM },
            { role: 'user', content: `Request: ${prompt}\n${region ? `The owner marked this region of the screen: ${region}.` : 'No region was marked.'}` },
          ],
        }),
        signal: controller.signal,
      });
      if (!response.ok) continue;
      const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const text = data.choices?.[0]?.message?.content;
      if (typeof text !== 'string') continue;
      const start = text.indexOf('{'), end = text.lastIndexOf('}');
      if (start < 0 || end <= start) continue;
      const plan = normalizePlan(JSON.parse(text.slice(start, end + 1)));
      if (plan) return plan;
    } catch {
      // Fall through to the deterministic plan.
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

function describeStrokes(strokes: Array<{ points: Array<[number, number]> }> | undefined) {
  if (!strokes?.length) return '';
  const parts = strokes.slice(0, 6).map((stroke, index) => {
    const points = stroke.points;
    if (!points.length) return '';
    const xs = points.map(([x]) => x);
    const ys = points.map(([, y]) => y);
    return `stroke ${index + 1}: ${points.length} points, box x=${Math.round(Math.min(...xs))}..${Math.round(
      Math.max(...xs),
    )}, y=${Math.round(Math.min(...ys))}..${Math.round(Math.max(...ys))}`;
  });
  return parts.filter(Boolean).join('; ');
}

export function visualRoutes(config: PlatformConfig) {
  const app = new Hono();

  app.post('/visual/plan', async (c) => {
    const parsed = planRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Describe what to explain.' }, 400);
    const { prompt, region, mode } = parsed.data;
    const fallback = fallbackPlan(prompt);
    const lab = labFor(`${prompt} ${region || ''}`);

    const modelPromise = modelPlan(config, prompt, region || '').catch(() => null);
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 12_000));
    const planned = (await Promise.race([modelPromise, timeout])) as ReturnType<typeof normalizePlan>;
    const plan = planned && planned.parts.length ? planned : fallback;
    const source = planned && planned.parts.length ? 'model' : 'fallback';

    return c.json({
      plan,
      lab,
      mode: mode || '3d',
      source,
      provider: config.providerLabel ?? config.providerId ?? 'local',
      model: config.model ?? 'sightline-engine',
    });
  });

  app.post('/visual/explain', async (c) => {
    const parsed = requestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Describe what to explain.' }, 400);
    const { prompt, strokes, screen } = parsed.data;
    const fallback = fallbackScene(prompt);
    const drawing = describeStrokes(strokes as Array<{ points: Array<[number, number]> }> | undefined);

    // The layer must answer quickly. Give the model a short window, then draw
    // the deterministic explanation instead of leaving the overlay spinning.
    const modelPromise = modelScene(config, prompt, drawing, screen).catch(() => null);
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 15_000));
    const scene = (await Promise.race([modelPromise, timeout])) ?? fallback;
    const usedModel = scene !== fallback;

    return c.json({
      scene,
      source: usedModel ? 'model' : 'fallback',
      provider: config.providerLabel ?? config.providerId ?? 'local',
      model: config.model ?? 'aegis-visual',
    });
  });

  return app;
}
