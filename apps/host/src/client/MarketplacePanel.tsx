import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  GitBranch,
  Globe,
  Key,
  Layers,
  PackagePlus,
  PlugZap,
  Plus,
  RefreshCw,
  Search,
  Star,
  Terminal,
  Wrench,
  X,
} from 'lucide-react';
import { MARKETPLACE_REGISTRY, type MarketplaceItem } from './marketplace-data';
import { getBrandLogo } from './BrandIcons';

type CategoryFilter = 'all' | 'mcp' | 'plugin' | 'skill' | 'connector' | 'tool';

const CATEGORY_TABS: { id: CategoryFilter; label: string; count: number }[] = [
  { id: 'all', label: 'All', count: MARKETPLACE_REGISTRY.length },
  { id: 'mcp', label: 'MCP Servers', count: MARKETPLACE_REGISTRY.filter((i) => i.kind === 'mcp').length },
  { id: 'plugin', label: 'Plugins', count: MARKETPLACE_REGISTRY.filter((i) => i.kind === 'plugin').length },
  { id: 'skill', label: 'Skills', count: MARKETPLACE_REGISTRY.filter((i) => i.kind === 'skill').length },
  { id: 'connector', label: 'Connectors (OAuth)', count: MARKETPLACE_REGISTRY.filter((i) => i.kind === 'connector').length },
  { id: 'tool', label: 'Tools', count: MARKETPLACE_REGISTRY.filter((i) => i.kind === 'tool').length },
];

