// Aegis model catalogue: the provider list comes from
// models.dev   not from a hard-coded
// table. A trimmed snapshot is vendored in models-dev.json (generated from
// https://models.dev/api.json; see tests/build-models-snapshot.mjs); at
// runtime the server tries a live fetch with a short timeout and falls
// back to the snapshot, caching the result in memory.
//
// The six registry providers in providers.ts are the favourites: they are
// pinned first in every view, and their hard-coded endpoints/key env names
// win over the catalogue entry of the same id. Key values are never
// exposed   only configured flags and env var NAMES.

import snapshotData from './models-dev.json' with { type: 'json' };
import {
  PROVIDERS,
  listProviders,
  type ExternalProviderDefinition,
  type ProviderApiType,
} from './providers.js';

export interface CatalogueModel {
  id: string;
  name: string;
  reasoning?: boolean;
  tool_call?: boolean;
  context?: number;
  output?: number;
}

export interface CatalogueProvider {
  id: string;
  name: string;
  /** API root URL from models.dev, when the entry carries one. */
  api?: string;
  apiType: ProviderApiType;
  npm?: string;
  /** Env var names that can hold this provider's key (names only). */
  env: string[];
  doc?: string;
  models: CatalogueModel[];
}

export interface Catalogue {
  providers: CatalogueProvider[];
  byId: Map<string, CatalogueProvider>;
  source: 'live' | 'snapshot';
  fetchedAt: number;
}

interface RawCatalogueModel {
  id?: unknown;
  name?: unknown;
  reasoning?: unknown;
  tool_call?: unknown;
  limit?: { context?: unknown; output?: unknown };
}

interface RawCatalogueProvider {
  id: string;
  name: string;
  api?: string;
  npm?: string;
  env?: string[];
  doc?: string;
  /** Snapshot shape: trimmed array. Live models.dev shape: object by id. */
  models?: CatalogueModel[] | Record<string, RawCatalogueModel>;
}

function parseModels(raw: RawCatalogueProvider['models']): CatalogueModel[] {
  if (!raw) return [];
  const entries: RawCatalogueModel[] = Array.isArray(raw)
    ? raw
    : Object.values(raw);
  const models: CatalogueModel[] = [];
  for (const model of entries) {
    if (!model || typeof model.id !== 'string' || !model.id) continue;
    models.push({
      id: model.id,
      name: typeof model.name === 'string' ? model.name : model.id,
      ...(model.reasoning ? { reasoning: true } : {}),
      ...(model.tool_call ? { tool_call: true } : {}),
      ...(typeof model.limit?.context === 'number'
        ? { context: model.limit.context }
        : {}),
      ...(typeof model.limit?.output === 'number'
        ? { output: model.limit.output }
        : {}),
    });
  }
  return models;
}

/**
 * models.dev expresses the wire protocol through the AI-SDK package
 * (`npm`). Map it to the two protocols the local runtime can speak;
 * anything else is catalogued but not runnable from the chat path.
 */
export function apiTypeForNpm(npm: string | undefined): ProviderApiType {
  if (!npm) return 'other';
  if (npm.includes('anthropic')) return 'anthropic';
  if (
    npm === '@ai-sdk/openai-compatible' ||
    npm === '@ai-sdk/openai' ||
    npm === '@openrouter/ai-sdk-provider' ||
    npm === '@ai-sdk/groq' ||
    npm === '@ai-sdk/cerebras' ||
    npm === '@ai-sdk/deepinfra' ||
    npm === '@ai-sdk/togetherai' ||
    npm === '@ai-sdk/perplexity' ||
    npm === '@ai-sdk/xai' ||
    npm === '@ai-sdk/gateway' ||
    npm.includes('openai-compatible')
  )
    return 'openai';
  return 'other';
}

/** Well-known API roots for catalogue entries that omit `api`. */
const KNOWN_APIS: Record<string, string> = {
  anthropic: 'https://api.anthropic.com/v1',
  openai: 'https://api.openai.com/v1',
  groq: 'https://api.groq.com/openai/v1',
  vercel: 'https://ai-gateway.vercel.sh/v1',
  mistral: 'https://api.mistral.ai/v1',
};

export function parseCatalogue(raw: unknown): CatalogueProvider[] {
  if (!raw || typeof raw !== 'object') return [];
  const providers: CatalogueProvider[] = [];
  for (const entry of Object.values(
    raw as Record<string, RawCatalogueProvider>,
  )) {
    if (!entry || typeof entry.id !== 'string' || !entry.id) continue;
    providers.push({
      id: entry.id,
      name: entry.name || entry.id,
      api: entry.api,
      apiType: apiTypeForNpm(entry.npm),
      npm: entry.npm,
      env: Array.isArray(entry.env) ? entry.env : [],
      doc: entry.doc,
      models: parseModels(entry.models),
    });
  }
  providers.sort((a, b) => a.id.localeCompare(b.id));
  return providers;
}

const snapshot = parseCatalogue(snapshotData);
let snapshotCatalogue: Catalogue | null = null;

let cache: Catalogue | null = null;
const CACHE_TTL_MS = 10 * 60_000;
const LIVE_FETCH_TIMEOUT_MS = 3_500;
const MODELS_DEV_URL = 'https://models.dev/api.json';

