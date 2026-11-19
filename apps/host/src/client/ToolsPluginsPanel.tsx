import { useEffect, useState } from 'react';
import { PlugZap, Trash2, Search, Wrench, Layers } from 'lucide-react';
import type { Dot } from '../shared/types';
import {
  deleteHarnessMcpServer,
  getDaemonActivity,
  getDaemonMcp,
  getHarnessMcpServers,
  saveHarnessMcpServer,
  toggleHarnessMcpServer,
  type DaemonActivityResponse,
  type DaemonMcpResponse,
  type McpServerConfig,
} from './api';

export function ToolsPluginsPanel({ dot }: { dot: Dot }) {
  const [activeTab, setActiveTab] = useState<'all' | 'daemon' | 'plugins'>('all');
  const [search, setSearch] = useState('');

  return (
    <div className="tools-plugins-panel">
      <div className="tools-plugins-head">
        <h2>Tools & Plugins</h2>
        <p>
          Unified management for {dot.name}: Aegis Daemon Tools and Aegis
          Plugins. Connections, OAuth and the marketplace live in the
          Integrations tabs above.
        </p>
      </div>

      {/* Merged Navigation and Omni-Filter Bar */}
      <div className="tools-hub-controls">
        <div className="tools-tab-switcher">
          <button
            type="button"
            className={`tools-tab-btn ${activeTab === 'all' ? 'active' : ''}`}
            onClick={() => setActiveTab('all')}
          >
            <Layers size={14} />
            <span>All Tools & Plugins</span>
          </button>
          <button
            type="button"
            className={`tools-tab-btn ${activeTab === 'daemon' ? 'active' : ''}`}
            onClick={() => setActiveTab('daemon')}
          >
            <Wrench size={14} />
            <span>Daemon Tools</span>
          </button>
          <button
            type="button"
            className={`tools-tab-btn ${activeTab === 'plugins' ? 'active' : ''}`}
            onClick={() => setActiveTab('plugins')}
          >
            <Layers size={14} />
            <span>MCP Servers</span>
          </button>
        </div>

        <div className="tools-search-box">
          <Search size={14} />
          <input
            type="text"
            placeholder="Search tools, schemas, servers..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {(activeTab === 'all' || activeTab === 'daemon') && (
        <DaemonToolsSection search={search} />
      )}
      {(activeTab === 'all' || activeTab === 'plugins') && (
        <HarnessPluginsSection search={search} />
      )}
    </div>
  );
}

