// AEGIS glue (W4): link from the Aegis host app to the Aegis daemon
// (services/daemon, Python/FastAPI)   health, memory state, and
// the (future) MCP memory connection. New file; no upstream code lives
// here. Registration in platform.ts is the coordinator's step   the
// exact snippet is in MODIFICATIONS.md (W4 section).
//
// Daemon protocol finding (verified by reading aegis_daemon/main.py
// end to end and grepping the whole daemon tree for "mcp"):
// the daemon exposes NO MCP transport at all   neither Streamable HTTP
// nor stdio. Its memory is reachable only over its plain HTTP API:
//   GET  /health                 {ok, version, tier, llm:{tier,provider,model,key_present}, state, mode}
//   GET  /api/state              full state payload (same llm block)
//   GET  /api/memory/search?q=   {results, abstained, citations, query}
//   POST /api/tool               {tool:"memory.remember"|"memory.recall", arguments:{...}}
//   POST /agui, WS /ws           AG-UI / WebSocket (not MCP)
// Aegis Connections (connections.ts) speak MCP Streamable HTTP
// only, so an 'Aegis Memory' Connection cannot be registered against
// this daemon yet: ConnectionService.add() would fail its tool
// discovery against a non-MCP endpoint. ensureAegisMemoryConnection()
// below therefore probes first and degrades to a no-op report instead
// of throwing or creating a broken connection; it registers for real
// if/when the daemon grows a Streamable HTTP MCP endpoint at /mcp.
// Everything in this module is fail-soft: an absent daemon yields
// reachable:false, never an exception into the host's boot path.
import type { Connection } from '../shared/connection-types.js';
import type { ConnectionService } from './connections.js';

export const AEGIS_MEMORY_CONNECTION_NAME = 'Aegis Memory';
export const DEFAULT_AEGIS_DAEMON_URL = 'http://127.0.0.1:8765';
// The conventional path a future Streamable HTTP MCP transport on the
// daemon would use; probed, never assumed.
export const AEGIS_DAEMON_MCP_PATH = '/mcp';

export interface AegisDaemonOptions {
  /** Daemon base URL. Default: AEGIS_DAEMON_URL env, else 127.0.0.1:8765. */
  baseUrl?: string;
  /** Per-request timeout. Default 3000ms   a health surface must be cheap. */
  timeoutMs?: number;
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
}

export function aegisDaemonUrl(
  env: Record<string, string | undefined> = process.env,
): string {
  const raw = env.AEGIS_DAEMON_URL?.trim() || DEFAULT_AEGIS_DAEMON_URL;
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
    return url.toString().replace(/\/$/, '');
  } catch {
    return DEFAULT_AEGIS_DAEMON_URL;
  }
}

function resolveOptions(options: AegisDaemonOptions = {}) {
  const env = options.env ?? process.env;
  return {
    baseUrl: (options.baseUrl ?? aegisDaemonUrl(env)).replace(/\/$/, ''),
    timeoutMs: options.timeoutMs ?? 3_000,
    env,
    fetch: options.fetch ?? fetch,
  };
}

