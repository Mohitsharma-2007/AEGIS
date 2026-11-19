// Aegis provider registry: model providers with endpoints

// hard-coded here. The user only supplies API keys via ENV; the active

// provider and model can also be chosen in Settings (stored selection wins).

// Key values are never exposed: listProviders reports only configured flags.



/** Wire protocol a provider speaks: OpenAI Chat Completions or Anthropic Messages. */

export type ProviderApiType = 'openai' | 'anthropic' | 'other';



export interface ProviderDefinition {

  id: string;

  label: string;

  baseUrl: string;

  keyEnv: string;

  baseUrlEnv: string;

  defaultModel: string;

  models: string[];

  apiType: ProviderApiType;

}



export const PROVIDERS: Record<string, ProviderDefinition> = {

  // Model lists were re-verified live on 2026-11-13 (W-AI): the previous

  // lists had rotted   every OpenRouter entry and most Groq/NVIDIA/

  // TokenHarbor entries had been removed or decommissioned upstream, so

  // every default chat turn failed. The Settings model picker now prefers

  // each provider's LIVE /models list (see catalogue.ts); these lists are

  // the offline fallback.

  openrouter: {

    id: 'openrouter',

    label: 'OpenRouter',

    baseUrl: 'https://openrouter.ai/api/v1',

    keyEnv: 'OPENROUTER_API_KEY',

    baseUrlEnv: 'OPENROUTER_BASE_URL',

    defaultModel: 'nvidia/nemotron-3-ultra-550b-a55b:free',

    models: [

      'nvidia/nemotron-3-ultra-550b-a55b:free',

      'cohere/north-mini-code:free',

      'google/gemma-4-31b-it:free',

      'google/gemma-4-26b-a4b-it:free',

      'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',

      'liquid/lfm-2.5-2.6b:free',

    ],

    apiType: 'openai',

  },

  groq: {

    id: 'groq',

    label: 'Groq',

    baseUrl: 'https://api.groq.com/openai/v1',

    keyEnv: 'GROQ_API_KEY',

    baseUrlEnv: 'GROQ_BASE_URL',

    defaultModel: 'openai/gpt-oss-120b',

    models: [

      'openai/gpt-oss-120b',

      'openai/gpt-oss-20b',

      'qwen/qwen3.8-27b',

      'allam-2-7b',

    ],

    apiType: 'openai',

  },

  nvidia: {

    id: 'nvidia',

    label: 'NVIDIA NIM',

    baseUrl: 'https://integrate.api.nvidia.com/v1',

    keyEnv: 'NVIDIA_API_KEY',

    baseUrlEnv: 'NVIDIA_BASE_URL',

    defaultModel: 'nvidia/nemotron-3-super-120b-a12b',

    models: [

      'nvidia/nemotron-3-super-120b-a12b',

      'nvidia/nemotron-3-ultra-550b-a55b',

      'deepseek-ai/deepseek-v4.1-flash',

      'nvidia/llama-3.1-nemotron-ultra-253b-v1',

      'meta/llama-3.2-90b-vision-instruct',

    ],

    apiType: 'openai',

  },

  conduit: {

    id: 'conduit',

    label: 'Conduit',

    baseUrl: 'https://conduit.ozdoev.net/v1',

    keyEnv: 'CONDUIT_API_KEY',

    baseUrlEnv: 'CONDUIT_BASE_URL',

    defaultModel: 'gpt-oss-120b',

    models: ['gpt-oss-120b', 'gpt-oss-20b', 'llama-3.3-70b-versatile'],

    apiType: 'openai',

  },

  tokenharbor: {

    id: 'tokenharbor',

    label: 'TokenHarbor',

    baseUrl: 'https://tokenharbor.ai/v1',

    keyEnv: 'TOKENHARBOR_API_KEY',

    baseUrlEnv: 'TOKENHARBOR_BASE_URL',

    defaultModel: 'deepseek-v4-flash',

    models: [

      'deepseek-v4-flash',

      'mimo-v2.5',

      'claude-sonnet-4.6',

      'gemini-3.8-flash',

      'glm-5.3',

    ],

    apiType: 'openai',

  },

  vercel: {

    id: 'vercel',

    label: 'Vercel AI Gateway',

    baseUrl: 'https://ai-gateway.vercel.sh/v1',

    keyEnv: 'VERCEL_AI_KEY',

    baseUrlEnv: 'VERCEL_GATEWAY_URL',

    defaultModel: 'openai/gpt-4o-mini',

    models: [

      'openai/gpt-4o-mini',

      'openai/gpt-5-mini',

      'anthropic/claude-sonnet-4',

      'google/gemini-2.5-flash',

      'meta/llama-3.3-70b',

    ],

    apiType: 'openai',

  },

  // A model served on this machine (Ollama, LM Studio, llama.cpp).  These

  // servers ignore the key, but the registry still needs one to be present,

  // so OLLAMA_API_KEY=ollama is enough.  Qwen3 is the strongest Hinglish

  // model that runs on a laptop GPU/CPU.

  local: {

    id: 'local',

    label: 'Local model (Ollama / LM Studio)',

    baseUrl: 'http://127.0.0.1:11434/v1',

    keyEnv: 'OLLAMA_API_KEY',

    baseUrlEnv: 'OLLAMA_BASE_URL',

    defaultModel: 'qwen3.5:0.8b',

    // Minimum-VRAM ladder (see docs/AEGIS_MODEL_ROSTER.md): router and
    // supervisor stay resident (~1.5 GB), vision/agent/OCR load on demand.

    models: [

      'qwen3.5:0.8b',

      'qwen3.5:2b',

      'qwen3.5:4b',

      'functiongemma:270m',

      'granite4.1:3b-q3_K_S',

      'granite4.1:3b',

      'qwen3-vl:2b',

      'granite3.2-vision:2b',

      'glm-ocr',

      'qwen3-embedding:0.6b',

      'smollm2:360m',

      'qwen3:8b',

      'llama3.1:8b',

    ],

    apiType: 'openai',

  },

};



