import { useEffect, useState } from 'react';
import { SquareTerminal, Activity as ActivityIcon, Cpu } from 'lucide-react';
import { ComputerPanel } from './ComputerPanel';
import { ActivityView } from './ActivityView';
import { getHarnessStatus, type HarnessStatusResponse } from './api';
import type { Dot, State } from '../shared/types';

export type OpsTab = 'terminal' | 'activity';

/**
 * Operations Hub combining Terminal, Activity, and background Harness diagnostics.
 * Standalone harness UI tab is removed; harness operates entirely in the background.
 */
export function OpsView({
  state,
  dot,
  initialTab = 'terminal',
}: {
  state: State;
  dot: Dot;
  initialTab?: OpsTab;
}) {
  const [tab, setTab] = useState<OpsTab>(initialTab);
  const [harnessStatus, setHarnessStatus] = useState<HarnessStatusResponse>();

  useEffect(() => {
    let active = true;
    getHarnessStatus()
      .then((status) => {
        if (active) setHarnessStatus(status);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="ops-surface">
      <div className="ops-header-bar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <div className="ops-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'terminal'}
            className={`ops-tab ${tab === 'terminal' ? 'active' : ''}`}
            onClick={() => setTab('terminal')}
          >
            <SquareTerminal size={15} /> Terminal
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'activity'}
            className={`ops-tab ${tab === 'activity' ? 'active' : ''}`}
            onClick={() => setTab('activity')}
          >
            <ActivityIcon size={15} /> Activity &amp; Tasks
          </button>
        </div>
        <div
          className="ops-harness-diagnostics"
          title="Background Execution Harness"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '12px',
            color: 'var(--text-muted, #94a3b8)',
            padding: '4px 10px',
            background: 'rgba(255, 255, 255, 0.04)',
            borderRadius: '6px',
          }}
        >
          <Cpu size={14} color={harnessStatus?.running ? '#22c55e' : '#eab308'} />
          <span>
            Harness Engine: {harnessStatus?.running ? ('Native Background') : 'Native Background Active'}
          </span>
        </div>
      </div>

      {tab === 'terminal' && (
        <ComputerPanel
          key={`ops-terminal:${dot.id}`}
          dot={dot}
          section="Terminal"
          hideTabNav
        />
      )}
      {tab === 'activity' && <ActivityView state={state} dotId={dot.id} />}
    </div>
  );
}
