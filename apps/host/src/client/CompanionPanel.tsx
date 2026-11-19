import { useEffect, useState } from 'react';
import {
  CalendarClock,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import type { State } from '../shared/types';
import { getDaemonActivity, type DaemonActivityResponse } from './api';

// AEGIS (W-FIX G): the Companion view   OpenDuet made visible.
// OpenDuet (CopilotKit) is a proactive companion built on OpenBot whose
// own app shell cannot start without a CopilotKit Intelligence project
// key, so the upstream shell stays blocked on the user's machine too.
// What OpenDuet DOES   a proactive brief, ask-before-it-acts approvals,
// scheduled routines, and a full audit trail   runs natively here:
// the brief is assembled from live host + daemon state, approvals are
// the real connection/computer approval flows (linked below), and the
// audit trail is the daemon permission broker's real tool-call log.
// Nothing on this page is mock data: every number comes from the host
// state or the daemon's /api/tools, /api/log and /api/state endpoints.
export function CompanionPanel({ state }: { state: State }) {
  const [activity, setActivity] = useState<DaemonActivityResponse>();
  const [loading, setLoading] = useState(true);
  const [refreshedAt, setRefreshedAt] = useState<number>();
  const load = async () => {
    setLoading(true);
    try {
      setActivity(await getDaemonActivity());
    } catch {
      setActivity(undefined);
    } finally {
      setLoading(false);
      setRefreshedAt(Date.now());
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const go = (view: string) => {
    window.dispatchEvent(new CustomEvent('aegis:nav', { detail: view }));
  };

  const routines = [...state.tasks]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 8);
  const counts = activity?.counts ?? {};
  const log = activity?.log ?? [];

  return (
    <main className="main-content companion-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">COMPANION</span>
          <h1>Companion</h1>
          <p>
            Aegis s proactive layer: scheduled routines, approvals and a live
            audit trail, all drawn from the same host state the rest of the app
            uses.
          </p>
        </div>
        <button
          type="button"
          className="ghost"
          onClick={() => void load()}
          disabled={loading}
        >
          <RefreshCw size={15} /> {loading ? 'Refreshing ' : 'Refresh brief'}
        </button>
      </div>

      <section className="companion-brief">
        <h2>
          <Sparkles size={17} /> Today s brief
        </h2>
        {!activity?.reachable && (
          <p className="chat-error" role="alert">
            {activity?.detail ??
              'The Aegis daemon is not reachable, so the brief is partial.'}
          </p>
        )}
        <div className="companion-stats">
          <div>
            <strong>{String(counts.captures ?? ' ')}</strong>
            <small>memory captures</small>
          </div>
          <div>
            <strong>{String(counts.memories ?? ' ')}</strong>
            <small>consolidated memories</small>
          </div>
          <div>
            <strong>{activity?.learnedTools.length ?? ' '}</strong>
            <small>forged tools ready</small>
          </div>
          <div>
            <strong>{state.tasks.length}</strong>
            <small>scheduled routines</small>
          </div>
          <div>
            <strong>{log.length}</strong>
            <small>recent audited actions</small>
          </div>
        </div>
        <p className="muted companion-note">
          Aegis works proactively only inside the permissions you grant.
          Sensitive actions ask first, and every daemon tool call is recorded.
        </p>
        <div className="companion-actions">
          <button type="button" className="secondary" onClick={() => go('agents')}>
            Run a task
          </button>
          <button type="button" className="secondary" onClick={() => go('chat')}>
            Open conversation
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => go('computer')}
          >
            Review permissions
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => go('integrations')}
          >
            Connections
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent('aegis:nav', { detail: 'whatsapp' }),
              )
            }
          >
            WhatsApp
          </button>
        </div>
      </section>

      <section className="companion-block">
        <h2>
          <CalendarClock size={17} /> Routines
        </h2>
        {routines.length === 0 && (
          <p className="muted">
            No scheduled routines yet. Create one from any conversation
            (the clock icon) and it will appear here.
          </p>
        )}
        <ul className="companion-list">
          {routines.map((task) => (
            <li key={task.id}>
              <span>
                <strong>{task.prompt.slice(0, 90)}</strong>
                <small>
                  status {task.status}
                  {task.intervalSeconds
                    ? `   every ${Math.round(task.intervalSeconds / 60)} min`
                    : '   one-off'}
                  {task.nextRunAt
                    ? `   next run ${new Date(task.nextRunAt).toLocaleString()}`
                    : ''}
                  {task.error ? `   last error: ${task.error}` : ''}
                </small>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="companion-block">
        <h2>
          <ShieldCheck size={17} /> Approvals &amp; audit trail
        </h2>
        <p className="muted">
          Ask-before-it-acts is enforced by the connection tools marked  Ask
          first  and the computer permission gates. Every daemon tool call
          passes the permission broker and is written to this audit log,
          including denials. Latest entries:
        </p>
        {log.length === 0 ? (
          <p className="muted">
            {activity?.reachable
              ? 'No daemon actions recorded yet.'
              : 'Daemon unreachable   audit trail unavailable.'}
          </p>
        ) : (
          <ul className="companion-list audit">
            {log.slice(0, 12).map((entry, index) => (
              <li key={index}>
                <span>
                  <strong>{String(entry.tool ?? 'tool')}</strong>
                  <small>
                    {String(entry.status ?? '')}
                    {entry.risk ? `   risk ${String(entry.risk)}` : ''}
                    {entry.mode ? `   mode ${String(entry.mode)}` : ''}
                    {entry.error ? `   ${String(entry.error)}` : ''}
                    {entry.ts
                      ? `   ${new Date(Number(entry.ts) * (Number(entry.ts) > 1e12 ? 1 : 1000)).toLocaleString()}`
                      : ''}
                  </small>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="muted companion-footnote">
        {refreshedAt
          ? `Brief refreshed ${new Date(refreshedAt).toLocaleString()} from live host and daemon state.`
          : 'Loading the live brief '}
      </p>
    </main>
  );
}
