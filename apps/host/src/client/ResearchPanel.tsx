import { useState, useEffect } from 'react';
import {
  BookOpen,
  Code2,
  Search,
  TrendingUp,
  Newspaper,
  ArrowUpRight,
  Globe,
  Calendar,
  ExternalLink,
} from 'lucide-react';

function formatNewsTime(raw: string): string {
  if (!raw) return '';
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw.trim();
  const now = Date.now();
  const diffHours = Math.round((now - d.getTime()) / (1000 * 60 * 60));
  if (diffHours >= 0 && diffHours < 1) return 'Just now';
  if (diffHours >= 1 && diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.round(diffHours / 24);
  if (diffDays >= 1 && diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
import {
  callAegisResearch,
  type AegisResearchResponse,
} from './api';

// AEGIS (W-FIX 2c): the Research view. Two real connector surfaces on
// the Aegis daemon, proxied through the host's allowlisted research
// route   OpenAlex (scholarly works/authors) and GitHub (repository
// metadata + commit analysis). Results are the daemon's real payloads;
// a down daemon is an honest empty state, never placeholder data.
// OpenAlex results are stored by the daemon as provenance captures, so
// they also show up in Memory with their source.

type WorkResult = {
  id?: string;
  title?: string;
  authors?: string[];
  venue?: string | null;
  year?: number | null;
  cited_by_count?: number | null;
  doi?: string | null;
  capture_id?: string;
};

export function ResearchPanel() {
  const [query, setQuery] = useState('');
  const [repo, setRepo] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [works, setWorks] = useState<WorkResult[]>();
  const [worksQuery, setWorksQuery] = useState('');
  const [repoData, setRepoData] = useState<Record<string, unknown>>();
  const [commits, setCommits] = useState<Record<string, unknown>>();

  const run = async (
    key: string,
    request: () => Promise<AegisResearchResponse>,
  ) => {
    setBusy(key);
    setError('');
    try {
      const response = await request();
      if (!response.reachable) {
        setError(
          response.detail ??
            'The Aegis daemon is not reachable, so research is unavailable.',
        );
        return null;
      }
      const result = response.result ?? {};
      if (result.ok === false) {
        setError(
          response.detail ??
            `The connector reported: ${String(result.error ?? 'unknown error')}${result.detail ? `   ${String(result.detail)}` : ''}`,
        );
        return null;
      }
      return result;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Research failed.');
      return null;
    } finally {
      setBusy('');
    }
  };

  const searchWorks = async () => {
    const result = await run('works', () =>
      callAegisResearch('openalex.search_works', { query, limit: 10 }),
    );
    if (result) {
      setWorks((result.results as WorkResult[]) ?? []);
      setWorksQuery(query);
    }
  };

  const loadRepo = async () => {
    const [repoResult, commitResult] = await Promise.all([
      run('repo', () => callAegisResearch('github.repo', { repo })),
      run('commits', () =>
        callAegisResearch('github.commits', { repo, per_page: 30 }),
      ),
    ]);
    if (repoResult) setRepoData(repoResult);
    if (commitResult) setCommits(commitResult);
  };

  return (
    <main className="main-content research-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">RESEARCH</span>
          <h1>Research</h1>
          <p>
            Scholarly literature via OpenAlex and repository intelligence
            via GitHub, served by the Aegis daemon s research connectors.
            Results are stored as provenance captures in Memory.
          </p>
        </div>
      </div>
      {error && (
        <p className="chat-error" role="alert">
          {error}
        </p>
      )}
      <FinanceResearchSection />
      <NewsIntelligenceSection />
      <section className="research-block">
        <h2>
          <BookOpen size={17} /> OpenAlex   papers & authors
        </h2>
        <form
          className="research-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (query.trim()) void searchWorks();
          }}
        >
          <input
            aria-label="Search OpenAlex works"
            placeholder="e.g. structure-aware information retrieval"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button
            className="primary"
            disabled={!!busy || !query.trim()}
            type="submit"
          >
            <Search size={15} />
            {busy === 'works' ? 'Searching ' : 'Search works'}
          </button>
        </form>
        {works && (
          <>
            <p className="muted">
              {works.length} results for  {worksQuery}    source: OpenAlex
            </p>
            <ul className="research-results">
              {works.map((work, index) => (
                <li key={work.id ?? index}>
                  <strong>{work.title ?? 'Untitled work'}</strong>
                  <small>
                    {(work.authors ?? []).slice(0, 4).join(', ')}
                    {(work.authors?.length ?? 0) > 4 ? ' et al.' : ''}
                    {work.year ? `   ${work.year}` : ''}
                    {work.venue ? `   ${work.venue}` : ''}
                    {typeof work.cited_by_count === 'number'
                      ? `   cited by ${work.cited_by_count.toLocaleString()}`
                      : ''}
                  </small>
                  {work.doi && (
                    <small>
                      <a href={work.doi} target="_blank" rel="noreferrer">
                        {work.doi}
                      </a>
                    </small>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
      <section className="research-block">
        <h2>
          <Code2 size={17} /> GitHub   repository & commit analysis
        </h2>
        <form
          className="research-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (repo.trim()) void loadRepo();
          }}
        >
          <input
            aria-label="GitHub repository, owner/name"
            placeholder="owner/name, e.g. CopilotKit/OpenDots"
            value={repo}
            onChange={(event) => setRepo(event.target.value)}
          />
          <button
            className="primary"
            disabled={!!busy || !repo.trim()}
            type="submit"
          >
            <Search size={15} />
            {busy ? 'Loading ' : 'Analyse'}
          </button>
        </form>
        {repoData && (
          <div className="research-repo">
            <p>
              <strong>{String(repoData.full_name ?? repo)}</strong>
              {repoData.description
                ? `   ${String(repoData.description)}`
                : ''}
            </p>
            <p className="muted">
              {typeof repoData.stars === 'number'
                ? `${repoData.stars.toLocaleString()} stars   `
                : ''}
              {typeof repoData.forks === 'number'
                ? `${repoData.forks.toLocaleString()} forks   `
                : ''}
              {repoData.language ? `${String(repoData.language)}   ` : ''}
              {repoData.license ? `licence ${String(repoData.license)}   ` : ''}
              default branch {String(repoData.default_branch ?? ' ')}
            </p>
            {commits && (
              <>
                <p className="muted">
                  Commit analysis (latest{' '}
                  {String(
                    (
                      commits.analysis as
                        | { total_in_page?: unknown }
                        | undefined
                    )?.total_in_page ??
                      (commits.recent as unknown[] | undefined)?.length ??
                      '',
                  )}{' '}
                  commits):
                </p>
                <div className="research-commits">
                  <div>
                    <strong>By author</strong>
                    <ul>
                      {Object.entries(
                        ((
                          commits.analysis as
                            | { by_author?: Record<string, number> }
                            | undefined
                        )?.by_author as Record<string, number>) ?? {},
                      )
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 8)
                        .map(([author, count]) => (
                          <li key={author}>
                            {author}: {count}
                          </li>
                        ))}
                    </ul>
                  </div>
                  <div>
                    <strong>Recent messages</strong>
                    <ul>
                      {(
                        (commits.recent as
                          | { message?: string; author?: string }[]
                          | undefined) ?? []
                      )
                        .slice(0, 8)
                        .map((commit, index) => (
                          <li key={index}>
                            {String(commit.message ?? '').split('\n')[0]}
                          </li>
                        ))}
                    </ul>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </section>

    </main>
  );
}

interface TickerData {
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
  updatedAt: string;
}

const WATCH_TICKERS = ['NVDA', 'AAPL', 'MSFT', 'GOOGL', 'BTC-USD'];

function formatMoney(value: number | null | undefined, currency: string): string {
  if (value == null) return ' ';
  try {
    return new Intl.NumberFormat(undefined, {
      style: currency ? 'currency' : 'decimal',
      currency: currency || 'USD',
      maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2,
    }).format(value);
  } catch {
    return value.toLocaleString(undefined, {
      maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2,
    });
  }
}

function formatCompact(value: number | null | undefined): string {
  if (value == null) return ' ';
  return new Intl.NumberFormat(undefined, {
    notation: 'compact',
    maximumFractionDigits: 2,
  }).format(value);
}

function formatRange(low: number | null | undefined, high: number | null | undefined): string {
  if (low == null && high == null) return ' ';
  return `${low == null ? ' ' : low.toLocaleString(undefined, { maximumFractionDigits: 2 })}   ${
    high == null ? ' ' : high.toLocaleString(undefined, { maximumFractionDigits: 2 })
  }`;
}

function FinanceResearchSection() {
  const [symbolInput, setSymbolInput] = useState('NVDA');
  const [ticker, setTicker] = useState<TickerData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadTicker = async (rawSymbol: string) => {
    const symbol = rawSymbol.trim().toUpperCase();
    if (!symbol) return;
    setSymbolInput(symbol);
    setLoading(true);
    setError('');
    try {
      const response = await fetch(
        `/api/research/finance?symbol=${encodeURIComponent(symbol)}`,
      );
      const data = (await response.json()) as {
        ok?: boolean;
        quote?: TickerData;
        error?: string;
      };
      if (!response.ok || !data.ok || !data.quote)
        throw new Error(data.error ?? 'Finance connector unavailable.');
      const quote = data.quote as Partial<TickerData> & {
        symbol: string;
        name: string;
        updatedAt: string;
      };
      setTicker({
        symbol: quote.symbol,
        name: quote.name,
        currency: quote.currency ?? '',
        price: quote.price ?? null,
        previousClose: quote.previousClose ?? null,
        changePercent: quote.changePercent ?? null,
        dayHigh: quote.dayHigh ?? null,
        dayLow: quote.dayLow ?? null,
        high52: quote.high52 ?? null,
        low52: quote.low52 ?? null,
        volume: quote.volume ?? null,
        updatedAt: quote.updatedAt,
      });
    } catch (cause) {
      setTicker(null);
      setError(
        cause instanceof Error ? cause.message : 'Finance lookup failed.',
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadTicker('NVDA');
    // Load the default watchlist quote once; later lookups are owner-driven.
  }, []);

  const positive = (ticker?.changePercent ?? 0) >= 0;

  return (
    <section className="research-block">
      <div className="research-block-head">
        <h2>
          <TrendingUp size={17} /> Financial Intelligence &amp; Markets
        </h2>
        <span className="research-source">Yahoo Finance</span>
      </div>
      <p className="muted">
        Live quote and range data from the public Yahoo Finance chart API.
        Nothing is generated locally: when the feed is unavailable the panel
        says so instead of showing a placeholder quote.
      </p>

      <form
        className="research-form"
        onSubmit={(event) => {
          event.preventDefault();
          void loadTicker(symbolInput);
        }}
      >
        <input
          type="text"
          aria-label="Ticker symbol"
          placeholder="Ticker, e.g. NVDA, AAPL, RELIANCE.NS, BTC-USD"
          value={symbolInput}
          onChange={(event) => setSymbolInput(event.target.value)}
        />
        <button className="primary" type="submit" disabled={loading}>
          <Search size={15} /> {loading ? 'Loading ' : 'Look up'}
        </button>
      </form>

      <div className="ticker-preset-chips">
        <span className="preset-label">Watchlist</span>
        {WATCH_TICKERS.map((symbol) => (
          <button
            key={symbol}
            type="button"
            className={`preset-chip ${ticker?.symbol === symbol ? 'active' : ''}`}
            onClick={() => void loadTicker(symbol)}
          >
            {symbol}
          </button>
        ))}
      </div>

      {error && (
        <p className="chat-error" role="alert">
          {error}
        </p>
      )}

      {loading && !ticker && (
        <p className="muted research-loading">Fetching the live quote </p>
      )}

      {ticker && (
        <div className="finance-ticker-card">
          <div className="ticker-card-top">
            <div>
              <div className="ticker-symbol-row">
                <strong>{ticker.symbol}</strong>
                <span className="ticker-full-name">{ticker.name}</span>
              </div>
              <div className="ticker-price-row">
                <span className="current-price">
                  {formatMoney(ticker.price, ticker.currency)}
                </span>
                <span
                  className={`price-change ${positive ? 'positive' : 'negative'}`}
                >
                  {ticker.changePercent === null
                    ? ' '
                    : `${positive ? '+' : ''}${ticker.changePercent.toFixed(2)}%`}
                </span>
              </div>
              <small className="ticker-updated">
                Updated {new Date(ticker.updatedAt).toLocaleTimeString()}
                {ticker.currency ? `   ${ticker.currency}` : ''}
              </small>
            </div>
            <a
              href={`https://finance.yahoo.com/quote/${encodeURIComponent(ticker.symbol)}`}
              target="_blank"
              rel="noreferrer"
              className="finance-source-link"
            >
              <span>Open on Yahoo Finance</span>
              <ArrowUpRight size={14} />
            </a>
          </div>

          <div className="ticker-metrics-grid">
            <div className="metric-box">
              <span className="metric-label">Previous close</span>
              <strong className="metric-val">
                {formatMoney(ticker.previousClose, ticker.currency)}
              </strong>
            </div>
            <div className="metric-box">
              <span className="metric-label">Day range</span>
              <strong className="metric-val">
                {formatRange(ticker.dayLow, ticker.dayHigh)}
              </strong>
            </div>
            <div className="metric-box">
              <span className="metric-label">52-week range</span>
              <strong className="metric-val">
                {formatRange(ticker.low52, ticker.high52)}
              </strong>
            </div>
            <div className="metric-box">
              <span className="metric-label">Volume</span>
              <strong className="metric-val">
                {formatCompact(ticker.volume)}
              </strong>
            </div>
          </div>
        </div>
      )}
      <p className="muted research-timefm-status">
        Live quotes and watchlists update on demand from market data; no heavy
        time-series model is loaded at startup.
      </p>
    </section>
  );
}

type NewsCategory = 'all' | 'ai' | 'markets' | 'cyber';

const NEWS_CATEGORY_QUERIES: Record<NewsCategory, string> = {
  all: 'Aegis AI agent',
  ai: 'artificial intelligence compute',
  markets: 'stock market macro economy',
  cyber: 'cybersecurity',
};

function NewsIntelligenceSection() {
  const [category, setCategory] = useState<NewsCategory>('all');
  const [newsQuery, setNewsQuery] = useState(NEWS_CATEGORY_QUERIES.all);
  const [articles, setArticles] = useState<
    Array<{ title: string; url: string; time: string; source: string }>
  >([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadNews = async (query: string) => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(
        `/api/research/news?q=${encodeURIComponent(query)}`,
      );
      const data = (await response.json()) as {
        ok?: boolean;
        articles?: Array<{
          title: string;
          url: string;
          time: string;
          source: string;
        }>;
        error?: string;
      };
      if (!response.ok || !data.ok)
        throw new Error(data.error ?? 'News feed unavailable.');
      setArticles(data.articles ?? []);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'News feed unavailable.',
      );
      setArticles([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadNews(NEWS_CATEGORY_QUERIES.all);
    // Load the default feed once; category/search actions drive later calls.
  }, []);

  const chooseCategory = (next: NewsCategory) => {
    setCategory(next);
    const query = NEWS_CATEGORY_QUERIES[next];
    setNewsQuery(query);
    void loadNews(query);
  };

  return (
    <section className="research-block">
      <div className="research-block-head">
        <h2>
          <Newspaper size={17} /> Global News &amp; Intelligence
        </h2>
        <span className="research-source">Google News RSS</span>
      </div>
      <p className="muted">
        Live headlines from the public Google News feed. Category pills run a
        real query against the feed; the search box accepts any topic.
      </p>

      <form
        className="research-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!newsQuery.trim()) return;
          setCategory('all');
          void loadNews(newsQuery);
        }}
      >
        <input
          type="text"
          aria-label="News topic"
          placeholder="News topic, e.g. AI, markets, cybersecurity"
          value={newsQuery}
          onChange={(event) => setNewsQuery(event.target.value)}
        />
        <button className="primary" type="submit" disabled={loading}>
          <Search size={15} /> {loading ? 'Loading ' : 'Search news'}
        </button>
      </form>

      <div className="news-category-pills">
        {(
          [
            ['all', 'All News'],
            ['ai', 'AI & Compute'],
            ['markets', 'Markets & Macro'],
            ['cyber', 'Cyber & Isolation'],
          ] as Array<[NewsCategory, string]>
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`news-pill ${category === id ? 'active' : ''}`}
            onClick={() => chooseCategory(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {error && (
        <p className="chat-error" role="alert">
          {error}
        </p>
      )}

      <p className="news-result-meta">
        {loading
          ? 'Loading headlines '
          : `${articles.length} headline${articles.length === 1 ? '' : 's'} for  ${newsQuery} `}
      </p>

      {!loading && articles.length === 0 && !error && (
        <p className="muted">No articles were returned for this topic.</p>
      )}

      <div className="news-cards-list">
        {articles.map((news, index) => (
          <article key={`${news.url}:${index}`} className="news-article-card">
            <div className="news-article-head">
              {news.source && (
                <span className="news-source-tag">
                  <Globe size={11} />
                  <span>{news.source}</span>
                </span>
              )}
              {news.time && (
                <span className="news-time-tag">
                  <Calendar size={11} />
                  <span>{formatNewsTime(news.time)}</span>
                </span>
              )}
            </div>
            <h3 className="news-title">
              <a href={news.url} target="_blank" rel="noreferrer">
                <span>{news.title}</span>
                <ExternalLink size={13} className="news-ext-icon" />
              </a>
            </h3>
          </article>
        ))}
      </div>
    </section>
  );
}