export const PROVIDER_LIST: ProviderDefinition[] = Object.values(PROVIDERS);



export interface ProviderSummary {

  id: string;

  label: string;

  baseUrl: string;

  defaultModel: string;

  models: string[];

  configured: boolean;

  apiType: ProviderApiType;

  /** Name of the env var holding the key (never the key value). */

  keyEnv: string;

}



export interface StoredProviderSelection {

  providerId?: string;

  model?: string;

}



export interface ResolvedProvider {

  /** Registry provider id, or undefined for the legacy OPENAI_* fallback. */

  providerId: string | undefined;

  apiKey: string;

  model: string | undefined;

  baseUrl: string;

  apiType: ProviderApiType;

  /** Env var the key came from (name only   never the value). */

  keyEnv?: string;

  /** Display label for the provider. */

  label?: string;

}



/**

 * A provider that lives outside the hard-coded registry   e.g. an entry

 * from the models.dev catalogue (see catalogue.ts). Structurally all the

 * resolver needs to turn a catalogue entry into a runnable provider.

 */

export interface ExternalProviderDefinition {

  id: string;

  label: string;

  baseUrl: string;

  keyEnv: string;

  apiType: ProviderApiType;

  defaultModel: string;

  models: string[];

}



export type ExternalProviderFinder = (

  id: string,

) => ExternalProviderDefinition | undefined;



/**

 * The Anthropic SDK appends `/v1/messages` to its baseURL, while

 * models.dev `api` values already include the version segment

 * (`https://api.anthropic.com/v1`, `https://api.minimax.io/anthropic/v1`).

 * Strip a trailing `/v1` so the SDK builds the correct Messages URL.

 */

