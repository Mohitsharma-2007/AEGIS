import type {
  CatalogueProviderOption,
  ProviderOption,
  SetupStatus,
} from '../shared/types';
let token = sessionStorage.getItem('aegis-token') ?? '';
export function setToken(value: string) {
  token = value;
  if (value) sessionStorage.setItem('aegis-token', value);
  else sessionStorage.removeItem('aegis-token');
}
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
export const OFFLINE_MESSAGE =
  'Aegis is offline. The local server is not running   start it with start.bat (or `npm start` in the host app), then retry.';

export async function api<T>(
  path: string,
  method = 'GET',
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      signal,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(['GET', 'HEAD'].includes(method)
          ? {}
          : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (error) {
    // fetch() only rejects for transport failures: a dead server, a killed
    // dev process or a dropped connection. "Failed to fetch" told the owner
    // nothing; this says what happened and what to do.
    if (signal?.aborted) throw error;
    throw new ApiError(OFFLINE_MESSAGE, 0);
  }
  let parsed = true;
  const data = (await response.json().catch(() => {
    parsed = false;
    return null;
  })) as { error?: string } | null;
  if (!response.ok)
    throw new ApiError(
      data?.error ??
        (response.status === 502 || response.status === 504
          ? OFFLINE_MESSAGE
          : `Request failed (${response.status}).`),
      response.status,
    );
  // `null` is a valid API answer (e.g. a conversation with no page context);
  // only a body that could not be parsed at all is unreadable.
  if (!parsed)
    throw new ApiError('Server returned an unreadable response.', response.status);
  return data as T;
}

/** True when an error means the local server could not be reached. */
export function isOffline(error: unknown): boolean {
  return error instanceof ApiError && error.status === 0;
}
export function authHeaders(): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}
export interface ProvidersResponse {
  providers: ProviderOption[];
  catalogue?: CatalogueProviderOption[];
  catalogueSource?: 'live' | 'snapshot';
  active: { providerId?: string; model?: string; baseUrl: string };
  setup?: SetupStatus;
}
export interface ProviderModelsResponse {
  providerId: string;
  models: string[];
  source: 'live' | 'catalogue';
  defaultModel?: string;
}
export function getProviders(): Promise<ProvidersResponse> {
  return api<ProvidersResponse>('/providers');
}
export function getProviderModels(
  providerId: string,
): Promise<ProviderModelsResponse> {
  return api<ProviderModelsResponse>(
    `/providers/${encodeURIComponent(providerId)}/models?live=1`,
  );
}
export function selectProvider(
  providerId: string,
  model: string,
): Promise<ProvidersResponse> {
  return api<ProvidersResponse>('/providers', 'PUT', { providerId, model });
}
// Aegis daemon memory (four layers), via the server glue in
// src/server/aegis-memory-routes.ts. All fail-soft: reachable=false
// when the daemon is down.
export interface AegisMemoryStateResponse {
  reachable: boolean;
  tier: string | null;
  provider: string | null;
  provenanceStrict: boolean;
  ragEnabled: boolean;
}
export interface AegisCaptureItem {
  id: string;
  kind: string | null;
  trust: string | null;
  source: string | null;
  ts: number | null;
  text: string;
  text_truncated?: boolean;
}
export interface AegisGraphResponse {
  reachable: boolean;
  entities: { id: number; name: string }[];
  edges: {
    id: number;
    subj: string;
    relation: string;
    obj: string;
    capture_id: string | null;
  }[];
}
export function getAegisMemoryState(): Promise<AegisMemoryStateResponse> {
  return api<AegisMemoryStateResponse>('/aegis-memory/state');
}
export function getAegisCaptures(limit = 50): Promise<{
  reachable: boolean;
  captures: AegisCaptureItem[];
  total: number;
}> {
  return api(`/aegis-memory/captures?limit=${limit}`);
}
export interface AegisMemorySearchResponse {
  reachable: boolean;
  results: {
    text: string;
    capture_id: string;
    score: number;
    source?: string | null;
    title?: string | null;
    kind?: string | null;
    is_snippet?: boolean;
  }[];
  citations: string[];
  abstained: boolean;
}
export function searchAegisMemory(
  query: string,
): Promise<AegisMemorySearchResponse> {
  return api(`/aegis-memory/search?q=${encodeURIComponent(query)}`);
}
export function getAegisCapture(id: string): Promise<{
  reachable: boolean;
  capture: AegisCaptureItem | null;
}> {
  return api(`/aegis-memory/captures/${encodeURIComponent(id)}`);
}
// Re-run the memory agent's policy over stored memories and drop clutter.
export function pruneAegisMemory(): Promise<{
  ok: boolean;
  removed: number;
  entries: Array<{ id: string; reason: string; title: string }>;
}> {
  return api('/aegis-memory/prune', 'POST', {});
}
// Remove a captured memory from RAG retrieval (owner curation).
export function deleteAegisCapture(
  captureId: string,
): Promise<{ ok: boolean; error?: string }> {
  return api(`/aegis-memory/captures/${encodeURIComponent(captureId)}`, 'DELETE');
}
export function getAegisGraph(): Promise<AegisGraphResponse> {
  return api('/aegis-memory/graph');
}
export function queryAegisGraph(
  entity: string,
): Promise<AegisGraphResponse & { entity?: string }> {
  return api(`/aegis-memory/graph?entity=${encodeURIComponent(entity)}`);
}
export interface MemoryDocumentItem {
  id: string;
  title: string;
  content: string;
  format?: string;
  documentClass?: string;
  indexState?: string;
  indexedAt?: number;
  error?: string | null;
  ragChunkCount?: number;
  sourcePath?: string | null;
  sourceModifiedAt?: number | null;
  sourceSizeBytes?: number | null;
  tier?: 'short' | 'long';
}
// Persistent, chunked RAG documents owned by the local memory store.
export function listMemoryDocs(): Promise<MemoryDocumentItem[]> {
  return api('/memory/documents');
}
export function createMemoryDoc(
  document: { title: string; content: string; format?: string },
): Promise<MemoryDocumentItem> {
  return api('/memory/documents', 'POST', document);
}
export function updateMemoryDoc(
  id: string,
  patch: { title?: string; content?: string },
): Promise<{ document: MemoryDocumentItem }> {
  return api(`/memory/documents/${encodeURIComponent(id)}`, 'PATCH', patch);
}
export function deleteMemoryDoc(
  id: string,
): Promise<{ ok: boolean; deleted?: boolean }> {
  return api(`/memory/documents/${encodeURIComponent(id)}`, 'DELETE');
}
export function reindexMemoryDoc(id: string): Promise<MemoryDocumentItem> {
  return api(`/memory/documents/${encodeURIComponent(id)}/reindex`, 'POST');
}

