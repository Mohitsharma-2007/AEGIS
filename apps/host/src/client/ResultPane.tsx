import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ArrowDownToLine,
  ArrowUpRight,
  BookOpen,
  ExternalLink,
  Globe,
  Maximize2,
  Minimize2,
  Monitor,
  X,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Dot, Result, Status } from '../shared/types';
import { Mascot } from './Mascot';
import { ComputerPanel } from './ComputerPanel';
import { MermaidBlock } from './MermaidBlock';
import { FencedChart } from './VisualCards';

// Inside a brief, a fenced chart/visual block is drawn as a real chart; a
// fenced mermaid block is drawn as a diagram. Neither should stay wrapped in a
// <pre>, which would show raw JSON or clash with the drawn block.
const FENCE_PATTERN = /language-(chart|visual|mermaid)\b/;
function BriefPre({ children }: { children?: ReactNode }) {
  const child = Array.isArray(children) ? children[0] : children;
  const className =
    (child as { props?: { className?: string } } | undefined)?.props?.className ?? '';
  return FENCE_PATTERN.test(className) ? <>{children}</> : <pre>{children}</pre>;
}

export type ResultPaneTab =
  | 'Brief'
  | 'Computer'
  | 'Browser'
  | 'Files'
  | 'Terminal'
  | 'Activity'
  | 'Document';

// The live preview is useful at a glance but cramped at the old 400px width,
// so the split view gets a drag handle. The pane sits on the right, which means
// dragging its left edge leftwards is what widens it.
const PANE_DEFAULT_WIDTH = 460;
const PANE_WIDE_WIDTH = 760;
const PANE_MIN_WIDTH = 360;
const PANE_MAX_WIDTH = 1100;

