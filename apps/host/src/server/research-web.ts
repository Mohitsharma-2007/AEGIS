import { Hono } from 'hono';
import { z } from 'zod';

/**
 * Research data connectors: finance (Yahoo Finance public chart API) and
 * news (Google News RSS, Bing News RSS, and GDELT DOC). These are keyless public feeds; results are the
 * remote payloads, never fabricated.
 *
 * The fetch helpers are exported so the agent swarm can gather the same
 * live evidence the Research surface shows, instead of a separate mock.
 */

export interface FinanceQuote {
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
}

export interface NewsArticle {
  title: string;
  url: string;
  time: string;
  source: string;
}

export async function fetchText(url: string, timeoutMs = 15000, headers?: Record<string, string>): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

export async function fetchJson(url: string, timeoutMs = 15000): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

export function parseRss(xml: string): NewsArticle[] {
  const items: NewsArticle[] = [];
  const seen = new Set<string>();
  const decode = (value: string) =>
    value
      .replace(/<!\[CDATA\[|\]\]>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#0?39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .trim();
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let match: RegExpExecArray | null;
  while ((match = itemRe.exec(xml)) !== null) {
    const block = match[1];
    const title = decode(block.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '');
    const link = decode(block.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? '');
    const pub = decode(block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] ?? '');
    const source = decode(block.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] ?? '');
    if (!title || !link || seen.has(link)) continue;
    seen.add(link);
    items.push({ title, url: link, time: pub, source });
  }
  return items.slice(0, 12);
}

export async function fetchFinanceQuote(
  symbol: string,
): Promise<FinanceQuote> {
  type YahooResponse = {
    chart?: {
      result?: Array<{
        meta?: Record<string, unknown>;
      }>;
    };
  };
  const data = (await fetchJson(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`,
  )) as YahooResponse;
  const meta = data.chart?.result?.[0]?.meta ?? {};
  const price =
    typeof meta.regularMarketPrice === 'number' ? meta.regularMarketPrice : null;
  const previousClose =
    typeof meta.chartPreviousClose === 'number'
      ? meta.chartPreviousClose
      : typeof meta.previousClose === 'number'
        ? meta.previousClose
        : null;
  const changePercent =
    price !== null && previousClose !== null && previousClose !== 0
      ? ((price - previousClose) / previousClose) * 100
      : null;
  return {
    symbol: String(meta.symbol ?? symbol.toUpperCase()),
    name: String(meta.longName ?? meta.shortName ?? symbol.toUpperCase()),
    currency: String(meta.currency ?? ''),
    price,
    previousClose,
    changePercent,
    dayHigh:
      typeof meta.regularMarketDayHigh === 'number' ? meta.regularMarketDayHigh : null,
    dayLow:
      typeof meta.regularMarketDayLow === 'number' ? meta.regularMarketDayLow : null,
    high52:
      typeof meta.fiftyTwoWeekHigh === 'number' ? meta.fiftyTwoWeekHigh : null,
    low52:
      typeof meta.fiftyTwoWeekLow === 'number' ? meta.fiftyTwoWeekLow : null,
    volume:
      typeof meta.regularMarketVolume === 'number' ? meta.regularMarketVolume : null,
    exchange: String(meta.exchangeName ?? ''),
    updatedAt: new Date().toISOString(),
  };
}

export async function fetchNewsArticles(
  query: string,
): Promise<NewsArticle[]> {
  const cleanQuery = query.trim();
  const today = new Date().toLocaleDateString('en-CA');

  // Primary news engine: GDELT (Global Database of Events, Language, and Tone)
  // Provides real-time news monitoring across global sources.
  async function fetchGdeltNews(): Promise<NewsArticle[]> {
    const url = new URL('https://api.gdeltproject.org/api/v2/doc/doc');
    url.searchParams.set('query', cleanQuery);
    url.searchParams.set('mode', 'ArtList');
    url.searchParams.set('format', 'json');
    url.searchParams.set('maxrecords', '50');
    url.searchParams.set('timespan', '1d');
    url.searchParams.set('sort', 'DateDesc');
    const data = await fetchJson(url.toString(), 15000) as {
      articles?: Array<{ title?: string; url?: string; seendate?: string; domain?: string; sourceCountry?: string }>;
    };
    return (data.articles ?? []).flatMap((item) => {
      if (!item.title || !item.url || !item.seendate) return [];
      const time = item.seendate
        .replace(/^(\d{4})(\d{2})(\d{2})T/, '$1-$2-$3T')
        .replace(/T(\d{2})(\d{2})(\d{2})Z$/, 'T$1:$2:$3Z');
      let source = item.domain || '';
      try { source ||= new URL(item.url).hostname.replace(/^www\./, ''); } catch { /* malformed source */ }
      return [{ title: item.title, url: item.url, time, source: source || 'GDELT' }];
    });
  }

  // Secondary: Google News RSS (fallback)
  async function fetchGoogleNews(): Promise<NewsArticle[]> {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(`${cleanQuery} when:1d`)}&hl=en-US&gl=US&ceid=US:en`;
    const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error(`Google News HTTP ${response.status}`);
    return parseRss(await response.text()).map((item) => ({ ...item, source: item.source || 'Google News' }));
  }

  // Tertiary: Bing News RSS (fallback)
  async function fetchBingNews(): Promise<NewsArticle[]> {
    const url = `https://www.bing.com/news/search?q=${encodeURIComponent(`${cleanQuery} past 24 hours`)}&format=rss`;
    const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error(`Bing News HTTP ${response.status}`);
    return parseRss(await response.text()).map((item) => ({ ...item, source: item.source || 'Bing News' }));
  }

  const sources = [fetchGdeltNews, fetchGoogleNews, fetchBingNews];
  const results = await Promise.allSettled(sources.map((source) => source()));
  const merged = new Map<string, NewsArticle>();
  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    for (const article of result.value) {
      const parsed = new Date(article.time);
      if (!Number.isFinite(parsed.getTime()) || parsed.toLocaleDateString('en-CA') !== today) continue;
      const key = article.url.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
      if (!merged.has(key)) merged.set(key, article);
    }
  }
  return [...merged.values()]
    .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
    .slice(0, 30);
}

