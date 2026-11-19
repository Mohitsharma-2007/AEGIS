import { useState } from 'react';
import { Store, PlugZap, Wrench, KeyRound } from 'lucide-react';
import { MarketplacePanel } from './MarketplacePanel';
import { WhatsAppCard, EcosystemConnectorsGrid } from './WhatsAppCard';
import { ConnectionsSection } from './ConnectionsSection';
import { ToolsPluginsPanel } from './ToolsPluginsPanel';
import { OAuthSettingsCard } from './OAuthSettingsCard';
import type { Dot } from '../shared/types';

export type IntegrationsTab = 'marketplace' | 'connections' | 'tools' | 'oauth';

/**
 * Integrations & Ecosystem Hub   unified surface for Marketplace, Connections/Sidecars, MCP Tools & Plugins, and OAuth.
 */
export function IntegrationsView({
  dot,
  initialTab = 'marketplace',
}: {
  dot: Dot;
  initialTab?: IntegrationsTab;
}) {
  const [tab, setTab] = useState<IntegrationsTab>(initialTab);

  return (
    <div className="integrations-surface">
      <div className="ops-tabs" role="tablist">
        {(
          [
            ['marketplace', 'Marketplace', Store],
            ['connections', 'Connections & Sidecars', PlugZap],
            ['tools', 'MCP Tools & Plugins', Wrench],
            ['oauth', 'OAuth 2.0', KeyRound],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`ops-tab ${tab === id ? 'active' : ''}`}
            onClick={() => setTab(id)}
          >
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      {tab === 'marketplace' && (
        <MarketplacePanel onOpenConnections={() => setTab('connections')} />
      )}
      {tab === 'connections' && (
        <div className="integrations-tab-body">
          <WhatsAppCard />
          <EcosystemConnectorsGrid />
          <ConnectionsSection dotId={dot.id} />
        </div>
      )}
      {tab === 'tools' && <ToolsPluginsPanel dot={dot} />}
      {tab === 'oauth' && <OAuthSettingsCard />}
    </div>
  );
}
