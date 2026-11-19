import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import {
  visualUiSchema,
  visualUiTool,
  type VisualUiSpec,
} from '../src/shared/visual-ui.js';
import { VisualUiCard, parseVisualSpec } from '../src/client/VisualCards.js';

const spec: VisualUiSpec = {
  title: 'NVIDIA · Nov 2023 → May 2024',
  summary: 'Closing price on the first and last day of the window.',
  blocks: [
    {
      type: 'chart',
      title: 'Closing price',
      kind: 'line',
      unit: 'USD',
      series: [
        {
          name: 'NVDA',
          points: [
            { x: '2023-11-01', y: 40.75 },
            { x: '2024-05-31', y: 109.32 },
          ],
        },
      ],
      caption: 'Source: StatMuse price history.',
    },
    {
      type: 'stats',
      title: 'Movement',
      items: [
        { label: 'Start', value: '$40.75' },
        { label: 'End', value: '$109.32' },
        { label: 'Change', value: '+168.2%', tone: 'positive' },
      ],
    },
    {
      type: 'table',
      title: 'Recent closes',
      columns: ['Date', 'Close'],
      rows: [
        ['2024-05-31', '109.32'],
        ['2024-05-30', '109.35'],
      ],
    },
  ],
};

describe('generative UI spec', () => {
  it('accepts a realistic multi-block spec', () => {
    const parsed = visualUiSchema.safeParse(spec);
    expect(parsed.success).toBe(true);
  });

  it('rejects unknown block types and extra keys', () => {
    expect(
      visualUiSchema.safeParse({ blocks: [{ type: 'iframe', url: 'https://x.test' }] })
        .success,
    ).toBe(false);
    expect(
      visualUiSchema.safeParse({
        blocks: [{ type: 'callout', tone: 'info', title: 'Hi', body: 'There', html: '<b>' }],
      }).success,
    ).toBe(false);
  });

  it('bounds chart data so a model cannot ship an unbounded payload', () => {
    const points = Array.from({ length: 61 }, (_, index) => ({
      x: `d${index}`,
      y: index,
    }));
    expect(
      visualUiSchema.safeParse({
        blocks: [{ type: 'chart', kind: 'bar', series: [{ name: 's', points }] }],
      }).success,
    ).toBe(false);
  });

  it('declares show_visual with a closed object schema', () => {
    const schema = visualUiTool.parameters as {
      additionalProperties?: boolean;
      required?: string[];
      properties?: Record<string, unknown>;
    };
    expect(visualUiTool.name).toBe('show_visual');
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toContain('blocks');
    expect(visualUiTool.description).toMatch(/chart/i);
  });

  it('tolerates a JSON string spec from the transport and rejects junk', () => {
    expect(parseVisualSpec(JSON.stringify(spec))?.blocks).toHaveLength(3);
    expect(parseVisualSpec('not json')).toBeNull();
    expect(parseVisualSpec({ blocks: [] })).toBeNull();
  });

  it('renders the chart, the stat tiles and the table', () => {
    const html = renderToStaticMarkup(
      createElement(VisualUiCard, { args: spec, status: 'complete' }),
    );
    expect(html).toContain('NVIDIA · Nov 2023 → May 2024');
    expect(html).toContain('visual-line');
    expect(html).toContain('+168.2%');
    expect(html).toContain('109.32');
    expect(html).toContain('Source: StatMuse price history.');
  });

  it('shows an honest error instead of drawing an invalid spec', () => {
    const html = renderToStaticMarkup(
      createElement(VisualUiCard, {
        args: { blocks: [{ type: 'nope' }] },
        status: 'complete',
      }),
    );
    expect(html).toContain('could not validate');
    expect(html).not.toContain('visual-line');
  });
});