export function researchWebRoutes() {
  const app = new Hono();

  app.get('/finance', async (c) => {
    const symbol = z.string().trim().min(1).max(12);
    const parsed = symbol.safeParse(c.req.query('symbol') ?? '');
    if (!parsed.success) {
      return c.json(
        { ok: false, error: 'symbol is required, for example ?symbol=AAPL' },
        400,
      );
    }
    try {
      const quote = await fetchFinanceQuote(parsed.data);
      return c.json({ ok: true, quote });
    } catch (error) {
      return c.json(
        {
          ok: false,
          error: error instanceof Error ? error.message : 'Yahoo Finance unavailable.',
        },
        502,
      );
    }
  });

  app.get('/news', async (c) => {
    const q = z.string().trim().min(1).max(200);
    const parsed = q.safeParse(c.req.query('q') ?? '');
    if (!parsed.success) {
      return c.json({ ok: false, error: 'q is required, for example ?q=ai' }, 400);
    }
    try {
      const articles = await fetchNewsArticles(parsed.data);
      return c.json({ ok: true, articles });
    } catch (error) {
      return c.json(
        {
          ok: false,
          error: error instanceof Error ? error.message : 'News feed unavailable.',
        },
        502,
      );
    }
  });

  return app;
}

export interface ResearchResult {
  title: string;
  url: string;
  source: string;
  year?: string;
  authors?: string;
  abstract?: string;
}

/**
 * OpenAlex API - scholarly works and authors.
 */
async function fetchOpenAlex(query: string): Promise<ResearchResult[]> {
  const url = new URL('https://api.openalex.org/works');
  url.searchParams.set('search', query);
  url.searchParams.set('per-page', '10');
  url.searchParams.set('mailto', 'aegis@local');
  try {
    const data = (await fetchJson(url.toString(), 15000)) as any;
    return (data.results ?? []).map((item: any) => ({
      title: item.title || '',
      url: item.doi || '',
      source: 'OpenAlex',
      year: item.publication_date?.slice(0, 4),
      authors: item.authorships?.map((a: any) => a.author?.display_name).filter(Boolean).join(', '),
    }));
  } catch {
    return [];
  }
}