// Personal memory: the owner's durable preferences and facts, stored by the
// host itself (not the daemon) and injected into every agent prompt.
export interface HostMemory {
  id: string;
  text: string;
  createdAt: number;
}
export function getMemories(): Promise<{ memories: HostMemory[] }> {
  return api('/memories');
}
export function saveMemory(text: string, id?: string): Promise<HostMemory> {
  return id
    ? api(`/memories/${encodeURIComponent(id)}`, 'PUT', { text })
    : api('/memories', 'POST', { text });
}
export function deleteMemory(id: string): Promise<{ ok: boolean }> {
  return api(`/memories/${encodeURIComponent(id)}`, 'DELETE');
}

// Native execution harness (W-HARNESS) via
// src/server/harness-routes.ts. No sidecar binary is involved.
export interface HarnessApproval {
  id: string;
  sessionId: string;
  runtime: 'node' | 'python' | 'shell' | 'tool';
  command: string;
  status: 'pending' | 'approved' | 'rejected';
  reason?: string;
  createdAt: number;
}
export interface HarnessStatusResponse {
  running: boolean;
  engine?: 'native';
  version: string | null;
  url: string;
  detail: string | null;
  info: Record<string, unknown> | null;
  runtimes?: {
    node: string;
    python: string;
    shell: string;
    tools: string[];
  };
}
export interface HarnessSession {
  id: string;
  title?: string;
  [key: string]: unknown;
}
export interface HarnessMessage {
  id: string;
  type?: string;
  text?: string;
  content?: { type: string; text?: string }[];
  approval?: HarnessApproval;
  execution?: {
    runtime: string;
    command: string;
    exitCode: number;
    stdout: string;
    stderr: string;
    durationMs: number;
  };
  [key: string]: unknown;
}
export function getHarnessStatus(): Promise<HarnessStatusResponse> {
  return api<HarnessStatusResponse>('/harness/status');
}
export function getHarnessSessions(): Promise<{ data: HarnessSession[] }> {
  return api('/harness/sessions');
}
export function createHarnessSession(title?: string): Promise<{
  data: HarnessSession;
}> {
  return api('/harness/sessions', 'POST', title ? { title } : {});
}
export function getHarnessMessages(
  sessionId: string,
): Promise<{ data: HarnessMessage[] }> {
  return api(`/harness/sessions/${encodeURIComponent(sessionId)}/messages`);
}
export function sendHarnessPrompt(
  sessionId: string,
  text: string,
): Promise<unknown> {
  return api(
    `/harness/sessions/${encodeURIComponent(sessionId)}/prompt`,
    'POST',
    {
      text,
    },
  );
}
export function approveHarnessAction(
  sessionId: string,
  approvalId: string,
  approved: boolean,
): Promise<{
  success: boolean;
  status: 'approved' | 'rejected';
  execution?: unknown;
}> {
  return api(
    `/harness/sessions/${encodeURIComponent(sessionId)}/approve`,
    'POST',
    { approvalId, approved },
  );
}
// MCP servers: the native harness registry (.aegis-data/mcp.json).
export type McpServerConfig =
  | {
      type: 'local';
      command: string[];
      cwd?: string;
      environment?: Record<string, string>;
      disabled?: boolean;
    }
  | {
      type: 'remote';
      url: string;
      headers?: Record<string, string>;
      oauth?: false | Record<string, unknown>;
      disabled?: boolean;
    };
