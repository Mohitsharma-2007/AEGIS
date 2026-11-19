import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// Mermaid needs a real browser at module load; the renderer's contract is
// tested by asserting the diagram is handed to its own block, not a <pre>.
vi.mock('mermaid', () => ({
  default: { initialize: vi.fn(), render: vi.fn() },
}));

import { RichMarkdown } from '../src/client/RichMarkdown';

const render = (markdown: string) =>
  renderToStaticMarkup(<RichMarkdown>{markdown}</RichMarkdown>);

it('renders a chart fence as an SVG chart with its title and labels', () => {
  const html = render(
    [
      '```chart',
      JSON.stringify({
        type: 'bar',
        title: 'Data centre revenue',
        labels: ['Q1', 'Q2'],
        values: [22.6, 26.3],
      }),
      '```',
    ].join('\n'),
  );
  expect(html).toContain('class="chart-block"');
  expect(html).toContain('Data centre revenue');
  expect(html).toContain('<svg');
  expect(html).toContain('<rect');
  expect(html).toContain('Q1');
  expect(html).not.toContain('class="code-block"');
});

it('falls back to a code block when chart JSON is malformed', () => {
  const html = render('```chart\n{ not json\n```');
  expect(html).toContain('class="code-block"');
  expect(html).not.toContain('class="chart-block"');
});

it('renders a mermaid fence through MermaidBlock instead of a code block', () => {
  const html = render('```mermaid\ngraph TD; A-->B;\n```');
  expect(html).toContain('class="mermaid-block"');
  expect(html).not.toContain('class="code-block"');
});

it('renders an html fence in a sandboxed iframe', () => {
  const html = render('```html\n<h1>NVIDIA dashboard</h1>\n```');
  expect(html).toContain('class="html-preview"');
  expect(html).toContain('sandbox="allow-scripts allow-popups"');
  expect(html).toContain('srcDoc=');
  expect(html).toContain('&lt;h1&gt;NVIDIA dashboard&lt;/h1&gt;');
  expect(html).not.toContain('class="code-block"');
});

it('renders a plain fence as code with its language badge', () => {
  const html = render('```ts\nconst revenue = 130;\n```');
  expect(html).toContain('class="code-block"');
  expect(html).toContain('class="code-lang">ts<');
  expect(html).toContain('const revenue = 130;');
  expect(html).not.toContain('<iframe');
  expect(html).not.toContain('class="mermaid-block"');
});

it('renders GFM tables in the themed wrapper', () => {
  const html = render('| Metric | Value |\n| --- | --- |\n| Revenue | 130 |');
  expect(html).toContain('class="markdown-table-wrap"');
  expect(html).toContain('<table>');
  expect(html).toContain('Revenue');
});
