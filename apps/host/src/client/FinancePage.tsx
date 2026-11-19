import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Loader2,
  RefreshCw,
  Search,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { api } from './api';

/**
 * Finance is a real market surface: quotes and the price line come from the
 * host's `/api/research/finance` (Yahoo's public chart API), news comes from
 * `/api/research/news`. Nothing here is generated client-side — if the feed
 * fails the page says so instead of drawing a plausible-looking line.
 */

interface FinanceSeriesPoint {
  t: number;
  c: number;
}

interface FinanceQuote {
  symbol: string;
  name: string;
  currency: string;
  price: number | null;
  previousClose: number | null;
  changePercent: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  high52: number | null;
  low52: number | null;
  volume: number | null;
  exchange: string;
  updatedAt: string;
  range: string;
  series: FinanceSeriesPoint[];
}

interface NewsArticle {
  title: string;
  url: string;
  time: string;
  source: string;
}

const RANGES = [
  { id: '1d', label: '1D' },
  { id: '5d', label: '5D' },
  { id: '1mo', label: '1M' },
  { id: '6mo', label: '6M' },
  { id: '1y', label: '1Y' },
  { id: '5y', label: '5Y' },
] as const;

const money = (value: number | null, currency = '') => {
  if (value === null || !Number.isFinite(value)) return '—';
  const formatted = value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return currency ? `${formatted} ${currency}` : formatted;
};

const compact = (value: number | null) => {
  if (value === null || !Number.isFinite(value)) return '—';
  if (value >= 1e12) return `${(value / 1e12).toFixed(2)}T`;
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return String(Math.round(value));
};