export function ResultPane({
  latest,
  status,
  dotState,
  onClose,
  dots,
  defaultDotId,
  focusTab,
  resizable = false,
}: {
  dots: Dot[];
  defaultDotId: string;
  latest?: Result | null;
  status?: Status;
  dotState: string;
  onClose: () => void;
  /** Browsing selects Computer; a new brief selects Brief. A new token means
   *  "act on this now", so re-selecting the same tab still takes effect. */
  focusTab?: { tab: ResultPaneTab; token: number };
  /** Split view: add a drag handle so the owner can size the live preview. */
  resizable?: boolean;
}) {
  const [resultTab, setResultTab] = useState<ResultPaneTab>(
    latest ? 'Brief' : 'Computer',
  );
  const [wide, setWide] = useState(false);
  const [paneWidth, setPaneWidth] = useState(() => {
    const saved =
      typeof localStorage === 'undefined'
        ? Number.NaN
        : Number(localStorage.getItem('aegis-pane-width'));
    return Number.isFinite(saved) &&
      saved >= PANE_MIN_WIDTH &&
      saved <= PANE_MAX_WIDTH
      ? saved
      : PANE_DEFAULT_WIDTH;
  });
  useEffect(() => {
    if (resizable && typeof localStorage !== 'undefined')
      localStorage.setItem('aegis-pane-width', String(paneWidth));
  }, [paneWidth, resizable]);
  const paneDragRef = useRef<{ startX: number; startWidth: number } | null>(
    null,
  );
  useEffect(() => {
    if (!resizable) return;
    const onMove = (event: MouseEvent) => {
      const drag = paneDragRef.current;
      if (!drag) return;
      const next = Math.min(
        PANE_MAX_WIDTH,
        Math.max(PANE_MIN_WIDTH, drag.startWidth - (event.clientX - drag.startX)),
      );
      setPaneWidth(next);
    };
    const onUp = () => {
      if (paneDragRef.current) {
        paneDragRef.current = null;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [resizable]);
  const startPaneResize = (event: {
    clientX: number;
    preventDefault: () => void;
  }) => {
    paneDragRef.current = { startX: event.clientX, startWidth: paneWidth };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    event.preventDefault();
  };
  const wideActive = resizable
    ? paneWidth > (PANE_DEFAULT_WIDTH + PANE_WIDE_WIDTH) / 2
    : wide;
  const toggleWide = () => {
    if (resizable) {
      setPaneWidth((value) =>
        value > (PANE_DEFAULT_WIDTH + PANE_WIDE_WIDTH) / 2
          ? PANE_DEFAULT_WIDTH
          : PANE_WIDE_WIDTH,
      );
    } else {
      setWide((value) => !value);
    }
  };
  // A newly arrived brief selects its own tab instead of leaving the owner to
  // find it behind the Computer tab.
  const briefText = latest?.text ?? '';
  // Select the Brief tab when a brief starts arriving, not on every streamed
  // token: the per-token version of this effect overrode the Computer focus a
  // browse turn had just set, so browsing never showed its own tab.
  const showingBrief = useRef(false);
  useEffect(() => {
    if (briefText && !showingBrief.current) {
      showingBrief.current = true;
      setResultTab('Brief');
    } else if (!briefText) showingBrief.current = false;
  }, [briefText]);
  const focusToken = focusTab?.token;
  useEffect(() => {
    if (focusTab) setResultTab(focusTab.tab);
  }, [focusToken]);
  const computerDot =
    dots.find((dot) => dot.id === defaultDotId) ??
    dots.find((dot) => dot.id === defaultDotId) ??
    dots[0];
  return (
    <aside
      className={`result-pane${resizable ? ' resizable' : ''}${
        !resizable && wide ? ' wide' : ''
      }`}
      style={resizable ? { width: paneWidth } : undefined}
    >
      {resizable && (
        <div
          className="result-pane-resize"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize live preview"
          title="Drag to resize   double-click to reset"
          onMouseDown={startPaneResize}
          onDoubleClick={() => setPaneWidth(PANE_DEFAULT_WIDTH)}
        />
      )}
      <div className={resizable ? 'result-pane-scroll' : undefined}>
        <div className="pane-header">
          <div className="pane-tabs">
            <button
              className={resultTab === 'Brief' ? 'selected' : ''}
              onClick={() => setResultTab('Brief')}
              title="Research & Conversation Brief"
            >
              <BookOpen size={14} />
              <span>Brief</span>
            </button>
            <button
              className={resultTab === 'Computer' ? 'selected' : ''}
              onClick={() => setResultTab('Computer')}
              title="AEGIS Computer: live screen, control handoff and permissions"
            >
              <Monitor size={14} />
              <span>Computer</span>
            </button>
            <button
              className={resultTab === 'Browser' ? 'selected' : ''}
              onClick={() => setResultTab('Browser')}
              title="Playwright Browser Preview"
            >
              <Globe size={14} />
              <span>Browser</span>
            </button>
          </div>
          <button
            className="icon-button"
            aria-label={
              wideActive ? 'Restore result panel width' : 'Widen result panel'
            }
            title={wideActive ? 'Restore width' : 'Widen'}
            aria-pressed={wideActive}
            onClick={toggleWide}
          >
            {wideActive ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
          <button
            className="icon-button"
            aria-label="Close result panel"
            onClick={() => onClose()}
          >
            <X size={16} />
          </button>
        </div>
        {resultTab === 'Computer' ? (
          computerDot ? (
            <ComputerPanel
              key={`pane:${computerDot.id}`}
              dot={computerDot}
              section="Computer"
              hideTabNav
              previewOnly
            />
          ) : (
            <p className="computer-panel">
              Create an Agent to give it an AEGIS Computer.
            </p>
          )
        ) : resultTab === 'Browser' ? (
          <>
            {computerDot ? (
              <ComputerPanel
                key={computerDot.id}
                dot={computerDot}
                browserOnly
                hideTabNav
                previewOnly
              />
            ) : (
              <p className="computer-panel">
                Create an Agent to give it an AEGIS Computer.
              </p>
            )}
          </>
        ) : latest ? (
          <div className="result-content">
            <div className="result-meta">
              <span className="eyebrow">
                {latest.sample ? 'FICTIONAL SAMPLE BRIEF' : 'RESEARCH BRIEF'}
              </span>
              <button
                className="icon-button"
                aria-label="Download brief"
                onClick={() => {
                  const blob = new Blob(
                    [
                      latest.text +
                        '\n\nSources\n' +
                        latest.sources
                          .map((s) => `${s.title}: ${s.url}`)
                          .join('\n'),
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
                <ArrowDownToLine size={16} />
              </button>
            </div>
            {latest.sample && (
              <div className="sample-note">
                An example of what an Agent can do. The findings and sources
                below are invented.
              </div>
            )}
            {latest.screenshot && (
              <figure className="result-screenshot">
                <img
                  src={latest.screenshot}
                  alt="Browser preview of the researched page"
                />
                <figcaption>
                  Browser preview
                  {latest.engine ? `   engine: ${latest.engine}` : ''}
                </figcaption>
              </figure>
            )}
            <article className="brief">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  img: ({ alt }) => (
                    <span>{alt ? `[Image: ${alt}]` : '[Image omitted]'}</span>
                  ),
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
                  pre: ({ children }) => <BriefPre>{children}</BriefPre>,
                  code: ({ className, children }) => {
                    const language = (className ?? '').replace(
                      'language-',
                      '',
                    );
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
                {latest.text}
              </ReactMarkdown>
            </article>
            <section className="sources">
              <h3>
                Source notes <span>{latest.sources.length}</span>
              </h3>
              {latest.sources.map((source) =>
                latest.sample ? (
                  <div className="source-card" key={source.url}>
                    <span className="source-icon">
                      <BookOpen size={15} />
                    </span>
                    <div>
                      <strong>{source.title}</strong>
                      <p>{source.excerpt}</p>
                      <small>Fictional source   not a live link</small>
                    </div>
                  </div>
                ) : (
                  <a
                    className="source-card"
                    href={source.url}
                    key={source.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <span className="source-icon">
                      <ExternalLink size={15} />
                    </span>
                    <div>
                      <strong>{source.title}</strong>
                      <p>{source.excerpt}</p>
                      <small>{new URL(source.url).hostname}</small>
                    </div>
                    <ArrowUpRight size={15} />
                  </a>
                ),
              )}
            </section>
          </div>
        ) : (
          <div className="pane-empty">
            <Mascot
              identity={defaultDotId}
              name={dots.find((dot) => dot.id === defaultDotId)?.name}
              state={dotState}
            />
            <h3>A little space for your findings.</h3>
            <p>
              {status === 'failed'
                ? 'Resolve the error and retry to create a research brief.'
                : 'Your brief and sources will appear here after a successful run.'}
            </p>
          </div>
        )}
      </div>
    </aside>
  );
}