async function fetchJson(
  options: Required<Omit<AegisDaemonOptions, 'baseUrl' | 'env'>> & {
    baseUrl: string;
  },
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: Record<string, unknown> } | undefined> {
  try {
    const response = await options.fetch(`${options.baseUrl}${path}`, {
      ...init,
      signal: AbortSignal.timeout(options.timeoutMs),
    });
    const body: unknown = await response.json().catch(() => null);
    return {
      status: response.status,
      body:
        body && typeof body === 'object'
          ? (body as Record<string, unknown>)
          : {},
    };
  } catch {
    return undefined;
  }
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
const asString = (value: unknown): string | null =>
  typeof value === 'string' && value ? value : null;

export interface AegisDaemonHealth {
  reachable: boolean;
  ok: boolean;
  version: string | null;
  tier: string | null;
  state: string | null;
  mode: string | null;
}

/** Health-check the daemon at AEGIS_DAEMON_URL. Never throws. */
export async function checkAegisDaemonHealth(
  options: AegisDaemonOptions = {},
): Promise<AegisDaemonHealth> {
  const resolved = resolveOptions(options);
  const result = await fetchJson(resolved, '/health');
  if (!result || result.status !== 200)
    return {
      reachable: false,
      ok: false,
      version: null,
      tier: null,
      state: null,
      mode: null,
    };
  const llm = asRecord(result.body.llm);
  return {
    reachable: true,
    ok: result.body.ok === true,
    version: asString(result.body.version),
    tier: asString(llm.tier) ?? asString(result.body.tier),
    state: asString(result.body.state),
    mode: asString(result.body.mode),
  };
}

export interface AegisMemoryState {
  reachable: boolean;
  /** Daemon LLM tier ('offline' | 'cloud'), names only   never a key. */
  tier: string | null;
  /** Selected provider name (e.g. 'openrouter'), never a key. */
  provider: string | null;
  provenanceStrict: boolean;
  /** Daemon RAG toggle: when false, chat turns inject no retrieved
   * memory context (explicit recall tools still work). Daemon default
   * is true; reported here from /api/state's `rag_enabled`. */
  ragEnabled: boolean;
}

// The daemon (services/daemon) has a real provenance toggle:
// /api/state carries `provenance_strict` and it is settable via its
// settings API (default off = conversational; on = cite-or-abstain for
// memory questions). Resolution order, all documented in
// MODIFICATIONS.md: an explicit boolean on a daemon payload wins; then
// the host's AEGIS_PROVENANCE_STRICT env (the product-level toggle
// declared in the root .env.example); then the product default,
// false = conversational.
function provenanceFromPayloads(
  payloads: Record<string, unknown>[],
): boolean | undefined {
  for (const payload of payloads) {
    const candidates = [
      payload.provenanceStrict,
      payload.provenance_strict,
      asRecord(payload.provenance).strict,
      asRecord(payload.settings).provenanceStrict,
      asRecord(payload.settings).provenance_strict,
    ];
    for (const candidate of candidates)
      if (typeof candidate === 'boolean') return candidate;
  }
  return undefined;
}

function provenanceFromEnv(env: Record<string, string | undefined>): boolean {
  const raw = env.AEGIS_PROVENANCE_STRICT?.trim().toLowerCase();
  if (raw === '1' || raw === 'true' || raw === 'yes') return true;
  return false;
}

/**
 * Memory status for the host UI: is the daemon up, which tier/provider
 * is it on (names only), and is provenance strict mode on. Reads
 * /health + /api/state. Never throws; a down daemon is
 * {reachable:false, tier:null, provider:null, provenanceStrict:<env>}.
 */
export async function getAegisMemoryState(
  options: AegisDaemonOptions = {},
): Promise<AegisMemoryState> {
  const resolved = resolveOptions(options);
  const [health, state] = await Promise.all([
    fetchJson(resolved, '/health'),
    fetchJson(resolved, '/api/state'),
  ]);
  const payloads = [health?.body ?? {}, state?.body ?? {}];
  const reachable = health?.status === 200 || state?.status === 200;
  let tier: string | null = null;
  let provider: string | null = null;
  let ragEnabled: boolean | undefined;
  for (const payload of payloads) {
    const llm = asRecord(payload.llm);
    tier ??= asString(llm.tier) ?? asString(payload.tier);
    provider ??= asString(llm.provider) ?? asString(payload.provider);
    if (typeof payload.rag_enabled === 'boolean')
      ragEnabled = payload.rag_enabled;
    if (typeof asRecord(payload.settings).rag_enabled === 'boolean')
      ragEnabled = asRecord(payload.settings).rag_enabled as boolean;
  }
  return {
    reachable,
    tier,
    provider,
    provenanceStrict:
      provenanceFromPayloads(payloads) ?? provenanceFromEnv(resolved.env),
    ragEnabled: ragEnabled ?? true,
  };
}

export interface AegisDaemonMcpStatus {
  available: boolean;
  transport: 'streamable-http' | 'none';
  /** The URL that was probed (and a future MCP Connection would use). */
  mcpUrl: string;
  detail: string;
}

/**
 * Probe for a Streamable HTTP MCP endpoint on the daemon with a real
 * MCP initialize request. Today's daemon answers 404 (no such route  
 * FastAPI), which this reports as transport:'none'. Never throws.
 */
export async function probeAegisDaemonMcp(
  options: AegisDaemonOptions = {},
): Promise<AegisDaemonMcpStatus> {
  const resolved = resolveOptions(options);
  const mcpUrl = `${resolved.baseUrl}${AEGIS_DAEMON_MCP_PATH}`;
  try {
    const response = await resolved.fetch(mcpUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'aegis-link', version: '0.1.0' },
        },
      }),
      signal: AbortSignal.timeout(resolved.timeoutMs),
    });
    if (response.status === 200) {
      const body: unknown = await response.json().catch(() => null);
      if (asRecord(body).jsonrpc === '2.0' && asRecord(body).result)
        return {
          available: true,
          transport: 'streamable-http',
          mcpUrl,
          detail: 'Daemon answered an MCP initialize request.',
        };
    }
    return {
      available: false,
      transport: 'none',
      mcpUrl,
      detail: `Daemon returned HTTP ${response.status} for MCP initialize; it exposes no MCP transport (HTTP API only).`,
    };
  } catch (error) {
    return {
      available: false,
      transport: 'none',
      mcpUrl,
      detail: `Daemon unreachable for MCP probe (${error instanceof Error ? error.name : 'error'}); it exposes no known MCP transport.`,
    };
  }
}

