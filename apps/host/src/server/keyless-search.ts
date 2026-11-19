// Keyless web and image search.
//
// Aegis is local-first: the research path must work on a fresh install with no
// API keys at all. Parallel (the hosted research provider) needs a key, so this
// module provides the keyless tier that always works:
//
//   web search   : DuckDuckGo HTML -> Wikipedia search -> GDELT news
//   image search : Wikimedia Commons (keyless, licensed images)
//
// Every hit carries the URL it came from, and the payloads are small and
// bounded so a runaway query can never flood a turn.
import { parse } from 'parse5';

export interface WebHit {
  title: string;
  url: string;
  snippet: string;
  source: string;
}

export interface ImageHit {
  title: string;
  url: string;
  thumb: string;
  page: string;
  license: string;
}

const UA = 'aegis-desktop/0.1.0 (local-first assistant; +https://github.com/aegis)';

async function fetchText(
  url: string,
  init: RequestInit = {},
  timeoutMs = 15000,
): Promise<string> {
  const response = await fetch(url, {
    ...init,
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok)
    throw new Error(`Search provider returned HTTP ${response.status}.`);
  return response.text();
}

async function fetchJson(
  url: string,
  init: RequestInit = {},
  timeoutMs = 15000,
): Promise<unknown> {
  const text = await fetchText(url, init, timeoutMs);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Search provider returned a non-JSON payload.');
  }
}

const stripTags = (value: string): string =>
  value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** DuckDuckGo wraps result links in a redirect; unwrap it to the real URL. */
function unwrapDuckDuckGoUrl(href: string): string {
  try {
    const parsed = new URL(href, 'https://duckduckgo.com');
    const target = parsed.searchParams.get('uddg');
    return target ? decodeURIComponent(target) : parsed.toString();
  } catch {
    return href;
  }
}

function collectNodes(
  node: unknown,
  predicate: (attrs: Record<string, string>) => boolean,
): { attrs: Record<string, string>; text: string }[] {
  const found: { attrs: Record<string, string>; text: string }[] = [];
  const visit = (current: any) => {
    if (!current || typeof current !== 'object') return;
    const tag = current.tagName ?? '';
    const attrs: Record<string, string> = {};
    for (const attr of current.attrs ?? []) attrs[attr.name] = attr.value;
    if (tag && predicate(attrs))
      found.push({ attrs, text: textOf(current) });
    for (const child of current.childNodes ?? []) visit(child);
  };
  visit(node);
  return found;
}

function textOf(node: unknown): string {
  const parts: string[] = [];
  const visit = (current: any) => {
    if (!current || typeof current !== 'object') return;
    if (current.nodeName === '#text' && typeof current.value === 'string')
      parts.push(current.value);
    for (const child of current.childNodes ?? []) visit(child);
  };
  visit(node);
  return stripTags(parts.join(' '));
}

async function duckDuckGoSearch(
  query: string,
  limit: number,
): Promise<WebHit[]> {
  const body = new URLSearchParams({ q: query }).toString();
  const html = await fetchText('https://html.duckduckgo.com/html/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'text/html',
    },
    body,
  });
  const document = parse(html);
  const anchors = collectNodes(document, (attrs) =>
    Boolean(attrs.class?.includes('result__a')),
  );
  const snippets = collectNodes(document, (attrs) =>
    Boolean(attrs.class?.includes('result__snippet')),
  );
  const hits: WebHit[] = [];
  for (const anchor of anchors) {
    const url = unwrapDuckDuckGoUrl(anchor.attrs.href ?? '');
    if (!url.startsWith('http')) continue;
    if (hits.some((hit) => hit.url === url)) continue;
    hits.push({
      title: anchor.text || anchor.attrs.title || url,
      url,
      snippet: '',
      source: 'duckduckgo',
    });
    if (hits.length >= limit) break;
  }
  // Snippets live in sibling nodes; attach them in document order.
  const snippetTexts = snippets.map((node) => node.text);
  hits.forEach((hit, index) => {
    if (snippetTexts[index]) hit.snippet = snippetTexts[index].slice(0, 320);
  });
  return hits;
}