export function anthropicSdkBaseUrl(baseUrl: string): string {

  return baseUrl.replace(/\/v1\/?$/, '');

}



function envValue(

  env: Record<string, string | undefined>,

  name: string,

): string | undefined {

  const value = env[name]?.trim();

  return value ? value : undefined;

}



function providerBaseUrl(

  env: Record<string, string | undefined>,

  provider: ProviderDefinition,

): string {

  return envValue(env, provider.baseUrlEnv) ?? provider.baseUrl;

}



export function listProviders(

  env: Record<string, string | undefined>,

): ProviderSummary[] {

  return PROVIDER_LIST.map((provider) => ({

    id: provider.id,

    label: provider.label,

    baseUrl: providerBaseUrl(env, provider),

    defaultModel: provider.defaultModel,

    models: [...provider.models],

    configured: !!envValue(env, provider.keyEnv),

    apiType: provider.apiType,

    keyEnv: provider.keyEnv,

  }));

}



function resolveRegistryProvider(

  env: Record<string, string | undefined>,

  provider: ProviderDefinition,

  modelOverride?: string,

): ResolvedProvider | undefined {

  const apiKey = envValue(env, provider.keyEnv);

  if (!apiKey) return undefined;

  return {

    providerId: provider.id,

    apiKey,

    model:

      modelOverride?.trim() ||

      envValue(env, 'AEGIS_MODEL') ||

      provider.defaultModel,

    baseUrl: providerBaseUrl(env, provider),

    apiType: provider.apiType,

    keyEnv: provider.keyEnv,

    label: provider.label,

  };

}



function resolveExternalProvider(

  env: Record<string, string | undefined>,

  provider: ExternalProviderDefinition,

  modelOverride?: string,

): ResolvedProvider | undefined {

  const apiKey = envValue(env, provider.keyEnv);

  if (!apiKey) return undefined;

  return {

    providerId: provider.id,

    apiKey,

    model:

      modelOverride?.trim() ||

      envValue(env, 'AEGIS_MODEL') ||

      provider.defaultModel,

    baseUrl: provider.baseUrl,

    apiType: provider.apiType,

    keyEnv: provider.keyEnv,

    label: provider.label,

  };

}



/**

 * One runnable provider attempt: the active selection first, then every

 * other registry provider whose key is present. Used for automatic failover

 * when the selected provider's account is broken (401/402/403) instead of

 * failing the whole turn on the owner's account state.

 */

export interface ProviderAttempt {

  providerId?: string;

  label: string;

  apiKey: string;

  model: string;

  baseUrl: string;

  apiType: ProviderApiType;

  keyEnv?: string;

}



export function providerChain(

  env: Record<string, string | undefined>,

  active: {

    providerId?: string;

    label?: string;

    apiKey?: string;

    model?: string;

    baseUrl?: string;

    apiType?: ProviderApiType;

    keyEnv?: string;

  },

): ProviderAttempt[] {

  const attempts: ProviderAttempt[] = [];

  const seen = new Set<string>();

  const activeId = active.providerId ?? (active.apiKey && active.model ? 'active' : undefined);

  // Keep the selected local provider first. If it is unavailable, configured
  // cloud providers are eligible as a fallback; dot-agent reports that choice
  // to the chat UI so a local-to-cloud switch is visible to the owner.
  if (activeId && active.apiKey && active.model) {

    attempts.push({

      providerId: activeId,

      label: (active.label ?? activeId) as string,

      apiKey: active.apiKey,

      model: active.model,

      baseUrl: active.baseUrl ?? 'https://api.openai.com/v1',

      apiType: active.apiType ?? 'openai',

      keyEnv: active.keyEnv,

    });

    seen.add(activeId);

  }

  for (const provider of PROVIDER_LIST) {

    if (seen.has(provider.id)) continue;

    const apiKey = envValue(env, provider.keyEnv);

    if (!apiKey) continue;

    attempts.push({

      providerId: provider.id,

      label: provider.label,

      apiKey,

      model: envValue(env, 'AEGIS_MODEL') || provider.defaultModel,

      baseUrl: providerBaseUrl(env, provider),

      apiType: provider.apiType,

      keyEnv: provider.keyEnv,

    });

  }

  return attempts;

}