export interface AegisMemoryConnectionConfig {
  name: typeof AEGIS_MEMORY_CONNECTION_NAME;
  /** Null today: there is no MCP endpoint to point a Connection at. */
  url: string | null;
  /** Where the endpoint will live if the daemon gains MCP transport. */
  mcpUrl: string;
  transport: 'none' | 'streamable-http';
  note: string;
}

/** The manual-connection config, for MODIFICATIONS.md / operator docs. */
export function aegisMemoryConnectionConfig(
  options: AegisDaemonOptions = {},
): AegisMemoryConnectionConfig {
  const resolved = resolveOptions(options);
  return {
    name: AEGIS_MEMORY_CONNECTION_NAME,
    url: null,
    mcpUrl: `${resolved.baseUrl}${AEGIS_DAEMON_MCP_PATH}`,
    transport: 'none',
    note: 'Do NOT add this in the Connections UI yet: the Aegis daemon has no MCP endpoint, so discovery would fail. When the daemon serves Streamable HTTP MCP at /mcp, add a connection named "Aegis Memory" with that URL and no token (the daemon is loopback-only), or let ensureAegisMemoryConnection() register it.',
  };
}

export interface EnsureAegisMemoryResult {
  registered: boolean;
  alreadyExisted: boolean;
  connection?: Connection;
  mcp: AegisDaemonMcpStatus;
  reason?: string;
}

/**
 * Ensure the built-in 'Aegis Memory' Connection exists for an Agent, using
 * only ConnectionService's public API (service.add -> store.create; the
 * SQLite store is never written directly). Safe to call at boot: if a
 * connection with that name already exists it is returned; if the
 * daemon has no MCP transport (today's reality) or is unreachable,
 * nothing is created and nothing throws   the result says why.
 */
export async function ensureAegisMemoryConnection(
  connections: Pick<ConnectionService, 'add' | 'store'>,
  dotId: string,
  options: AegisDaemonOptions = {},
): Promise<EnsureAegisMemoryResult> {
  const existing = connections.store
    .list(dotId)
    .find((connection) => connection.name === AEGIS_MEMORY_CONNECTION_NAME);
  const mcp = await probeAegisDaemonMcp(options);
  if (existing)
    return {
      registered: true,
      alreadyExisted: true,
      connection: existing,
      mcp,
    };
  if (!mcp.available)
    return {
      registered: false,
      alreadyExisted: false,
      mcp,
      reason: mcp.detail,
    };
  try {
    const connection = await connections.add(dotId, {
      name: AEGIS_MEMORY_CONNECTION_NAME,
      url: mcp.mcpUrl,
    });
    return { registered: true, alreadyExisted: false, connection, mcp };
  } catch (error) {
    return {
      registered: false,
      alreadyExisted: false,
      mcp,
      reason: error instanceof Error ? error.message : 'Registration failed.',
    };
  }
}

