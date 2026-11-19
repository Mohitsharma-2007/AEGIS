import { Activity, Cloud, Cpu, MessagesSquare, Shield, Mic, Pause, Play, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * The widget payload the desktop sends to its surfaces.
 *
 * This is the same object `main.js` broadcasts as `aegis:widgets` /
 * `aegis:status` and that the notch merges into its `W` store, so the app and
 * the notch render one source of truth instead of two mock sets.
 */
export interface DesktopWeather {
  temp?: number;
  city?: string;
  high?: number;
  low?: number;
  feels?: number;
  humidity?: number;
  wind?: number;
  condition?: string;
  isDay?: boolean;
  code?: number;
}

export interface DesktopSystem {
  cpuPercent?: number;
  memoryPercent?: number;
  usedMemoryGb?: string;
  totalMemoryGb?: string;
  uptimeHours?: string;
  gpu?: number | null;
  hist?: { cpu?: number[]; mem?: number[]; gpu?: number[] };
}

export interface DesktopAgentRow {
  id?: string;
  name?: string;
  state?: string;
  task?: string;
  progress?: number | null;
}

export interface DesktopWidgets {
  weather?: DesktopWeather;
  system?: DesktopSystem;
  agents?: DesktopAgentRow[];
  voice?: { stt?: string; tts?: string; lang?: string; available?: boolean };
  security?: { pending?: number; label?: string; strict?: boolean };
  model?: { provider?: string; model?: string; mode?: string };
  conversations?: { active?: number };
  media?: { title?: string; artist?: string; playing?: boolean };
}

export interface DesktopStatus {
  text?: string;
  state?: string;
  paused?: boolean;
  surface?: string;
}

function Card({
  icon,
  title,
  meta,
  children,
}: {
  icon: ReactNode;
  title: string;
  meta?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="widget-card">
      <header className="widget-card-head">
        <span className="widget-card-icon">{icon}</span>
        <strong>{title}</strong>
        {meta ? <span className="widget-card-meta">{meta}</span> : null}
      </header>
      {children}
    </section>
  );
}

function Meter({ label, value, hint }: { label: string; value: number; hint?: string }) {
  const safe = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
  return (
    <div className="widget-meter">
      <div className="widget-meter-row">
        <span>{label}</span>
        <b>{Math.round(safe)}%</b>
      </div>
      <div className="widget-meter-track">
        <i style={{ width: `${safe}%` }} />
      </div>
      {hint ? <small>{hint}</small> : null}
    </div>
  );
}

const STATE_TONE: Record<string, string> = {
  working: 'var(--accent)',
  thinking: 'var(--warning, #f2b84b)',
  searching: 'var(--accent)',
  listening: 'var(--danger, #f07167)',
  speaking: 'var(--danger, #f07167)',
  paused: 'var(--muted)',
  done: 'var(--success, #5fd3a0)',
  error: 'var(--danger, #f07167)',
};

export function WidgetsPanel({
  widgets,
  status,
  paused,
  onTogglePause,
}: {
  widgets: DesktopWidgets;
  status: DesktopStatus;
  paused: boolean;
  onTogglePause: () => void;
}) {
  const system = widgets.system ?? {};
  const weather = widgets.weather;
  const agents = widgets.agents ?? [];
  const voice = widgets.voice;
  const security = widgets.security;
  const model = widgets.model;
  const media = widgets.media;
  const busyState = status.state && status.state !== 'idle' ? status.state : 'idle';

  return (
    <main className="main-content widgets-surface">
      <header className="widgets-head">
        <div>
          <h1>Widgets</h1>
          <p className="muted">
            Live cards from the same desktop status stream the notch draws from.
          </p>
        </div>
        <div className="widgets-head-actions">
          <span className={`widgets-state ${paused ? 'paused' : ''}`}>
            <Activity size={13} />
            {paused ? 'Paused' : status.text || busyState}
          </span>
          <button
            type="button"
            className="pause-button"
            onClick={onTogglePause}
            aria-label={paused ? 'Resume all Agents' : 'Pause all Agents'}
          >
            {paused ? <Play size={14} /> : <Pause size={14} />}
            <span>{paused ? 'Resume' : 'Pause'}</span>
          </button>
        </div>
      </header>

      <div className="widgets-grid">
        {weather ? (
          <Card
            icon={<Cloud size={15} />}
            title="Weather"
            meta={weather.city || 'Local'}
          >
            <div className="widget-weather">
              <b>{Math.round(weather.temp ?? 0)}°</b>
              <div className="widget-weather-side">
                <span>{weather.condition || 'Fair'}</span>
                <small>
                  H {Math.round(weather.high ?? weather.temp ?? 0)}° · L{' '}
                  {Math.round(weather.low ?? weather.temp ?? 0)}°
                  {weather.wind != null ? ` · ${Math.round(weather.wind)} km/h` : ''}
                </small>
              </div>
            </div>
          </Card>
        ) : null}

        <Card
          icon={<Cpu size={15} />}
          title="System"
          meta={system.uptimeHours ? `up ${system.uptimeHours}h` : undefined}
        >
          <Meter
            label="CPU"
            value={system.cpuPercent ?? 0}
            hint={
              system.usedMemoryGb
                ? `${system.usedMemoryGb} / ${system.totalMemoryGb ?? '?'} GB RAM`
                : undefined
            }
          />
          <Meter label="Memory" value={system.memoryPercent ?? 0} />
          {system.gpu != null ? <Meter label="GPU" value={system.gpu} /> : null}
        </Card>

        <Card icon={<MessagesSquare size={15} />} title="Agents" meta={`${agents.length}`}>
          {agents.length ? (
            <ul className="widget-agent-list">
              {agents.slice(0, 6).map((agent) => (
                <li key={agent.id || agent.name}>
                  <span className="widget-agent-dot" style={{ background: STATE_TONE[agent.state ?? ''] ?? 'var(--muted)' }} />
                  <div>
                    <strong>{agent.name || agent.id}</strong>
                    <small>{agent.task || agent.state || 'idle'}</small>
                  </div>
                  <em>{agent.progress != null ? `${Math.round(agent.progress)}%` : agent.state || 'idle'}</em>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted widget-empty">No agents running.</p>
          )}
        </Card>

        <Card icon={<Sparkles size={15} />} title="Model">
          <dl className="widget-facts">
            <div>
              <dt>Provider</dt>
              <dd>{model?.provider || '—'}</dd>
            </div>
            <div>
              <dt>Model</dt>
              <dd>{model?.model || '—'}</dd>
            </div>
            <div>
              <dt>Mode</dt>
              <dd>{model?.mode || '—'}</dd>
            </div>
            <div>
              <dt>Guardrails</dt>
              <dd>{security?.label || '—'}</dd>
            </div>
          </dl>
        </Card>

        <Card icon={<Mic size={15} />} title="Voice">
          <dl className="widget-facts">
            <div>
              <dt>Speech to text</dt>
              <dd>{voice?.stt || '—'}</dd>
            </div>
            <div>
              <dt>Text to speech</dt>
              <dd>{voice?.tts || '—'}</dd>
            </div>
            <div>
              <dt>Language</dt>
              <dd>{voice?.lang || '—'}</dd>
            </div>
          </dl>
        </Card>

        <Card icon={<Shield size={15} />} title="Sentinel" meta={security?.strict ? 'strict' : undefined}>
          <dl className="widget-facts">
            <div>
              <dt>Pending permissions</dt>
              <dd>{security?.pending ?? 0}</dd>
            </div>
            <div>
              <dt>Conversations</dt>
              <dd>{widgets.conversations?.active ?? 0}</dd>
            </div>
            <div>
              <dt>Outside surface</dt>
              <dd>{status.surface === 'mascot' ? 'Mascot' : 'Notch'}</dd>
            </div>
          </dl>
        </Card>

        {media?.title ? (
          <Card icon={<Activity size={15} />} title="Now playing">
            <p className="widget-media">
              <strong>{media.title}</strong>
              <small>{media.artist || ''}</small>
            </p>
          </Card>
        ) : null}
      </div>
    </main>
  );
}
