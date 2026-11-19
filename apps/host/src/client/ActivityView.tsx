import { useEffect, useMemo, useState } from 'react';
import { Activity as ActivityIcon, Monitor, Search, Clock3 } from 'lucide-react';
import { api } from './api';
import type { Detail, State } from '../shared/types';

interface AuditEntry {
  id: string;
  action: string;
  detail?: string;
  at: number;
  status?: string;
}

/**
 * One interconnected Activity surface: task runs (server) + the agent's
 * computer audit trail (surface) in a single timeline, because they ARE the
 * same story   what the agent did and when.
 */
export function ActivityView({ state, dotId }: { state: State; dotId: string }) {
  const [search, setSearch] = useState('');
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [detail, setDetail] = useState<Detail>();
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    api<{ audit?: AuditEntry[] }>(`/dots/${encodeURIComponent(dotId)}/computer`)
      .then((status) => {
        if (active) setAudit(status.audit ?? []);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [dotId]);

  const query = search.trim().toLowerCase();
  const tasks = useMemo(
    () => state.tasks.filter((task) => !query || task.prompt.toLowerCase().includes(query)),
    [state.tasks, query],
  );
  const auditEntries = useMemo(
    () =>
      audit.filter(
        (entry) =>
          !query ||
          entry.action.toLowerCase().includes(query) ||
          (entry.detail ?? '').toLowerCase().includes(query),
      ),
    [audit, query],
  );

  const merged: Array<{
    id: string;
    at: number;
    kind: 'task' | 'audit';
    title: string;
    status?: string;
    detail?: string;
  }> = [
    ...tasks.map((task) => ({
      id: `task:${task.id}`,
      at: task.createdAt ?? 0,
      kind: 'task' as const,
      title: task.prompt,
      status: task.status,
    })),
    ...auditEntries.map((entry) => ({
      id: `audit:${entry.id}`,
      at: entry.at,
      kind: 'audit' as const,
      title: entry.action,
      status: entry.status,
      detail: entry.detail,
    })),
  ].sort((a, b) => b.at - a.at);

  const openTask = (id: string) =>
    void api<Detail>(`/tasks/${id}`)
      .then(setDetail)
      .catch((cause) => setError(cause instanceof Error ? cause.message : 'Could not load task.'));

  return (
    <div className="activity-hub">
      <div className="files-hub-header">
        <div className="hub-title-block">
          <div className="hub-badge">
            <ActivityIcon size={16} />
            <strong>Activity   Tasks &amp; Computer Audit</strong>
          </div>
          <p>Runs and surface actions in one timeline, in order.</p>
        </div>
        <div className="hub-controls-row">
          <div className="hub-search-box">
            <Search size={14} />
            <input
              type="text"
              placeholder="Search tasks and actions..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      </div>

      {error && (
        <p className="computer-error" role="alert">
          {error}
        </p>
      )}

      <div className="activity-timeline">
        {merged.length === 0 && (
          <p className="muted">No activity yet   scheduled tasks and computer actions will appear here.</p>
        )}
        {merged.map((entry) => (
          <div key={entry.id} className={`activity-row kind-${entry.kind}`}>
            <div className="activity-icon">
              {entry.kind === 'task' ? <Clock3 size={14} /> : <Monitor size={14} />}
            </div>
            <div className="activity-body">
              <div className="activity-title">
                <strong>{entry.title}</strong>
                <span className="activity-kind">{entry.kind}</span>
                {entry.status && <span className="activity-status">{entry.status}</span>}
              </div>
              {entry.detail && <p className="activity-detail">{entry.detail}</p>}
              <time className="activity-time">{new Date(entry.at).toLocaleString()}</time>
            </div>
            {entry.kind === 'task' && (
              <button
                type="button"
                className="text-button"
                onClick={() => openTask(entry.id.replace('task:', ''))}
              >
                Inspect
              </button>
            )}
          </div>
        ))}
      </div>
      {detail && (
        <div className="activity-detail-panel">
          <h3>{detail.task.prompt}</h3>
          <pre>
            {detail.runs?.length
              ? detail.runs
                  .map((run) => `${run.status}   ${new Date(run.startedAt).toLocaleString()}`)
                  .join('\n')
              : 'No runs yet.'}
          </pre>
        </div>
      )}
    </div>
  );
}