// ---------------------------------------------------------------------------
// Research connector descriptors (W-MEM, additive). Aegis has NO
// built-in connector descriptor registry: Connections are per-Agent MCP
// Streamable-HTTP registrations whose add() performs live tool
// discovery against a URL (see connections.ts `connectionInput`), and
// the daemon's research tools are plain HTTP-API tools, not an MCP
// endpoint   so they cannot be registered as Connections without deep
// surgery. They are surfaced through this daemon-link glue instead
// (daemon /api/tool + the memory panel), described here for the UI.
// ---------------------------------------------------------------------------

export interface AegisResearchConnector {
  name: string;
  /** Daemon tool names (POST /api/tool on the daemon). */
  tools: string[];
  auth: string;
  note: string;
}

export const AEGIS_RESEARCH_CONNECTORS: AegisResearchConnector[] = [
  {
    name: 'OpenAlex',
    tools: [
      'openalex.search_works',
      'openalex.work',
      'openalex.search_authors',
    ],
    auth: 'none',
    note: 'Scholarly works/authors via api.openalex.org. Every result is stored as a provenance capture (source openalex:<id>) in the daemon memory.',
  },
  {
    name: 'GitHub',
    tools: ['github.repo', 'github.tree', 'github.commits', 'github.file'],
    auth: 'optional GITHUB_TOKEN env on the daemon; unauthenticated otherwise',
    note: 'Plain api.github.com REST (no gh CLI, no app auth). Commits include by-author / by-ISO-week analysis.',
  },
];

// ---------------------------------------------------------------------------
// Four-layer memory read client (W-MEM, additive). The daemon exposes
// all four layers over HTTP:
//   L1 captures  GET /api/memory/captures[/:id]
//   L2 RAG       GET /api/memory/search?q=
//   L3 STAIR     GET /api/tree, GET /api/tree/address?q=, /api/tree/nodes/:id
//   L4 graph     GET /api/graph, GET /api/graph/query?entity=
// Every method is fail-soft like the rest of this module: a down
// daemon yields {reachable:false, ...empty fields}, never a throw.
// ---------------------------------------------------------------------------

export interface AegisCapture {
  id: string;
  kind: string | null;
  trust: string | null;
  source: string | null;
  ts: number | null;
  text: string;
}

export interface AegisCapturesResult {
  reachable: boolean;
  captures: AegisCapture[];
  total: number;
}

export async function getAegisCaptures(
  limit = 50,
  options: AegisDaemonOptions = {},
): Promise<AegisCapturesResult> {
  const resolved = resolveOptions(options);
  const result = await fetchJson(
    resolved,
    `/api/memory/captures?limit=${Math.max(1, Math.min(limit, 500))}`,
  );
  if (!result || result.status !== 200)
    return { reachable: false, captures: [], total: 0 };
  const captures = Array.isArray(result.body.captures)
    ? (result.body.captures as AegisCapture[])
    : [];
  return {
    reachable: true,
    captures,
    total:
      typeof result.body.total === 'number'
        ? result.body.total
        : captures.length,
  };
}

export interface AegisCaptureResult {
  reachable: boolean;
  capture: AegisCapture | null;
}

export async function getAegisCapture(
  captureId: string,
  options: AegisDaemonOptions = {},
): Promise<AegisCaptureResult> {
  const resolved = resolveOptions(options);
  const result = await fetchJson(
    resolved,
    `/api/memory/captures/${encodeURIComponent(captureId)}`,
  );
  if (!result || result.status !== 200)
    return { reachable: false, capture: null };
  const capture = asRecord(result.body.capture);
  return {
    reachable: true,
    capture: Object.keys(capture).length
      ? (capture as unknown as AegisCapture)
      : null,
  };
}

export interface AegisMemorySearchResult {
  reachable: boolean;
  results: Record<string, unknown>[];
  citations: string[];
  abstained: boolean;
}

export async function searchAegisMemory(
  query: string,
  options: AegisDaemonOptions = {},  scopeId?: string,
): Promise<AegisMemorySearchResult> {
  const resolved = resolveOptions(options);
  const result = await fetchJson(
    resolved,
    `/api/memory/search?q=${encodeURIComponent(query)}${scopeId ? `&scope_id=${encodeURIComponent(scopeId)}` : ''}`,
  );
  if (!result || result.status !== 200)
    return { reachable: false, results: [], citations: [], abstained: true };
  return {
    reachable: true,
    results: Array.isArray(result.body.results)
      ? (result.body.results as Record<string, unknown>[])
      : [],
    citations: Array.isArray(result.body.citations)
      ? (result.body.citations as string[])
      : [],
    abstained: result.body.abstained === true,
  };
}

