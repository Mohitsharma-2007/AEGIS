import { useEffect, useState } from 'react';
import { KeyRound, PlugZap, RefreshCw, ShieldCheck } from 'lucide-react';

interface ProviderStatus {
  provider: string;
  label: string;
  configured: boolean;
  connected: boolean;
  me: string | null;
  expiresAt: number | null;
}

/** OAuth client credentials live here   server-side only. */
export function OAuthSettingsCard() {
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [drafts, setDrafts] = useState<Record<string, { clientId: string; clientSecret: string }>>({});

  const load = async () => {
    try {
      const response = await fetch('/api/oauth/providers');
      if (!response.ok) return;
      const data = (await response.json()) as { providers: ProviderStatus[] };
      setProviders(data.providers);
    } catch {
      // server offline
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const saveCredentials = async (provider: string) => {
    const draft = drafts[provider];
    if (!draft?.clientId || !draft?.clientSecret) return;
    setBusy(provider);
    setError('');
    try {
      const response = await fetch('/api/oauth/credentials', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          clientId: draft.clientId,
          clientSecret: draft.clientSecret,
        }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? 'Save failed.');
      setDrafts((current) => ({ ...current, [provider]: { clientId: '', clientSecret: '' } }));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Save failed.');
    } finally {
      setBusy('');
    }
  };

  const connect = async (provider: string) => {
    setBusy(provider);
    setError('');
    try {
      const response = await fetch('/api/oauth/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
      });
      const data = (await response.json()) as { url?: string; error?: string };
      if (!response.ok || !data.url) {
        setError(data.error ?? 'OAuth could not start.');
        return;
      }
      window.location.href = data.url;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'OAuth could not start.');
    } finally {
      setBusy('');
    }
  };

  const disconnect = async (provider: string) => {
    setBusy(provider);
    setError('');
    try {
      await fetch('/api/oauth/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
      });
      await load();
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="assistant-card oauth-settings-card">
      <div className="voice-health">
        <KeyRound size={13} />
        <strong>OAuth providers</strong>
        <span>  credentials are stored on the server only.</span>
        <button type="button" className="text-button" onClick={() => void load()}>
          <RefreshCw size={13} /> Refresh
        </button>
      </div>
      {error && (
        <p className="computer-error" role="alert">
          {error}
        </p>
      )}
      {providers.length === 0 && (
        <p className="field-hint">No providers configured yet   add a client id and secret.</p>
      )}
      {providers.map((provider) => {
        const draft = drafts[provider.provider] ?? { clientId: '', clientSecret: '' };
        return (
          <div className="oauth-provider-row" key={provider.provider}>
            <div className="voice-health">
              <span>
                <strong>{provider.label}</strong>
                {' '}
                {provider.connected ? (
                  <span className="oauth-connected">
                    <ShieldCheck size={12} /> Connected{provider.me ? `   ${provider.me}` : ''}
                  </span>
                ) : provider.configured ? (
                  <span className="muted">configured   not connected</span>
                ) : (
                  <span className="muted">needs credentials</span>
                )}
              </span>
            </div>
            <div className="oauth-cred-fields">
              <input
                aria-label={`${provider.label} client id`}
                placeholder="Client ID"
                value={draft.clientId}
                onChange={(event) =>
                  setDrafts((current) => ({
                    ...current,
                    [provider.provider]: { ...draft, clientId: event.target.value },
                  }))
                }
              />
              <input
                aria-label={`${provider.label} client secret`}
                placeholder="Client secret"
                type="password"
                value={draft.clientSecret}
                onChange={(event) =>
                  setDrafts((current) => ({
                    ...current,
                    [provider.provider]: { ...draft, clientSecret: event.target.value },
                  }))
                }
              />
              <button
                type="button"
                className="text-button"
                disabled={busy === provider.provider || !draft.clientId || !draft.clientSecret}
                onClick={() => void saveCredentials(provider.provider)}
              >
                Save
              </button>
              <button
                type="button"
                className="text-button"
                disabled={busy === provider.provider || !provider.configured}
                onClick={() => void connect(provider.provider)}
              >
                <PlugZap size={13} /> {provider.connected ? 'Reconnect' : 'Connect'}
              </button>
              {provider.connected && (
                <button
                  type="button"
                  className="text-button danger"
                  disabled={busy === provider.provider}
                  onClick={() => void disconnect(provider.provider)}
                >
                  Disconnect
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
