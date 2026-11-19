import type { WebConfig } from './parallel.js';
import type { SetupStatus } from '../shared/types.js';
import { PROVIDERS, listProviders } from './providers.js';

// `copilotkit project select` writes the CLI name and deletes the template name.
const INTELLIGENCE_API_KEY_ENV_NAMES = [
  'CPK_INTELLIGENCE_API_KEY',
  'INTELLIGENCE_API_KEY',
] as const;
export const INTELLIGENCE_KEY_MISSING_LABEL = `${INTELLIGENCE_API_KEY_ENV_NAMES[1]} (or ${INTELLIGENCE_API_KEY_ENV_NAMES[0]})`;
export const DEFAULT_AGENT_RUN_TIMEOUT_MS = 180_000;
const MAX_TIMER_DELAY_MS = 2_147_483_647;

export function intelligenceApiKeyFromEnv(
  env: Record<string, string | undefined>,
): string | undefined {
  return firstNonEmptyEnvValue(env, INTELLIGENCE_API_KEY_ENV_NAMES);
}

export function intelligenceWsUrlFromEnv(
  env: Record<string, string | undefined>,
): string | undefined {
  return firstNonEmptyEnvValue(env, [
    'INTELLIGENCE_GATEWAY_WS_URL',
    'INTELLIGENCE_WS_URL',
  ]);
}

export type ComputerMode = 'local' | 'docker';
/**
 * AEGIS_COMPUTER_MODE: 'local' (default) runs each Agent's computer as a
 * local process on the host (Playwright Chromium + a per-Agent workspace
 * directory under the app's data dir) with NO sandbox isolation; 'docker'
 * is the upstream behaviour (one supervised container per Agent, isolated).
 */
export function computerModeFromEnv(
  env: Record<string, string | undefined>,
): ComputerMode {
  const raw = env.AEGIS_COMPUTER_MODE?.trim().toLowerCase();
  if (!raw) return 'local';
  if (raw === 'local' || raw === 'docker') return raw;
  throw new Error('AEGIS_COMPUTER_MODE must be "local" or "docker".');
}

export function agentRunTimeoutMsFromEnv(
  env: Record<string, string | undefined>,
): number {
  const raw = env.AGENT_RUN_TIMEOUT_MS?.trim();
  if (!raw) return DEFAULT_AGENT_RUN_TIMEOUT_MS;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > MAX_TIMER_DELAY_MS)
    throw new Error(
      `AGENT_RUN_TIMEOUT_MS must be an integer between 1 and ${MAX_TIMER_DELAY_MS}.`,
    );
  return value;
}

function firstNonEmptyEnvValue(
  env: Record<string, string | undefined>,
  names: readonly string[],
): string | undefined {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

export interface PlatformConfig extends WebConfig {
  intelligenceKey?: string;
  intelligenceApiUrl?: string;
  intelligenceWsUrl?: string;
  /** Aegis provider id (registry favourite or models.dev catalogue entry). */
  providerId?: string;
  /** Wire protocol of the active provider (OpenAI Chat Completions / Anthropic Messages). */
  providerApiType?: 'openai' | 'anthropic' | 'other';
  /** Env var name the active provider's key comes from (name only). */
  providerKeyEnv?: string;
  /** Display label of the active provider. */
  providerLabel?: string;
  model?: string;
  apiKey?: string;
  baseUrl: string;
  agentRunTimeoutMs?: number;
  computerSupervisorUrl?: string;
  computerSupervisorToken?: string;
  computerToken?: string;
  computerNamespace?: string;
  /** Aegis computer provisioning mode; see computerModeFromEnv. */
  computerMode?: ComputerMode;
  /** Root directory for local-mode computers (per-Agent subdirectories). */
  computerLocalRoot?: string;
  /** Default browse engine request for the browser service ('auto' etc.). */
  browserEngine?: 'playwright';
  aegisComputerUrl?: string;
  browserUrl?: string;
  browserSecret?: string;
  composioApiKey?: string;
  voiceKey?: string;
  voiceModel?: string;
  voiceName: string;
  /** Base URL for an OpenAI-compatible realtime voice endpoint (local or hosted). */
  voiceBaseUrl?: string;
  /** Local STT endpoint (OpenAI-compatible /v1/audio/transcriptions). */
  sttEndpoint?: string;
  /** Local TTS endpoint (OpenAI-compatible /v1/audio/speech). */
  ttsEndpoint?: string;
  slackChannel?: string;
  slackTeam?: string;
  slackUsers: string[];
  slackDotId?: string;
  runtimeUrl: string;
  ownerToken?: string;
}
export function setupStatus(
  config: PlatformConfig,
  slack = 'not_configured',
  activationFailed = false,
): SetupStatus {
  const provider = config.providerId ? PROVIDERS[config.providerId] : undefined;
  // Any configured Aegis provider (registry favourite or catalogue entry)
  // replaces both the Intelligence account requirement (threads run
  // locally) and the legacy OPENAI_* variables.
  const hasProvider = !!config.providerId;
  const missing = (
    hasProvider
      ? [
          !config.apiKey &&
            (provider?.keyEnv ?? config.providerKeyEnv ?? 'PROVIDER_API_KEY'),
        ]
      : [
          !config.intelligenceKey && INTELLIGENCE_KEY_MISSING_LABEL,
          !config.apiKey && 'OPENAI_API_KEY',
          !config.model && 'OPENAI_MODEL',
        ]
  ).filter((item): item is string => !!item);
  const declaredSlack = !!(
    config.slackChannel &&
    config.slackTeam &&
    config.slackUsers.length
  );
  slack = declaredSlack
    ? activationFailed && slack !== 'online'
      ? 'activation_failed'
      : slack
    : config.slackChannel || config.slackTeam || config.slackUsers.length
      ? 'setup_required'
      : 'not_configured';
  return {
    intelligence: !!config.intelligenceKey,
    model: hasProvider ? !!config.apiKey : !!(config.apiKey && config.model),
    browser: !!(config.browserUrl && config.browserSecret),
    voice:
      !!(config.voiceKey && config.voiceModel && !missing.length) ||
      !!(config.sttEndpoint && config.ttsEndpoint),
    composio: !!config.composioApiKey,
    slack,
    missing,
    activeProvider: hasProvider
      ? {
          id: config.providerId as string,
          label:
            provider?.label ??
            config.providerLabel ??
            (config.providerId as string),
        }
      : undefined,
    providers: listProviders(process.env),
  };
}