/**
 * arXiv API - preprint research papers.
 */
async function fetchArxiv(query: string): Promise<ResearchResult[]> {
  const url = new URL('http://export.arxiv.org/api/query');
  url.searchParams.set('search_query', `all:${encodeURIComponent(query)}`);
  url.searchParams.set('start', '0');
  url.searchParams.set('max_results', '10');
  try {
    const text = await fetchText(url.toString(), 15000);
    const items: ResearchResult[] = [];
    const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
    let match;
    while ((match = entryRe.exec(text)) !== null) {
      const block = match[1];
      const title = (block.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '').replace(/\s+/g, ' ').trim();
      const url = (block.match(/<link rel="alternate" href="([^"]+)"/)?.[1] ?? '');
      const pub = (block.match(/<published>([\s\S]*?)<\/published>/)?.[1] ?? '');
      const authors: string[] = [];
      const authorRe = /<author>[\s\S]*?<name>([\s\S]*?)<\/name>/g;
      let am;
      while ((am = authorRe.exec(block)) !== null) {
        authors.push(am[1].trim());
      }
      if (title || url) items.push({ title, url, source: 'arXiv', year: pub?.slice(0, 4), authors: authors.join(', ') });
    }
    return items.slice(0, 10);
  } catch {
    return [];
  }
}

/**
 * Google Scholar search (via HTML scraping).
 */
async function fetchGoogleScholar(query: string): Promise<ResearchResult[]> {
  const url = new URL('https://scholar.google.com/scholar');
  url.searchParams.set('q', query);
  url.searchParams.set('hl', 'en');
  try {
    const text = await fetchText(url.toString(), 15000, { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36' });
    const items: ResearchResult[] = [];
    const entryRe = /<div class="gs_r gs_or gs_scl">([\s\S]*?)<\/div>\s*<\/div>/g;
    let match;
    while ((match = entryRe.exec(text)) !== null && items.length < 10) {
      const block = match[1];
      const title = (block.match(/<h3 class="gs_rt">([\s\S]*?)<\/h3>/)?.[1] ?? '').replace(/<[^>]*>/g, '').trim();
      const url = (block.match(/<a href="([^"]+)"/)?.[1] ?? '');
      const year = (block.match(/<div class="gs_a">[\s\S]*?(\d{4})/)?.[1] ?? '');
      const authors = (block.match(/<div class="gs_a">([\s\S]*?)-\s*\d{4}/)?.[1] ?? '').replace(/<[^>]*>/g, '').trim();
      if (title) items.push({ title, url, source: 'Google Scholar', year, authors });
    }
    return items;
  } catch {
    return [];
  }
}

/**
 * ResearchGate search (via HTML scraping).
 */
async function fetchResearchGate(query: string): Promise<ResearchResult[]> {
  const url = new URL('https://www.researchgate.net/search');
  url.searchParams.set('q', query);
  url.searchParams.set('type', 'publication');
  try {
    const text = await fetchText(url.toString(), 15000, { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36' });
    const items: ResearchResult[] = [];
    const entryRe = /<li class="publication-list-item[^"]*"[\s\S]*?<\/li>/g;
    let match;
    while ((match = entryRe.exec(text)) !== null && items.length < 10) {
      const block = match[1];
      const title = (block.match(/<h2[^>]*class="[^"]*publication-title[^"]*"[^>]*>([\s\S]*?)<\/h2>/)?.[1] ?? '').replace(/<[^>]*>/g, '').trim();
      const url = (block.match(/<a[^>]*href="([^"]+)"[^>]*class="[^"]*publication-title[^"]*"/)?.[1] ?? '');
      const year = (block.match(/<span[^>]*class="publication-year"[^>]*>(\d{4})<\/span>/)?.[1] ?? '');
      const authors = (block.match(/<span[^>]*class="author-names"[^>]*>([\s\S]*?)<\/span>/)?.[1] ?? '').replace(/<[^>]*>/g, '').trim();
      if (title) items.push({ title, url: url.startsWith('http') ? url : `https://www.researchgate.net${url}`, source: 'ResearchGate', year, authors });
    }
    return items.slice(0, 10);
  } catch {
    return [];
  }
}
