import { useMemo, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { MermaidBlock } from './MermaidBlock';
import { openPageLink } from './page-navigation';

// Markdown that renders what the agent actually produces: GFM tables, fenced
// diagrams, real charts and sandboxed HTML. Everything is derived from the
// message text, so no special prompt or hard-coded per-task rendering is
// needed.

type ChartSpec = {
  type?: 'bar' | 'line' | 'pie';
  title?: string;
  labels?: (string | number)[];
  values?: (number | string)[];
  series?: { name?: string; values: (number | string)[] }[];
};

function numbers(values: (number | string)[] | undefined): number[] {
  return (values ?? []).map((value) =>
    typeof value === 'number' ? value : Number(value) || 0,
  );
}

function ChartBlock({ code }: { code: string }) {
  const spec = useMemo<ChartSpec | null>(() => {
    try {
      const parsed: unknown = JSON.parse(code);
      return parsed && typeof parsed === 'object' ? (parsed as ChartSpec) : null;
    } catch {
      return null;
    }
  }, [code]);
  if (!spec) return <pre className="code-block">{code}</pre>;

  const labels = spec.labels ?? [];
  const values = numbers(spec.values ?? spec.series?.[0]?.values);
  const width = 520;
  const height = 220;
  const pad = 34;
  const max = Math.max(1, ...values.map((value) => Math.abs(value)));
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;

  let content: ReactNode;
  if (spec.type === 'pie') {
    const total = values.reduce((sum, value) => sum + Math.max(0, value), 0) || 1;
    let angle = -Math.PI / 2;
    const cx = width / 2;
    const cy = height / 2;
    const r = Math.min(innerW, innerH) / 2;
    content = values.map((value, index) => {
      const sweep = (Math.max(0, value) / total) * Math.PI * 2;
      const x1 = cx + r * Math.cos(angle);
      const y1 = cy + r * Math.sin(angle);
      angle += sweep;
      const x2 = cx + r * Math.cos(angle);
      const y2 = cy + r * Math.sin(angle);
      const large = sweep > Math.PI ? 1 : 0;
      const palette = ['#e8a08c', '#8ab4f8', '#a7f3d0', '#fbbf24', '#c4b5fd', '#f87171'];
      return (
        <path
          key={index}
          d={`M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`}
          fill={palette[index % palette.length]}
          opacity={0.85}
        />
      );
    });
  } else if (spec.type === 'line') {
    const points = values
      .map((value, index) => {
        const x = pad + (innerW * index) / Math.max(1, values.length - 1);
        const y = pad + innerH - (Math.abs(value) / max) * innerH;
        return `${x},${y}`;
      })
      .join(' ');
    content = (
      <>
        <polyline points={points} fill="none" style={{ stroke: 'var(--accent)' }} strokeWidth={2.4} />
        {values.map((value, index) => {
          const x = pad + (innerW * index) / Math.max(1, values.length - 1);
          const y = pad + innerH - (Math.abs(value) / max) * innerH;
          return <circle key={index} cx={x} cy={y} r={3} style={{ fill: 'var(--accent)' }} />;
        })}
      </>
    );
  } else {
    const barW = innerW / Math.max(1, values.length) * 0.62;
    content = values.map((value, index) => {
      const step = innerW / Math.max(1, values.length);
      const x = pad + step * index + (step - barW) / 2;
      const h = (Math.abs(value) / max) * innerH;
      return (
        <rect
          key={index}
          x={x}
          y={pad + innerH - h}
          width={barW}
          height={h}
          rx={4}
          style={{ fill: 'var(--accent)', opacity: index % 2 ? 0.55 : 0.9 }}
        />
      );
    });
  }

  return (
    <figure className="chart-block">
      {spec.title && <figcaption>{spec.title}</figcaption>}
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={spec.title ?? 'Chart'}>
        {spec.type !== 'pie' && (
          <>
            <line x1={pad} y1={pad + innerH} x2={width - pad} y2={pad + innerH} style={{ stroke: 'color-mix(in srgb, var(--muted) 35%, transparent)' }} />
            <line x1={pad} y1={pad} x2={pad} y2={pad + innerH} style={{ stroke: 'color-mix(in srgb, var(--muted) 35%, transparent)' }} />
          </>
        )}
        {content}
        {spec.type !== 'pie' &&
          labels.slice(0, 12).map((label, index) => {
            const shown = Math.min(labels.length, 12);
            const step = innerW / Math.max(1, shown);
            return (
              <text
                key={index}
                x={pad + step * index + step / 2}
                y={height - 12}
                style={{ fill: 'var(--muted)' }}
                fontSize={9}
                textAnchor="middle"
              >
                {String(label).slice(0, 10)}
              </text>
            );
          })}
      </svg>
      {spec.type === 'pie' && (
        <ul className="chart-legend">
          {labels.map((label, index) => (
            <li key={index}>
              <i style={{ background: ['#e8a08c', '#8ab4f8', '#a7f3d0', '#fbbf24', '#c4b5fd', '#f87171'][index % 6] }} />
              {label}: {values[index]}
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}

function HtmlBlock({ code }: { code: string }) {
  return (
    <figure className="html-preview">
      <figcaption>
        <span>HTML render</span>
        <a href={`data:text/html;charset=utf-8,${encodeURIComponent(code)}`} target="_blank" rel="noreferrer">
          Open
        </a>
      </figcaption>
      <iframe
        title="Rendered HTML from the agent"
        sandbox="allow-scripts allow-popups"
        srcDoc={code}
        loading="lazy"
      />
    </figure>
  );
}

export function RichMarkdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        img: ({ alt }) => <span>{alt}</span>,
        a: ({ href, children: label }) => (
          <a
            onClick={(event) => {
              if (href?.startsWith('/#/spaces/')) {
                event.preventDefault();
                openPageLink(href);
              }
            }}
            href={href}
            target={href?.startsWith('/#/spaces/') ? undefined : '_blank'}
            rel="noreferrer"
          >
            {label}
          </a>
        ),
        table: ({ children: rows }) => (
          <div className="markdown-table-wrap">
            <table>{rows}</table>
          </div>
        ),
        pre: ({ children: node }) => {
          const child = Array.isArray(node) ? node[0] : node;
          const props =
            child && typeof child === 'object' && 'props' in child
              ? (child.props as { className?: string; children?: ReactNode })
              : undefined;
          const language = /language-(\w+)/.exec(props?.className ?? '')?.[1];
          const text = String(props?.children ?? '').replace(/\n$/, '');
          if (language === 'mermaid') return <MermaidBlock code={text} />;
          if (language === 'html' || language === 'htm') return <HtmlBlock code={text} />;
          if (language === 'chart' || language === 'jsonchart') return <ChartBlock code={text} />;
          return (
            <pre className="code-block">
              {language && <span className="code-lang">{language}</span>}
              <code>{text}</code>
            </pre>
          );
        },
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
