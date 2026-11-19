import { useCallback, useEffect, useState } from 'react';
import {
  Bot,
  Brain,
  FlaskConical,
  FolderOpen,
  GitGraph,
  Loader2,
  Mail,
  Monitor,
  RefreshCw,
  ShieldCheck,
  Users,
  X,
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
import { HarnessPanel } from './HarnessPanel';
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
  const [deleting, setDeleting] = useState(false);

  const deleteAgent = async () => {
    if (!confirm(`Delete agent "${agent.name}"?`)) return;
    setDeleting(true);
    try {
      await api(`/agents/tasks/${agent.id}`, 'DELETE');
      void refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Delete failed.');
    } finally {
      setDeleting(false);
    }
  };

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
        <button
          type="button"
          className="ag-delete-btn"
          onClick={deleteAgent}
          disabled={deleting}
          aria-label={`Delete ${agent.name}`}
          title="Delete agent"
        >
          {deleting ? <Loader2 size={12} className="ag-spin" /> : <X size={14} />}
        </button>
      </footer>
    </article>
  );
}

export function AgentsWorkspace({
  dot,
  dots,
}: {
  dot: Dot;
  dots: Dot[];
}) {
  const [data, setData] = useState<AgentsResponse>();
  const [tab, setTab] = useState<'queries' | 'team' | 'harness'>('queries');
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

  const agents = data?.agents ?? [];
  const active = data?.active;

  return (
    <main className="main-content agents-workspace">
      <div className="page-heading ag-page-heading">
        <div>
          <span className="eyebrow">AGENT ORCHESTRATION</span>
          <h1>Agents</h1>
          <p>
            The orchestrator communicates with each agent through internal
            markdown mail. Queries and replies are threads in the Mail surface;
            the Harness tab shows the native execution engine's capabilities.
            {dots.length} workspace Agent{dots.length === 1 ? '' : 's'} available.
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
            <small>{active ? `${active.running} running · ${active.queued} queued` : 'Checking runtime'}</small>
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
          aria-selected={tab === 'queries'}
          className={tab === 'queries' ? 'active' : ''}
          onClick={() => setTab('queries')}
        >
          <Mail size={15} /> Queries
        </button>
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
          aria-selected={tab === 'harness'}
          className={tab === 'harness' ? 'active' : ''}
          onClick={() => setTab('harness')}
        >
          <GitGraph size={15} /> Harness
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
      ) : tab === 'harness' ? (
        <HarnessPanel />
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