export function MarketplacePanel({
  onOpenConnections,
}: {
  onOpenConnections?: () => void;
}) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [installed, setInstalled] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem('aegis:marketplace:installed') || '{}');
    } catch {
      return {};
    }
  });
  // OAuth state comes from the server: a "connected" flag here means a
  // real token handshake completed, never a local toggle.
  const [oauthState, setOauthState] = useState<Record<string, { connected: boolean; me?: string | null }>>({});
  const [oauthBusy, setOauthBusy] = useState<string>();
  const [oauthError, setOauthError] = useState('');

  const [page, setPage] = useState(1);
  const PAGE_SIZE = 36;
  const [flash, setFlash] = useState<string>();
  const [installBusy, setInstallBusy] = useState<string>();

  // Custom addition modal
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addTab, setAddTab] = useState<'npx' | 'github' | 'oauth'>('npx');
  const [npxCommand, setNpxCommand] = useState('npx -y @modelcontextprotocol/server-postgres postgresql://localhost/mydb');
  const [githubUrl, setGithubUrl] = useState('https://github.com/modelcontextprotocol/servers/tree/main/src/github');
  const [oauthProvider, setOauthProvider] = useState('Google Workspace');
  const [oauthClientId, setOauthClientId] = useState('');
  const [oauthClientSecret, setOauthClientSecret] = useState('');
  const [oauthRedirectUri] = useState('http://localhost:4310/api/oauth/callback');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const saveInstalled = (next: Record<string, boolean>) => {
    setInstalled(next);
    localStorage.setItem('aegis:marketplace:installed', JSON.stringify(next));
  };

  // Installed connectors come from the server (files on disk), not from a
  // localStorage flag. The local map is only a cache while offline.
  useEffect(() => {
    let active = true;
    fetch('/api/marketplace/installed')
      .then((response) => (response.ok ? response.json() : []))
      .then((list: Array<{ item?: { id?: string } }>) => {
        if (!active || !Array.isArray(list)) return;
        const map: Record<string, boolean> = {};
        for (const record of list) {
          if (record.item?.id) map[record.item.id] = true;
        }
        setInstalled((current) => ({ ...current, ...map }));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const installConnector = async (item: MarketplaceItem) => {
    setInstallBusy(item.id);
    setOauthError('');
    try {
      const response = await fetch('/api/marketplace/installed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item),
      });
      const data = (await response.json()) as {
        slug?: string;
        path?: string;
        harness?: string;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error ?? 'Could not install this connector.');
      }
      saveInstalled({ ...installed, [item.id]: true });
      setFlash(
        data.harness === 'registered'
          ? `Installed ${item.name} into ${data.path ?? 'data/connectors'} and registered it with the harness.`
          : `Installed ${item.name} into ${data.path ?? 'data/connectors'}.`,
      );
      return true;
    } catch (cause) {
      setFlash(
        cause instanceof Error
          ? cause.message
          : 'Could not add this connector.',
      );
      return false;
    } finally {
      setInstallBusy(undefined);
      setTimeout(() => setFlash(undefined), 6000);
    }
  };

  const removeConnector = async (item: MarketplaceItem) => {
    setInstallBusy(item.id);
    setOauthError('');
    try {
      const response = await fetch(
        `/api/marketplace/installed/${encodeURIComponent(item.id)}`,
        { method: 'DELETE' },
      );
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(data.error ?? 'Could not remove this connector.');
      }
      saveInstalled({ ...installed, [item.id]: false });
      setFlash(`Removed ${item.name} and its connector folder.`);
    } catch (cause) {
      setFlash(
        cause instanceof Error
          ? cause.message
          : 'Could not remove this connector.',
      );
    } finally {
      setInstallBusy(undefined);
      setTimeout(() => setFlash(undefined), 5000);
    }
  };

  useEffect(() => {
    let active = true;
    fetch('/api/oauth/providers')
      .then((response) => (response.ok ? response.json() : { providers: [] }))
      .then((data: { providers: Array<{ provider: string; connected: boolean; me?: string | null }> }) => {
        if (!active) return;
        const next: Record<string, { connected: boolean; me?: string | null }> = {};
        for (const provider of data.providers ?? []) {
          next[provider.provider] = { connected: provider.connected, me: provider.me };
        }
        setOauthState(next);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const connectOAuth = async (provider: string) => {
    setOauthBusy(provider);
    setOauthError('');
    try {
      const response = await fetch('/api/oauth/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
      });
      const data = (await response.json()) as { url?: string; error?: string };
      if (!response.ok || !data.url) {
        setOauthError(data.error ?? 'OAuth could not start.');
        return;
      }
      window.location.href = data.url;
    } catch (error) {
      setOauthError(error instanceof Error ? error.message : 'OAuth could not start.');
    } finally {
      setOauthBusy(undefined);
    }
  };

  const disconnectOAuth = async (provider: string) => {
    setOauthBusy(provider);
    setOauthError('');
    try {
      const response = await fetch('/api/oauth/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
      });
      if (response.ok) {
        setOauthState((current) => ({
          ...current,
          [provider]: { connected: false },
        }));
      }
    } catch {
      // leave state unchanged
    } finally {
      setOauthBusy(undefined);
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return MARKETPLACE_REGISTRY.filter((item) => {
      const matchCat = category === 'all' || item.kind === category;
      if (!matchCat) return false;
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        item.publisher.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [query, category]);

  const visibleItems = useMemo(() => {
    return filtered.slice(0, page * PAGE_SIZE);
  }, [filtered, page]);

  const toggleInstall = (item: MarketplaceItem) => {
    if (installed[item.id]) void removeConnector(item);
    else void installConnector(item);
  };

  const toggleOAuth = (provider: string) => {
    if (oauthState[provider]?.connected) void disconnectOAuth(provider);
    else void connectOAuth(provider);
  };

  const handleAddCustom = async () => {
    setIsSubmitting(true);
    try {
      if (addTab === 'oauth') {
        await connectOAuth(oauthProvider);
        setAddModalOpen(false);
        setFlash(`Opening ${oauthProvider} OAuth…`);
        return;
      }
      const now = Date.now();
      const newItem: MarketplaceItem =
        addTab === 'npx'
          ? {
              id: `custom-npx-${now}`,
              name:
                npxCommand.replace(/^npx\s+(-y\s+)?/, '').split(' ')[0] ||
                'custom-npx',
              kind: 'skill',
              category: 'Custom Installed',
              publisher: 'Local User',
              description: `Connector generated from this command: \`${npxCommand}\``,
              tags: ['npx', 'custom', 'skill'],
              command: npxCommand,
              githubUrl: '',
              oauth: false,
              rating: 5.0,
              installs: 1,
            }
          : {
              id: `custom-gh-${now}`,
              name: githubUrl.split('/').pop() || 'custom-repo',
              kind: 'skill',
              category: 'GitHub Imported',
              publisher: 'GitHub',
              description: `Connector manifest for repository: ${githubUrl}`,
              tags: ['github', 'custom', 'imported'],
              command: `git clone ${githubUrl}`,
              githubUrl,
              oauth: false,
              rating: 5.0,
              installs: 1,
            };
      MARKETPLACE_REGISTRY.unshift(newItem);
      const ok = await installConnector(newItem);
      if (ok) setAddModalOpen(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard?.writeText(text);
    setFlash(`Copied ${label} to clipboard!`);
    setTimeout(() => setFlash(undefined), 2500);
  };

  return (
    <main className="marketplace-surface">
      <header className="marketplace-hero">
        <div className="marketplace-hero-text">
          <span className="marketplace-eyebrow">Aegis Ecosystem</span>
          <h1>Marketplace & Connector Hub</h1>
          <p>
            Browse over <strong>2,000+</strong> verified MCP servers, skills, tools, and enterprise connectors.
            Connect real-time data with native OAuth 2.0 or install skills directly via NPX and GitHub.
          </p>
        </div>

        <div className="marketplace-hero-actions">
          <button
            className="primary marketplace-add-btn"
            onClick={() => setAddModalOpen(true)}
          >
            <Plus size={16} />
            <span>Add Custom Skill / Connector</span>
          </button>
          {onOpenConnections && (
            <button className="secondary" onClick={onOpenConnections}>
              <PlugZap size={16} />
              <span>Manage Connections</span>
            </button>
          )}
        </div>
      </header>

      {/* Search & Category Filter Toolbar */}
      <div className="marketplace-toolbar">
        <div className="marketplace-search-wrap">
          <Search size={18} className="search-icon" />
          <input
            type="search"
            aria-label="Search the marketplace"
            placeholder="Search 2,000+ MCP servers, plugins, skills, tools, and connectors..."
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
          />
          {query && (
            <button className="search-clear" onClick={() => setQuery('')}>
              <X size={14} />
            </button>
          )}
        </div>

        <div className="marketplace-categories" role="tablist">
          {CATEGORY_TABS.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={category === tab.id}
              className={`cat-pill ${category === tab.id ? 'active' : ''}`}
              onClick={() => {
                setCategory(tab.id);
                setPage(1);
              }}
            >
              <span>{tab.label}</span>
              <span className="pill-count">{tab.count}</span>
            </button>
          ))}
        </div>
      </div>

      {flash && (
        <div className="marketplace-toast" role="status">
          <Check size={16} />
          <span>{flash}</span>
        </div>
      )}
      {oauthError && (
        <div className="marketplace-toast error" role="alert">
          <X size={16} />
          <span>{oauthError}</span>
        </div>
      )}

      {/* Grid count summary */}
      <div className="marketplace-meta-bar">
        <span>
          Showing <strong>{visibleItems.length}</strong> of <strong>{filtered.length}</strong> items
          {category !== 'all' && ` in ${category.toUpperCase()}`}
        </span>
      </div>

      {/* Marketplace Cards Grid */}
      <div className="marketplace-cards-grid">
        {visibleItems.map((item) => {
          const isItemInstalled = !!installed[item.id];
          const isOauthConnected = item.oauthProvider
            ? !!oauthState[item.oauthProvider]?.connected
            : false;

          return (
            <article className={`m-card ${isItemInstalled ? 'installed' : ''}`} key={item.id}>
              <div className="m-card-header">
                <div className="m-card-icon-wrap">
                  {getBrandLogo(item, 22) ?? (
                    <>
                      {item.kind === 'mcp' && <PlugZap size={20} />}
                      {item.kind === 'plugin' && <Layers size={20} />}
                      {item.kind === 'skill' && <Wrench size={20} />}
                      {item.kind === 'connector' && <Globe size={20} />}
                      {item.kind === 'tool' && <Wrench size={20} />}
                    </>
                  )}
                </div>
                <div className="m-card-titles">
                  <h3>{item.name}</h3>
                  <div className="m-card-sub">
                    <span className="m-publisher">{item.publisher}</span>
                    <span className="m-dot"> </span>
                    <span className={`m-kind-badge ${item.kind}`}>{item.kind.toUpperCase()}</span>
                  </div>
                </div>
                {item.oauth && (
                  <span
                    className={`m-oauth-badge ${isOauthConnected ? 'connected' : ''}`}
                    title={isOauthConnected ? 'OAuth Connected' : 'OAuth Ready'}
                  >
                    <Key size={11} /> {isOauthConnected ? 'Authorized' : 'OAuth'}
                  </span>
                )}
              </div>

              <p className="m-card-desc">{item.description}</p>

              <div className="m-card-tags">
                {item.tags.map((tag) => (
                  <span key={tag} className="m-tag">
                    #{tag}
                  </span>
                ))}
              </div>

              <div className="m-card-command-row">
                <code title={item.command}>{item.command}</code>
                <button
                  className="icon-copy-btn"
                  title="Copy command"
                  onClick={() => copyToClipboard(item.command, 'NPX command')}
                >
                  <Copy size={13} />
                </button>
              </div>

              <div className="m-card-footer">
                <div className="m-card-stats">
                  <span className="m-stat" title="Rating">
                    <Star size={12} className="star-icon" /> {item.rating}
                  </span>
                  <span className="m-stat" title="Active Installs">
                    <Download size={12} /> {item.installs.toLocaleString()}
                  </span>
                </div>

                <div className="m-card-actions">
                  {item.oauth && (
                    <button
                      className={`m-oauth-btn ${isOauthConnected ? 'connected' : ''}`}
                      disabled={oauthBusy === (item.oauthProvider || item.name)}
                      onClick={() => toggleOAuth(item.oauthProvider || item.name)}
                    >
                      {oauthBusy === (item.oauthProvider || item.name)
                        ? 'Working '
                        : isOauthConnected
                          ? 'Disconnect'
                          : 'Connect OAuth'}
                    </button>
                  )}

                  <button
                    className={`m-action-btn ${isItemInstalled ? 'installed' : 'add'}`}
                    disabled={installBusy === item.id}
                    title={
                      isItemInstalled
                        ? 'Remove this connector folder'
                        : 'Create the connector files and download them'
                    }
                    onClick={() => toggleInstall(item)}
                  >
                    {installBusy === item.id ? (
                      <>
                        <RefreshCw size={14} /> Working…
                      </>
                    ) : isItemInstalled ? (
                      <>
                        <Check size={14} /> Added
                      </>
                    ) : (
                      <>
                        <Download size={14} /> Add
                      </>
                    )}
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {/* Pagination Load More */}
      {visibleItems.length < filtered.length && (
        <div className="marketplace-load-more">
          <button className="secondary" onClick={() => setPage((p) => p + 1)}>
            Load More ({filtered.length - visibleItems.length} remaining)
          </button>
        </div>
      )}

      {/* Modal: Add Custom Skill / Connector */}
      {addModalOpen && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) setAddModalOpen(false);
          }}
        >
          <div className="modal-dialog marketplace-modal">
            <header className="modal-header">
              <div className="modal-title-row">
                <PackagePlus size={22} />
                <h2>Add Custom Skill, Tool or Connector</h2>
              </div>
              <button
                className="icon-button modal-close"
                onClick={() => setAddModalOpen(false)}
              >
                <X size={18} />
              </button>
            </header>

            <nav className="modal-tabs" role="tablist">
              <button
                className={addTab === 'npx' ? 'active' : ''}
                onClick={() => setAddTab('npx')}
              >
                <Terminal size={15} /> Install via NPX
              </button>
              <button
                className={addTab === 'github' ? 'active' : ''}
                onClick={() => setAddTab('github')}
              >
                <GitBranch size={15} /> Import from GitHub
              </button>
              <button
                className={addTab === 'oauth' ? 'active' : ''}
                onClick={() => setAddTab('oauth')}
              >
                <Key size={15} /> OAuth 2.0 Connector
              </button>
            </nav>

            <div className="modal-body">
              {addTab === 'npx' && (
                <div className="tab-pane">
                  <p className="pane-help">
                    Provide any valid NPX command or Smithery package. Aegis will register the process as an active
                    skill/tool in the workspace.
                  </p>
                  <label className="field-label">
                    <span>NPX Command</span>
                    <input
                      type="text"
                      className="text-input"
                      value={npxCommand}
                      onChange={(e) => setNpxCommand(e.target.value)}
                      placeholder="npx -y @modelcontextprotocol/server-name args..."
                    />
                  </label>
                  <div className="cmd-preview">
                    <span>Execution Preview:</span>
                    <code>{npxCommand}</code>
                  </div>
                </div>
              )}

              {addTab === 'github' && (
                <div className="tab-pane">
                  <p className="pane-help">
                    Paste a link to any public or private GitHub repository containing MCP server definitions or Aegis skills.
                  </p>
                  <label className="field-label">
                    <span>GitHub Repository URL</span>
                    <input
                      type="url"
                      className="text-input"
                      value={githubUrl}
                      onChange={(e) => setGithubUrl(e.target.value)}
                      placeholder="https://github.com/organization/repository"
                    />
                  </label>
                  <div className="cmd-preview">
                    <span>Clone Target:</span>
                    <code>{githubUrl}</code>
                  </div>
                </div>
              )}

              {addTab === 'oauth' && (
                <div className="tab-pane">
                  <p className="pane-help">
                    Authenticate directly with third-party providers using OAuth 2.0 PKCE flow.
                  </p>
                  <label className="field-label">
                    <span>OAuth Provider</span>
                    <select
                      className="text-input select"
                      value={oauthProvider}
                      onChange={(e) => setOauthProvider(e.target.value)}
                    >
                      <option>Google Workspace (Drive, Docs, Sheets, Gmail)</option>
                      <option>Slack (Channels, DMs, Canvas)</option>
                      <option>GitHub (Repos, PRs, Issues, Actions)</option>
                      <option>Linear (Issues, Cycles, Projects)</option>
                      <option>Notion (Databases, Documents)</option>
                      <option>Microsoft 365 (Outlook, Teams, OneDrive)</option>
                      <option>Discord (Guilds, Messages, Bots)</option>
                      <option>Spotify (Playlists, Web Playback)</option>
                    </select>
                  </label>
                  <div className="form-row">
                    <label className="field-label">
                      <span>Client ID</span>
                      <input
                        type="text"
                        className="text-input"
                        placeholder="e.g. 102938475-client.apps.googleusercontent.com"
                        value={oauthClientId}
                        onChange={(e) => setOauthClientId(e.target.value)}
                      />
                    </label>
                    <label className="field-label">
                      <span>Client Secret (Optional for PKCE)</span>
                      <input
                        type="password"
                        className="text-input"
                        placeholder=" "
                        value={oauthClientSecret}
                        onChange={(e) => setOauthClientSecret(e.target.value)}
                      />
                    </label>
                  </div>
                  <label className="field-label">
                    <span>Redirect Callback URL</span>
                    <input
                      type="text"
                      className="text-input"
                      readOnly
                      value={oauthRedirectUri}
                    />
                  </label>
                </div>
              )}
            </div>

            <footer className="modal-footer">
              <button
                className="secondary"
                onClick={() => setAddModalOpen(false)}
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button
                className="primary"
                onClick={handleAddCustom}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <RefreshCw size={14} className="spinning" /> Connecting...
                  </>
                ) : (
                  <>
                    {addTab === 'oauth' ? 'Authorize with OAuth' : 'Install & Register'}
                  </>
                )}
              </button>
            </footer>
          </div>
        </div>
      )}
    </main>
  );
}