function DaemonToolsSection({ search: _search = '' }: { search?: string }) {
  const [mcp, setMcp] = useState<DaemonMcpResponse>();
  const [activity, setActivity] = useState<DaemonActivityResponse>();
  useEffect(() => {
    let active = true;
    const load = async () => {
      const [m, a] = await Promise.all([getDaemonMcp(), getDaemonActivity()]);
      if (!active) return;
      setMcp(m);
      setActivity(a);
    };
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  const servers = mcp?.servers?.servers ?? [];
  const importedTools = mcp?.tools?.tools ?? [];
  return (
    <fieldset className="space-access-fields connections-fields">
      <legend>Aegis daemon tools</legend>
      {!mcp || !activity ? (
        <p className="muted">Loading daemon status </p>
      ) : !mcp.reachable ? (
        <p className="muted">{mcp.detail}</p>
      ) : (
        <>
          <p className="muted">
            Daemon MCP servers: {servers.length} configured
            {importedTools.length
              ? `   ${importedTools.length} imported tools`
              : ''}
            . The daemon also serves its own memory tools as a stdio MCP server
            (registered with the harness as "aegis-daemon" in .aegis-data/mcp.json).
          </p>
          {/* AEGIS (W-FIX 1c): per-server status, honestly   connected,
              configured-but-not-started, or failed WITH the reason the
              daemon recorded, instead of one flattened line. */}
          {servers.length > 0 && (
            <ul className="connection-tools">
              {servers.map((server) => {
                const entry = server as {
                  name: string;
                  status: string;
                  error?: string | null;
                };
                return (
                  <li key={entry.name}>
                    <span>
                      <strong>{entry.name}</strong>
                      <small>
                        {entry.status === 'connected'
                          ? 'Connected'
                          : entry.status === 'configured'
                            ? 'Configured   starts on first use'
                            : `Failed   ${entry.error ?? entry.status}`}
                      </small>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {activity.learnedTools.length > 0 && (
            <>
              <p>
                <strong>Forged tools</strong>   repeated calls the daemon
                learned into faster tools:
              </p>
              <ul className="connection-tools">
                {activity.learnedTools.map((tool, index) => (
                  <li key={index}>
                    <span>
                      <strong>
                        {String(tool.name ?? tool.slug ?? 'tool')}
                      </strong>
                      <small>
                        from {String(tool.source_tool ?? '')}   used{' '}
                        {String(tool.use_count ?? 0)} times
                      </small>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {activity.forgedLog.length > 0 && (
            <p className="muted">
              {activity.forgedLog.length} recent log entr
              {activity.forgedLog.length === 1 ? 'y ran' : 'ies ran'} through
              forged tools.
            </p>
          )}
          {/* AEGIS (W-FIX G): OpenBot governance made visible   the
              permission broker's audit trail. Every daemon tool call
              (allowed, denied, errored) is one entry. */}
          {activity.log.length > 0 && (
            <>
              <p>
                <strong>Permission broker audit trail</strong>   latest
                daemon actions:
              </p>
              <ul className="connection-tools">
                {activity.log.slice(0, 10).map((entry, index) => (
                  <li key={index}>
                    <span>
                      <strong>{String(entry.tool ?? 'tool')}</strong>
                      <small>
                        {String(entry.status ?? '')}
                        {entry.risk ? `   risk ${String(entry.risk)}` : ''}
                        {entry.mode ? `   ${String(entry.mode)}` : ''}
                        {entry.error ? `   ${String(entry.error)}` : ''}
                      </small>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {activity.counts && (
            <p className="muted">
              Memory: {String(activity.counts.memories ?? 0)} memories  {' '}
              {String(activity.counts.captures ?? 0)} captures. Consolidation
              runs on the daemon when idle; its reports arrive on the daemon
              event queue (the learned-tools and log state above is what the
              daemon s HTTP API carries between runs).
            </p>
          )}
        </>
      )}
    </fieldset>
  );
}

function HarnessPluginsSection({ search: _search = '' }: { search?: string }) {
  const [servers, setServers] = useState<Record<string, McpServerConfig>>();
  const [name, setName] = useState('');
  const [type, setType] = useState<'local' | 'remote'>('local');
  const [command, setCommand] = useState('');
  const [url, setUrl] = useState('');
  const [environment, setEnvironment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void getHarnessMcpServers()
      .then((result) => active && setServers(result.servers))
      .catch(
        (cause) =>
          active &&
          setError(
            cause instanceof Error ? cause.message : 'Could not load plugins.',
          ),
      );
    return () => {
      active = false;
    };
  }, []);
  const run = async (
    request: () => Promise<{ servers: Record<string, McpServerConfig> }>,
  ) => {
    setBusy(true);
    setError('');
    try {
      const result = await request();
      setServers(result.servers);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Request failed.');
    } finally {
      setBusy(false);
    }
  };
  const add = async () => {
    const env: Record<string, string> = {};
    for (const line of environment.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const eq = trimmed.indexOf('=');
      if (eq > 0) env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1);
    }
    const config: McpServerConfig =
      type === 'local'
        ? {
            type: 'local',
            command: command.trim().split(/\s+/).filter(Boolean),
            ...(Object.keys(env).length ? { environment: env } : {}),
            disabled: false,
          }
        : { type: 'remote', url: url.trim(), disabled: false };
    await run(() => saveHarnessMcpServer(name.trim(), config));
    setName('');
    setCommand('');
    setUrl('');
    setEnvironment('');
  };
  return (
    <fieldset className="space-access-fields connections-fields">
      <legend>MCP servers</legend>
      <p className="muted">
        These entries live in .aegis-data/mcp.json (mcp.servers) and are
        read by the native harness. The harness reads its config when it
        starts, so changes here apply the next time the harness restarts   they
        do not hot-reload into a running sidecar.
      </p>
      {servers &&
        Object.entries(servers).map(([serverName, config]) => (
          <div className="connection" key={serverName}>
            <div className="connection-head">
              <PlugZap size={15} />
              <span>
                <strong>{serverName}</strong>
                <small>
                  {config.type === 'local'
                    ? `local   ${config.command.join(' ')}`
                    : `remote   ${config.url}`}
                  {config.disabled ? '   disabled' : ''}
                </small>
              </span>
              <label className="connection-approval">
                <input
                  type="checkbox"
                  checked={!config.disabled}
                  disabled={busy}
                  onChange={(event) =>
                    void run(() =>
                      toggleHarnessMcpServer(serverName, !event.target.checked),
                    )
                  }
                />
                Enabled
              </label>
              <button
                type="button"
                className="icon-button"
                aria-label={`Remove ${serverName}`}
                disabled={busy}
                onClick={() => {
                  if (
                    !window.confirm(`Remove ${serverName} from mcp.json?`)
                  )
                    return;
                  void run(() => deleteHarnessMcpServer(serverName));
                }}
              >
                <Trash2 size={15} />
              </button>
            </div>
            {config.type === 'local' && config.environment && (
              <p className="muted">
                Environment: {Object.keys(config.environment).join(', ')}
              </p>
            )}
          </div>
        ))}
      {servers && !Object.keys(servers).length && (
        <p className="muted">No MCP servers configured yet.</p>
      )}
      <div className="connection-add">
        <label className="field-label" htmlFor="mcp-plugin-name">
          Add an MCP server
        </label>
        <input
          id="mcp-plugin-name"
          placeholder="Name, e.g. everything"
          maxLength={80}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <select
          aria-label="Plugin type"
          value={type}
          onChange={(event) =>
            setType(event.target.value as 'local' | 'remote')
          }
        >
          <option value="local">Local (command)</option>
          <option value="remote">Remote (URL)</option>
        </select>
        {type === 'local' ? (
          <>
            <input
              aria-label="Command"
              placeholder="npx -y @modelcontextprotocol/server-everything"
              value={command}
              onChange={(event) => setCommand(event.target.value)}
            />
            <textarea
              aria-label="Environment (KEY=value per line)"
              placeholder={'Environment, one KEY=value per line (optional)'}
              value={environment}
              onChange={(event) => setEnvironment(event.target.value)}
              rows={2}
            />
          </>
        ) : (
          <input
            aria-label="MCP server URL"
            placeholder="https://example.com/mcp"
            type="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
        )}
        <button
          type="button"
          className="connection-connect"
          disabled={
            busy ||
            !name.trim() ||
            (type === 'local' ? !command.trim() : !url.trim())
          }
          onClick={() => void add()}
        >
          {busy ? 'Saving ' : 'Add plugin'}
        </button>
      </div>
      {error && (
        <p className="chat-error" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}
