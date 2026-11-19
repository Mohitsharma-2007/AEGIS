import { z } from 'zod';

// AEGIS (W-GEN 2): the model's generative-UI surface.
//
// The agent may draw in the chat without shipping arbitrary HTML: it calls
// show_visual with a small, closed declarative spec, and the client renders it
// with real components (VisualCards.tsx). The spec is deliberately strict  
// no z.record, no free-form props   so strict providers accept the schema and
// a forged payload cannot render anything the client did not define.
//
// Every block is data-only. The card never runs model-authored code, and the
// numbers it shows are the numbers the model got from real tools.

const label = (max: number) => z.string().trim().min(1).max(max);

const seriesPoint = z
  .object({
    x: label(40).describe('Category or date for this point, shown on the axis.'),
    y: z.number().finite().describe('Numeric value for this point.'),
  })
  .strict();

const series = z
  .object({
    name: label(60).describe('Series name, shown in the legend.'),
    points: z
      .array(seriesPoint)
      .min(2)
      .max(60)
      .describe('Two to sixty points, ordered left to right.'),
  })
  .strict();

const chartBlock = z
  .object({
    type: z.literal('chart'),
    title: label(120).optional(),
    kind: z
      .enum(['line', 'area', 'bar'])
      .describe('line for trends over time, area for a filled trend, bar to compare values.'),
    unit: label(16).optional().describe('Short unit suffix, e.g. USD, %, ms.'),
    series: z.array(series).min(1).max(4),
    caption: label(240).optional(),
  })
  .strict();

const statsBlock = z
  .object({
    type: z.literal('stats'),
    title: label(120).optional(),
    items: z
      .array(
        z
          .object({
            label: label(40),
            value: label(40),
            delta: label(24).optional().describe('Change, e.g. "+168.2%" or "-3.1 pts".'),
            tone: z.enum(['neutral', 'positive', 'negative']).optional(),
            hint: label(120).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(6),
  })
  .strict();

const tableBlock = z
  .object({
    type: z.literal('table'),
    title: label(120).optional(),
    columns: z.array(label(40)).min(1).max(8),
    rows: z.array(z.array(z.string().max(200)).min(1).max(8)).min(1).max(40),
    caption: label(240).optional(),
  })
  .strict();

const timelineBlock = z
  .object({
    type: z.literal('timeline'),
    title: label(120).optional(),
    events: z
      .array(
        z
          .object({
            when: label(40),
            title: label(120),
            detail: label(400).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(12),
  })
  .strict();

const calloutBlock = z
  .object({
    type: z.literal('callout'),
    tone: z.enum(['info', 'success', 'warning', 'danger']),
    title: label(120),
    body: label(800),
  })
  .strict();

const progressBlock = z
  .object({
    type: z.literal('progress'),
    title: label(120).optional(),
    items: z
      .array(
        z
          .object({
            label: label(60),
            value: z.number().finite().min(0),
            max: z.number().finite().positive().optional(),
            hint: label(80).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(8),
  })
  .strict();

const galleryBlock = z
  .object({
    type: z.literal('gallery'),
    title: label(120).optional(),
    images: z
      .array(
        z
          .object({
            url: z.string().url().max(2048),
            alt: label(200),
            caption: label(200).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(6),
  })
  .strict();

const codeBlock = z
  .object({
    type: z.literal('code'),
    title: label(120).optional(),
    language: label(24).optional(),
    code: z.string().min(1).max(4000),
  })
  .strict();

// --- dynamic components -------------------------------------------------
// The card is not a fixed set of widgets: the model composes the blocks it
// needs, including search results it just fetched and free prose it wrote.

const linkListBlock = z
  .object({
    type: z.literal('linklist'),
    title: label(120).optional(),
    links: z
      .array(
        z
          .object({
            title: label(200),
            url: z.string().url().max(2048),
            snippet: label(400).optional(),
            source: label(60).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(12),
  })
  .strict();

const markdownBlock = z
  .object({
    type: z.literal('markdown'),
    title: label(120).optional(),
    body: z.string().min(1).max(8000),
  })
  .strict();

const kvBlock = z
  .object({
    type: z.literal('kv'),
    title: label(120).optional(),
    items: z
      .array(
        z
          .object({
            label: label(80),
            value: label(240),
            hint: label(200).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(12),
  })
  .strict();

// A column holds the non-recursive block types, so a card can lay two or
// three short panels side by side without nesting forever.
const simpleBlockSchema = z.discriminatedUnion('type', [
  chartBlock,
  statsBlock,
  tableBlock,
  kvBlock,
  linkListBlock,
  markdownBlock,
  calloutBlock,
]);

const columnsBlock = z
  .object({
    type: z.literal('columns'),
    title: label(120).optional(),
    columns: z
      .array(
        z
          .object({
            heading: label(80).optional(),
            blocks: z.array(simpleBlockSchema).min(1).max(3),
          })
          .strict(),
      )
      .min(2)
      .max(3),
  })
  .strict();

export const visualBlockSchema = z.discriminatedUnion('type', [
  chartBlock,
  statsBlock,
  tableBlock,
  timelineBlock,
  calloutBlock,
  progressBlock,
  galleryBlock,
  codeBlock,
  linkListBlock,
  markdownBlock,
  kvBlock,
  columnsBlock,
]);
export type VisualBlock = z.infer<typeof visualBlockSchema>;

export const visualUiSchema = z
  .object({
    title: label(120).optional().describe('Card heading, e.g. "NVIDIA   Nov 2023   May 2024".'),
    summary: label(600).optional().describe('One sentence of context shown under the heading.'),
    blocks: z.array(visualBlockSchema).min(1).max(8),
  })
  .strict();
export type VisualUiSpec = z.infer<typeof visualUiSchema>;

export const visualUiTool = {
  name: 'show_visual',
  description:
    'Render a live visual card in the chat. Available block types: chart (line/area/bar), stats, table, timeline, callout, progress, gallery (images with captions), code, linklist (search results with title, url and snippet), markdown (free prose), kv (label/value pairs) and columns (two or three panels side by side). Use this whenever the owner asks for a graph, chart, comparison, dashboard, timeline, scorecard, a list of sources, or any visual explanation, and whenever numbers are clearer drawn than written. The card renders from the spec you send, so put the real data you already gathered (from web search, image search, files, the browser, or memory) into the spec. Several blocks can be combined in one card, and a linklist is the right block for web-search results. Never invent data: if a value is unknown, say so in the surrounding text instead of charting it.',
  parameters: z.toJSONSchema(visualUiSchema),
};

/** What the browser handler returns to the model: a compact acknowledgement,
 *  never the spec echoed back (that would spend the model's context twice). */
export type VisualUiAck = {
  rendered: boolean;
  title?: string;
  blocks: string[];
};
