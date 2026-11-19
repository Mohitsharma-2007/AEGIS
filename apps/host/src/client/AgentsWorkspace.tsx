import { useCallback, useEffect, useState } from 'react';
import {
  Bot,
  Brain,
  FlaskConical,
  FolderOpen,
  Loader2,
  Mail,
  Monitor,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { Dot } from '../shared/types';
import {
  getAgents,
  type AgentsResponse,
  type SwarmAgentId,
  type SwarmAgentInfo,
} from './api';
import { AgentMailPanel, AgentSendComposer } from './AgentMailPanel';
import { api } from './api';

const AGENT_ICONS: Record<SwarmAgentId, LucideIcon> = {
  aegis: Bot,
  rfi: FlaskConical,
  security: ShieldCheck,
  files: FolderOpen,
  memory: Brain,
  computer: Monitor,
};

function TeamCard({
  agent,
  configured,
}: {
  agent: SwarmAgentInfo;
  configured: boolean;
}) {
  const Icon = AGENT_ICONS[agent.id];

  return (
    <article className="ag-team-card">
      <div className="ag-team-head">
        <span className="ag-team-icon">
          <Icon size={18} />
        </span>
        <div>
          <strong>{agent.name}</strong>
          <small>{agent.role}</small>
        </div>
        <span className={`ag-ready ${configured ? 'on' : 'off'}`}>
          {configured ? 'Ready' : 'No provider'}
        </span>
      </div>
      <p>{agent.description}</p>
      <div className="ag-capabilities">
        {agent.capabilities.map((capability) => (
          <span key={capability}>{capability}</span>
        ))}
      </div>
      <footer>
        <span>{agent.kind === 'orchestrator' ? 'Orchestrator' : 'Specialist'}</span>
        {agent.model && <span>{agent.model}</span>}
      </footer>
    </article>
  );
}

/** One workspace Agent (a `dot`). Deleting it also deletes its conversations. */
function WorkspaceAgentCard({
  dot,
  primary,
  onDelete,
}: {
  dot: Dot;
  primary: boolean;
  onDelete: (dot: Dot) => Promise<void>;
}) {
  const [deleting, setDeleting] = useState(false);

  const remove = async () => {
    if (
      !confirm(
        `Delete "${dot.name}"? Its conversations are deleted too. This cannot be undone.`,
      )
    )
      return;
    setDeleting(true);
    try {
      await onDelete(dot);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <article className="ag-ws-card">
      <div className="ag-ws-head">
        <span className="ag-ws-avatar" aria-hidden="true">
          {dot.name.trim().charAt(0).toUpperCase()}
        </span>
        <div>
          <strong>{dot.name}</strong>
          <small>{primary ? 'Primary orchestrator' : 'Workspace Agent'}</small>
        </div>
        {primary ? (
          <span className="ag-ws-lock" title="The primary Agent cannot be deleted">
            Primary
          </span>
        ) : (
          <button
            type="button"
            className="ag-delete-btn"
            onClick={() => void remove()}
            disabled={deleting}
            aria-label={`Delete ${dot.name}`}
            title={`Delete ${dot.name}`}
          >
            {deleting ? (
              <Loader2 size={12} className="ag-spin" />
            ) : (
              <Trash2 size={14} />
            )}
          </button>
        )}
      </div>
      <p>{dot.instructions || 'No instructions yet.'}</p>
      <div className="ag-ws-flags">
        <span className={dot.researchAllowed ? 'on' : 'off'}>Research</span>
        <span className={dot.memoryAllowed ? 'on' : 'off'}>Memory</span>
      </div>
    </article>
  );
}

export function AgentsWorkspace({
  dot,
  dots,
  onOpenHarness,
}: {
  dot: Dot;
  dots: Dot[];
  /** The Harness is its own surface now; this link switches to it. */
  onOpenHarness: () => void;
}) {
  const [data, setData] = useState<AgentsResponse>();
  const [tab, setTab] = useState<'queries' | 'team' | 'workspace'>('team');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const agentsResponse = await getAgents();
      setData(agentsResponse);
      setError('');
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'The agent runtime could not be reached.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const deleteWorkspaceAgent = useCallback(
    async (target: Dot) => {
      try {
        await api(`/dots/${encodeURIComponent(target.id)}`, 'DELETE');
        setError('');
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Delete failed.');
      }
      await refresh();
    },
    [refresh],
  );

  const agents = data?.agents ?? [];
  const active = data?.active;
  const primary = dots.find((item) => !item.surface) ?? dots[0];
  const specialists = dots.filter((item) => item.id !== primary?.id);

  return (
    <main className="main-content agents-workspace">
      <div className="page-heading ag-page-heading">
        <div>
          <span className="eyebrow">AGENT ORCHESTRATION</span>
          <h1>Agents</h1>
          <p>
            The orchestrator talks to each agent through internal markdown mail.
            Queries and replies are threads in the Mail surface; the Harness is
            its own page in the rail.
          </p>
        </div>
        <div className="ag-runtime-state">
          <span className={`ag-runtime-dot ${active?.configured ? 'on' : 'off'}`} />
          <div>
            <strong>
              {active?.configured
                ? `${active.provider ?? 'Provider'}${active.model ? ` · ${active.model}` : ''}`
                : 'No model provider'}
            </strong>
            <small>
              {active ? `${active.running} running · ${active.queued} queued` : 'Checking runtime'}
            </small>
          </div>
          <button
            type="button"
            className="ag-icon-button"
            aria-label="Refresh agent runtime"
            onClick={() => void refresh()}
          >
            <RefreshCw size={15} />
          </button>
        </div>
      </div>

      {error && (
        <div className="ag-banner" role="alert">
          {error}
        </div>
      )}

      <div className="ag-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'team'}
          className={tab === 'team' ? 'active' : ''}
          onClick={() => setTab('team')}
        >
          <Users size={15} /> Team
          <span>{agents.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'workspace'}
          className={tab === 'workspace' ? 'active' : ''}
          onClick={() => setTab('workspace')}
        >
          <Bot size={15} /> Workspace
          <span>{dots.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'queries'}
          className={tab === 'queries' ? 'active' : ''}
          onClick={() => setTab('queries')}
        >
          <Mail size={15} /> Queries
        </button>
        <button
          type="button"
          className="ag-tab-link"
          onClick={onOpenHarness}
          title="Open the Harness execution engine"
        >
          Harness →
        </button>
      </div>

      {loading ? (
        <div className="ag-empty">
          <Loader2 size={18} className="ag-spin" /> Loading the runtime
        </div>
      ) : tab === 'team' ? (
        <div className="ag-team-grid">
          {agents.map((agent) => (
            <TeamCard
              key={agent.id}
              agent={agent}
              configured={Boolean(active?.configured)}
            />
          ))}
        </div>
      ) : tab === 'workspace' ? (
        <>
          <div className="ag-workspace-head">
            <h2>Workspace Agents</h2>
            <button
              type="button"
              className="secondary"
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent('aegis:new-agent', {
                    detail: { spaceId: dot.spaceId },
                  }),
                )
              }
            >
              <Plus size={14} /> New Agent
            </button>
          </div>
          {primary && (
            <div className="ag-team-grid">
              <WorkspaceAgentCard
                dot={primary}
                primary
                onDelete={deleteWorkspaceAgent}
              />
              {specialists.map((item) => (
                <WorkspaceAgentCard
                  key={item.id}
                  dot={item}
                  primary={false}
                  onDelete={deleteWorkspaceAgent}
                />
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <AgentSendComposer
            mailboxAddress="user@aegis"
            onSent={() => setTab('queries')}
          />
          <AgentMailPanel mailboxAddress="user@aegis" />
        </>
      )}
    </main>
  );
}
