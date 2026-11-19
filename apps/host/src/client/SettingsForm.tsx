import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  ChevronRight,
  Eye,
  EyeOff,
  KeyRound,
  Keyboard,
  Mic,
  PlugZap,
  RefreshCw,
  Search,
  Sparkles,
  Volume2,
  Waves,
} from 'lucide-react';
import type {
  ProviderOption,
  Settings,
  State,
  WorkspaceState,
} from '../shared/types';
import {
  api,
  getProviderModels,
  getProviders,
  selectProvider,
  type ProviderModelsResponse,
  type ProvidersResponse,
} from './api';
import { adoptServerSoundPreference, setSoundsEnabled } from './sounds';
import {
  setThemePreference,
  themePreference,
  type ThemePreference,
} from './theme';
import { readAloud, stopReadAloud } from './read-aloud';
import { WindowsVoicePanel } from './WindowsVoicePanel';
import { OAuthSettingsCard } from './OAuthSettingsCard';

declare global {
  interface Window {
    aegis?: {
      getDesktopPreferences?: () => Promise<{ minimizeToTray?: boolean; clipboardHistoryEnabled?: boolean; externalAgentDiscoveryEnabled?: boolean }>;
      setMinimizeToTray?: (enabled: boolean) => Promise<{ minimizeToTray: boolean; saved: boolean }>;
      setClipboardHistoryEnabled?: (enabled: boolean) => Promise<{ clipboardHistoryEnabled: boolean; saved: boolean }>;
      setExternalAgentDiscovery?: (enabled: boolean) => Promise<{ externalAgentDiscoveryEnabled: boolean; saved: boolean }>;
    };
  }
}

// AEGIS Settings: a searchable provider rail with a
// detail pane, an environment editor for the keys those providers need, and
// the assistant controls (mascot, sound pack, wake word, local voice).
// Every control writes real state: PATCH /api/settings, PUT /api/providers,
// and PUT /api/env for .env.local.

interface EnvEntry {
  key: string;
  value: string;
  configured: boolean;
  secret: boolean;
  group: 'provider' | 'voice' | 'runtime' | 'other';
  hint?: string;
}

const ENV_GROUPS: { id: EnvEntry['group']; label: string }[] = [
  { id: 'provider', label: 'Provider keys & URLs' },
  { id: 'voice', label: 'Voice pipeline' },
  { id: 'runtime', label: 'Runtime' },
  { id: 'other', label: 'Other' },
];

const CHARACTERS: { id: Settings['mascotCharacter']; label: string }[] = [
  { id: 'auto', label: 'Auto   follows the surface' },
  { id: 'aegi', label: 'Aegi   lead assistant' },
  { id: 'harness', label: 'Rig   harness' },
  { id: 'files', label: 'Filo   files' },
  { id: 'memory', label: 'Memo   memory' },
  { id: 'social', label: 'Chatty   social' },
  { id: 'mail', label: 'Posty   mail' },
  { id: 'security', label: 'Guard   security' },
];

const SHAPES: { id: Settings['mascotShape']; label: string }[] = [
  { id: 'auto', label: 'Auto   the character outline' },
  { id: 'orb', label: 'Orb' },
  { id: 'squircle', label: 'Squircle' },
  { id: 'blob', label: 'Blob' },
  { id: 'leaf', label: 'Leaf' },
  { id: 'drop', label: 'Drop' },
];

const SOUND_PACKS: { id: Settings['soundPack']; label: string; hint: string }[] = [
  { id: 'classic', label: 'Classic', hint: 'Soft mallets, dry' },
  { id: 'glassy', label: 'Glassy', hint: 'Crystal bells, airy' },
  { id: 'warm', label: 'Warm', hint: 'Mallets with a little room' },
];

const LANGUAGES: { id: Settings['voiceLanguage']; label: string }[] = [
  { id: 'auto', label: 'Auto detect' },
  { id: 'en', label: 'English' },
  { id: 'hi', label: '  (Hindi)' },
  { id: 'hinglish', label: 'Hinglish' },
];