export function getHarnessMcpServers(): Promise<{
  path: string;
  servers: Record<string, McpServerConfig>;
}> {
  return api('/harness/plugins');
}
export function saveHarnessMcpServer(
  name: string,
  config: McpServerConfig,
): Promise<{ servers: Record<string, McpServerConfig> }> {
  return api(`/harness/plugins/${encodeURIComponent(name)}`, 'PUT', { config });
}
export function deleteHarnessMcpServer(
  name: string,
): Promise<{ servers: Record<string, McpServerConfig> }> {
  return api(`/harness/plugins/${encodeURIComponent(name)}`, 'DELETE');
}
export function toggleHarnessMcpServer(
  name: string,
  disabled: boolean,
): Promise<{ servers: Record<string, McpServerConfig> }> {
  return api(`/harness/plugins/${encodeURIComponent(name)}/toggle`, 'POST', {
    disabled,
  });
}
// Daemon forge/activity notices (phase-10 surface).
export interface DaemonActivityResponse {
  reachable: boolean;
  learnedTools: Record<string, unknown>[];
  forgedLog: Record<string, unknown>[];
  log: Record<string, unknown>[];
  counts: Record<string, unknown> | null;
  detail: string | null;
}
export function getDaemonActivity(): Promise<DaemonActivityResponse> {
  return api<DaemonActivityResponse>('/harness/daemon-activity');
}
export interface DaemonMcpResponse {
  reachable: boolean;
  servers: {
    servers?: { name: string; status: string }[];
    configs?: unknown[];
  } | null;
  tools: { tools?: { name: string }[] } | null;
  detail: string | null;
}
export function getDaemonMcp(): Promise<DaemonMcpResponse> {
  return api<DaemonMcpResponse>('/harness/daemon-mcp');
}
// Research connectors (W-FIX 2c), via the allowlisted proxy in
// src/server/aegis-memory-routes.ts -> daemon /api/tool. The daemon
// runs the real OpenAlex / GitHub calls and stores provenance captures.
export interface AegisResearchResponse {
  reachable: boolean;
  tool: string;
  result: Record<string, unknown> | null;
  detail: string | null;
}
export function callAegisResearch(
  tool: string,
  args: Record<string, unknown>,
): Promise<AegisResearchResponse> {
  return api<AegisResearchResponse>('/aegis-research/tool', 'POST', {
    tool,
    args,
  });
}
// WhatsApp pairing (W-FIX 3d), proxied by src/server/whatsapp-routes.ts.
export interface WhatsAppStatusResponse {
  reachable: boolean;
  state: 'disconnected' | 'qr' | 'connecting' | 'connected' | 'unavailable';
  qrDataUrl: string | null;
  me: { id: string; name?: string } | null;
  detail: string | null;
  paired: boolean;
}
export function getWhatsAppStatus(): Promise<WhatsAppStatusResponse> {
  return api<WhatsAppStatusResponse>('/whatsapp/status');
}
export function startWhatsApp(): Promise<WhatsAppStatusResponse> {
  return api<WhatsAppStatusResponse>('/whatsapp/start', 'POST');
}