export interface AegisTreeNode {
  id: string;
  doc_title: string | null;
  leaf_title: string | null;
  title: string | null;
  title_path: string | null;
  level: number | null;
  parent_id: string | null;
  is_leaf: boolean;
  capture_id: string | null;
  text: string | null;
}

export interface AegisTreeResult {
  reachable: boolean;
  nodes: AegisTreeNode[];
}

export async function getAegisTree(
  options: AegisDaemonOptions = {},
): Promise<AegisTreeResult> {
  const resolved = resolveOptions(options);
  const result = await fetchJson(resolved, '/api/tree');
  if (!result || result.status !== 200) return { reachable: false, nodes: [] };
  return {
    reachable: true,
    nodes: Array.isArray(result.body.nodes)
      ? (result.body.nodes as AegisTreeNode[])
      : [],
  };
}

export interface AegisTreeAddressResult {
  reachable: boolean;
  abstained: boolean;
  node: AegisTreeNode | null;
  text: string | null;
}

export async function addressAegisTree(
  query: string,
  options: AegisDaemonOptions = {},
): Promise<AegisTreeAddressResult> {
  const resolved = resolveOptions(options);
  const result = await fetchJson(
    resolved,
    `/api/tree/address?q=${encodeURIComponent(query)}`,
  );
  if (!result || result.status !== 200)
    return { reachable: false, abstained: true, node: null, text: null };
  const node = asRecord(result.body.node);
  return {
    reachable: true,
    abstained: result.body.abstained === true,
    node: Object.keys(node).length ? (node as unknown as AegisTreeNode) : null,
    text: asString(result.body.text),
  };
}

