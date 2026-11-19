import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { MermaidBlock } from './MermaidBlock';
import {
  ArrowUpRight,
  BarChart3,
  BookOpen,
  Braces,
  CheckCircle2,
  CircleAlert,
  Download,
  ExternalLink,
  Images,
  Info,
  ListChecks,
  Sparkles,
  TriangleAlert,
} from 'lucide-react';
import type { Result } from '../shared/types';
import {
  visualBlockSchema,
  visualUiSchema,
  type VisualBlock,
  type VisualUiSpec,
} from '../shared/visual-ui';
import { computerToolResult } from './ComputerToolCard';

// AEGIS (W-GEN 2): renderers for the model's generative UI. Everything here
// draws from a validated spec (shared/visual-ui.ts); a block that fails
// validation is reported, never guessed at. All animation is CSS driven, so a
// card streams in as the model composes it and settles without layout jank.

export function parseVisualSpec(value: unknown): VisualUiSpec | null {
  let candidate: unknown = value;
  if (typeof candidate === 'string') {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      return null;
    }
  }
  const data = computerToolResult(candidate);
  const parsed = visualUiSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

const blockIcon = (block: VisualBlock) => {
  switch (block.type) {
    case 'chart':
      return <BarChart3 size={15} />;
    case 'timeline':
      return <ListChecks size={15} />;
    case 'gallery':
      return <Images size={15} />;
    case 'code':
      return <Braces size={15} />;
    case 'callout':
      return block.tone === 'danger' || block.tone === 'warning' ? (
        <TriangleAlert size={15} />
      ) : (
        <Info size={15} />
      );
    default:
      return <Sparkles size={15} />;
  }
};

const fmtNumber = (value: number) =>
  value.toLocaleString(undefined, { maximumFractionDigits: 2 });