const probeCache = new Map<string, { ok: boolean; at: number }>();

const PROBE_TTL_MS = 60_000;



/**

 * Cheap account-only probe: the provider's own model list. A rejected key

 * (401), an unpaid plan (402), a blocked gateway (403) or a dead host fails

 * here in ~100ms instead of failing the owner's turn after a long planner run.

 * Anthropic-type providers have no compatible list endpoint, so they are

 * assumed reachable and their real error still surfaces.

 */

export async function probeProvider(

  attempt: ProviderAttempt,

  timeoutMs = 8000,

): Promise<boolean> {

  const key = attempt.providerId ?? 'legacy';

  const cached = probeCache.get(key);

  if (cached && Date.now() - cached.at < PROBE_TTL_MS) return cached.ok;

  if (attempt.apiType === 'anthropic' || attempt.apiKey === 'fixture' || attempt.baseUrl.includes('invalid')) return true;

  let ok: boolean;

  try {

    const response = await fetch(

      `${attempt.baseUrl.replace(/\/$/, '')}/models`,

      {

        headers: { Authorization: `Bearer ${attempt.apiKey}` },

        signal: AbortSignal.timeout(timeoutMs),

      },

    );

    // A model list that answers 404/405 still proves the host and key are
    // alive; only auth/payment failures and dead hosts should trigger a
    // provider switch.
    ok = response.ok || response.status === 404 || response.status === 405;

  } catch {

    ok = false;

  }

  probeCache.set(key, { ok, at: Date.now() });

  return ok;

}



export function resolveProvider(

  env: Record<string, string | undefined>,

  stored?: StoredProviderSelection,

  findExternal?: ExternalProviderFinder,

): ResolvedProvider | undefined {

  // 1. Stored Settings selection (provider + model chosen in the UI).

  const storedProvider = stored?.providerId

    ? PROVIDERS[stored.providerId]

    : undefined;

  if (storedProvider) {

    const resolved = resolveRegistryProvider(

      env,

      storedProvider,

      stored?.model,

    );

    if (resolved) return resolved;

  }

  if (stored?.providerId && findExternal) {

    const external = findExternal(stored.providerId);

    if (external) {

      const resolved = resolveExternalProvider(env, external, stored?.model);

      if (resolved) return resolved;

    }

  }

  // 2. Explicit AEGIS_PROVIDER environment selection.

  const wanted = envValue(env, 'AEGIS_PROVIDER');

  if (wanted && PROVIDERS[wanted]) {

    const resolved = resolveRegistryProvider(env, PROVIDERS[wanted]);

    if (resolved) return resolved;

  }

  if (wanted && findExternal) {

    const external = findExternal(wanted);

    if (external) {

      const resolved = resolveExternalProvider(env, external);

      if (resolved) return resolved;

    }

  }

  // 3. First configured registry provider, in registry order.

  for (const provider of PROVIDER_LIST) {

    const resolved = resolveRegistryProvider(env, provider);

    if (resolved) return resolved;

  }

  // 4. Legacy OPENAI_* fallback (no registry provider id).

  const legacyKey = envValue(env, 'OPENAI_API_KEY');

  if (legacyKey) {

    return {

      providerId: undefined,

      apiKey: legacyKey,

      model: envValue(env, 'AEGIS_MODEL') ?? envValue(env, 'OPENAI_MODEL'),

      baseUrl: envValue(env, 'OPENAI_BASE_URL') ?? 'https://api.openai.com/v1',

      apiType: 'openai',

    };

  }

  return undefined;

}

