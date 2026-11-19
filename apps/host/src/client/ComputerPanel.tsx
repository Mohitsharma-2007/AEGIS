import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity as ActivityIcon,
  AppWindow,
  ArrowLeft,
  ArrowRight,
  Camera,
  Crop,
  FileText,
  FolderOpen,
  Globe,
  Maximize2,
  Minimize2,
  Monitor,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Terminal as TerminalIcon,
  X,
} from 'lucide-react';
import type { Dot } from '../shared/types';
import type { ComputerAction, ComputerStatus } from '../shared/computer-types';
import { api } from './api';

type Screen = {
  base64: string;
  width: number;
  height: number;
  url: string;
  capturedAt: number;
  format?: string;
};

// AEGIS: dual-browser preview via the browser service (POST /api/browse-preview).
// 'computer' uses this panel's own AEGIS Computer browser (Playwright screenshot);
// The browser preview is the Playwright-only AEGIS Computer browser.
type BrowsePreview = {
  url: string;
  title: string;
  screenshot: string;
  engine: string;
  requestedEngine?: string;
  engineFallback?: boolean;
};
export type ComputerTab =
  | 'Computer'
  | 'Browser'
  | 'Documents/Files'
  | 'Terminal'
  | 'Activity';

export function ComputerPanel({
  dot,
  browserOnly = false,
  section,
  activeTab,
  onTabChange,
  hideTabNav = false,  previewOnly = false,
}: {
  dot: Dot;
  /** When true, start on the Browser tab */
  browserOnly?: boolean;
  /** Pin or initialize the panel to one tab */
  section?:
    | 'Computer'
    | 'Browser'
    | 'Files'
    | 'Documents/Files'
    | 'Terminal'
    | 'Activity';
  /** Controlled tab, for hosts that render their own navigation. */
  activeTab?: ComputerTab;
  onTabChange?: (tab: ComputerTab) => void;
  /** Hide the built-in tab bar when the host owns navigation. */
  hideTabNav?: boolean;  /** Keep split-pane views to the live screen and control handoff. */  previewOnly?: boolean;
}) {
  const dotId = dot?.id || 'aegis';
  const dotName = dot?.name || 'Aegis';

  const initialTab: ComputerTab =
    section === 'Files' || section === 'Documents/Files'
      ? 'Documents/Files'
      : section === 'Terminal'
        ? 'Terminal'
        : section === 'Activity'
          ? 'Activity'
          : browserOnly || section === 'Browser'
            ? 'Browser'
            : 'Computer';

  const [tab, setTab] = useState<ComputerTab>(activeTab ?? initialTab);
  useEffect(() => {
    if (activeTab) setTab(activeTab);
  }, [activeTab]);

  const selectTab = (nextTab: ComputerTab) => {
    setTab(nextTab);
    onTabChange?.(nextTab);
  };
  const [status, setStatus] = useState<ComputerStatus>();
  const [screen, setScreen] = useState<Screen>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState('');
  const [path, setPath] = useState('');
  const [contents, setContents] = useState('');
  const [command, setCommand] = useState('');
  const [output, setOutput] = useState('');
  const [outputError, setOutputError] = useState('');
  const [screenError, setScreenError] = useState('');
  const [preview, setPreview] = useState<BrowsePreview>();
  const [previewError, setPreviewError] = useState('');
  const [previewBusy, setPreviewBusy] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [commandHistory, setCommandHistory] = useState<Array<{ command: string; at: number }>>([]);
  const [approvedCommands, setApprovedCommands] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(`aegis:terminal:approved:${dot.id}`) || '[]');
    } catch {
      return [];
    }
  });
  const [approveDraft, setApproveDraft] = useState('');
  const approveCommand = (raw: string) => {
    const value = raw.trim();
    if (!value) return;
    setApprovedCommands((list) => {
      const next = list.includes(value) ? list : [...list, value];
      try {
        localStorage.setItem(`aegis:terminal:approved:${dot.id}`, JSON.stringify(next));
      } catch {
        // localStorage unavailable
      }
      return next;
    });
    setApproveDraft('');
  };

  // AGENT DEDICATED CURSOR STATE (rendered overlay; driven by Aegis)
  const agentCursor = {
    x: 480,
    y: 280,
    visible: true,
    clicking: false,
    label: `${dotName} (Agent)`,
  };
  const [annotations, setAnnotations] = useState<
    Array<{
      id: string;
      x: number;
      y: number;
      width: number;
      height: number;
      label: string;
      action: 'click' | 'modify' | 'type' | 'inspect';
      shape?: 'rect' | 'circle' | 'triangle' | 'arrow' | 'line';
      ref?: string;
    }>
  >([]);
  const [croppedCapture, setCroppedCapture] = useState<string | null>(null);
  const [activeWindows, setActiveWindows] = useState<Array<{ id: number; processName: string; title: string }>>([]);
  const [selectedWindow, setSelectedWindow] = useState('');
  const [windowBusy, setWindowBusy] = useState(false);
  const [snapshotBusy, setSnapshotBusy] = useState(false);

  const lifecycle = useRef({
    active: false,
    revision: 0,
    busy: false,
    loaded: false,
    running: false,
  });
  const controller = useRef<AbortController | null>(null);
