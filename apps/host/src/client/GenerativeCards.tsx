import { useEffect, useState } from 'react';
import { BookOpen, Cpu, Globe } from 'lucide-react';
import { api, getProviders, type ProvidersResponse } from './api';
import {
  computerToolResult,
  type ComputerToolRenderProps,
} from './ComputerToolCard';
import {
  previewKey,
  useBrowserPreviewStore,
  type LivePagePreview,
} from './browser-preview-context';

// AEGIS (W-GEN): CopilotKit generative-UI cards for chat, built with the
// mechanisms this app already uses   backend tool calls render through
// the same useRenderTool wildcard in Chat.tsx as ComputerToolCard, and
// the two frontend tools (show_provider_status / show_memory_sources)
// render through useFrontendTool's render in Chat.tsx. Every card shows
// only real tool results / real API data; missing data is an honest
// empty state, never a placeholder. Styling reuses the existing card
// classes (.inline-computer for tool activity, .page-review-card for
// frontend-tool cards)   no new visual framework.

// ---------------------------------------------------------------------
// 1. Browser activity card   the read_public_page backend tool.
// The browser variant of the tool returns {title, url, text, engine,
// The browser variant of the tool returns {title, url, text, engine} and
// no screenshot in the chat path; the Parallel variant returns {sources,
// limitations}. When the result carries no screenshot, the live preview is
// loaded for real through the server browse-preview proxy, keyed by the
// page URL.
// ---------------------------------------------------------------------
type BrowsePreview = {
  url: string;
  title: string;
  screenshot: string;
  engine: string;
};

/** "Engine: playwright" label (single engine)   kept for tool cards. */
export function browseEngineLabel(data: Record<string, unknown>): string {
  const engine = typeof data.engine === 'string' ? data.engine : '';
  if (!engine) return '';
  return `Engine: ${engine}`;
}

function browseSources(data: Record<string, unknown>): {
  title: string;
  url: string;
}[] {
  if (!Array.isArray(data.sources)) return [];
  return data.sources.flatMap((source) => {
    if (!source || typeof source !== 'object') return [];
    const record = source as Record<string, unknown>;
    return typeof record.url === 'string'
      ? [
          {
            title: typeof record.title === 'string' ? record.title : record.url,
            url: record.url,
          },
        ]
      : [];
  });
}

