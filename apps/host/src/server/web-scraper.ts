// WebScraper - Web content extraction for Aegis
// Provides server-side web page fetching and text extraction
// Used by agent-swarm for web research tasks

import { fetchText } from './research-web.js';

export interface WebScrapeResult {
  url: string;
  title: string;
  text: string;
  links: string[];
  images: string[];
  error?: string;
}

/**
 * Scrape a web page and extract readable text content.
 * Uses a simple text extraction approach that strips HTML tags
 * and preserves readable content.
 */
export async function scrapeWebPage(url: string): Promise<WebScrapeResult> {
  try {
    const html = await fetchText(url, 15000, { 'User-Agent': 'Aegis/1.0 (web scraper)' });
    
    // Extract title
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].replace(/<[^>]*>/g, '').trim() : url;

    // Extract text content - remove scripts, styles, and HTML tags
    let text = html
      .replace(/<script[\s\S]*?<\/script>/g, ' ')
      .replace(/<style[\s\S]*?<\/style>/g, ' ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();

    // Extract links
    const links: string[] = [];
    const linkRe = /<a[^>]+href="([^"]+)"[^>]*>/gi;
    let linkMatch;
    while ((linkMatch = linkRe.exec(html)) !== null) {
      links.push(linkMatch[1]);
    }

    // Extract images
    const images: string[] = [];
    const imgRe = /<img[^>]+src="([^"]+)"[^>]*>/gi;
    let imgMatch;
    while ((imgMatch = imgRe.exec(html)) !== null) {
      images.push(imgMatch[1]);
    }

    return {
      url,
      title,
      text: text.slice(0, 50000), // Limit to 50KB
      links: links.slice(0, 50),
      images: images.slice(0, 20),
    };
  } catch (error) {
    return {
      url,
      title: '',
      text: '',
      links: [],
      images: [],
      error: error instanceof Error ? error.message : 'Failed to scrape page',
    };
  }
}

/**
 * Scrape multiple URLs in parallel with concurrency limit.
 */
export async function scrapeWebPages(urls: string[]): Promise<WebScrapeResult[]> {
  const results: WebScrapeResult[] = [];
  const concurrency = 3;
  
  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(url => scrapeWebPage(url)));
    results.push(...batchResults);
  }
  
  return results;
}

/**
 * Search the web using DuckDuckGo HTML (keyless).
 */
export async function webSearch(query: string, maxResults: number = 10): Promise<WebScrapeResult[]> {
  try {
    const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const html = await fetchText(url, 15000, { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36' });
    
    const results: WebScrapeResult[] = [];
    const resultRe = /<div class="result"[\s\S]*?<\/div>\s*<\/div>/g;
    let match;
    
    while ((match = resultRe.exec(html)) !== null && results.length < maxResults) {
      const block = match[1];
      const titleMatch = block.match(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
      const snippetMatch = block.match(/<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
      
      if (titleMatch && url) {
        const title = titleMatch[1].replace(/<[^>]*>/g, '').trim();
        const resultUrl = titleMatch[1];
        const snippet = (snippetMatch?.[1] ?? '').replace(/<[^>]*>/g, '').trim();
        
        results.push({
          url: resultUrl,
          title,
          text: snippet,
          links: [],
          images: [],
        });
      }
    }
    
    return results;
  } catch (error) {
    console.error('Web search failed:', error);
    return [];
  }
}