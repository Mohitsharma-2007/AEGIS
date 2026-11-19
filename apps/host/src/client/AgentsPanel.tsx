import { Bot, Plus, SquarePen } from 'lucide-react';
import type { Dot } from '../shared/types';
import type { Dialog } from './WorkspaceDialog';
import { Mascot } from './Mascot';

// AEGIS (W-FIX 2b): the Agents view. One Aegis agent is the primary
// agent; the upstream surface presets (Today, Chat, Mail,  ) are
// grouped as its surfaces, not peers   the server tags them via
// Dot.surface (workspace.ts). User-created agents stay peers and can
// still be created on demand; Aegis also spawns task agents itself
// when work needs one.
export function AgentsPanel({
  dots,
  spaceId,
  onDialog,
}: {
  dots: Dot[];
  spaceId: string;
  onDialog: (dialog: Dialog) => void;
}) {
  const primary = dots.find((dot) => !dot.surface) ?? dots[0];
  const surfaces = dots.filter((dot) => dot.surface);
  const peers = dots.filter((dot) => !dot.surface && dot.id !== primary?.id);
  return (
    <main className="main-content">
      <div className="page-heading">
        <div>
          <span className="eyebrow">AGENTS</span>
          <h1>Agents</h1>
          <p>
            One Aegis agent runs your work. Its surfaces are built-in
            workspaces; extra agents are created on demand   by you here,
            or by Aegis when a task needs one.
          </p>
        </div>
        <button
          type="button"
          className="primary"
          onClick={() => onDialog({ type: 'dot', spaceId })}
        >
          <Plus size={16} /> New agent
        </button>
      </div>
      {primary && (
        <section className="agents-primary">
          <div className="agent-card-main">
            <Mascot identity={primary.id} name={primary.name} />
            <div>
              <strong>{primary.name}</strong>
              <p className="muted">
                Primary agent   {primary.spaceIds.length} space
                {primary.spaceIds.length === 1 ? '' : 's'}
              </p>
            </div>
            <button
              type="button"
              className="ghost"
              onClick={() => onDialog({ type: 'dot', dot: primary, spaceId })}
            >
              <SquarePen size={15} /> Edit
            </button>
          </div>
          {surfaces.length > 0 && (
            <>
              <h2>Surfaces of {primary.name}</h2>
              <ul className="agents-surfaces">
                {surfaces.map((dot) => (
                  <li key={dot.id}>
                    <Mascot identity={dot.id} name={dot.name} small />
                    <span>
                      <strong>
                        {dot.name.replace(/^Aegis\s+/, '')}
                      </strong>
                      <small>{dot.surface}</small>
                    </span>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => onDialog({ type: 'dot', dot, spaceId })}
                    >
                      <SquarePen size={14} /> Edit
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
      {peers.length > 0 && (
        <section className="agents-peers">
          <h2>
            <Bot size={17} /> Additional agents
          </h2>
          <ul className="agents-surfaces">
            {peers.map((dot) => (
              <li key={dot.id}>
                <Mascot identity={dot.id} name={dot.name} small />
                <span>
                  <strong>{dot.name}</strong>
                  <small>
                    {dot.spaceIds.length} space
                    {dot.spaceIds.length === 1 ? '' : 's'}
                  </small>
                </span>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => onDialog({ type: 'dot', dot, spaceId })}
                >
                  <SquarePen size={14} /> Edit
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