export function BrowserActivityCard({
  status,
  args,
  result,
}: ComputerToolRenderProps) {
  const data = computerToolResult(result);
  const parameters = computerToolResult(args);
  const sources = browseSources(data);
  const url =
    typeof data.url === 'string'
      ? data.url
      : typeof parameters.url === 'string'
        ? parameters.url
        : (sources[0]?.url ?? '');
  const title =
    typeof data.title === 'string' ? data.title : (sources[0]?.title ?? '');
  const inlineScreenshot =
    typeof data.screenshot === 'string' &&
    data.screenshot.startsWith('data:image/')
      ? data.screenshot
      : '';
  // The turn stores the page it loaded (with its screenshot) before the model
  // finishes answering. Draw that real capture immediately instead of waiting
  // for the tool result   re-browsing is not possible, the browser service is
  // busy with this turn and answers "Browser is busy".
  const { threadId, previews } = useBrowserPreviewStore();
  const live = url ? previews[previewKey(url)] : undefined;
  const [pushed, setPushed] = useState<LivePagePreview>();
  const complete = status === 'complete';
  const error = typeof data.error === 'string' ? data.error : '';
  const engineLabel = browseEngineLabel(data);
  const excerpt = typeof data.text === 'string' ? data.text.slice(0, 400) : '';
  // Live preview via the browse-preview proxy. It starts as soon as the URL
  // is known (while the tool is still working), not only after it finishes, so
  // browsing is watchable instead of a silent background job.
  const [preview, setPreview] = useState<BrowsePreview>();
  const [previewError, setPreviewError] = useState('');
  useEffect(() => {
    if (!url || inlineScreenshot || live?.screenshot || !threadId) return;
    let active = true;
    let timer = 0;
    const tick = async () => {
      try {
        const response = await api<{
          preview: LivePagePreview | null;
        }>(`/conversations/${threadId}/preview`, 'GET');
        if (!active) return;
        // Only this card's page: a thread keeps the capture of its previous
        // turn until the new one is written.
        if (
          response.preview?.screenshot &&
          previewKey(response.preview.url) === previewKey(url)
        ) {
          setPushed(response.preview);
          return;
        }
      } catch {
        // the capture is not written yet; poll again
      }
      if (active) timer = window.setTimeout(tick, 1200);
    };
    void tick();
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [url, inlineScreenshot, live?.screenshot, threadId]);
  useEffect(() => {
    if (!url || inlineScreenshot || live?.screenshot || pushed?.screenshot) return;
    const controller = new AbortController();
    setPreview(undefined);
    setPreviewError('');
    void api<BrowsePreview>(
      '/browse-preview',
      'POST',
      { url },
      controller.signal,
    )
      .then((value) => {
        if (!controller.signal.aborted) setPreview(value);
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setPreviewError(
            cause instanceof Error
              ? cause.message
              : 'Browser preview unavailable.',
          );
      });
    return () => controller.abort();
  }, [url, inlineScreenshot]);
  const previewLabel = preview ? browseEngineLabel(preview) : '';
  const liveScreenshot = live?.screenshot ?? pushed?.screenshot ?? '';
  const livePreview = live ?? pushed;
  return (
    <section
      className="inline-computer with-screen"
      aria-label={`Browser activity: ${title || url || 'reading page'}`}
    >
      <header>
        <Globe size={16} aria-hidden="true" />
        <strong>{title || 'Reading page'}</strong>
        <span className={error ? 'tool-state failed' : 'tool-state'}>
          {error ? 'Needs attention' : complete ? 'Finished' : 'Working'}
        </span>
      </header>
      {url && (
        <div className="inline-computer-detail" title={url}>
          {url}
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {engineLabel && (
        <div className="inline-computer-caption">{engineLabel}</div>
      )}
      {excerpt && <p>{excerpt}</p>}
      {sources.length > 1 && (
        <div className="inline-computer-caption">
          {sources.length} sources read
        </div>
      )}
      {!complete && !error && (
        <div className="browser-live-bar" aria-hidden="true">
          <span />
        </div>
      )}
      {(inlineScreenshot || liveScreenshot || preview || previewError || url) && (
        <div className="inline-computer-preview">
          <div className="inline-computer-caption">
            <span className="live-indicator" />
            {inlineScreenshot
              ? `Page preview${engineLabel ? `   ${engineLabel}` : ''}`
              : liveScreenshot
                ? 'Live page preview   captured as the browser loaded it'
                : preview
                ? `Live preview via browse preview${previewLabel ? `   ${previewLabel}` : ''}`
                : 'Live preview via browse preview'}
          </div>
          {inlineScreenshot && (
            <img src={inlineScreenshot} alt={`Preview of ${title || url}`} />
          )}
          {liveScreenshot && (
            <img
              src={liveScreenshot}
              alt={`Live preview of ${livePreview?.title || title || url}`}
            />
          )}
          {!inlineScreenshot && !liveScreenshot && preview && (
            <img
              src={preview.screenshot}
              alt={`Preview of ${preview.title || preview.url}`}
            />
          )}
          {!inlineScreenshot &&
            !liveScreenshot &&
            !preview &&
            (previewError ? (
              <p role="status">Preview unavailable: {previewError}</p>
            ) : (
              <div className="browser-preview-loading" role="status">
                <span className="browser-preview-skeleton" />
                <p>Opening the live preview </p>
              </div>
            ))}
          {(inlineScreenshot || liveScreenshot || preview) && (
            <div className="inline-computer-url">
              {(livePreview?.url || url) ?? ''}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------
// 3. Provider / model status card   the show_provider_status frontend
// tool. Its handler (registered in Chat.tsx) fetches GET /api/providers
// and returns that payload; CopilotKit delivers it to render as the
// tool result (JSON string), parsed here. Fixture-shaped results in
// tests are the real ProvidersResponse shape.
// ---------------------------------------------------------------------
export function parseProvidersResult(
  result: unknown,
): ProvidersResponse | null {
  const data = computerToolResult(result);
  if (!Array.isArray(data.providers) || !data.active) return null;
  return data as unknown as ProvidersResponse;
}

export function ProviderStatusCard({
  status,
  args,
  result,
}: {
  status: string;
  args?: unknown;
  result?: unknown;
}) {
  // AEGIS (W-FIX 1c): the tool result delivered to the model is now a
  // compact summary (the full /api/providers payload overflowed
  // strict providers' token limits on the delivery run   the
  // "delivery failed" error). A full-shaped result still renders
  // directly; a summary triggers the card's own fetch of the full
  // payload, which is also what makes the card genuinely live.
  const fromResult = status === 'complete' ? parseProvidersResult(result) : null;
  const [fetched, setFetched] = useState<ProvidersResponse | null>(null);
  const [fetchFailed, setFetchFailed] = useState(false);
  useEffect(() => {
    if (status !== 'complete' || fromResult) return;
    let active = true;
    void getProviders()
      .then((value) => {
        if (active) setFetched(value);
      })
      .catch(() => {
        if (active) setFetchFailed(true);
      });
    return () => {
      active = false;
    };
  }, [status, fromResult]);
  const data = fromResult ?? fetched;
  const parameters = computerToolResult(args);
  const focusedId =
    typeof parameters.provider_id === 'string' ? parameters.provider_id : '';
  const failed = status === 'complete' && fetchFailed;
  const activeId = data?.active.providerId ?? '';
  const activeProvider =
    data?.providers.find((provider) => provider.id === activeId) ??
    data?.catalogue?.find((provider) => provider.id === activeId);
  // The favourites are the registry providers; when only a catalogue
  // payload is present they are its favourite entries.
  const favourites =
    data && data.providers.length
      ? data.providers.map((provider) => ({
          id: provider.id,
          label: provider.label,
          configured: provider.configured,
        }))
      : (data?.catalogue ?? [])
          .filter((provider) => provider.favourite)
          .map((provider) => ({
            id: provider.id,
            label: provider.label,
            configured: provider.configured,
          }));
  return (
    <section
      className="page-review-card connection-action-card"
      aria-label="Provider status"
    >
      <header>
        <Cpu size={17} />
        <strong>Provider status</strong>
        <span>{failed ? 'Unavailable' : data ? 'Live' : 'Checking'}</span>
      </header>
      <div className="page-review-body">
        {data ? (
          <>
            <h3>
              {activeProvider?.label ?? activeId ?? 'No provider selected'}
              {data.active.model ? `   ${data.active.model}` : ''}
            </h3>
            <dl className="connection-action-args">
              <div>
                <dt>Active provider</dt>
                <dd>{activeId || 'Not selected'}</dd>
              </div>
              <div>
                <dt>Model</dt>
                <dd>{data.active.model ?? 'Not selected'}</dd>
              </div>
              <div>
                <dt>Catalogue source</dt>
                <dd>
                  {data.catalogueSource === 'live'
                    ? 'models.dev (live)'
                    : data.catalogueSource === 'snapshot'
                      ? 'models.dev (bundled snapshot)'
                      : 'Not reported'}
                </dd>
              </div>
              {favourites.map((provider) => (
                <div key={provider.id}>
                  <dt>{provider.label}</dt>
                  <dd>
                    {provider.configured ? 'Configured' : 'Not configured'}
                    {provider.id === focusedId
                      ? ' · focus of this question'
                      : ''}
                  </dd>
                </div>
              ))}
            </dl>
          </>
        ) : failed ? (
          <p>Provider status could not be loaded.</p>
        ) : (
          <p>Checking provider status </p>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------
// 4. Memory citation card   the show_memory_sources frontend tool. Its
// handler searches the daemon memory through the client api
// (searchAegisMemory) and enriches each top hit with its capture record
// (getAegisCapture) so the card can show real provenance: source + id.
// ---------------------------------------------------------------------
export type MemorySourceHit = {
  text: string;
  capture_id: string;
  score?: number;
  source?: string | null;
  kind?: string | null;
};
export type MemorySourcesResult = {
  reachable: boolean;
  query?: string;
  results: MemorySourceHit[];
  citations: string[];
  abstained: boolean;
};

export function parseMemorySourcesResult(
  result: unknown,
): MemorySourcesResult | null {
  const data = computerToolResult(result);
  if (!Array.isArray(data.results)) return null;
  return {
    reachable: data.reachable !== false,
    query: typeof data.query === 'string' ? data.query : undefined,
    results: data.results.flatMap((hit) => {
      if (!hit || typeof hit !== 'object') return [];
      const record = hit as Record<string, unknown>;
      return typeof record.capture_id === 'string' &&
        typeof record.text === 'string'
        ? [
            {
              text: record.text,
              capture_id: record.capture_id,
              ...(typeof record.score === 'number'
                ? { score: record.score }
                : {}),
              source: typeof record.source === 'string' ? record.source : null,
              kind: typeof record.kind === 'string' ? record.kind : null,
            },
          ]
        : [];
    }),
    citations: Array.isArray(data.citations)
      ? data.citations.filter(
          (citation): citation is string => typeof citation === 'string',
        )
      : [],
    abstained: data.abstained === true,
  };
}

export function MemorySourcesCard({
  status,
  args,
  result,
}: {
  status: string;
  args?: unknown;
  result?: unknown;
}) {
  const data = status === 'complete' ? parseMemorySourcesResult(result) : null;
  const parameters = computerToolResult(args);
  const query =
    data?.query ??
    (typeof parameters.query === 'string' ? parameters.query : '');
  const failed = status === 'complete' && !data;
  return (
    <section
      className="page-review-card connection-action-card"
      aria-label="Memory sources"
    >
      <header>
        <BookOpen size={17} />
        <strong>Memory sources</strong>
        <span>
          {failed
            ? 'Unavailable'
            : data
              ? data.reachable
                ? `${data.results.length} ${data.results.length === 1 ? 'capture' : 'captures'}`
                : 'Daemon offline'
              : 'Searching'}
        </span>
      </header>
      <div className="page-review-body">
        {query && <h3>{query}</h3>}
        {data ? (
          !data.reachable ? (
            <p>
              The Aegis memory daemon is not reachable, so no memory sources can
              be shown.
            </p>
          ) : data.results.length ? (
            data.results.map((hit) => (
              <div className="connection-action-result" key={hit.capture_id}>
                <strong>
                  {hit.source ?? 'unknown source'} · capture {hit.capture_id}
                  {typeof hit.score === 'number'
                    ? `   score ${hit.score.toFixed(2)}`
                    : ''}
                </strong>
                <pre>{hit.text}</pre>
              </div>
            ))
          ) : (
            <p>
              {data.abstained
                ? 'No memory matches that closely enough to cite.'
                : 'No memory captures matched.'}
            </p>
          )
        ) : failed ? (
          <p>Memory sources could not be loaded.</p>
        ) : (
          <p>Searching Aegis memory </p>
        )}
      </div>
    </section>
  );
}