/** Animated line/area/bar chart with a live hover readout. Real values only. */
function ChartBlock({ block }: { block: Extract<VisualBlock, { type: 'chart' }> }) {
  const [hover, setHover] = useState<number | null>(null);
  const values = block.series.flatMap((entry) => entry.points.map((point) => point.y));
  // A bar chart must start at zero or a 12-vs-18 difference looks like 3x.
  const min = block.kind === 'bar' ? 0 : Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const width = 100;
  const height = 42;
  const pad = 2;
  const xCount = Math.max(...block.series.map((entry) => entry.points.length));
  const coords = (index: number, value: number) => {
    const x =
      xCount === 1
        ? width / 2
        : pad + (index / (xCount - 1)) * (width - pad * 2);
    const y = height - pad - ((value - min) / span) * (height - pad * 2);
    return [x, y] as const;
  };
  const ticks = block.series[0]?.points ?? [];
  const unit = block.unit ? ` ${block.unit}` : '';
  const hovered =
    hover != null
      ? block.series
          .map((entry, index) => ({ entry, index }))
          .filter(({ entry }) => entry.points[hover])
      : [];
  return (
    <figure className="visual-chart">
      <div className="visual-chart-scale">
        <span>
          {hover != null && hovered.length === 1
            ? `${fmtNumber(hovered[0].entry.points[hover]!.y)}${unit}`
            : `${fmtNumber(max)}${unit}`}
        </span>
        <span>{`${fmtNumber(min)}${unit}`}</span>
      </div>
      <div className="visual-chart-plot" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img">
        <title>{block.title ?? 'Chart'}</title>
        {[0.25, 0.5, 0.75].map((fraction) => (
          <line
            key={fraction}
            x1={0}
            x2={width}
            y1={height * fraction}
            y2={height * fraction}
            className="visual-grid"
          />
        ))}
        {block.kind === 'bar' ? (
          block.series.map((entry, seriesIndex) => {
            const band = (width - pad * 2) / Math.max(xCount, 1);
            const barWidth = Math.min(10, (band * 0.62) / block.series.length);
            return entry.points.map((point, index) => {
              const [rawX, y] = coords(index, point.y);
              const center = Math.min(
                width - pad - barWidth / 2,
                Math.max(pad + barWidth / 2, rawX),
              );
              const x =
                center -
                (barWidth * block.series.length) / 2 +
                seriesIndex * barWidth;
              return (
                <rect
                  key={`${entry.name}-${index}`}
                  x={x}
                  y={y}
                  width={barWidth}
                  height={Math.max(0.4, height - pad - y)}
                  rx={0.8}
                  className={`visual-series series-${seriesIndex} visual-bar`}
                  style={{ animationDelay: `${index * 26}ms` }}
                />
              );
            });
          })
        ) : (
          block.series.map((entry, seriesIndex) => {
            const points = entry.points.map((point, index) => coords(index, point.y));
            const line = points
              .map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`)
              .join(' ');
            const area = `${line} L${points.at(-1)?.[0].toFixed(2)} ${height - pad} L${points[0][0].toFixed(2)} ${height - pad} Z`;
            return (
              <g key={entry.name}>
                {block.kind === 'area' && (
                  <path d={area} className={`visual-series-fill series-${seriesIndex}`} />
                )}
                <path
                  d={line}
                  pathLength={1}
                  className={`visual-series series-${seriesIndex} visual-line`}
                  style={{ animationDelay: `${seriesIndex * 120}ms` }}
                  vectorEffect="non-scaling-stroke"
                />
                {points.map(([x, y], index) => (
                  <circle
                    key={`${entry.name}-dot-${index}`}
                    cx={x}
                    cy={y}
                    r={0.55}
                    className={`visual-series series-${seriesIndex} visual-dot`}
                    style={{ animationDelay: `${180 + index * 22}ms` }}
                  />
                ))}
              </g>
            );
          })
        )}
        {hover != null && (
          <line
            className="visual-guide"
            x1={coords(hover, 0)[0]}
            x2={coords(hover, 0)[0]}
            y1={pad}
            y2={height - pad}
          />
        )}
        {ticks.map((_, index) => {
          const [cx] = coords(index, 0);
          const half = (width - pad * 2) / Math.max(1, xCount) / 2;
          return (
            <rect
              key={`hit-${index}`}
              x={Math.max(0, cx - half)}
              y={0}
              width={half * 2}
              height={height}
              fill="transparent"
              onMouseEnter={() => setHover(index)}
            />
          );
        })}
      </svg>
      {hover != null && (
        <div
          className="visual-tooltip"
          style={{
            left: `${Math.min(92, Math.max(8, (coords(hover, 0)[0] / width) * 100))}%`,
          }}
        >
          <strong>{ticks[hover]?.x}</strong>
          {hovered.map(({ entry, index }) => (
            <span key={entry.name}>
              <i className={`series-${index}`} />
              {entry.name ? `${entry.name}: ` : ''}
              {fmtNumber(entry.points[hover]!.y)}
              {unit}
            </span>
          ))}
        </div>
      )}
      </div>
      <div className="visual-axis">
        {ticks.map((point, index) => (
          <span key={`${point.x}-${index}`}>{point.x}</span>
        ))}
      </div>
      {block.series.length > 1 && (
        <div className="visual-legend">
          {block.series.map((entry, index) => (
            <span key={entry.name}>
              <i className={`series-${index}`} />
              {entry.name}
            </span>
          ))}
        </div>
      )}
      {block.caption && <figcaption>{block.caption}</figcaption>}
    </figure>
  );
}

function StatsBlock({ block }: { block: Extract<VisualBlock, { type: 'stats' }> }) {
  return (
    <div className="visual-stats">
      {block.items.map((item, index) => (
        <div
          className={`visual-stat tone-${item.tone ?? 'neutral'}`}
          key={`${item.label}-${index}`}
          style={{ animationDelay: `${index * 70}ms` }}
        >
          <span>{item.label}</span>
          <strong>{item.value}</strong>
          {item.delta && <em>{item.delta}</em>}
          {item.hint && <small>{item.hint}</small>}
        </div>
      ))}
    </div>
  );
}

function TableBlock({ block }: { block: Extract<VisualBlock, { type: 'table' }> }) {
  const [sort, setSort] = useState<{ column: number; dir: 'asc' | 'desc' } | null>(
    null,
  );
  const rows = sort
    ? [...block.rows].sort((a, b) => {
        const left = a[sort.column] ?? '';
        const right = b[sort.column] ?? '';
        const ln = Number(left.replace(/[^0-9.-]/g, ''));
        const rn = Number(right.replace(/[^0-9.-]/g, ''));
        const bothNumeric =
          left.trim() !== '' &&
          right.trim() !== '' &&
          Number.isFinite(ln) &&
          Number.isFinite(rn);
        const order = bothNumeric
          ? ln - rn
          : left.localeCompare(right, undefined, { numeric: true });
        return sort.dir === 'asc' ? order : -order;
      })
    : block.rows;
  const toggle = (column: number) =>
    setSort((prev) =>
      prev && prev.column === column
        ? { column, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { column, dir: 'asc' },
    );
  return (
    <div className="visual-table-wrap">
      <table className="visual-table">
        <thead>
          <tr>
            {block.columns.map((column, columnIndex) => (
              <th key={column}>
                <button
                  type="button"
                  className="visual-th-sort"
                  aria-sort={
                    sort?.column === columnIndex
                      ? sort.dir === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : 'none'
                  }
                  onClick={() => toggle(columnIndex)}
                >
                  {column}
                  <span aria-hidden="true" className="visual-sort-mark">
                    {sort?.column === columnIndex
                      ? sort.dir === 'asc'
                        ? '▲'
                        : '▼'
                      : '↕'}
                  </span>
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={`row-${rowIndex}`} style={{ animationDelay: `${rowIndex * 24}ms` }}>
              {block.columns.map((column, columnIndex) => (
                <td key={`${column}-${columnIndex}`}>{row[columnIndex] ?? ''}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {block.caption && <p className="visual-caption">{block.caption}</p>}
    </div>
  );
}

function TimelineBlock({
  block,
}: {
  block: Extract<VisualBlock, { type: 'timeline' }>;
}) {
  return (
    <ol className="visual-timeline">
      {block.events.map((event, index) => (
        <li key={`${event.when}-${index}`} style={{ animationDelay: `${index * 80}ms` }}>
          <span className="visual-timeline-when">{event.when}</span>
          <div>
            <strong>{event.title}</strong>
            {event.detail && <p>{event.detail}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

function ProgressBlock({
  block,
}: {
  block: Extract<VisualBlock, { type: 'progress' }>;
}) {
  const ceiling = Math.max(
    ...block.items.map((item) => item.max ?? Math.max(item.value, 1) * 1.15),
  );
  return (
    <div className="visual-progress">
      {block.items.map((item, index) => {
        const percent = Math.min(100, Math.round((item.value / ceiling) * 100));
        return (
          <div key={`${item.label}-${index}`}>
            <div className="visual-progress-label">
              <span>{item.label}</span>
              <span>
                {item.value.toLocaleString()}
                {item.max ? ` / ${item.max.toLocaleString()}` : ''}
              </span>
            </div>
            <div className="visual-progress-track">
              <i style={{ width: `${percent}%`, animationDelay: `${index * 90}ms` }} />
            </div>
            {item.hint && <small>{item.hint}</small>}
          </div>
        );
      })}
    </div>
  );
}

function GalleryBlock({
  block,
}: {
  block: Extract<VisualBlock, { type: 'gallery' }>;
}) {
  return (
    <div className="visual-gallery">
      {block.images.map((image, index) => (
        <figure key={`${image.url}-${index}`} style={{ animationDelay: `${index * 90}ms` }}>
          <img src={image.url} alt={image.alt} loading="lazy" />
          <figcaption>{image.caption ?? image.alt}</figcaption>
        </figure>
      ))}
    </div>
  );
}

function CalloutBlock({ block }: { block: Extract<VisualBlock, { type: 'callout' }> }) {
  const icon =
    block.tone === 'success' ? (
      <CheckCircle2 size={16} />
    ) : block.tone === 'danger' || block.tone === 'warning' ? (
      <CircleAlert size={16} />
    ) : (
      <Info size={16} />
    );
  return (
    <div className={`visual-callout tone-${block.tone}`}>
      {icon}
      <div>
        <strong>{block.title}</strong>
        <p>{block.body}</p>
      </div>
    </div>
  );
}

function CodeBlock({ block }: { block: Extract<VisualBlock, { type: 'code' }> }) {
  return (
    <div className="visual-code">
      <div className="visual-code-head">
        <Braces size={14} />
        <span>{block.title ?? block.language ?? 'Code'}</span>
      </div>
      <pre>
        <code>{block.code}</code>
      </pre>
    </div>
  );
}

const asNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value.replace(/[$%\s]/g, '').replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

const kindOf = (raw: unknown): 'bar' | 'line' | 'area' => {
  const kind = String(raw ?? '').toLowerCase();
  if (kind === 'line') return 'line';
  if (kind === 'area') return 'area';
  return 'bar';
};

function safeChart(candidate: Record<string, unknown>): VisualBlock | null {
  const parsed = visualBlockSchema.safeParse({ type: 'chart', ...candidate });
  return parsed.success ? parsed.data : null;
}

/** Turn the loose chart JSON a model writes in a fenced ```chart block into a
 *  validated chart block. It accepts the shapes models actually emit: a
 *  {labels, values} pair, a {series:[{name, points}]} spec, an array of
 *  {label, value} rows, a plain array of numbers, or an object map. */
function chartBlockFromAny(parsed: unknown): VisualBlock | null {
  if (Array.isArray(parsed)) {
    const values = parsed.map(asNumber);
    if (parsed.length >= 2 && values.every((value) => value != null))
      return safeChart({
        series: [
          {
            name: 'Value',
            points: parsed.map((_, index) => ({ x: String(index + 1), y: values[index] as number })),
          },
        ],
      });
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  // A whole visual spec nested in the fence: use its first chart.
  if (Array.isArray(obj.blocks)) {
    const nested = (obj.blocks as unknown[]).find(
      (block) => block && typeof block === 'object' && (block as { type?: unknown }).type === 'chart',
    );
    if (nested) return chartBlockFromAny(nested);
  }
  const kind = kindOf(obj.kind ?? obj.type);
  const title = typeof obj.title === 'string' ? obj.title : undefined;
  const unit = typeof obj.unit === 'string' ? obj.unit : undefined;
  const caption = typeof obj.caption === 'string' ? obj.caption : undefined;

  if (Array.isArray(obj.series) && obj.series.length) {
    const series = (obj.series as unknown[])
      .map((entry, index) => {
        const row = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
        const raw = Array.isArray(row.points)
          ? (row.points as unknown[])
          : Array.isArray(row.values)
            ? (row.values as unknown[])
            : [];
        const points = raw
          .map((point, pointIndex) => {
            if (point && typeof point === 'object') {
              const item = point as Record<string, unknown>;
              const y = asNumber(item.y ?? item.value);
              return y == null
                ? null
                : { x: String(item.x ?? item.label ?? pointIndex + 1), y };
            }
            const y = asNumber(point);
            return y == null ? null : { x: String(pointIndex + 1), y };
          })
          .filter((point): point is { x: string; y: number } => point !== null);
        return { name: String(row.name ?? `Series ${index + 1}`), points };
      })
      .filter((series) => series.points.length >= 2);
    if (series.length) return safeChart({ title, kind, unit, caption, series });
  }

  const labels = Array.isArray(obj.labels) ? (obj.labels as unknown[]) : null;
  const values = Array.isArray(obj.values) ? (obj.values as unknown[]) : null;
  if (labels && values) {
    const points = labels
      .map((label, index) => {
        const y = asNumber(values[index]);
        return y == null ? null : { x: String(label ?? index + 1), y };
      })
      .filter((point): point is { x: string; y: number } => point !== null);
    if (points.length >= 2)
      return safeChart({ title, kind, unit, caption, series: [{ name: title ?? 'Value', points }] });
  }

  const data = Array.isArray(obj.data) ? (obj.data as unknown[]) : null;
  if (data) {
    const points = data
      .map((row, index) => {
        if (!row || typeof row !== 'object') return null;
        const item = row as Record<string, unknown>;
        const y = asNumber(item.value ?? item.y ?? item.count);
        return y == null
          ? null
          : { x: String(item.label ?? item.x ?? item.name ?? index + 1), y };
      })
      .filter((point): point is { x: string; y: number } => point !== null);
    if (points.length >= 2)
      return safeChart({ title, kind, unit, caption, series: [{ name: title ?? 'Value', points }] });
  }

  // An object map such as { "Q1": 44.1, "Q2": 46.7 }.
  const keys = Object.keys(obj);
  if (keys.length >= 2 && keys.every((key) => asNumber(obj[key]) != null)) {
    const points = keys.map((key) => ({ x: key, y: asNumber(obj[key]) as number }));
    return safeChart({ title, kind, unit, caption, series: [{ name: title ?? 'Value', points }] });
  }
  return null;
}

/** Parse a fenced ```chart block into a validated visual spec, or null. */
export function fenceToVisualSpec(value: unknown): VisualUiSpec | null {
  if (value && typeof value === 'object' && Array.isArray((value as { blocks?: unknown }).blocks)) {
    const spec = visualUiSchema.safeParse(value);
    return spec.success ? spec.data : null;
  }
  const chart = chartBlockFromAny(value);
  if (!chart) return null;
  const spec = visualUiSchema.safeParse({ blocks: [chart] });
  return spec.success ? spec.data : null;
}

/** A ```chart fenced block inside a brief or report: draw the same chart the
 *  visual card draws instead of showing raw JSON. Anything unparseable falls
 *  back to a plain code block   the brief is never worse than before. */
export function FencedChart({ code }: { code: string }) {
  const spec = useMemo(() => {
    try {
      return fenceToVisualSpec(JSON.parse(code.replace(/,\s*([}\]])/g, '$1')));
    } catch {
      return null;
    }
  }, [code]);
  if (!spec)
    return (
      <pre className="visual-fence-fallback">
        <code>{code}</code>
      </pre>
    );
  return <VisualUiCard args={spec} status="complete" />;
}

/** Search results, rendered as real links with their snippets. */
function LinkListBlock({
  block,
}: {
  block: Extract<VisualBlock, { type: 'linklist' }>;
}) {
  return (
    <ul className="visual-links">
      {block.links.map((link) => (
        <li key={link.url}>
          <a href={link.url} target="_blank" rel="noreferrer">
            <span className="visual-link-title">{link.title}</span>
            {link.source ? (
              <span className="visual-link-source">{link.source}</span>
            ) : null}
          </a>
          {link.snippet ? <p>{link.snippet}</p> : null}
        </li>
      ))}
    </ul>
  );
}

/** Free prose the model wrote, rendered as Markdown. */
function MarkdownBlock({
  block,
}: {
  block: Extract<VisualBlock, { type: 'markdown' }>;
}) {
  return (
    <div className="visual-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{block.body}</ReactMarkdown>
    </div>
  );
}

/** Label/value pairs: the shape most facts arrive in. */
function KvBlock({ block }: { block: Extract<VisualBlock, { type: 'kv' }> }) {
  return (
    <dl className="visual-kv">
      {block.items.map((item) => (
        <div key={`${item.label}-${item.value}`}>
          <dt>{item.label}</dt>
          <dd>
            {item.value}
            {item.hint ? <span className="visual-kv-hint">{item.hint}</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function VisualUiCard({
  args,
  status,
  result,
}: {
  args?: unknown;
  status: string;
  result?: unknown;
}) {
  const spec = parseVisualSpec(args);
  // A parseable spec is a complete spec: the card is drawn even if the tool
  // state still reads inProgress on a rehydrated turn (that happened on reload
  // and made finished charts say "Drawing ").
  const done = spec !== null || status !== 'inProgress';
  if (!spec) {
    return (
      <section className="visual-card composing" aria-live="polite">
        <header>
          <Sparkles size={16} />
          <strong>{done ? 'Visual could not be read' : 'Composing a visual '}</strong>
        </header>
        {done ? (
          <p className="visual-error">
            The model sent a visual spec Aegis could not validate, so nothing was
            drawn. Ask again, or ask for the numbers as text.
          </p>
        ) : (
          <div className="visual-skeleton" />
        )}
        {typeof result === 'string' && result && done && (
          <p className="visual-caption">{result.slice(0, 200)}</p>
        )}
      </section>
    );
  }
  return (
    <section className="visual-card" aria-label={spec.title ?? 'Visual answer'}>
      <header>
        <BarChart3 size={16} />
        <strong>{spec.title ?? 'Visual answer'}</strong>
        <span className={`tool-state${done ? '' : ' live'}`}>
          {done ? 'Rendered' : 'Drawing '}
        </span>
      </header>
      {spec.summary && <p className="visual-summary">{spec.summary}</p>}
      <div className="visual-blocks">
        {spec.blocks.map((block, index) => (
          <div
            className="visual-block"
            key={`${block.type}-${index}`}
            style={{ animationDelay: `${index * 60}ms` }}
          >
            <div className="visual-block-head">
              {blockIcon(block)}
              {'title' in block && block.title ? <span>{block.title}</span> : null}
            </div>
            {block.type === 'chart' ? (
              <ChartBlock block={block} />
            ) : block.type === 'stats' ? (
              <StatsBlock block={block} />
            ) : block.type === 'table' ? (
              <TableBlock block={block} />
            ) : block.type === 'timeline' ? (
              <TimelineBlock block={block} />
            ) : block.type === 'progress' ? (
              <ProgressBlock block={block} />
            ) : block.type === 'gallery' ? (
              <GalleryBlock block={block} />
            ) : block.type === 'callout' ? (
              <CalloutBlock block={block} />
            ) : block.type === 'linklist' ? (
              <LinkListBlock block={block} />
            ) : block.type === 'markdown' ? (
              <MarkdownBlock block={block} />
            ) : block.type === 'kv' ? (
              <KvBlock block={block} />
            ) : block.type === 'columns' ? (
              <div className="visual-columns">
                {block.columns.map((column, columnIndex) => (
                  <section key={`column-${columnIndex}`} className="visual-column">
                    {column.heading ? (
                      <h4 className="visual-column-head">{column.heading}</h4>
                    ) : null}
                    {column.blocks.map((inner, innerIndex) => (
                      <div
                        className="visual-column-block"
                        key={`${inner.type}-${innerIndex}`}
                      >
                        {inner.type === 'chart' ? (
                          <ChartBlock block={inner} />
                        ) : inner.type === 'stats' ? (
                          <StatsBlock block={inner} />
                        ) : inner.type === 'table' ? (
                          <TableBlock block={inner} />
                        ) : inner.type === 'kv' ? (
                          <KvBlock block={inner} />
                        ) : inner.type === 'linklist' ? (
                          <LinkListBlock block={inner} />
                        ) : inner.type === 'markdown' ? (
                          <MarkdownBlock block={inner} />
                        ) : (
                          <CalloutBlock block={inner} />
                        )}
                      </div>
                    ))}
                  </section>
                ))}
              </div>
            ) : (
              <CodeBlock block={block} />
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/** The research brief, rendered inside the conversation. The side pane is the
 *  full reader; this card is the in-chat, animated arrival of the same brief
 *  (screenshot, findings, sources) so a finished run is never invisible. */
export function ResearchBriefCard({
  result,
  onOpen,
}: {
  result: Result;
  onOpen?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [arrived, setArrived] = useState(false);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    setArrived(false);
    const timer = window.setTimeout(() => setArrived(true), 40);
    return () => window.clearTimeout(timer);
  }, [result.text]);
  const body = expanded ? result.text : result.text.slice(0, 900);
  return (
    <article
      ref={ref}
      className={`brief-inline${arrived ? ' arrived' : ''}`}
      aria-label="Research brief"
    >
      <header>
        <BookOpen size={16} />
        <strong>{result.sample ? 'Sample research brief' : 'Research brief'}</strong>
        <span className="brief-inline-actions">
          {onOpen && (
            <button type="button" className="text-button" onClick={onOpen}>
              Open full brief <ArrowUpRight size={13} />
            </button>
          )}
          <button
            type="button"
            className="icon-button"
            aria-label="Download brief"
            onClick={() => {
              const blob = new Blob(
                [
                  `${result.text}\n\nSources\n${result.sources
                    .map((source) => `${source.title}: ${source.url}`)
                    .join('\n')}`,
                ],
                { type: 'text/plain' },
              );
              const url = URL.createObjectURL(blob);
              const anchor = document.createElement('a');
              anchor.href = url;
              anchor.download = 'aegis-brief.txt';
              anchor.click();
              URL.revokeObjectURL(url);
            }}
          >
            <Download size={14} />
          </button>
        </span>
      </header>
      {result.screenshot && (
        <figure className="brief-inline-shot">
          <img
            src={result.screenshot}
            alt="Browser preview of the researched page"
            loading="lazy"
          />
          <figcaption>
            Browser preview
            {result.engine ? `   ${result.engine}` : ''}
          </figcaption>
        </figure>
      )}
      <div className="brief-inline-body">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            img: ({ alt }) => <span>{alt ? `[Image: ${alt}]` : ''}</span>,
            a: ({ children, href }) => (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            ),
            table: ({ children }) => (
              <div className="brief-table-wrap">
                <table className="brief-table">{children}</table>
              </div>
            ),
            th: ({ children }) => <th>{children}</th>,
            td: ({ children }) => <td>{children}</td>,
            pre: ({ children }) => {
              const child = Array.isArray(children) ? children[0] : children;
              const className =
                (child as { props?: { className?: string } } | undefined)?.props
                  ?.className ?? '';
              return /language-(chart|visual|mermaid)\b/.test(className) ? (
                <>{children}</>
              ) : (
                <pre>{children}</pre>
              );
            },
            code: ({ className, children }) => {
              const language = (className ?? '').replace('language-', '');
              if (language === 'mermaid') {
                return <MermaidBlock code={String(children).trim()} />;
              }
              if (language === 'chart' || language === 'visual') {
                return <FencedChart code={String(children).trim()} />;
              }
              return <code className={className}>{children}</code>;
            },
          }}
        >
          {body}
        </ReactMarkdown>
      </div>
      {result.text.length > 900 && (
        <button
          type="button"
          className="text-button"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? 'Show less' : 'Show the whole brief'}
        </button>
      )}
      {!!result.sources.length && (
        <div className="brief-inline-sources">
          {result.sources.slice(0, 6).map((source) => (
            <a key={source.url} href={source.url} target="_blank" rel="noreferrer">
              <ExternalLink size={12} />
              {source.title}
            </a>
          ))}
        </div>
      )}
    </article>
  );
}