export async function updateAegisTreeNode(
  nodeId: string,
  patch: { leaf_title?: string; text?: string },
  options: AegisDaemonOptions = {},
): Promise<{ ok: boolean; error?: string }> {
  const resolved = resolveOptions(options);
  const result = await fetchJson(
    resolved,
    `/api/tree/nodes/${encodeURIComponent(nodeId)}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    },
  );
  if (!result) return { ok: false, error: 'daemon_unreachable' };
  return {
    ok: result.status === 200 && result.body.ok === true,
    error:
      typeof result.body.error === 'string'
        ? result.body.error
        : result.status === 200
          ? undefined
          : 'tree_node_update_failed',
  };
}

export async function deleteAegisCapture(
  captureId: string,
  options: AegisDaemonOptions = {},
): Promise<{ ok: boolean; error?: string }> {
  const resolved = resolveOptions(options);
  const result = await fetchJson(
    resolved,
    `/api/captures/${encodeURIComponent(captureId)}`,
    { method: 'DELETE' },
  );
  if (!result) return { ok: false, error: 'daemon_unreachable' };
  return {
    ok: result.status === 200 && result.body.ok !== false,
    error:
      result.status === 200
        ? undefined
        : typeof result.body.error === 'string'
          ? result.body.error
          : 'capture_delete_failed',
  };
}

export async function deleteAegisTreeNode(
  nodeId: string,
  options: AegisDaemonOptions = {},
): Promise<{ ok: boolean; error?: string }> {
  const resolved = resolveOptions(options);
  const result = await fetchJson(
    resolved,
    `/api/tree/nodes/${encodeURIComponent(nodeId)}`,
    { method: 'DELETE' },
  );
  if (!result) return { ok: false, error: 'daemon_unreachable' };
  return {
    ok: result.status === 200 && result.body.ok !== false,
    error:
      result.status === 200
        ? undefined
        : typeof result.body.error === 'string'
          ? result.body.error
          : 'tree_node_delete_failed',
  };
}

export interface AegisGraphEdge {
  id: number;
  subj: string;
  relation: string;
  obj: string;
  capture_id: string | null;
}

export interface AegisGraphResult {
  reachable: boolean;
  entities: { id: number; name: string }[];
  edges: AegisGraphEdge[];
}

export async function getAegisGraph(
  options: AegisDaemonOptions = {},
): Promise<AegisGraphResult> {
  const resolved = resolveOptions(options);
  const result = await fetchJson(resolved, '/api/graph');
  if (!result || result.status !== 200)
    return { reachable: false, entities: [], edges: [] };
  return {
    reachable: true,
    entities: Array.isArray(result.body.entities)
      ? (result.body.entities as { id: number; name: string }[])
      : [],
    edges: Array.isArray(result.body.edges)
      ? (result.body.edges as AegisGraphEdge[])
      : [],
  };
}

export async function queryAegisGraph(
  entity: string,
  options: AegisDaemonOptions = {},
): Promise<AegisGraphResult & { entity: string }> {
  const resolved = resolveOptions(options);
  const result = await fetchJson(
    resolved,
    `/api/graph/query?entity=${encodeURIComponent(entity)}`,
  );
  if (!result || result.status !== 200)
    return { reachable: false, entities: [], edges: [], entity };
  return {
    reachable: true,
    entities: [],
    edges: Array.isArray(result.body.edges)
      ? (result.body.edges as AegisGraphEdge[])
      : [],
    entity,
  };
}

// ---------------------------------------------------------------------------
// Research connectors (W-FIX 2c): the Research view calls the daemon's
// read-only research tools (OpenAlex + GitHub, see
// AEGIS_RESEARCH_CONNECTORS) through POST /api/tool. The allowlist is
// enforced here   this proxy can never become a generic tool pipe into
// the daemon's permission broker. Longer timeout than the health
// surfaces: these are real upstream API calls.
// ---------------------------------------------------------------------------

export const AEGIS_RESEARCH_TOOL_NAMES: readonly string[] =
  AEGIS_RESEARCH_CONNECTORS.flatMap((connector) => connector.tools);

export interface AegisResearchResult {
  reachable: boolean;
  tool: string;
  result: Record<string, unknown> | null;
  detail: string | null;
}

export interface AegisMemoryWriteResult {  reachable: boolean;  result: Record<string, unknown> | null;  detail: string | null;}/** Store a scoped capture through the daemon's dedicated memory write API. */export async function rememberAegisMemory(  input: { text: string; source: string; category: string; scopeId?: string },  options: AegisDaemonOptions = {},): Promise<AegisMemoryWriteResult> {  const resolved = resolveOptions({ ...options, timeoutMs: options.timeoutMs ?? 15_000 });  const response = await fetchJson(resolved, '/api/memory/remember', {    method: 'POST',    headers: { 'Content-Type': 'application/json' },    body: JSON.stringify({      text: input.text,      source: input.source,      category: input.category,      scope_id: input.scopeId ?? '',    }),  });  if (!response) {    return { reachable: false, result: null, detail: 'The Aegis memory daemon is not reachable.' };  }  if (response.status !== 200) {    return { reachable: false, result: response.body, detail: `Memory daemon returned HTTP ${response.status}.` };  }  return { reachable: true, result: response.body, detail: null };}export async function callAegisResearchTool(
  tool: string,
  args: Record<string, unknown>,
  options: AegisDaemonOptions = {},
): Promise<AegisResearchResult> {
  if (!AEGIS_RESEARCH_TOOL_NAMES.includes(tool))
    return {
      reachable: false,
      tool,
      result: null,
      detail: `Tool ${tool} is not a research connector tool.`,
    };
  const resolved = resolveOptions({ ...options, timeoutMs: 30_000 });
  const result = await fetchJson(resolved, '/api/tool', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tool, arguments: args }),
  });
  if (!result)
    return {
      reachable: false,
      tool,
      result: null,
      detail:
        'The Aegis daemon is not reachable, so research connectors are unavailable. Start Aegis with start.sh / start.ps1 so the daemon runs.',
    };
  // The daemon's permission broker mode-gates the research scopes
  // (network.get lives in Browser mode). Surface that in plain
  // language instead of a bare mode_blocked so the Research view can
  // tell the user exactly what to change.
  const body = result.body as { error?: string; mode?: string } | null;
  return {
    reachable: true,
    tool,
    result: result.body,
    detail:
      body?.error === 'mode_blocked'
        ? `The daemon is in ${body.mode ?? 'a non-Browser'} mode; research connectors need Browser mode (they use the network.get scope). Switch the daemon mode, then retry.`
        : null,
  };
}
