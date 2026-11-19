// Aegis Finance page - Google Finance style dashboard
// Provides real-time stock quotes, charts, graphs, and news
import { useCallback, useEffect, useRef, useState } from 'react';
import { Search, TrendingUp, TrendingDown, RefreshCw, Share2 } from 'lucide-react';
import { fetchFinanceQuote, fetchNewsArticles } from '../server/research-web.js';

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

export function FinancePage() {
  const [quote, setQuote] = useState<FinanceQuote | null>(null);
  const [news, setNews] = useState<NewsArticle[]>([]);
  const [loading, setLoading] = useState(false);
  const [symbol, setSymbol] = useState('AAPL');
  const [error, setError] = useState<string | null>(null);
  const chartRef = useRef<HTMLCanvasElement>(null);

  const fetchQuote = async (symbol: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/finance?symbol=${encodeURIComponent(symbol)}`);
      const data = await response.json();
      if (data.ok && data.quote) {
        setQuote(data.quote);
      } else {
        setError(data.error || 'Failed to fetch quote');
      }
    } catch (e) {
      setError(error instanceof Error ? e.message : 'Failed to fetch quote');
    } finally {
      setLoading(false);
    }
  };

  const fetchNews = async (query: string) => {
    try {
      const response = await fetch(`/api/news?q=${encodeURIComponent(query)}`);
      const data = await response.json();
      if (data.ok && data.articles) {
        setNews(data.articles);
      }
    } catch (e) {
      console.error('News fetch failed:', e);
    }
  };

  const handleSearch = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && symbol.trim()) {
      setLoading(true);
      fetchQuote(symbol.trim());
      fetchNews(symbol.trim());
    }
  };

  useEffect(() => {
    fetchQuote(symbol);
    fetchNews(symbol);
  }, [symbol]);

  // Draw chart
  useEffect(() => {
    if (!quote?.price) return;
    const canvas = chartRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Mock price data for chart visualization
    const points = 50;
    const basePrice = quote.price || 100;
    const pointsData: number[] = [];
    for (let i = 0; i < points; i++) {
      const variation = Math.sin(i / 5) * (quote.price || 100) * 0.05;
      const noise = (Math.random() - 0.5) * (quote.price || 100) * 0.02;
      pointsData.push(basePrice + variation + noise);
    }

    const maxPrice = Math.max(...pointsData);
    const minPrice = Math.min(...pointsData);
    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;
    const padding = 20;

    // Draw grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {
      const y = padding + (canvasHeight - padding * 2) * (i / 5);
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(canvasWidth - padding, y);
      ctx.stroke();
    }

    // Draw price line
    ctx.beginPath();
    ctx.strokeStyle = changePercent >= 0 ? '#10b981' : '#ef4444';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(padding, canvasHeight - padding - ((pointsData[0] - minPrice) / (maxPrice - minPrice)) * (canvasHeight - padding * 2));
    for (let i = 1; i < pointsData.length; i++) {
      const x = padding + (i / (pointsData.length - 1)) * (canvasWidth - padding * 2);
      const y = canvasHeight - padding - ((pointsData[i] - minPrice) / (maxPrice - minPrice)) * (canvasHeight - padding * 2);
      ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Fill area under line
    ctx.fillStyle = changePercent >= 0 ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)';
    ctx.lineTo(canvasWidth - padding, canvasHeight - padding);
    ctx.lineTo(padding, canvasHeight - padding);
    ctx.closePath();
    ctx.fill();
  }, [quote]);

  const changeValue = quote?.changePercent ?? 0;
  const isUp = changeValue >= 0;
  const absChange = Math.abs(changeValue || 0);

  return (
    <div className="finance-page">
      {/* Header */}
      <div className="finance-header">
        <div className="finance-header-left">
          <div className="finance-brand">
            <div className="finance-mark">A</div>
            <span>Aegis</span>
          </div>
          <div className="finance-subtitle">Real-time market data and news</div>
        </div>
        <div className="finance-search-wrapper">
          <div className="finance-search-box">
            <Search size={14} />
            <input
              type="text"
              placeholder="Search symbol (e.g., AAPL, TSLA, MSFT)"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              onKeyDown={handleSearch}
              className="finance-search-input"
            />
          </div>
          <button
            type="button"
            className="finance-search-button"
            onClick={() => {
              setLoading(true);
              fetchQuote(symbol.trim());
              fetchNews(symbol.trim());
            }}
            disabled={loading}
          >
            {loading ? <RefreshCw size={16} className="animate-spin" /> : <Search size={14} />}
          </button>
        </div>
      </div>

      {error && (
        <div className="finance-error">
          <span>⚠️</span> {error}
        </div>
      )}

      {/* Quote Card */}
      {quote && (
        <div className="quote-card">
          <div className="quote-header">
            <div className="quote-symbol">{quote.symbol}</div>
            <span className="quote-name">{quote.name}</span>
            <div className="quote-exchange">{quote.exchange}</div>
          </div>
          <div className="quote-price-container">
            <span className="quote-price">
              {quote.price ? quote.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
            </span>
            <span className={`quote-change ${isUp ? 'text-green-600' : 'text-red-600'}`}>
              {changeValue >= 0 ? '+' : ''}{changeValue?.toFixed(2)}%
            </span>
            <span className={`quote-change-abs ${isUp ? 'text-green-600' : 'text-red-600'}`}>
              {changeValue >= 0 ? '+' : ''}{changeValue?.toFixed(2)}
            </span>
          </div>
          <div className="quote-details">
            <div className="quote-detail">
              <span className="quote-detail-label">Previous Close</span>
              <span className="quote-detail-value">{quote.previousClose?.toFixed(2)}</span>
            </div>
            <div className="quote-detail">
              <span className="quote-detail-label">Day High</span>
              <span className="quote-detail-value">{quote.dayHigh?.toFixed(2)}</span>
            </div>
            <div className="quote-detail">
              <span className="quote-detail-label">Day Low</span>
              <span className="quote-detail-value">{quote.dayLow?.toFixed(2)}</span>
            </div>
            <div className="quote-detail">
              <span className="quote-detail-label">52 Week High</span>
              <span className="quote-detail-value">{quote.high52?.toFixed(2)}</span>
            </div>
            <div className="quote-detail">
              <span className="quote-detail-label">52 Week Low</span>
              <span className="quote-detail-value">{quote.low52?.toFixed(2)}</span>
            </div>
            <div className="quote-detail">
              <span className="quote-detail-label">Volume</span>
              <span className="quote-detail-value">{quote.volume?.toLocaleString()}</span>
            </div>
          </div>
          <div className="quote-chart">
            <canvas ref={chartRef} width={400} height={200} />
          </div>
        </div>
      )}

      {/* News Section */}
      <div className="finance-news-section">
        <div className="finance-news-header">
          <h2 className="finance-section-title">Latest News</h2>
          <span className="finance-news-count">{news.length} articles</span>
        </div>
        {loading && (
          <div className="finance-loading">
            <RefreshCw size={16} className="animate-spin" />
            <span>Loading news...</span>
          </div>
        )}
        {news.length === 0 && !loading && (
          <p className="finance-news-empty">No news found for {symbol}</p>
        )}
        {news.map((article, index) => (
          <div key={article.url || index} className="finance-news-item">
            <h3 className="finance-news-title">{article.title}</h3>
            <div className="finance-news-meta">
              <span className="finance-news-source">{article.source}</span>
              <span className="finance-news-time">{article.time}</span>
            </div>
            <a href={article.url} target="_blank" rel="noopener noreferrer" className="finance-news-link">
              Read more →
            </a>
          </div>
        ))}
      </div>

      <div className="finance-disclaimer">
        <p>
          Market data provided by Yahoo Finance. Data may be delayed by up to 15 minutes.
          Not financial advice.
        </p>
      </div>
    </div>
  );
}

export default FinancePage;
