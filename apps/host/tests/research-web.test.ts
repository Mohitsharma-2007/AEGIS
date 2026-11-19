import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchNewsArticles } from '../src/server/research-web.js';

const rss = (title: string, pubDate: string, url: string) =>
  `<rss><channel><item><title>${title}</title><link>${url}</link><pubDate>${pubDate}</pubDate><source>Example News</source></item></channel></rss>`;

afterEach(() => vi.unstubAllGlobals());

describe('fetchNewsArticles', () => {
  it('merges live feeds and excludes articles outside today', async () => {
    const midday = new Date();
    midday.setHours(12, 0, 0, 0);
    const old = new Date(midday);
    old.setDate(old.getDate() - 2);
    const todayItem = {
      title: 'Today result',
      url: 'https://research.example/today',
      time: midday.toISOString(),
      domain: 'research.example',
      seendate: midday.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''),
    };
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes('api.gdeltproject.org')) {
        return new Response(JSON.stringify({ articles: [todayItem] }), { status: 200 });
      }
      if (url.includes('bing.com')) {
        return new Response(rss('Old result', old.toUTCString(), 'https://news.example/old'), { status: 200 });
      }
      return new Response(rss('Google result', midday.toUTCString(), 'https://news.example/google'), { status: 200 });
    }));

    const articles = await fetchNewsArticles('agent AI');
    expect(articles.map((article) => article.title)).toContain('Today result');
    expect(articles.map((article) => article.title)).toContain('Google result');
    expect(articles.map((article) => article.title)).not.toContain('Old result');
  });
});