async function wikipediaSearch(query: string, limit: number): Promise<WebHit[]> {
  const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
    query,
  )}&srlimit=${Math.min(limit, 10)}&format=json&origin=*`;
  const payload = (await fetchJson(url)) as {
    query?: { search?: { title: string; snippet: string; pageid: number }[] };
  };
  return (payload.query?.search ?? []).map((row) => ({
    title: row.title,
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(row.title.replace(/ /g, '_'))}`,
    snippet: stripTags(row.snippet),
    source: 'wikipedia',
  }));
}

async function gdeltNewsSearch(query: string, limit: number): Promise<WebHit[]> {
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(
    query,
  )}&mode=artlist&format=json&maxrecords=${Math.min(limit, 20)}&sort=HybridRel`;
  const payload = (await fetchJson(url)) as {
    articles?: { title?: string; url?: string; domain?: string }[];
  };
  return (payload.articles ?? [])
    .filter((article) => article.url)
    .map((article) => ({
      title: article.title ?? article.domain ?? article.url ?? '',
      url: article.url ?? '',
      snippet: '',
      source: 'gdelt',
    }));
}

/**
 * Keyless web search with a fallback chain. Returns real hits or throws with
 * a readable reason; it never invents results.
 */
export async function keylessWebSearch(
  query: string,
  limit = 5,
): Promise<{ hits: WebHit[]; provider: string; limitations: string[] }> {
  const clean = query.trim();
  if (!clean) throw new Error('A search query is required.');
  const limitations: string[] = [];
  const attempts: [string, () => Promise<WebHit[]>][] = [
    ['duckduckgo', () => duckDuckGoSearch(clean, limit)],
    ['wikipedia', () => wikipediaSearch(clean, limit)],
    ['gdelt', () => gdeltNewsSearch(clean, limit)],
  ];
  for (const [provider, run] of attempts) {
    try {
      const hits = (await run()).filter((hit) => hit.url.startsWith('http'));
      if (hits.length) return { hits, provider, limitations };
      limitations.push(`${provider} returned no results for this query.`);
    } catch (error) {
      limitations.push(
        `${provider} unavailable: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }
  return { hits: [], provider: 'none', limitations };
}

/**
 * Keyless image search over Wikimedia Commons: freely licensed images with a
 * stable page URL and licence, which is what the gallery block needs.
 */
export async function keylessImageSearch(
  query: string,
  limit = 6,
): Promise<{ hits: ImageHit[]; provider: string }> {
  const clean = query.trim();
  if (!clean) throw new Error('An image search query is required.');
  const url = `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrsearch=${encodeURIComponent(
    clean,
  )}&gsrnamespace=6&gsrlimit=${Math.min(Math.max(limit, 1), 20)}&prop=imageinfo&iiprop=url|mime|extmetadata&iiurlwidth=800`;
  const payload = (await fetchJson(url)) as {
    query?: {
      pages?: Record<
        string,
        {
          title?: string;
          imageinfo?: {
            url?: string;
            thumburl?: string;
            descriptionurl?: string;
            mime?: string;
            extmetadata?: { LicenseShortName?: { value?: string } };
          }[];
        }
      >;
    };
  };
  const hits: ImageHit[] = [];
  for (const page of Object.values(payload.query?.pages ?? {})) {
    const info = page.imageinfo?.[0];
    if (!info?.url) continue;
    if (info.mime && !info.mime.startsWith('image/')) continue;
    hits.push({
      title: (page.title ?? '').replace(/^File:/, ''),
      url: info.url,
      thumb: info.thumburl ?? info.url,
      page: info.descriptionurl ?? info.url,
      license: info.extmetadata?.LicenseShortName?.value ?? 'see source page',
    });
    if (hits.length >= limit) break;
  }
  return { hits, provider: 'wikimedia-commons' };
}