function tickLabel(t: number, range: string) {
  const date = new Date(t);
  if (range === '1d') {
    return date.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  if (range === '5d') {
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
  }
  if (range === '5y' || range === '1y') {
    return date.toLocaleDateString(undefined, {
      month: 'short',
      year: '2-digit',
    });
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * The price chart. Drawn from the quote's own close series as an inline SVG so
 * it scales with the panel, keeps crisp hairlines on HiDPI screens, and needs
 * no chart dependency in the host bundle.
 */
function PriceChart({
  series,
  range,
  positive,
}: {
  series: FinanceSeriesPoint[];
  range: string;
  positive: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 720;
  const height = 260;
  const pad = { top: 16, right: 18, bottom: 28, left: 58 };

  const geometry = useMemo(() => {
    if (series.length < 2) return null;
    const values = series.map((point) => point.c);
    const min = Math.min(...values);
    const max = Math.max(...values);
    // A flat series has zero range; pad it so the line sits mid-panel.
    const span = max - min || Math.max(max * 0.01, 0.5);
    const low = max === min ? min - span / 2 : min;
    const high = max === min ? max + span / 2 : max;
    const plotWidth = width - pad.left - pad.right;
    const plotHeight = height - pad.top - pad.bottom;
    const x = (index: number) =>
      pad.left + (index / (series.length - 1)) * plotWidth;
    const y = (value: number) =>
      pad.top + plotHeight - ((value - low) / (high - low)) * plotHeight;
    const coordinates = series.map(
      (point, index) => `${x(index).toFixed(2)},${y(point.c).toFixed(2)}`,
    );
    const line = `M ${coordinates.join(' L ')}`;
    const area = `${line} L ${x(series.length - 1).toFixed(2)},${(
      pad.top + plotHeight
    ).toFixed(2)} L ${pad.left.toFixed(2)},${(pad.top + plotHeight).toFixed(
      2,
    )} Z`;
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => ({
      value: low + (high - low) * fraction,
      y: pad.top + plotHeight * (1 - fraction),
    }));
    // Three date labels: start, middle, end — enough to orient without clutter.
    const labelIndexes = [
      0,
      Math.floor((series.length - 1) / 2),
      series.length - 1,
    ];
    return { line, area, ticks, labelIndexes, x, y, low, high };
  }, [series, pad.left, pad.right, pad.top, pad.bottom]);

  if (!geometry) {
    return (
      <div className="fin-chart-empty">
        No price history was returned for this range.
      </div>
    );
  }

  const stroke = positive ? '#16a34a' : '#dc2626';
  const fill = positive ? 'rgba(22,163,74,0.14)' : 'rgba(220,38,38,0.14)';
  const active = hover === null ? null : series[hover];

  return (
    <div className="fin-chart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Price history for the selected range (${range})`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          const relative = (event.clientX - box.left) / box.width;
          const index = Math.round(relative * (series.length - 1));
          setHover(Math.max(0, Math.min(series.length - 1, index)));
        }}
      >
        {geometry.ticks.map((tick) => (
          <g key={tick.value}>
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={tick.y}
              y2={tick.y}
              stroke="currentColor"
              strokeOpacity="0.12"
              strokeWidth="1"
            />
            <text
              x={pad.left - 8}
              y={tick.y + 3.5}
              textAnchor="end"
              fontSize="10.5"
              fill="currentColor"
              opacity="0.62"
            >
              {tick.value.toFixed(2)}
            </text>
          </g>
        ))}
        <path d={geometry.area} fill={fill} />
        <path
          d={geometry.line}
          fill="none"
          stroke={stroke}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        {geometry.labelIndexes.map((index) => (
          <text
            key={index}
            x={geometry.x(index)}
            y={height - 8}
            textAnchor={
              index === 0
                ? 'start'
                : index === series.length - 1
                  ? 'end'
                  : 'middle'
            }
            fontSize="10.5"
            fill="currentColor"
            opacity="0.62"
          >
            {tickLabel(series[index].t, range)}
          </text>
        ))}
        {hover !== null && active && (
          <g>
            <line
              x1={geometry.x(hover)}
              x2={geometry.x(hover)}
              y1={pad.top}
              y2={height - pad.bottom}
              stroke={stroke}
              strokeOpacity="0.5"
              strokeDasharray="3 3"
            />
            <circle
              cx={geometry.x(hover)}
              cy={geometry.y(active.c)}
              r="3.5"
              fill={stroke}
            />
          </g>
        )}
      </svg>
      {active && (
        <div className="fin-chart-readout">
          <strong>{active.c.toFixed(2)}</strong>
          <span>{new Date(active.t).toLocaleString()}</span>
        </div>
      )}
    </div>
  );
}

export function FinancePage() {
  const [symbol, setSymbol] = useState('AAPL');
  const [query, setQuery] = useState('AAPL');
  const [range, setRange] = useState<string>('1mo');
  const [quote, setQuote] = useState<FinanceQuote | null>(null);
  const [news, setNews] = useState<NewsArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [newsLoading, setNewsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newsError, setNewsError] = useState<string | null>(null);

  const loadQuote = useCallback(async (next: string, nextRange: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<{ ok: boolean; quote: FinanceQuote }>(
        `/research/finance?symbol=${encodeURIComponent(next)}&range=${nextRange}`,
      );
      setQuote(data.quote);
    } catch (caught) {
      setQuote(null);
      setError(
        caught instanceof Error
          ? caught.message
          : 'The quote could not be loaded.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const loadNews = useCallback(async (next: string) => {
    setNewsLoading(true);
    setNewsError(null);
    try {
      const data = await api<{ ok: boolean; articles: NewsArticle[] }>(
        `/research/news?q=${encodeURIComponent(next)}`,
      );
      setNews(data.articles);
    } catch (caught) {
      setNews([]);
      setNewsError(
        caught instanceof Error ? caught.message : 'News could not be loaded.',
      );
    } finally {
      setNewsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadQuote(symbol, range);
  }, [symbol, range, loadQuote]);

  useEffect(() => {
    void loadNews(symbol);
  }, [symbol, loadNews]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const next = query.trim().toUpperCase();
    if (!next) return;
    setSymbol(next);
    // A new symbol starts from the default range so the chart is never empty.
    setRange('1mo');
  };

  const change = quote?.changePercent ?? null;
  const positive = (change ?? 0) >= 0;

  return (
    <main className="main-content fin-page">
      <form className="fin-top" onSubmit={submit}>
        <div className="fin-title">
          <span className="eyebrow">MARKETS</span>
          <h1>Finance</h1>
        </div>
        <div className="fin-search">
          <Search size={15} />
          <input
            aria-label="Search a ticker symbol"
            placeholder="Ticker, e.g. AAPL, NVDA, MSFT"
            value={query}
            maxLength={12}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button type="submit" disabled={loading} aria-label="Load symbol">
            {loading ? <Loader2 size={15} className="ag-spin" /> : 'Load'}
          </button>
        </div>
      </form>

      {error && (
        <div className="fin-error" role="alert">
          {error}
          <button type="button" onClick={() => void loadQuote(symbol, range)}>
            <RefreshCw size={13} /> Retry
          </button>
        </div>
      )}

      {quote && (
        <>
          <section className="fin-quote">
            <div className="fin-quote-head">
              <div>
                <h2>{quote.symbol}</h2>
                <p>
                  {quote.name}
                  {quote.exchange ? ` · ${quote.exchange}` : ''}
                </p>
              </div>
              <div className={`fin-price ${positive ? 'up' : 'down'}`}>
                <strong>{money(quote.price, quote.currency)}</strong>
                <span>
                  {positive ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                  {change === null
                    ? '—'
                    : `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`}
                </span>
              </div>
            </div>
            <dl className="fin-stats">
              <div>
                <dt>Previous close</dt>
                <dd>{money(quote.previousClose)}</dd>
              </div>
              <div>
                <dt>Day high</dt>
                <dd>{money(quote.dayHigh)}</dd>
              </div>
              <div>
                <dt>Day low</dt>
                <dd>{money(quote.dayLow)}</dd>
              </div>
              <div>
                <dt>52-week high</dt>
                <dd>{money(quote.high52)}</dd>
              </div>
              <div>
                <dt>52-week low</dt>
                <dd>{money(quote.low52)}</dd>
              </div>
              <div>
                <dt>Volume</dt>
                <dd>{compact(quote.volume)}</dd>
              </div>
            </dl>
          </section>

          <section className="fin-panel">
            <div className="fin-panel-head">
              <h3>Price</h3>
              <div className="fin-ranges" role="group" aria-label="Chart range">
                {RANGES.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={range === item.id ? 'active' : ''}
                    aria-pressed={range === item.id}
                    onClick={() => setRange(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
            {loading ? (
              <div className="fin-chart-empty">
                <Loader2 size={16} className="ag-spin" /> Loading prices
              </div>
            ) : (
              <PriceChart
                series={quote.series}
                range={quote.range}
                positive={positive}
              />
            )}
            <p className="fin-source">
              Closes from Yahoo Finance. Updated{' '}
              {new Date(quote.updatedAt).toLocaleString()}.
            </p>
          </section>
        </>
      )}

      <section className="fin-panel">
        <div className="fin-panel-head">
          <h3>News</h3>
          {newsLoading && <Loader2 size={15} className="ag-spin" />}
        </div>
        {newsError && <div className="fin-error">{newsError}</div>}
        {!newsError && !newsLoading && news.length === 0 && (
          <p className="fin-empty">No articles from today for this symbol.</p>
        )}
        <ul className="fin-news">
          {news.map((article) => (
            <li key={article.url}>
              <a href={article.url} target="_blank" rel="noreferrer">
                <span>{article.title}</span>
                <ArrowUpRight size={13} />
              </a>
              <small>
                {article.source}
                {article.time
                  ? ` · ${new Date(article.time).toLocaleString()}`
                  : ''}
              </small>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