export interface WhatsAppMessage {
  id?: string;
  chatId?: string;
  chat?: string;
  from?: string;
  to?: string;
  fromMe?: boolean;
  name?: string;
  pushName?: string;
  text?: string;
  body?: string;
  mediaType?: string;
  timestamp?: number;
  time?: number;
  createdAt?: number;
}
export interface WhatsAppMessagesResponse {
  ok?: boolean;
  messages?: WhatsAppMessage[];
  error?: string;
}
export function getWhatsAppMessages(
  chat?: string,
  limit = 60,
): Promise<WhatsAppMessagesResponse> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (chat) params.set('chat', chat);
  return api<WhatsAppMessagesResponse>(`/whatsapp/messages?${params.toString()}`);
}
export function sendWhatsApp(
  to: string,
  text: string,
): Promise<{ ok?: boolean; error?: string }> {
  return api('/whatsapp/send', 'POST', { to, text });
}
export function sendWhatsAppMedia(input: {
  to: string; data: string; mimetype: string; filename: string; caption?: string;
}): Promise<{ ok?: boolean; error?: string; mediaType?: string }> {
  return api('/whatsapp/send-media', 'POST', input);
}

// Agent runtime (src/server/agent-swarm.ts): one task   orchestrator plan  
// specialist reports   synthesis. The board only renders this real state.
export type SwarmAgentId =
  | 'aegis'
  | 'rfi'
  | 'security'
  | 'files'
  | 'memory'
  | 'computer';

export type SwarmTaskStatus =
  | 'queued'
  | 'planning'
  | 'running'
  | 'synthesizing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface SwarmAgentInfo {
  id: SwarmAgentId;
  name: string;
  role: string;
  description: string;
  capabilities: string[];
  kind: 'orchestrator' | 'specialist';
  model: string | null;
  provider: string | null;
}

export interface SwarmEvidence {
  agentId: SwarmAgentId;
  label: string;
  source: string;
  value: string;
  url?: string;
}

export interface SwarmSubtask {
  id: string;
  agentId: SwarmAgentId;
  title: string;
  instruction: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  evidence: SwarmEvidence[];
  report?: string;
  error?: string;
}

export interface SwarmTaskEvent {
  at: number;
  stage:
    | 'queued'
    | 'plan'
    | 'dispatch'
    | 'evidence'
    | 'report'
    | 'synthesis'
    | 'done'
    | 'error'
    | 'cancel';
  agentId: SwarmAgentId | 'system';
  title: string;
  detail?: string;
}

export interface SwarmTaskSummary {
  id: string;
  title: string;
  prompt: string;
  dotId: string;
  status: SwarmTaskStatus;
  planSource: 'model' | 'heuristic';
  provider?: string;
  model?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  subtaskCount: number;
  completedSubtasks: number;
  failedSubtasks: number;
  agents: SwarmAgentId[];
  error?: string;
}

export interface SwarmTaskDetail extends SwarmTaskSummary {
  requestedAgentId?: SwarmAgentId;
  subtasks: SwarmSubtask[];
  synthesis?: string;
  events: SwarmTaskEvent[];
}

export interface SwarmActiveProvider {
  providerId: string | null;
  provider: string | null;
  model: string | null;
  configured: boolean;
  running: number;
  queued: number;
}

export interface AgentsResponse {
  agents: SwarmAgentInfo[];
  active: SwarmActiveProvider;
  tasks: {
    total: number;
    running: number;
    completed: number;
    failed: number;
  };
}

export interface AgentTasksResponse {
  tasks: SwarmTaskSummary[];
  active: SwarmActiveProvider;
}

export function getAgents(): Promise<AgentsResponse> {
  return api<AgentsResponse>('/agents');
}

export function getAgentTasks(limit = 40): Promise<AgentTasksResponse> {
  return api<AgentTasksResponse>(`/agents/tasks?limit=${limit}`);
}

export function getAgentTask(id: string): Promise<SwarmTaskDetail> {
  return api<SwarmTaskDetail>(`/agents/tasks/${encodeURIComponent(id)}`);
}

export function createAgentTask(
  prompt: string,
  dotId: string,
  agentId?: SwarmAgentId,
): Promise<SwarmTaskDetail> {
  return api<SwarmTaskDetail>('/agents/tasks', 'POST', {
    prompt,
    dotId,
    ...(agentId ? { agentId } : {}),
  });
}

export function cancelAgentTask(id: string): Promise<SwarmTaskDetail> {
  return api<SwarmTaskDetail>(
    `/agents/tasks/${encodeURIComponent(id)}/cancel`,
    'POST',
  );
}

export function retryAgentTask(id: string): Promise<SwarmTaskDetail> {
  return api<SwarmTaskDetail>(
    `/agents/tasks/${encodeURIComponent(id)}/retry`,
    'POST',
  );
}

