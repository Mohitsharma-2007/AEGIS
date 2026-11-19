import { useEffect, useState } from 'react';
import type { SetupStatus } from '../shared/types';
import {
  getAegisMemoryState,
  getHarnessStatus,
  type AegisMemoryStateResponse,
  type HarnessStatusResponse,
} from './api';

// AEGIS (W-HARNESS): services status block for the Settings view  
// real states only: the daemon link + computer sidecar come from the
// existing setup status, the browser engine from the setup payload's
// daemon state where present, and the native harness from
// /api/harness/status. Anything unknown is said plainly.
export function ServicesStatus({ setup }: { setup: SetupStatus }) {
  const [daemon, setDaemon] = useState<AegisMemoryStateResponse>();
  const [harness, setHarness] = useState<HarnessStatusResponse>();
  useEffect(() => {
    let active = true;
    const load = async () => {
      const [d, h] = await Promise.all([
        getAegisMemoryState().catch(() => undefined),
        getHarnessStatus().catch(() => undefined),
      ]);
      if (!active) return;
      setDaemon(d);
      setHarness(h);
    };
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  const rows: [string, string][] = [
    [
      'Aegis daemon (memory / tools, :8765)',
      daemon === undefined
        ? 'checking '
        : daemon.reachable
          ? `online   tier ${daemon.tier ?? ' '}   provider ${daemon.provider ?? ' '}   RAG ${daemon.ragEnabled ? 'on' : 'off'}`
          : 'offline   start Aegis with start.sh / start.ps1',
    ],
    [
      'Playwright browser (AEGIS Computer)',
      'Configured through the server s browser service; the Browser view uses the single Playwright engine.',
    ],
    [
      'AEGIS Computer',
      setup.aegisComputer
        ? setup.aegisComputer.configured
          ? setup.aegisComputer.available
            ? 'sidecar available'
            : `sidecar configured   ${setup.aegisComputer.detail}`
          : 'local mode (see the AEGIS Computer view for per-Agent state)'
        : 'local mode (see the AEGIS Computer view for per-Agent state)',
    ],
    [
      'Native harness',
      harness === undefined
        ? 'checking '
        : harness.running
          ? `running   native ${harness.version ?? ''}`
          : `down   ${harness.detail ?? 'not reachable'}`,
    ],
  ];
  return (
    <fieldset className="space-access-fields connections-fields">
      <legend>Services</legend>
      {rows.map(([name, value]) => (
        <p key={name}>
          <strong>{name}:</strong> <span className="muted">{value}</span>
        </p>
      ))}
    </fieldset>
  );
}