function toCatalogue(
  providers: CatalogueProvider[],
  source: 'live' | 'snapshot',
): Catalogue {
  return {
    providers,
    byId: new Map(providers.map((provider) => [provider.id, provider])),
    source,
    fetchedAt: Date.now(),
  };
}

/** The catalogue as currently known (snapshot until a live fetch lands). */
export function currentCatalogue(): Catalogue {
  if (cache) return cache;
  snapshotCatalogue ??= toCatalogue(snapshot, 'snapshot');
  return snapshotCatalogue;
}

/**
 * The catalogue, refreshed from models.dev when the cache is stale. A
 * failed or slow live fetch falls back to the vendored snapshot   this
 * never throws.
 */
export async function getCatalogue(force = false): Promise<Catalogue> {
  if (!force && cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS)
    return cache;
  try {
    const response = await fetch(MODELS_DEV_URL, {
      signal: AbortSignal.timeout(LIVE_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`models.dev HTTP ${response.status}`);
    const providers = parseCatalogue(await response.json());
    if (!providers.length) throw new Error('models.dev catalogue is empty');
    cache = toCatalogue(providers, 'live');
    return cache;
  } catch {
    // Fall back to the snapshot (or the last good live copy) and leave the
    // cache stale so the next call retries the live fetch.
    return currentCatalogue();
  }
}

/**
 * Resolve a catalogue entry into a runnable provider definition, or
 * undefined when the entry cannot run locally (no API root, no key env
 * name, no models, or a wire protocol the runtime does not speak).
 * Registry favourites are NOT resolved here   providers.ts owns them.
 */
export function findCatalogueProvider(
  id: string,
): ExternalProviderDefinition | undefined {
  if (PROVIDERS[id]) return undefined;
  const provider = currentCatalogue().byId.get(id);
  if (!provider) return undefined;
  if (provider.apiType !== 'openai' && provider.apiType !== 'anthropic')
    return undefined;
  const baseUrl = provider.api ?? KNOWN_APIS[provider.id];
  const keyEnv = provider.env[0];
  const defaultModel = provider.models[0]?.id;
  if (!baseUrl || !keyEnv || !defaultModel) return undefined;
  return {
    id: provider.id,
    label: provider.name,
    baseUrl,
    keyEnv,
    apiType: provider.apiType,
    defaultModel,
    models: provider.models.map((model) => model.id),
  };
}

export interface CatalogueViewEntry {
  id: string;
  label: string;
  baseUrl: string;
  apiType: ProviderApiType;
  /** Env var names that can configure this provider (names only). */
  env: string[];
  configured: boolean;
  favourite: boolean;
  modelCount: number;
  defaultModel: string;
  /** False when the catalogue entry cannot run on the local chat path. */
  runnable: boolean;
}

/**
 * The merged Settings view: the six favourites pinned first (registry
 * endpoints win), then every catalogue provider. Configured flags come
 * from the supplied env   values are never included.
 */
export function catalogueView(
  env: Record<string, string | undefined>,
  catalogue: Catalogue = currentCatalogue(),
): CatalogueViewEntry[] {
  const favourites = listProviders(env).map((provider) => ({
    id: provider.id,
    label: provider.label,
    baseUrl: provider.baseUrl,
    apiType: provider.apiType,
    env: [provider.keyEnv],
    configured: provider.configured,
    favourite: true,
    modelCount:
      catalogue.byId.get(provider.id)?.models.length ?? provider.models.length,
    defaultModel: provider.defaultModel,
    runnable: true,
  }));
  const favouriteIds = new Set(favourites.map((provider) => provider.id));
  const rest = catalogue.providers
    .filter((provider) => !favouriteIds.has(provider.id))
    .map((provider) => {
      const runnable = !!findCatalogueProvider(provider.id);
      return {
        id: provider.id,
        label: provider.name,
        baseUrl: provider.api ?? KNOWN_APIS[provider.id] ?? '',
        apiType: provider.apiType,
        env: provider.env,
        configured: provider.env.some((name) => !!env[name]?.trim()),
        favourite: false,
        modelCount: provider.models.length,
        defaultModel: provider.models[0]?.id ?? '',
        runnable,
      };
    });
  return [...favourites, ...rest];
}

/**
 * Fetch a provider's own live model list. OpenAI-style providers serve
 * `GET {api}/models` with a Bearer key; Anthropic-style providers serve
 * the same path on the Messages API root with `x-api-key` +
 * `anthropic-version` headers. Throws on any failure so the caller can
 * fall back to the catalogue list and label the source honestly.
 */
export async function fetchLiveModels(
  provider: { apiType: ProviderApiType; baseUrl: string; keyEnv: string },
  env: Record<string, string | undefined>,
): Promise<string[]> {
  const apiKey = env[provider.keyEnv]?.trim();
  if (!apiKey) throw new Error('Provider is not configured.');
  const url = `${provider.baseUrl.replace(/\/$/, '')}/models`;
  const headers: Record<string, string> =
    provider.apiType === 'anthropic'
      ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
      : { Authorization: `Bearer ${apiKey}` };
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok)
    throw new Error(`Model list request failed (HTTP ${response.status}).`);
  const body = (await response.json().catch(() => null)) as {
    data?: Array<{ id?: unknown }>;
  } | null;
  const models = (body?.data ?? [])
    .map((model) => model?.id)
    .filter((id): id is string => typeof id === 'string' && !!id);
  if (!models.length) throw new Error('Provider returned no models.');
  return models;
}