const autoStartRef = useRef(false);
  const base = `/dots/${encodeURIComponent(dotId)}/computer`;

  const refresh = useCallback(async () => {
    const revision = lifecycle.current.revision;
    const current = () =>
      lifecycle.current.active && revision === lifecycle.current.revision;
    try {
      const next = await api<ComputerStatus>(
        base,
        'GET',
        undefined,
        controller.current?.signal,
      );
      if (!current()) return;
      setStatus(next);
      lifecycle.current.loaded = true;
      lifecycle.current.running = next.state === 'running';
      setError('');
      if (
        next.state === 'running' &&
        next.permissions.browser &&
        next.permissions.enabled
      ) {
        try {
          const capture = await api<Screen>(
            `${base}/actions`,
            'POST',
            { action: 'screenshot', input: {} },
            controller.current?.signal,
          );
          if (current()) {
            setScreen(capture);
            setScreenError('');
          }
        } catch (cause) {
          if (current()) {
            setScreen(undefined);
            setScreenError(
              cause instanceof Error
                ? cause.message
                : 'Could not refresh the screen.',
            );
          }
        }
      } else {
        setScreen(undefined);
        setScreenError('');
      }
    } catch (cause) {
      if (current()) {
        setError(
          cause instanceof Error
            ? cause.message
            : 'Could not load the AEGIS Computer.',
        );
        setScreen(undefined);
      }
    }
  }, [base]);

  useEffect(() => {
    lifecycle.current.active = true;
    controller.current = new AbortController();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (
        !document.hidden &&
        !lifecycle.current.busy &&
        (!lifecycle.current.loaded || lifecycle.current.running)
      )
        await refresh();
      if (!cancelled && lifecycle.current.active)
        timer = setTimeout(() => void poll(), 4000);
    };
    void poll();
    return () => {
      cancelled = true;
      lifecycle.current.active = false;
      lifecycle.current.revision++;
      controller.current?.abort();
      clearTimeout(timer);
    };
  }, [refresh]);

  // Aegis drives the desktop itself: once permissions are on and the
  // computer is idle, start it automatically instead of waiting for an
  // owner click. Guarded so it only fires once per mount.
  useEffect(() => {
    if (autoStartRef.current) return;
    if (!status || status.state === 'running') return;
    if (!status.permissions?.enabled) return;
    autoStartRef.current = true;
    void run('/start');
  }, [status]);

  const run = async (
    endpoint: string,
    body: unknown = {},
    method = 'POST',
    showOutput = false,
  ) => {
    if (lifecycle.current.busy) return;
    lifecycle.current.busy = true;
    lifecycle.current.revision++;
    setBusy(true);
    setError('');
    if (showOutput) setOutputError('');
    try {
      const result = await api<unknown>(
        `${base}${endpoint}`,
        method,
        body,
        controller.current?.signal,
      );
      if (!lifecycle.current.active) return;
      if (showOutput)
        setOutput(
          typeof result === 'string' ? result : JSON.stringify(result, null, 2),
        );
      await refresh();
      return result;
    } catch (cause) {
      if (!lifecycle.current.active) return;
      const message =
        cause instanceof Error
          ? cause.message
          : 'AEGIS Computer action failed.';
      if (showOutput) {
        setOutput('');
        setOutputError(message);
      } else setError(message);
    } finally {
      lifecycle.current.busy = false;
      if (lifecycle.current.active) setBusy(false);
    }
  };

  const action = (action: ComputerAction, input: unknown, showOutput = false) =>
    run('/actions', { action, input }, 'POST', showOutput);

  const browsePreview = async (target?: string) => {
    const destination = (target ?? url).trim();
    if (previewBusy || !destination) return;
    setPreviewBusy(true);
    setPreviewError('');
    try {
      const result = await api<BrowsePreview>(
        '/browse-preview',
        'POST',
        { url: destination },
        controller.current?.signal,
      );
      if (lifecycle.current.active) {
        setPreview(result);
        setUrl(result.url || destination);
      }
    } catch (cause) {
      if (lifecycle.current.active) {
        setPreview(undefined);
        setPreviewError(
          cause instanceof Error ? cause.message : 'Browser preview failed.',
        );
      }
    } finally {
      if (lifecycle.current.active) setPreviewBusy(false);
    }
  };

  const running = status?.state === 'running' && !!status?.permissions?.enabled;
  const human =
    status?.control?.holder === 'human' && !status?.control?.transitioning;
  const browser = !!running && !!status?.permissions?.browser;


  const handleBrowserBack = async () => {
    if (!running || busy) return;
    try {
      const res = (await action('browser_back', {}, true)) as { url?: string } | undefined;
      if (res?.url) setUrl(res.url);
      void browsePreview();
    } catch {
      // fallback
    }
  };

  const handleBrowserForward = async () => {
    if (!running || busy) return;
    try {
      const res = (await action('browser_forward', {}, true)) as { url?: string } | undefined;
      if (res?.url) setUrl(res.url);
      void browsePreview();
    } catch {
      // fallback
    }
  };

  const handleBrowserReload = async () => {
    if (!running || busy) return;
    try {
      await action('browser_reload', {}, true);
      void browsePreview();
    } catch {
      void browsePreview();
    }
  };

  const handleCropCurrentScreen = (cropX?: number, cropY?: number, cropW?: number, cropH?: number) => {
    const src = screen?.base64 ? `data:${screen.format ?? 'image/png'};base64,${screen.base64}` : preview?.screenshot;
    if (!src) return;
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const firstAnn = annotations[0];
      const x = cropX ?? (firstAnn?.x ?? 100);
      const y = cropY ?? (firstAnn?.y ?? 100);
      const w = cropW ?? (firstAnn?.width ?? 400);
      const h = cropH ?? (firstAnn?.height ?? 300);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(10, w);
      canvas.height = Math.max(10, h);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, x, y, w, h, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/png');
      setCroppedCapture(dataUrl);
    };
    img.src = src;
  };

  const handleListWindows = async () => {
    if (!running || busy) return;
    setWindowBusy(true);
    try {
      const res = (await action('list_windows', {}, true)) as { windows?: Array<{ id: number; processName: string; title: string }> };
      if (res?.windows) {
        setActiveWindows(res.windows);
        if (res.windows.length > 0 && !selectedWindow) {
          setSelectedWindow(res.windows[0].title || res.windows[0].processName);
        }
      }
    } catch {
      //
    } finally {
      setWindowBusy(false);
    }
  };

  const handleWindowAction = async (winAction: 'switch_window' | 'minimize_window' | 'maximize_window' | 'resize_window') => {
    const target = selectedWindow.trim();
    if (!target || !running || busy) return;
    setWindowBusy(true);
    try {
      const payload = winAction === 'resize_window'
        ? { title: target, width: 1280, height: 720, x: 0, y: 0 }
        : { title: target };
      await action(winAction, payload, true);
    } catch {
      //
    } finally {
      setWindowBusy(false);
    }
  };

  const handleDesktopSnapshot = async () => {
    if (!running || busy) return;
    setSnapshotBusy(true);
    try {
      const snap = (await action('desktop_snapshot', {}, true)) as Screen;
      if (snap?.base64) {
        setScreen(snap);
        setScreenError('');
      }
    } catch {
      //
    } finally {
      setSnapshotBusy(false);
    }
  };

  return (
    <>
      <section
        className={`computer-panel${previewOnly ? ' preview-only' : ''}`}
        aria-label={`${dot.name}'s AEGIS Computer`}
        aria-busy={busy}
      >
        {error && (
          <p className="computer-error" role="alert">
            {error}
          </p>
        )}

        {!status ? (
          <p role="status">
            {error
              ? 'AEGIS Computer status unavailable.'
              : 'Loading AEGIS Computer                                                                                                                     '}
          </p>
        ) : (
          <>
            {/* Top Status & Handoff Toolbar */}
            <div className="computer-status-card">
              <div className="computer-status-row">
                <div className="computer-state-pill">
                  <span
                    className={`status-dot ${status.state === 'running' ? 'active' : ''}`}
                  />
                  <strong>{(status.state || 'stopped').replaceAll('_', ' ')}</strong>
                </div>

                <div className="computer-mode-badges">
                  <span className="badge">
                    Mode: {status.computerMode ?? 'local'}
                  </span>
                  <span className="badge">
                    {status.isolated
                      ? 'Docker Sandbox'
                      : 'Local Process (Shared)'}
                  </span>
                  <span className="badge">
                     {screen ? `${screen.width} x ${screen.height} px` : '1280 x 800'}
                  </span>
                </div>

                <div className="computer-header-actions">
                  <button
                    className="action-btn"
                    title="Refresh status and screen"
                    disabled={busy}
                    onClick={() => void refresh()}
                  >
                    <RefreshCw size={13} />
                    Refresh
                  </button>
                  {screen && (
                    <button
                      className="action-btn"
                      title="Maximize screen view"
                      onClick={() => setMaximized(true)}
                    >
                      <Maximize2 size={13} />
                      Maximize
                    </button>
                  )}
                   {status.state !== 'running' ? (
                     <span className="muted" style={{ fontSize: 11 }}>
                       {status.permissions?.enabled ? 'Aegis is starting the desktop   ' : 'Enable computer permissions to let Aegis drive the desktop.'}
                     </span>
                   ) : (
                    <button
                      className="action-btn danger"
                      disabled={busy}
                      onClick={() => void run('/stop')}
                    >
                      Stop Computer
                    </button>
                  )}
                </div>
              </div>

              {/* Handoff pill: Vercel Agent Desktop style */}
              <div className="computer-handoff-bar">
                <span className="control-label">
                  {human ? (
                    <>
                      <span className="user-indicator">                                                                                                                             </span> You have interactive control
                    </>
                  ) : (
                    <>
                      <span className="agent-indicator">                                                                                                                             </span> {dot.name} (Agent) is driving
                    </>
                  )}
                </span>
                <button
                  className={`handoff-toggle-btn ${human ? 'release' : 'take'}`}
                  disabled={
                    (!human && !browser) ||
                    busy ||
                    status.control?.transitioning
                  }
                  onClick={() => void run(human ? '/release' : '/take')}
                >
                  {status.control?.transitioning
                    ? 'Transferring                                                                                                                     '
                    : human
                      ? 'Return control to Agent'
                      : 'Take over control'}
                </button>
              </div>
            </div>

            {/* Dedicated 5-Tab Navigation Bar */}
            {!hideTabNav && (
            <div
              className="computer-tool-tabs"
              role="tablist"
              aria-label="AEGIS Computer dedicated tabs"
            >
              <button
                role="tab"
                aria-selected={tab === 'Computer'}
                className={`computer-tab-btn ${tab === 'Computer' ? 'active' : ''}`}
                onClick={() => selectTab('Computer')}
              >
                <Monitor size={15} />
                <span>Computer / Desktop</span>
              </button>
              <button
                role="tab"
                aria-selected={tab === 'Browser'}
                className={`computer-tab-btn ${tab === 'Browser' ? 'active' : ''}`}
                onClick={() => selectTab('Browser')}
              >
                <Globe size={15} />
                <span>Browser</span>
              </button>
              <button
                role="tab"
                aria-selected={tab === 'Documents/Files'}
                className={`computer-tab-btn ${tab === 'Documents/Files' ? 'active' : ''}`}
                onClick={() => selectTab('Documents/Files')}
              >
                <FolderOpen size={15} />
                <span>File editor</span>
              </button>
              <button
                role="tab"
                aria-selected={tab === 'Terminal'}
                className={`computer-tab-btn ${tab === 'Terminal' ? 'active' : ''}`}
                onClick={() => selectTab('Terminal')}
              >
                <TerminalIcon size={15} />
                <span>Terminal</span>
              </button>
              <button
                role="tab"
                aria-selected={tab === 'Activity'}
                className={`computer-tab-btn ${tab === 'Activity' ? 'active' : ''}`}
                onClick={() => selectTab('Activity')}
              >
                <ActivityIcon size={15} />
                <span>Activity ({(status.audit || []).length})</span>
              </button>
            </div>
            )}

            {/* TAB 1: Computer / Desktop Control (Vercel Agent Desktop reference) */}
            <div className="computer-tab-content" hidden={tab !== 'Computer'}>
              <div className="desktop-view-container">
                {screenError && (
                  <p className="computer-error" role="status">
                    {screenError}
                  </p>
                )}

                {screen ? (
                  <div className="desktop-canvas-frame">
                    <div className="desktop-canvas-toolbar">
                      <span className="url-tag" title={screen.url}>
                        {screen.url || 'Desktop screen active'}
                      </span>
                      <span className="coords-hud">
                         {screen.width} x {screen.height} px
                      </span>
                      <span className="timestamp-tag">
                        Refreshed {new Date(screen.capturedAt).toLocaleTimeString()}
                      </span>
                    </div>

                    <div className="desktop-screen-stage">

                      {/* AGENT DEDICATED CURSOR & SCREEN ANNOTATION OVERLAY */}
                      <div className="agent-screen-overlay" aria-hidden="true">
                        {annotations.map((ann) => {
                          const leftPct = (ann.x / screen.width) * 100;
                          const topPct = (ann.y / screen.height) * 100;
                          const wPct = Math.max(2.5, (ann.width / screen.width) * 100);
                          const hPct = Math.max(2.5, (ann.height / screen.height) * 100);
                          if (ann.shape) {
                            return (
                              <svg
                                key={ann.id}
                                className={`agent-shape-annotation shape-${ann.shape}`}
                                style={{
                                  left: `${leftPct}%`,
                                  top: `${topPct}%`,
                                  width: `${wPct}%`,
                                  height: `${hPct}%`,
                                }}
                                viewBox="0 0 100 100"
                                preserveAspectRatio="none"
                              >
                                {ann.shape === 'rect' && (
                                  <rect x="4" y="4" width="92" height="92" fill="rgba(217,107,82,0.10)" stroke="#d96b52" strokeWidth="4" />
                                )}
                                {ann.shape === 'circle' && (
                                  <circle cx="50" cy="50" r="44" fill="rgba(56,189,248,0.12)" stroke="#38bdf8" strokeWidth="4" />
                                )}
                                {ann.shape === 'triangle' && (
                                  <polygon points="50,6 96,94 4,94" fill="rgba(52,211,153,0.12)" stroke="#34d399" strokeWidth="4" />
                                )}
                                {ann.shape === 'arrow' && (
                                  <>
                                    <line x1="8" y1="92" x2="88" y2="12" stroke="#f59e0b" strokeWidth="6" strokeLinecap="round" />
                                    <polygon points="92,6 62,10 86,32" fill="#f59e0b" />
                                  </>
                                )}
                                {ann.shape === 'line' && (
                                  <line x1="6" y1="50" x2="94" y2="50" stroke="#a78bfa" strokeWidth="5" strokeLinecap="round" />
                                )}
                                <text x="50" y="46" textAnchor="middle" className="shape-label">
                                  {ann.label}
                                </text>
                              </svg>
                            );
                          }
                          return (
                            <div
                              key={ann.id}
                              className={`agent-annotation-box ${ann.action}`}
                              style={{
                                left: `${leftPct}%`,
                                top: `${topPct}%`,
                                width: `${wPct}%`,
                                height: `${hPct}%`,
                              }}
                            >
                              <div className="agent-annotation-badge">
                                <span className={`action-pill ${ann.action}`}>{ann.action}</span>
                                <span className="label-text">{ann.label}</span>
                                {ann.ref && <span className="ref-tag">[{ann.ref}]</span>}
                              </div>
                            </div>
                          );
                        })}

                        {agentCursor.visible && (
                          <div
                            className={`agent-dedicated-cursor ${agentCursor.clicking ? 'clicking' : ''}`}
                            style={{
                              left: `${(agentCursor.x / screen.width) * 100}%`,
                              top: `${(agentCursor.y / screen.height) * 100}%`,
                            }}
                          >
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="cursor-arrow-svg">
                              <path
                                d="M3 3L10.5 21L13.5 13.5L21 10.5L3 3Z"
                                fill="#d96b52"
                                stroke="#ffffff"
                                strokeWidth="1.6"
                                strokeLinejoin="round"
                              />
                            </svg>
                            <div className="agent-cursor-tag">
                              <span className="cursor-dot" />
                              <span>{agentCursor.label}</span>
                            </div>
                            <div className="cursor-ripple" />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="desktop-screen-empty">
                    <div className="app-chrome-mockup" aria-hidden="true">
                      <div className="mockup-bar">
                        <i className="mockup-dot red" />
                        <i className="mockup-dot yellow" />
                        <i className="mockup-dot green" />
                        <span className="mockup-url">{dot.name}                                                                                                                                           Aegis</span>
                      </div>
                      <div className="mockup-body">
                        <div className="mockup-side">
                          <div className="mockup-nav">
                            <i /><i /><i /><i />
                          </div>
                          <div style={{ display: 'grid', gap: 8 }}>
                            <div className="mockup-line" />
                            <div className="mockup-line" style={{ width: '82%' }} />
                            <div className="mockup-line" style={{ width: '64%' }} />
                          </div>
                        </div>
                        <div className="mockup-line" style={{ width: '40%' }} />
                      </div>
                    </div>
                    <Monitor size={30} />
                    <p>
                      {running && status.permissions.browser
                        ? 'Waiting for desktop display output                                                                                                                     '
                        : 'Start the Aegis Computer with Browser/Desktop permission to see live control.'}
                    </p>
                    {(!running || !status.permissions.browser) && (
                      <button
                        className="action-btn primary"
                        disabled={busy}
                        onClick={() => void run('/start')}
                      >
                        Start Computer
                      </button>
                    )}
                  </div>
                )}

                {/* Agent-driven controls: Aegis draws and annotates over the
                    screen layer in the background. Only app launch and the
                    handoff remain owner-facing. */}
                <div className="desktop-control-deck agent-drives">
                  <div className="deck-header">
                    <Sparkles size={14} />
                    <strong>Aegis drives this screen</strong>
                    <span className="muted-hint">
                      The agent moves its own cursor and draws annotation shapes
                      over the screen layer. You keep the handoff and quick app
                      launch.
                    </span>
                  </div>
                  <div className="launcher-row">
                    {[
                      { id: 'notepad', label: 'Notepad' },
                      { id: 'notepad', label: 'Notepad' },
                      { id: 'explorer', label: 'Explorer' },
                      { id: 'paint', label: 'Paint' },
                      { id: 'terminal', label: 'Terminal' },
                    ].map((app) => (
                      <button
                        key={app.id}
                        type="button"
                        className="action-btn"
                        disabled={!running || !status.permissions.shell || busy}
                        onClick={() => void action('open_app', { app: app.id })}
                      >
                        {app.label}
                      </button>
                    ))}
                    <button
                      type="button"
                      className="action-btn secondary"
                      disabled={!running || busy || snapshotBusy}
                      onClick={() => void handleDesktopSnapshot()}
                      title="Capture live full desktop screen snapshot"
                    >
                      <Camera size={13} />
                      <span>{snapshotBusy ? 'Capturing                                                                                                                     ' : 'Snapshot'}</span>
                    </button>
                    <span className="shape-legend">
                      <span>annotation shapes</span>
                      <button type="button" className="text-btn" onClick={() => handleCropCurrentScreen()} title="Crop and extract bytes from selected coordinates">
                        <Crop size={12} /> crop bytes
                      </button>
                      <button type="button" className="text-btn" onClick={() => setAnnotations([])}>
                        clear
                      </button>
                    </span>
                  </div>

                  {/* Windows Native Automation Bar (Vercel Agent Desktop Model) */}
                  <div className="window-management-bar" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginTop: '10px', paddingTop: '10px', borderTop: '1px solid var(--line)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>
                      <AppWindow size={14} />
                      <span>Windows 11 Window Control:</span>
                    </div>
                    <button
                      type="button"
                      className="action-btn secondary"
                      style={{ padding: '4px 8px', fontSize: '11px' }}
                      disabled={!running || windowBusy}
                      onClick={() => void handleListWindows()}
                    >
                      {windowBusy ? 'Scanning                                                                                                                     ' : 'List Windows'}
                    </button>
                    {activeWindows.length > 0 ? (
                      <select
                        value={selectedWindow}
                        onChange={(e) => setSelectedWindow(e.target.value)}
                        style={{
                          background: 'var(--surface-raised)',
                          color: 'var(--text)',
                          border: '1px solid var(--line)',
                          borderRadius: '4px',
                          padding: '3px 8px',
                          fontSize: '11px',
                          maxWidth: '220px',
                        }}
                      >
                        {activeWindows.map((w, idx) => (
                          <option key={`${w.id}-${idx}`} value={w.title || w.processName}>
                            {w.title ? `${w.title.slice(0, 30)} (${w.processName})` : w.processName}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        placeholder="Target window title / process                                                                                                                     "
                        value={selectedWindow}
                        onChange={(e) => setSelectedWindow(e.target.value)}
                        style={{
                          background: 'var(--surface-raised)',
                          color: 'var(--text)',
                          border: '1px solid var(--line)',
                          borderRadius: '4px',
                          padding: '3px 8px',
                          fontSize: '11px',
                          width: '180px',
                        }}
                      />
                    )}
                    <button
                      type="button"
                      className="action-btn"
                      style={{ padding: '4px 8px', fontSize: '11px' }}
                      disabled={!running || !selectedWindow || windowBusy}
                      onClick={() => void handleWindowAction('switch_window')}
                      title="Bring target window to foreground and restore"
                    >
                      Focus
                    </button>
                    <button
                      type="button"
                      className="action-btn"
                      style={{ padding: '4px 8px', fontSize: '11px' }}
                      disabled={!running || !selectedWindow || windowBusy}
                      onClick={() => void handleWindowAction('minimize_window')}
                      title="Minimize target window"
                    >
                      <Minimize2 size={11} />
                      <span>Min</span>
                    </button>
                    <button
                      type="button"
                      className="action-btn"
                      style={{ padding: '4px 8px', fontSize: '11px' }}
                      disabled={!running || !selectedWindow || windowBusy}
                      onClick={() => void handleWindowAction('maximize_window')}
                      title="Maximize target window"
                    >
                      <Maximize2 size={11} />
                      <span>Max</span>
                    </button>
                    <button
                      type="button"
                      className="action-btn"
                      style={{ padding: '4px 8px', fontSize: '11px' }}
                      disabled={!running || !selectedWindow || windowBusy}
                      onClick={() => void handleWindowAction('resize_window')}
                      title="Move and resize window to standard 1280x720"
                    >
                      Resize
                    </button>
                  </div>

                  {croppedCapture && (
                    <div className="cropped-capture-preview">
                      <div className="crop-preview-head">
                        <strong>Cropped Screen Bytes Capture</strong>
                        <button type="button" className="text-btn" onClick={() => setCroppedCapture(null)}>
                          <X size={12} />
                        </button>
                      </div>
                      <img src={croppedCapture} alt="Cropped capture" className="cropped-img-thumb" />
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* TAB 2: Browser (Playwright only, AEGIS Computer browser) */}
            <div className="computer-tab-content" hidden={tab !== 'Browser'}>
              <div className="browser-tab-container">
                <div className="browser-toolbar-card">
                  <div className="browser-control-row">
                    <span className="engine-label">
                      AEGIS Computer browser                                                                           Playwright
                    </span>
                    <button
                      type="button"
                      className="text-btn"
                      disabled={!running || !status.permissions.browser || busy}
                      onClick={() => void run(human ? '/release' : '/take')}
                    >
                      {human ? 'Give control to Aegis' : 'Take over control'}
                    </button>
                  </div>

                  <form
                    className="browser-nav-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (human && browser) void action('navigate', { url });
                      else void browsePreview();
                    }}
                  >
                    <div className="browser-history-btns">
                      <button
                        type="button"
                        className="browser-icon-btn"
                        title="Back"
                        disabled={previewBusy || busy}
                        onClick={() => void handleBrowserBack()}
                      >
                        <ArrowLeft size={14} />
                      </button>
                      <button
                        type="button"
                        className="browser-icon-btn"
                        title="Forward"
                        disabled={previewBusy || busy}
                        onClick={() => void handleBrowserForward()}
                      >
                        <ArrowRight size={14} />
                      </button>
                      <button
                        type="button"
                        className="browser-icon-btn"
                        title="Reload"
                        disabled={previewBusy || busy}
                        onClick={() => void handleBrowserReload()}
                      >
                        <RotateCcw size={14} />
                      </button>
                    </div>
                    <input
                      type="url"
                      aria-label="Browser URL"
                      placeholder="https://example.com"
                      value={url}
                      onChange={(event) => setUrl(event.target.value)}
                      required
                    />
                    <button
                      type="submit"
                      disabled={previewBusy || busy || !url.trim()}
                    >
                      {previewBusy || busy ? 'Loading                                                                                                                     ' : 'Navigate'}
                    </button>
                  </form>
                </div>

                {/* Playwright preview viewport (single engine) */}
                <div className="browser-preview-viewport">
                  {previewError && (
                    <p className="computer-error" role="status">
                      {previewError}
                    </p>
                  )}
                  {preview ? (
                    <div className="preview-card">
                      <div className="preview-meta-bar">
                        <span className="url-badge">{preview.url}</span>
                        <span className="engine-badge">
                          Served by: {preview.engine}
                        </span>
                      </div>
                      <img
                        src={preview.screenshot}
                        alt={`Browser preview served by ${preview.engine}`}
                      />
                    </div>
                  ) : (
                    <div className="desktop-screen-empty">
                      <Globe size={36} />
                      <p>
                        {previewBusy
                          ? 'Rendering preview                                                                                                                     '
                          : 'Enter a URL and click Navigate to browse with the AEGIS Computer browser (Playwright).'}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* TAB 3: File editor (raw path read/write inside the computer) */}
            <div className="computer-tab-content" hidden={tab !== 'Documents/Files'}>
              <div className="files-tab-container">
                <div className="files-toolbar">
                  <label className="path-label">
                    <span>Workspace Path:</span>
                    <input
                      value={path}
                      onChange={(e) => setPath(e.target.value)}
                      placeholder="e.g. notes.txt or src/"
                      disabled={!running || !status.permissions.files || busy}
                    />
                  </label>
                  <div className="files-action-btns">
                    <button
                      disabled={!running || !status.permissions.files || busy}
                      onClick={() => void action('files_list', { path }, true)}
                    >
                      List Files
                    </button>
                    <button
                      disabled={
                        !running ||
                        !status.permissions.files ||
                        busy ||
                        !path.trim()
                      }
                      onClick={() =>
                        void action('files_read', { path }, true).then(
                          (result) => {
                            if (
                              lifecycle.current.active &&
                              result &&
                              typeof result === 'object' &&
                              'text' in result &&
                              typeof result.text === 'string'
                            )
                              setContents(result.text);
                          },
                        )
                      }
                    >
                      Read File
                    </button>
                  </div>
                  <button
                    type="button"
                    className="files-surface-link"
                    onClick={() =>
                      window.dispatchEvent(
                        new CustomEvent('aegis:nav', { detail: 'files' }),
                      )
                    }
                  >
                    <FolderOpen size={13} /> Conversation files
                  </button>
                </div>

                <div className="file-editor-card">
                  <div className="editor-header">
                    <FileText size={14} />
                    <span>File Editor / Viewer</span>
                    <span className="editor-stats">
                      {contents.length} chars                                                                           {contents.split('\n').length} lines
                    </span>
                  </div>
                  <textarea
                    className="file-textarea"
                    aria-label="File contents editor"
                    value={contents}
                    onChange={(e) => setContents(e.target.value)}
                    placeholder="File contents will appear here, or type new content to write..."
                    disabled={!running || !status.permissions.files || busy}
                    rows={12}
                  />
                  <div className="editor-footer">
                    <button
                      className="primary-btn"
                      disabled={
                        !running ||
                        !status.permissions.files ||
                        busy ||
                        !path.trim()
                      }
                      onClick={() =>
                        void action('files_write', { path, contents }, true)
                      }
                    >
                      Save File (Write to Workspace)
                    </button>
                  </div>
                </div>

                {(output || outputError) && (
                  <div className="terminal-output-card">
                    <div className="output-header">
                      <span>Command / Files Output</span>
                      <button
                        className="clear-btn"
                        onClick={() => {
                          setOutput('');
                          setOutputError('');
                        }}
                      >
                        Clear
                      </button>
                    </div>
                    {outputError && (
                      <p className="computer-error" role="alert">
                        {outputError}
                      </p>
                    )}
                    {output && <pre tabIndex={0}>{output}</pre>}
                  </div>
                )}
              </div>
            </div>

            {/* TAB 4: Terminal */}
            <div className="computer-tab-content" hidden={tab !== 'Terminal'}>
              <div className="terminal-tab-container">
                <div className="terminal-presets">
                  <span className="preset-label">Approved commands:</span>
                  {approvedCommands.length === 0 && (
                    <button
                      type="button"
                      className="preset-chip"
                      onClick={() => approveCommand('pwd')}
                    >
                      approve pwd
                    </button>
                  )}
                  {approvedCommands.map((cmd) => (
                    <button
                      key={cmd}
                      type="button"
                      className="preset-chip approved"
                      onClick={() => {
                        setCommand(cmd);
                        setCommandHistory((history) => [...history, { command: cmd, at: Date.now() }]);
                        void action('exec', { command: cmd, timeoutMs: 30000 }, true);
                      }}
                    >
                      {cmd}                                                                                                  
                    </button>
                  ))}
                  {approvedCommands.length > 0 && (
                    <button
                      type="button"
                      className="preset-chip remove"
                      onClick={() => {
                        setApprovedCommands([]);
                        try {
                          localStorage.removeItem(`aegis:terminal:approved:${dot.id}`);
                        } catch {
                          // ignore
                        }
                      }}
                      title="Clear approved list"
                    >
                      clear
                    </button>
                  )}
                  <span className="approved-input-wrap">
                    <input
                      aria-label="Approve a terminal command"
                      placeholder="approve a command to run here"
                      value={approveDraft}
                      onChange={(e) => setApproveDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          approveCommand(approveDraft);
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="preset-chip add"
                      disabled={!approveDraft.trim()}
                      onClick={() => approveCommand(approveDraft)}
                    >
                      approve
                    </button>
                  </span>
                </div>

                <form
                  className="terminal-input-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const target = command.trim();
                    if (!target) return;
                    setCommandHistory((history) => [...history, { command: target, at: Date.now() }]);
                    void action('exec', { command: target, timeoutMs: 30000 }, true);
                  }}
                >
                  <div className="terminal-input-wrap">
                    <span className="terminal-prompt">$</span>
                    <textarea
                      aria-label="Terminal command"
                      value={command}
                      onChange={(e) => setCommand(e.target.value)}
                      rows={3}
                      disabled={!running || !status.permissions.shell || busy}
                      placeholder="Enter command to run in workspace (e.g. ls, git status, python test.py)..."
                    />
                  </div>
                  <div className="terminal-form-footer aegis-dark-footer">
                    <span className="muted-hint">
                       Execution timeout: 30 seconds - Workspace root: {dot.name}
                    </span>
                    <button
                      type="submit"
                      className="primary-btn"
                      disabled={
                        !running ||
                        !status.permissions.shell ||
                        busy ||
                        !command.trim()
                      }
                    >
                      Run Command
                    </button>
                  </div>
                </form>

                <div className="terminal-output-card aegis-dark-card">
                  <div className="output-header aegis-dark-header">
                    <span>Terminal Console</span>
                    {output && (
                      <button
                        className="clear-btn"
                        onClick={() => {
                          setOutput('');
                          setOutputError('');
                        }}
                      >
                        Clear Output
                      </button>
                    )}
                  </div>
                  {outputError && (
                    <p className="computer-error" role="alert">
                      {outputError}
                    </p>
                  )}
                  {output ? (
                    <pre className="terminal-pre aegis-dark-pre" tabIndex={0}>
                      {output}
                    </pre>
                  ) : (
                    <p className="terminal-empty-hint aegis-dark-empty">
                      No terminal output yet. Run a command above.
                    </p>
                  )}
                </div>

                {/* Access + execution history (surface-side) */}
                <div className="terminal-meta-grid">
                  <div className="terminal-access-card">
                    <div className="output-header">
                      <span>Agent access</span>
                    </div>
                    <ul className="terminal-access-list">
                      {(
                        [
                          ['shell', 'Terminal commands', status.permissions.shell],
                          ['files', 'Workspace files', status.permissions.files],
                          ['browser', 'Browser', status.permissions.browser],
                          ['computer', 'Computer/desktop', status.permissions.enabled],
                        ] as const
                      ).map(([key, label, allowed]) => (
                        <li key={key}>
                          <span
                            className={`access-dot ${allowed ? 'on' : ''}`}
                            aria-hidden="true"
                          />
                          <span>{label}</span>
                          <em>{allowed ? 'allowed' : 'blocked'}</em>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="terminal-history-card">
                    <div className="output-header">
                      <span>Executed commands</span>
                      {commandHistory.length > 0 && (
                        <button className="clear-btn" onClick={() => setCommandHistory([])}>
                          Clear
                        </button>
                      )}
                    </div>
                    {commandHistory.length ? (
                      <ol className="terminal-history-list">
                        {commandHistory.slice(-12).reverse().map((entry, index) => (
                          <li key={`${entry.at}-${index}`}>
                            <code>{entry.command}</code>
                            <time>{new Date(entry.at).toLocaleTimeString()}</time>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="terminal-empty-hint">No commands executed in this session yet.</p>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* TAB 5: Activity */}
            <div className="computer-tab-content" hidden={tab !== 'Activity'}>
              <div className="activity-tab-container">
                <h3>Computer Action Audit Trail</h3>
                {(status.audit || []).length ? (
                  <ol className="computer-audit-list">
                    {(status.audit || [])
                      .slice(-50)
                      .reverse()
                      .map((entry) => (
                        <li key={entry.id} className="audit-item">
                          <div className="audit-main">
                            <strong className="audit-action">
                              {entry.action.replaceAll('_', ' ')}
                            </strong>
                            <span className={`outcome-pill ${entry.outcome}`}>
                              {entry.outcome}
                            </span>
                          </div>
                          <div className="audit-meta">
                            <span>Actor: {entry.actor}</span>
                            <span>
                              {new Date(entry.createdAt).toLocaleTimeString()}
                            </span>
                          </div>
                        </li>
                      ))}
                  </ol>
                ) : (
                  <p className="empty-hint">No computer actions logged yet.</p>
                )}
              </div>
            </div>

            {/* Collapsible Settings & Permissions Drawer */}
            <details className="computer-settings-drawer">
              <summary>Computer Permissions & Runtime Settings</summary>
              <div className="settings-drawer-body">
                <p>Configure hardware, browser, file, and shell access for {dot.name}:</p>
                <div className="permissions-grid">
                  {(['enabled', 'browser', 'files', 'shell'] as const).map(
                    (permission) => (
                      <label key={permission} className="permission-toggle">
                        <input
                          type="checkbox"
                          checked={status.permissions[permission]}
                          disabled={busy || !status.configured}
                          onChange={(e) =>
                            void run(
                              '/permissions',
                              { [permission]: e.target.checked },
                              'PATCH',
                            )
                          }
                        />
                        <span>
                          {
                            {
                              enabled: 'Enable Computer Service',
                              browser: 'Web Browser (Playwright)',
                              files: 'Workspace Files Access',
                              shell: 'Terminal & Command Execution',
                            }[permission]
                          }
                        </span>
                      </label>
                    ),
                  )}
                </div>
              </div>
            </details>
          </>
        )}
      </section>

      {/* Fullscreen Maximize Overlay */}
      {maximized && screen && (
        <div
          className="computer-maximize-overlay"
          role="dialog"
          aria-modal="true"
          onClick={() => setMaximized(false)}
        >
          <div
            className="computer-maximize-frame"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="computer-maximize-close"
              onClick={() => setMaximized(false)}
              aria-label="Close maximized view"
            >
              <X size={20} />
            </button>
            <img
              src={`data:${screen.format ?? 'image/png'};base64,${screen.base64}`}
              alt={`Maximized screen for ${dot.name}`}
            />
          </div>
        </div>
      )}
    </>
  );
}