export function SettingsForm({
  state,
  mutate,
  onSaved,
}: {
  state: State;
  workspace: WorkspaceState;
  mutate: (path: string, method: string, body?: unknown) => Promise<boolean>;
  onSaved?: () => void;
}) {
  const settings = state.settings;
  const [research, setResearch] = useState(settings.researchAllowed);
  const [memory, setMemory] = useState(settings.memoryAllowed);
  const [apps, setApps] = useState(settings.appsAllowed);
  const [developerOptions, setDeveloperOptions] = useState(
    settings.developerOptionsEnabled,
  );
  const [wslEnabled, setWslEnabled] = useState(settings.wslEnabled);
  const [sounds, setSounds] = useState(settings.soundsEnabled ?? true);
  // Exactly one surface is shown outside the app window. mascotEnabled is kept
  // in sync so older readers of the setting behave correctly.
  const [desktopSurface, setDesktopSurface] = useState<'notch' | 'mascot'>(
    settings.desktopSurface ?? (settings.mascotEnabled ? 'mascot' : 'notch'),
  );
  const [mascotEnabled, setMascotEnabled] = useState(
    settings.mascotEnabled ?? true,
  );
  const [mascotCharacter, setMascotCharacter] = useState(
    settings.mascotCharacter ?? 'auto',
  );
  const [mascotSize, setMascotSize] = useState(settings.mascotSize ?? 96);
  const [mascotShape, setMascotShape] = useState<Settings['mascotShape']>(
    settings.mascotShape ?? 'auto',
  );
  const [soundPack, setSoundPack] = useState(
    settings.soundPack ?? 'warm',
  );
  const [soundVolume, setSoundVolume] = useState(
    settings.soundVolume ?? 0.5,
  );
  const [wakeWordEnabled, setWakeWordEnabled] = useState(
    settings.wakeWordEnabled ?? false,
  );
  const [voicePipelineUrl, setVoicePipelineUrl] = useState(
    settings.voicePipelineUrl ?? 'http://127.0.0.1:8766',
  );
  const [voiceLanguage, setVoiceLanguage] = useState(
    settings.voiceLanguage ?? 'auto',
  );
  const [minimizeToTray, setMinimizeToTray] = useState(true);
  const [clipboardHistoryEnabled, setClipboardHistoryEnabledState] = useState(false);
  const [externalAgentDiscoveryEnabled, setExternalAgentDiscoveryEnabledState] = useState(false);
  const [desktopPreferencesAvailable, setDesktopPreferencesAvailable] = useState(false);
  useEffect(() => {
    const bridge = window.aegis;
    if (!bridge?.getDesktopPreferences || !bridge.setMinimizeToTray) return;
    setDesktopPreferencesAvailable(true);
    void bridge.getDesktopPreferences().then((preferences) => {
      if (typeof preferences.minimizeToTray === 'boolean') {
        setMinimizeToTray(preferences.minimizeToTray);
      }
      setClipboardHistoryEnabledState(preferences.clipboardHistoryEnabled === true);
      setExternalAgentDiscoveryEnabledState(preferences.externalAgentDiscoveryEnabled === true);
    }).catch(() => setDesktopPreferencesAvailable(false));
  }, []);
  useEffect(() => {
    adoptServerSoundPreference(settings.soundsEnabled);
  }, [settings.soundsEnabled]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [theme, setTheme] = useState(themePreference);
  const chooseTheme = (next: ThemePreference) => {
    setTheme(next);
    setThemePreference(next);
  };

  // ---- providers ---------------------------------------------------------
  const [providers, setProviders] = useState<ProvidersResponse>();
  const [providerId, setProviderId] = useState('');
  const [providerModel, setProviderModel] = useState('');
  const [providerQuery, setProviderQuery] = useState('');
  const [modelOptions, setModelOptions] = useState<ProviderModelsResponse>();
  const [providerBusy, setProviderBusy] = useState(false);
  const [providerNote, setProviderNote] = useState('');

  useEffect(() => {
    let active = true;
    void getProviders()
      .then((response) => {
        if (!active) return;
        setProviders(response);
        setProviderId(
          response.active.providerId ??
            response.providers.find((provider) => provider.configured)?.id ??
            response.providers[0]?.id ??
            '',
        );
        setProviderModel(response.active.model ?? '');
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const catalogueEntries = providers?.catalogue ?? [];
  const chosenEntry = catalogueEntries.find(
    (provider) => provider.id === providerId,
  );
  const chosenProvider = providers?.providers.find(
    (provider) => provider.id === providerId,
  );

  useEffect(() => {
    if (!providers || !providerId) return;
    if (!chosenEntry && !chosenProvider) return;
    let active = true;
    setModelOptions(undefined);
    void getProviderModels(providerId)
      .then((response) => {
        if (!active) return;
        setModelOptions(response);
        setProviderModel((current) => current || response.defaultModel || '');
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [providerId, providers, chosenEntry, chosenProvider]);

  const modelChoices = useMemo(() => {
    const list =
      modelOptions?.models ??
      chosenProvider?.models ??
      (chosenEntry?.defaultModel ? [chosenEntry.defaultModel] : []);
    return [...new Set(list)].slice(0, 200);
  }, [modelOptions, chosenProvider, chosenEntry]);

  const providerRail = useMemo(() => {
    const registry: ProviderOption[] = providers?.providers ?? [];
    const registryIds = new Set(registry.map((provider) => provider.id));
    const catalogue = catalogueEntries.filter(
      (provider) => !registryIds.has(provider.id),
    );
    const needle = providerQuery.trim().toLowerCase();
    const matches = (id: string, label: string) =>
      !needle ||
      id.toLowerCase().includes(needle) ||
      label.toLowerCase().includes(needle);
    return {
      registry: registry.filter((provider) =>
        matches(provider.id, provider.label),
      ),
      catalogue: catalogue
        .filter((provider) => matches(provider.id, provider.label))
        .slice(0, 80),
    };
  }, [providers, catalogueEntries, providerQuery]);

  const activeProviderId = providers?.active.providerId;

  const useProvider = async () => {
    if (!providerId || providerBusy) return;
    setProviderBusy(true);
    setProviderNote('');
    try {
      const response = await selectProvider(
        providerId,
        providerModel || modelChoices[0] || '',
      );
      setProviders((current) => (current ? { ...current, ...response } : current));
      setProviderNote(
        `Active: ${response.active.providerId ?? providerId}   ${response.active.model ?? providerModel}`,
      );
      onSaved?.();
    } catch (failure) {
      setProviderNote(
        failure instanceof Error
          ? failure.message
          : 'Could not switch providers.',
      );
    } finally {
      setProviderBusy(false);
    }
  };

  // ---- environment -------------------------------------------------------
  const [env, setEnv] = useState<{ path: string; entries: EnvEntry[] }>();
  const [envEdits, setEnvEdits] = useState<Record<string, string>>({});
  const [envReveal, setEnvReveal] = useState<Record<string, boolean>>({});
  const [envBusy, setEnvBusy] = useState(false);
  const [envNote, setEnvNote] = useState('');
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [pipeline, setPipeline] = useState<{
    ok: boolean;
    whisperModel?: string;
    voice?: string;
    error?: string;
  }>();
  const [pipelineBusy, setPipelineBusy] = useState(false);
  const [voiceSample, setVoiceSample] = useState('');

  useEffect(() => {
    let active = true;
    void api<{ path: string; entries: EnvEntry[] }>('/env')
      .then((value) => active && setEnv(value))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const checkPipeline = async () => {
    setPipelineBusy(true);
    try {
      const info = await api<{
        ok: boolean;
        whisperModel?: string;
        voice?: string;
        error?: string;
      }>('/voice/pipeline');
      setPipeline(info);
    } catch (failure) {
      setPipeline({
        ok: false,
        error:
          failure instanceof Error ? failure.message : 'Unreachable.',
      });
    } finally {
      setPipelineBusy(false);
    }
  };

  useEffect(() => {
    void checkPipeline();
  }, []);

  const saveEnv = async () => {
    if (envBusy) return;
    const values: Record<string, string | null> = {};
    for (const [key, value] of Object.entries(envEdits)) {
      values[key] = value.trim() ? value : null;
    }
    if (newKey.trim() && newValue.trim()) {
      values[newKey.trim()] = newValue;
    }
    if (!Object.keys(values).length) {
      setEnvNote('Nothing changed.');
      return;
    }
    setEnvBusy(true);
    setEnvNote('');
    try {
      const next = await api<{ path: string; entries: EnvEntry[] }>(
        '/env',
        'PUT',
        { values },
      );
      setEnv(next);
      setEnvEdits({});
      setNewKey('');
      setNewValue('');
      setEnvNote('Saved to .env.local and applied to this process.');
      onSaved?.();
    } catch (failure) {
      setEnvNote(
        failure instanceof Error ? failure.message : 'Could not save.',
      );
    } finally {
      setEnvBusy(false);
    }
  };

  // ---- settings save -----------------------------------------------------
  const save = () => {
    if (busy) return;
    setBusy(true);
    setError('');
    setThemePreference(theme);
    void mutate('/settings', 'PATCH', {
      researchAllowed: research,
      memoryAllowed: memory,
      appsAllowed: apps,
      developerOptionsEnabled: developerOptions,
      wslEnabled,
      soundsEnabled: sounds,
      mascotEnabled,
      desktopSurface,
      mascotCharacter,
      mascotSize,
      mascotShape,
      soundPack,
      soundVolume,
      wakeWordEnabled,
      voicePipelineUrl,
      voiceLanguage,
    })
      .then((ok) => {
        if (!ok) throw new Error('The server rejected these settings.');
        setSaved(true);
        window.setTimeout(() => setSaved(false), 2000);
        onSaved?.();
      })
      .catch((failure: unknown) => {
        setError(
          failure instanceof Error
            ? failure.message
            : 'Could not save settings.',
        );
      })
      .finally(() => setBusy(false));
  };

  return (
    <form
      className="settings-form"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      {/* Provider browser ----------------------------------------------------- */}
      <fieldset className="settings-section provider-section">
        <legend>
          <PlugZap size={15} /> Providers
        </legend>
        <p className="muted">
          Pick the model provider Aegis runs on. Keys live in Environment
          below; the provider rail reads the models.dev catalogue plus the
          built-in registry.
        </p>
        <div className="provider-browser">
          <div className="provider-rail">
            <label className="search-box">
              <Search size={15} />
              <input
                aria-label="Search providers"
                placeholder="Search providers "
                value={providerQuery}
                onChange={(event) => setProviderQuery(event.target.value)}
              />
            </label>
            <div className="provider-rail-scroll">
              {providerRail.registry.length > 0 && (
                <small className="provider-rail-label">Built in</small>
              )}
              {providerRail.registry.map((provider) => (
                <button
                  type="button"
                  key={provider.id}
                  className={`provider-row ${providerId === provider.id ? 'active' : ''}`}
                  onClick={() => {
                    setProviderId(provider.id);
                    setProviderModel(
                      provider.defaultModel || provider.models[0] || '',
                    );
                  }}
                >
                  <span>
                    <strong>{provider.label}</strong>
                    <small>{provider.id}</small>
                  </span>
                  {activeProviderId === provider.id ? (
                    <span className="provider-chip on">Active</span>
                  ) : provider.configured ? (
                    <span className="provider-chip">Key</span>
                  ) : null}
                </button>
              ))}
              {providerRail.catalogue.length > 0 && (
                <small className="provider-rail-label">
                  models.dev catalogue
                </small>
              )}
              {providerRail.catalogue.map((provider) => (
                <button
                  type="button"
                  key={`catalogue-${provider.id}`}
                  className={`provider-row ${providerId === provider.id ? 'active' : ''}`}
                  onClick={() => {
                    setProviderId(provider.id);
                    setProviderModel(provider.defaultModel);
                  }}
                >
                  <span>
                    <strong>{provider.label}</strong>
                    <small>
                      {provider.id}   {provider.modelCount} models
                    </small>
                  </span>
                  {activeProviderId === provider.id ? (
                    <span className="provider-chip on">Active</span>
                  ) : provider.configured ? (
                    <span className="provider-chip">Key</span>
                  ) : null}
                </button>
              ))}
              {!providerRail.registry.length &&
                !providerRail.catalogue.length && (
                  <p className="muted">No provider matches that search.</p>
                )}
            </div>
          </div>
          <div className="provider-detail">
            {chosenProvider || chosenEntry ? (
              <>
                <header>
                  <div>
                    <h3>
                      {chosenProvider?.label ?? chosenEntry?.label ?? providerId}
                    </h3>
                    <small>
                      {(chosenProvider?.apiType ?? chosenEntry?.apiType) ??
                        'openai'}{' '}
                       {' '}
                      {chosenProvider?.baseUrl ??
                        chosenEntry?.baseUrl ??
                        'custom endpoint'}
                    </small>
                  </div>
                  {providerId === activeProviderId && (
                    <span className="provider-chip on">Active</span>
                  )}
                </header>
                <label className="field-label" htmlFor="settings-provider-model">
                  Model
                </label>
                <input
                  id="settings-provider-model"
                  list="settings-provider-models"
                  value={providerModel}
                  placeholder="Search or paste a model id"
                  onChange={(event) => setProviderModel(event.target.value)}
                />
                <datalist id="settings-provider-models">
                  {modelChoices.map((model) => (
                    <option key={model} value={model} />
                  ))}
                </datalist>
                {modelChoices.length > 0 && (
                  <div className="model-chips">
                    {modelChoices.slice(0, 8).map((model) => (
                      <button
                        type="button"
                        key={model}
                        className={providerModel === model ? 'active' : ''}
                        onClick={() => setProviderModel(model)}
                      >
                        {model.split('/').pop()}
                      </button>
                    ))}
                  </div>
                )}
                <div className="provider-meta">
                  <span>
                    {chosenProvider?.configured || chosenEntry?.configured ? (
                      <>
                        <Check size={13} /> Key configured
                      </>
                    ) : (
                      <>
                        <KeyRound size={13} /> Add{' '}
                        {chosenProvider?.keyEnv ??
                          chosenEntry?.env[0] ??
                          'an API key'}{' '}
                        in Environment
                      </>
                    )}
                  </span>
                  <span>{modelChoices.length} models</span>
                </div>
                {providerNote && (
                  <p className="settings-note" role="status">
                    {providerNote}
                  </p>
                )}
                <button
                  type="button"
                  className="primary"
                  disabled={
                    providerBusy ||
                    (!providerModel && !modelChoices[0]) ||
                    (providerId === activeProviderId &&
                      providerModel === providers?.active.model)
                  }
                  onClick={() => void useProvider()}
                >
                  {providerBusy ? (
                    <>
                      <RefreshCw size={14} className="spin" /> Switching 
                    </>
                  ) : (
                    <>
                      <Check size={14} /> Use this provider
                    </>
                  )}
                </button>
              </>
            ) : (
              <p className="muted">
                Choose a provider on the left, or add one in Environment.
              </p>
            )}
          </div>
        </div>
      </fieldset>

      {/* Environment ----------------------------------------------------- */}
      <fieldset className="settings-section env-section" id="settings-environment">
        <legend>
          <KeyRound size={15} /> Environment
        </legend>
        <p className="muted">
          Values are written to <code>{env?.path ?? '.env.local'}</code> and
          applied immediately. Secrets are shown masked.
        </p>
        {env ? (
          <div className="env-groups">
            {ENV_GROUPS.map((group) => {
              const entries = env.entries.filter(
                (entry) => entry.group === group.id,
              );
              if (!entries.length) return null;
              return (
                <details
                  className="env-group"
                  key={group.id}
                  open={group.id === 'provider' || group.id === 'voice'}
                >
                  <summary>
                    <ChevronRight size={14} /> {group.label}
                    <small>{entries.length}</small>
                  </summary>
                  <div className="env-list">
                    {entries.map((entry) => {
                      const editing = entry.key in envEdits;
                      const reveal = envReveal[entry.key];
                      return (
                        <div className="env-row" key={entry.key}>
                          <div className="env-key">
                            <strong>{entry.key}</strong>
                            <small>
                              {entry.hint ??
                                (entry.configured
                                  ? 'Configured'
                                  : 'Not set')}
                            </small>
                          </div>
                          <div className="env-value">
                            {editing ? (
                              <input
                                aria-label={`Value for ${entry.key}`}
                                type={
                                  entry.secret && !reveal ? 'password' : 'text'
                                }
                                placeholder={entry.value || 'New value'}
                                value={envEdits[entry.key]}
                                onChange={(event) =>
                                  setEnvEdits((current) => ({
                                    ...current,
                                    [entry.key]: event.target.value,
                                  }))
                                }
                              />
                            ) : (
                              <code>
                                {entry.configured
                                  ? entry.value || ' '
                                  : '  not set  '}
                              </code>
                            )}
                            {entry.secret && editing && (
                              <button
                                type="button"
                                className="icon-button"
                                aria-label={
                                  reveal ? 'Hide value' : 'Show value'
                                }
                                onClick={() =>
                                  setEnvReveal((current) => ({
                                    ...current,
                                    [entry.key]: !current[entry.key],
                                  }))
                                }
                              >
                                {reveal ? (
                                  <EyeOff size={14} />
                                ) : (
                                  <Eye size={14} />
                                )}
                              </button>
                            )}
                            <button
                              type="button"
                              className="text-button"
                              onClick={() =>
                                setEnvEdits((current) => ({
                                  ...current,
                                  [entry.key]: editing
                                    ? current[entry.key]
                                    : '',
                                }))
                              }
                            >
                              {editing ? 'Editing' : 'Edit'}
                            </button>
                            {editing && (
                              <button
                                type="button"
                                className="text-button danger"
                                onClick={() =>
                                  setEnvEdits((current) => ({
                                    ...current,
                                    [entry.key]: '',
                                  }))
                                }
                              >
                                Clear
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </details>
              );
            })}
            <div className="env-add">
              <input
                aria-label="New environment variable name"
                placeholder="NEW_VARIABLE"
                value={newKey}
                onChange={(event) => setNewKey(event.target.value)}
              />
              <input
                aria-label="New environment variable value"
                placeholder="Value"
                type="password"
                value={newValue}
                onChange={(event) => setNewValue(event.target.value)}
              />
              <button
                type="button"
                className="secondary"
                disabled={!newKey.trim() || !newValue.trim()}
                onClick={() => {
                  if (!newKey.trim() || !newValue.trim()) return;
                  setEnvEdits((current) => ({
                    ...current,
                    [newKey.trim()]: newValue,
                  }));
                  setNewKey('');
                  setNewValue('');
                }}
              >
                Add
              </button>
            </div>
            {Object.keys(envEdits).length > 0 && (
              <p className="settings-note">
                {Object.keys(envEdits).length} unsaved change
                {Object.keys(envEdits).length === 1 ? '' : 's'}.
              </p>
            )}
            {envNote && (
              <p className="settings-note" role="status">
                {envNote}
              </p>
            )}
            <button
              type="button"
              className="secondary"
              disabled={envBusy}
              onClick={() => void saveEnv()}
            >
              {envBusy ? 'Saving ' : 'Save environment'}
            </button>
          </div>
        ) : (
          <p className="muted">Loading environment </p>
        )}
      </fieldset>

      {/* Assistant ------------------------------------------------------- */}
      <fieldset className="settings-section assistant-section">
        <legend>
          <Sparkles size={15} /> Assistant
        </legend>
        <div className="assistant-grid">
          <div className="assistant-card">
            <div className="toggle-row">
              <span>
                <strong>Hide in tray when minimized</strong>
                <small>Turn this off to keep Aegis visible on the taskbar.</small>
              </span>
              <input
                type="checkbox"
                aria-label="Hide in tray when minimized"
                checked={minimizeToTray}
                disabled={!desktopPreferencesAvailable}
                onChange={(event) => {
                  const enabled = event.target.checked;
                  setMinimizeToTray(enabled);
                  void window.aegis?.setMinimizeToTray?.(enabled).then((result) => {
                    if (!result.saved) {
                      setError('Could not save the desktop minimize preference.');
                    }
                  }).catch(() => setError('Could not save the desktop minimize preference.'));
                }}
              />
            </div>
            <div className="toggle-row">
              <span>
                <strong>Detect coding apps in the Notch</strong>
                <small>Opt in to checking process names while the Live shelf is open. Aegis shows app presence only; external task details need a supported provider integration.</small>
              </span>
              <input
                type="checkbox"
                aria-label="Enable coding app detection"
                checked={externalAgentDiscoveryEnabled}
                disabled={!desktopPreferencesAvailable || !window.aegis?.setExternalAgentDiscovery}
                onChange={(event) => {
                  const enabled = event.target.checked;
                  setExternalAgentDiscoveryEnabledState(enabled);
                  void window.aegis?.setExternalAgentDiscovery?.(enabled).then((result) => {
                    if (!result.saved) setError('Could not save the coding app detection preference.');
                  }).catch(() => setError('Could not save the coding app detection preference.'));
                }}
              />
            </div>
            <div className="toggle-row">
              <span>
                <strong>Local clipboard history</strong>
                <small>Off by default. When enabled, keeps up to 30 text clips on this PC; obvious secrets and payment numbers are skipped.</small>
              </span>
              <input
                type="checkbox"
                aria-label="Enable local clipboard history"
                checked={clipboardHistoryEnabled}
                disabled={!desktopPreferencesAvailable || !window.aegis?.setClipboardHistoryEnabled}
                onChange={(event) => {
                  const enabled = event.target.checked;
                  setClipboardHistoryEnabledState(enabled);
                  void window.aegis?.setClipboardHistoryEnabled?.(enabled).then((result) => {
                    if (!result.saved) setError('Could not save the clipboard history preference.');
                  }).catch(() => setError('Could not save the clipboard history preference.'));
                }}
              />
            </div>
            {!desktopPreferencesAvailable && (
              <p className="settings-note">This desktop setting is available when Aegis is running in its desktop app.</p>
            )}
          </div>
          <div className="assistant-card">
            <div className="field-label">Outside the app</div>
            <div className="surface-choice" role="radiogroup" aria-label="Surface outside the app">
              <label className={`surface-option${desktopSurface === 'notch' ? ' active' : ''}`}>
                <input
                  type="radio"
                  name="desktop-surface"
                  value="notch"
                  checked={desktopSurface === 'notch'}
                  onChange={() => {
                    setDesktopSurface('notch');
                    setMascotEnabled(false);
                  }}
                />
                <span>
                  <strong>Notch</strong>
                  <small>Compact island at the top of the screen. Widgets live here.</small>
                </span>
              </label>
              <label className={`surface-option${desktopSurface === 'mascot' ? ' active' : ''}`}>
                <input
                  type="radio"
                  name="desktop-surface"
                  value="mascot"
                  checked={desktopSurface === 'mascot'}
                  onChange={() => {
                    setDesktopSurface('mascot');
                    setMascotEnabled(true);
                  }}
                />
                <span>
                  <strong>Mascot</strong>
                  <small>Floating character you can drag; click it to talk.</small>
                </span>
              </label>
            </div>
            <label className="field-label" htmlFor="settings-mascot-character">
              Character
            </label>
            <select
              id="settings-mascot-character"
              value={mascotCharacter}
              onChange={(event) =>
                setMascotCharacter(
                  event.target.value as Settings['mascotCharacter'],
                )
              }
            >
              {CHARACTERS.map((character) => (
                <option key={character.id} value={character.id}>
                  {character.label}
                </option>
              ))}
            </select>
            <label className="field-label" htmlFor="settings-mascot-shape">
              Body shape
            </label>
            <select
              id="settings-mascot-shape"
              value={mascotShape}
              onChange={(event) =>
                setMascotShape(event.target.value as Settings['mascotShape'])
              }
            >
              {SHAPES.map((shape) => (
                <option key={shape.id} value={shape.id}>
                  {shape.label}
                </option>
              ))}
            </select>
            <label className="field-label" htmlFor="settings-mascot-size">
              Size   {mascotSize}px
            </label>
            <input
              id="settings-mascot-size"
              type="range"
              min={64}
              max={160}
              step={4}
              value={mascotSize}
              onChange={(event) => setMascotSize(Number(event.target.value))}
            />
          </div>

          <div className="assistant-card">
            <div className="toggle-row">
              <span>
                <strong>Interface sounds</strong>
                <small>Sent, alerts, listening and speaking cues.</small>
              </span>
              <input
                type="checkbox"
                aria-label="Interface sounds"
                checked={sounds}
                onChange={(event) => {
                  setSounds(event.target.checked);
                  setSoundsEnabled(event.target.checked);
                }}
              />
            </div>
            <label className="field-label" htmlFor="settings-sound-pack">
              Sound pack
            </label>
            <select
              id="settings-sound-pack"
              value={soundPack}
              onChange={(event) =>
                setSoundPack(event.target.value as Settings['soundPack'])
              }
            >
              {SOUND_PACKS.map((pack) => (
                <option key={pack.id} value={pack.id}>
                  {pack.label}   {pack.hint}
                </option>
              ))}
            </select>
            <label className="field-label" htmlFor="settings-volume">
              <Volume2 size={13} /> Volume  {' '}
              {Math.round(soundVolume * 100)}%
            </label>
            <input
              id="settings-volume"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={soundVolume}
              onChange={(event) => setSoundVolume(Number(event.target.value))}
            />
          </div>

          <div className="assistant-card">
            <label className="toggle-row" htmlFor="settings-wake">
              <span>
                <strong> Hey Aegis  wake word</strong>
                <small>
                  Uses the system speech recogniser while Aegis is open.
                </small>
              </span>
              <input
                type="checkbox"
                id="settings-wake"
                checked={wakeWordEnabled}
                onChange={(event) => setWakeWordEnabled(event.target.checked)}
              />
            </label>
            <label className="field-label" htmlFor="settings-voice-url">
              Local pipeline
            </label>
            <input
              id="settings-voice-url"
              value={voicePipelineUrl}
              onChange={(event) => setVoicePipelineUrl(event.target.value)}
              placeholder="http://127.0.0.1:8766"
            />
            <label className="field-label" htmlFor="settings-voice-language">
              <Mic size={13} /> Spoken language
            </label>
            <select
              id="settings-voice-language"
              value={voiceLanguage}
              onChange={(event) =>
                setVoiceLanguage(
                  event.target.value as Settings['voiceLanguage'],
                )
              }
            >
              {LANGUAGES.map((language) => (
                <option key={language.id} value={language.id}>
                  {language.label}
                </option>
              ))}
            </select>
            <div className="voice-health">
              <span
                className={`online-dot ${pipeline?.ok ? '' : 'off'}`}
                aria-hidden="true"
              />
              <span>
                {pipelineBusy
                  ? 'Checking pipeline '
                  : pipeline?.ok
                    ? `${pipeline.whisperModel ?? 'local STT'}   ${pipeline.voice ?? 'Piper'}`
                    : pipeline?.error ?? 'Pipeline not checked yet.'}
              </span>
              <button
                type="button"
                className="text-button"
                disabled={pipelineBusy}
                onClick={() => void checkPipeline()}
              >
                <RefreshCw size={13} /> Check
              </button>
              <button
                type="button"
                className="text-button"
                onClick={async () => {
                  stopReadAloud();
                  setVoiceSample('speaking');
                  const sample =
                    voiceLanguage === 'en'
                      ? "Hello, I'm Aegis. How can I help you today?"
                      : voiceLanguage === 'hi'
                        ? ' ,            ?'
                        : ' ,            ? Hello, how can I help you today?';
                  try {
                    await readAloud(sample, voiceLanguage);
                  } finally {
                    setVoiceSample('');
                  }
                }}
              >
                <Waves size={13} />
                {voiceSample ? 'Speaking ' : 'Test voice'}
              </button>
            </div>
          </div>

          <div className="assistant-card">
            <label className="field-label" htmlFor="settings-windows-voice">
              <Keyboard size={13} /> Windows Voice Bridge
            </label>
            <p className="field-hint">
              Command-only voice access through the Windows speech engine
              (the engine behind Voice Access). Only Aegis listens to it.
            </p>
            <WindowsVoicePanel />
          </div>

          <div className="assistant-card">
            <label className="field-label" htmlFor="settings-oauth">
              <KeyRound size={13} /> OAuth providers
            </label>
            <OAuthSettingsCard />
          </div>
        </div>
      </fieldset>

      {/* Permissions ----------------------------------------------------- */}
      <fieldset className="settings-section access-fields">
        <legend>Permissions</legend>
        <label className="field-label" htmlFor="settings-research">
          <input
            type="checkbox"
            id="settings-research"
            checked={research}
            onChange={(event) => setResearch(event.target.checked)}
          />
          Allow research tools
        </label>
        <label className="field-label" htmlFor="settings-memory">
          <input
            type="checkbox"
            id="settings-memory"
            checked={memory}
            onChange={(event) => setMemory(event.target.checked)}
          />
          Allow memory tools
        </label>
        <label className="field-label" htmlFor="settings-apps">
          <input
            type="checkbox"
            id="settings-apps"
            checked={apps}
            onChange={(event) => setApps(event.target.checked)}
          />
          Allow apps tools
        </label>
      </fieldset>

      <fieldset className="settings-section access-fields">
        <legend>Runtime</legend>
        <label className="field-label" htmlFor="settings-developer-options">
          <input
            type="checkbox"
            id="settings-developer-options"
            checked={developerOptions}
            onChange={(event) => setDeveloperOptions(event.target.checked)}
          />
          Developer options (unlock reload, DevTools and print shortcuts)
        </label>
        <label className="field-label" htmlFor="settings-wsl">
          <input
            type="checkbox"
            id="settings-wsl"
            checked={wslEnabled}
            onChange={(event) => setWslEnabled(event.target.checked)}
          />
          Run under Windows Subsystem for Linux
        </label>
      </fieldset>

      <fieldset className="settings-section appearance-fields">
        <legend>Appearance</legend>
        <div className="segmented" role="radiogroup">
          {(['system', 'light', 'dark'] as ThemePreference[]).map((option) => (
            <label key={option}>
              <input
                type="radio"
                name="theme"
                value={option}
                checked={theme === option}
                onChange={(event) =>
                  chooseTheme(event.target.value as ThemePreference)
                }
              />
              <span>{option}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {error && (
        <p className="settings-error" role="alert">
          {error}
        </p>
      )}

      <div className="settings-actions">
        <button className="primary" disabled={busy} type="submit">
          {busy ? 'Saving ' : saved ? 'Saved' : 'Save settings'}
        </button>
        <button
          className="secondary"
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent('aegis:nav', { detail: 'chat' }))}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
