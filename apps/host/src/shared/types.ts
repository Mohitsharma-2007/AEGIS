export type Status =
  | 'queued'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'interrupted'
  | 'cancelled';
export interface Settings {
  name: string;
  paused: boolean;
  researchAllowed: boolean;
  memoryAllowed: boolean;
  appsAllowed: boolean;
  developerOptionsEnabled: boolean;
  wslEnabled: boolean;
  /** UI sound cues (sent/alert/paused/voice). Default on. */
  soundsEnabled: boolean;
  /** Aegis provider registry selection, chosen in Settings. */
  providerId?: string;
  providerModel?: string;
  /** Show the floating desktop mascot. Default on. */
  mascotEnabled: boolean;
  /**
   * Which surface Aegis shows outside the app window: the compact notch or the
   * floating mascot. Exactly one is ever visible.
   */
  desktopSurface?: 'notch' | 'mascot';
  /** Mascot character: auto follows the active surface. */
  mascotCharacter:
    | 'auto'
    | 'aegi'
    | 'mail'
    | 'social'
    | 'files'
    | 'memory'
    | 'harness'
    | 'security';
  /** Floating mascot size in pixels (64-160). */
  mascotSize: number;
  /** Mascot body shape: auto keeps the character's own outline. */
  mascotShape: 'auto' | 'orb' | 'squircle' | 'blob' | 'leaf' | 'drop';
  /** Interface sound pack. */
  soundPack: 'classic' | 'glassy' | 'warm';
  /** Interface sound volume, 0-1. */
  soundVolume: number;
  /** Listen for "Hey Aegis" in the background. */
  wakeWordEnabled: boolean;
  /** Local Pipecat voice pipeline base URL. */
  voicePipelineUrl: string;
  /** Spoken language preference for the local pipeline. */
  voiceLanguage: 'auto' | 'en' | 'hi' | 'hinglish';
}
export interface ProviderOption {
  id: string;
  label: string;
  baseUrl: string;
  defaultModel: string;
  models: string[];
  configured: boolean;
  /** Wire protocol: OpenAI Chat Completions or Anthropic Messages. */
  apiType?: 'openai' | 'anthropic' | 'other';
  /** Env var name holding the key (name only, never the value). */
  keyEnv?: string;
}

/** One entry of the models.dev catalogue view served by GET /api/providers. */
export interface CatalogueProviderOption {
  id: string;
  label: string;
  baseUrl: string;
  apiType: 'openai' | 'anthropic' | 'other';
  /** Env var names that can configure this provider (names only). */
  env: string[];
  configured: boolean;
  favourite: boolean;
  modelCount: number;
  defaultModel: string;
  runnable: boolean;
}
export interface Task {
  id: string;
  prompt: string;
  status: Status;
  intervalSeconds: number | null;
  nextRunAt: number | null;
  createdAt: number;
  updatedAt: number;
  error: string | null;
  lease: string | null;
  leaseUntil: number | null;
}
export interface Source {
  title: string;
  url: string;
  excerpt: string;
}
export interface Result {
  text: string;
  sources: Source[];
  sample: boolean;
  screenshot?: string;
  /** Browser engine that actually served a browse-backed brief. */
  engine?: 'playwright';
}
export interface Run {
  id: string;
  taskId: string;
  status: string;
  startedAt: number;
  finishedAt: number | null;
  result: Result | null;
  error: string | null;
}
export interface TaskEvent {
  id: number;
  taskId: string;
  runId: string | null;
  /** Free-form text log (e.g. "Thinking...", "Running tool...") */
  text?: string;
  /** Structured breakdown data for task chain-of-thought */
  breakdown?: {
    thought?: string;
    action?:
      | 'tool'
      | 'api'
      | 'browser'
      | 'search'
      | 'memory'
      | 'visual'
      | 'voice'
      | 'plugin'
      | 'system';
    tool?: string; /* name of the tool being called */
    args?: Record<string, unknown>; /* args passed to the tool */
    result?: unknown; /* result from the tool */
    error?: string; /* error if the tool failed */
    /** How much context was consumed (0-1) */
    contextConsumed?: number;
    /** Estimated context remaining (0-1) */
    contextRemaining?: number;
  };
}
export interface Memory {
  id: string;
  text: string;
  createdAt: number;
}
export interface Detail {
  task: Task;
  runs: Run[];
  events: TaskEvent[];
}
export interface State {
  settings: Settings;
  tasks: Task[];
  memories: Memory[];
  mode: 'sample' | 'live';
  configured: boolean;
}
export type Action = 'run' | 'pause' | 'cancel';
export interface Space {
  id: string;
  name: string;
  description: string;
  createdAt: number;
}
export interface Dot {
  id: string;
  /** Default destination for saved pages, not ownership. */
  spaceId: string;
  spaceIds: string[];
  name: string;
  instructions: string;
  researchAllowed: boolean;
  memoryAllowed: boolean;
  appsAllowed: boolean;
  composioToolkits: string[];
  composioSessionId?: string | null;
  composioPolicyHash?: string | null;
  createdAt: number;
  learningContainerId?: string | null;
  skillDeliveryEnabled?: boolean;
  /** AEGIS (W-FIX 2b): set when this Agent is one of the seeded
   * surface presets (today/chat/mail/calendar/browser/files/activity/
   * connections/ideas/goals/apps). The sidebar groups these under the
   * single primary Aegis Agent as its surfaces instead of listing them
   * as peer agents. Computed server-side from the preset registry;
   * never stored. */
  surface?: string;
}
export interface Conversation {
  id: string;
  dotId: string;
  ownerId: string;
  title: string;
  createdAt: number;
  /** Frozen at creation; null means this conversation does not participate. */
  learningContainerId?: string | null;
}
export interface CallReceipt {
  anchorMessageId?: string | null;
  id: string;
  threadId: string;
  startedAt: number;
  endedAt: number | null;
  status: 'connecting' | 'active' | 'ended' | 'failed';
  transcript: string;
  error: string | null;
}
export interface SetupStatus {
  intelligence: boolean;
  model: boolean;
  browser: boolean;
  voice: boolean;
  composio: boolean;
  slack: string;
  missing: string[];
  /** Aegis provider registry: active provider and per-provider status. */
  activeProvider?: { id: string; label: string };
  providers?: ProviderOption[];
  /** Aegis daemon memory layer link state (names/flags only). */
  aegisMemory?: {
    reachable: boolean;
    tier: string | null;
    provider: string | null;
    provenanceStrict: boolean;
  };
  /** Optional Aegis computer sidecar probe result. */
  aegisComputer?: {
    configured: boolean;
    available: boolean;
    detail: string;
  };
}
export interface WorkspaceState {
  spaces: Space[];
  dots: Dot[];
  conversations: Conversation[];
  setup: SetupStatus;
  calls: CallReceipt[];
}
