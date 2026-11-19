import { ComputerService } from './computer-service.js';
import { ConnectionService } from './connections.js';
import { PageService } from './page-service.js';
import { randomUUID } from 'node:crypto';
import {
  CopilotKitIntelligence,
  CopilotRuntime,
  createCopilotHonoHandler,
  type CopilotHonoApp,
} from '@copilotkit/runtime/v2';
import { createSlackChannel } from './slack-channel.js';
export { slackIdentity } from './slack-channel.js';
import { EventType } from '@ag-ui/core';
import { lastValueFrom, toArray } from 'rxjs';
import { PROVIDERS } from './providers.js';
import { findCatalogueProvider } from './catalogue.js';
import { Store } from './store.js';
import { WorkspaceStore } from './workspace.js';
import { DotAgent } from './dot-agent.js';
import { runThreadTurn } from './headless.js';
import {
  INTELLIGENCE_KEY_MISSING_LABEL,
  setupStatus,
  type PlatformConfig,
} from './platform-config.js';
import { validateRuntimeScope } from './runtime-scope.js';
import { learningSelector } from './learning.js';
import { SetupTelemetry } from './setup-telemetry.js';
import {
  ensureAegisMemoryConnection,
  getAegisMemoryState,
  type AegisMemoryState,
} from './aegis-daemon.js';
import {
  probeAegisComputerSidecar,
  type AegisComputerSidecarHealth,
} from './integrations/aegis-computer-sidecar.js';
export class Platform {
  private channelStartupFailed = false;
  private aegisMemory?: AegisMemoryState;
  private aegisSidecar?: AegisComputerSidecarHealth;
  readonly setupTelemetry: SetupTelemetry;
  readonly pages: PageService;
  readonly computers: ComputerService;
  readonly connections: ConnectionService;
  readonly intelligence?: CopilotKitIntelligence;
  handler?: CopilotHonoApp;
  constructor(
    readonly store: Store,
    readonly workspace: WorkspaceStore,
    readonly config: PlatformConfig,
  ) {
    this.setupTelemetry = new SetupTelemetry(store);
    this.computers = new ComputerService(
      workspace,
      config,
      () => store.settings().paused,
    );
    this.connections = new ConnectionService(workspace.connections);
    this.pages = new PageService(workspace, () => {
      this.requireReady();
      if (!this.intelligence)
        throw new Error(
          'Page conversations require CopilotKit Intelligence; local provider mode does not provide them.',
        );
      return this.intelligence;
    });
    if (!config.intelligenceKey) {
      if (this.localMode) this.startLocalRuntime();
      return;
    }
    this.intelligence = new CopilotKitIntelligence({
      apiKey: config.intelligenceKey,
      apiUrl: config.intelligenceApiUrl,
      wsUrl: config.intelligenceWsUrl,
      getLearningContainerId: learningSelector(
        workspace,
        config.slackDotId ?? workspace.dots()[0]?.id,
      ),
    });
    const channels = [];
    if (config.slackChannel && config.slackTeam && config.slackUsers.length) {
      const dotId = config.slackDotId ?? workspace.dots()[0].id;
      if (!workspace.dot(dotId))
        throw new Error('SLACK_DOT_ID does not identify an existing Agent.');
      const slack = createSlackChannel({
        name: config.slackChannel,
        config,
        ownerId: workspace.ownerId,
        paused: () => store.settings().paused,
        agent: () =>
          new DotAgent(
            store,
            workspace,
            config,
            dotId,
            true,
            this.setupTelemetry,
            this.computers,
          ),
      });
      channels.push(slack);
    }
    const runtime = new CopilotRuntime({
      intelligence: this.intelligence,
      telemetryId: this.setupTelemetry.identity,
      telemetryProperties: this.setupTelemetry.metadata,
      identifyUser: async () => ({
        id: workspace.ownerId,
        name: 'Aegis owner',
      }),
      agents: async () =>
        Object.fromEntries(
          workspace
            .dots()
            .map((dot) => [
              dot.id,
              new DotAgent(
                store,
                workspace,
                config,
                dot.id,
                false,
                this.setupTelemetry,
                this.computers,
              ),
            ]),
        ),
      channels,
      generateThreadNames: true,
    });
    this.handler = createCopilotHonoHandler({
      runtime,
      basePath: '/api/copilotkit',
      cors: { origin: [] },
    });
  }
  setup() {
    const status = setupStatus(
      this.config,
      this.handler?.channels?.status().overall ??
        (this.config.slackChannel ? 'setup_required' : 'not_configured'),
      this.channelStartupFailed,
    );
    if (this.aegisMemory)
      status.aegisMemory = {
        reachable: this.aegisMemory.reachable,
        tier: this.aegisMemory.tier,
        provider: this.aegisMemory.provider,
        provenanceStrict: this.aegisMemory.provenanceStrict,
      };
    if (this.aegisSidecar) status.aegisComputer = this.aegisSidecar;
    return status;
  }
  /**
   * Local mode: a registry provider is configured and no Intelligence
   * account is present. Threads and messages stay in the local SQLite
   * stores and the runtime serves agents over SSE in-process.
   */
  get localMode(): boolean {
    return (
      !this.config.intelligenceKey &&
      !!this.config.providerId &&
      !!this.config.apiKey &&
      !!this.config.model
    );
  }
  private startLocalRuntime() {
    const runtime = new CopilotRuntime({
      telemetryId: this.setupTelemetry.identity,
      telemetryProperties: this.setupTelemetry.metadata,
      agents: async () =>
        Object.fromEntries(
          this.workspace
            .dots()
            .map((dot) => [
              dot.id,
              new DotAgent(
                this.store,
                this.workspace,
                this.config,
                dot.id,
                false,
                this.setupTelemetry,
                this.computers,
              ),
            ]),
        ),
    });
    this.handler = createCopilotHonoHandler({
      runtime,
      basePath: '/api/copilotkit',
      cors: { origin: [] },
    });
  }
  /**
   * Applies a Settings provider selection to the live config object. The
   * runtime's agent factory and DotAgent read this same object on every
   * turn, so the next turn uses the new provider/model without a restart.
   * The selection is also persisted via Store settings for the next boot.
   */
  applyProviderSelection(providerId: string, model?: string) {
    // Providers come from the hard-coded registry (the six favourites) or
    // from the models.dev catalogue. The model is NOT checked against a
    // hard-coded list: those lists rot as providers rename/decommission
    // models, and the Settings picker is fed by each provider's live
    // /models list. Provider existence + a non-empty model is the check.
    const registry = PROVIDERS[providerId];
    const external = registry ? undefined : findCatalogueProvider(providerId);
    if (!registry && !external) throw new Error('Unknown provider.');
    const chosenModel =
      model?.trim() || registry?.defaultModel || external?.defaultModel;
    if (!chosenModel)
      throw new Error('Choose a model offered by this provider.');
    // Selecting a provider without its key used to leave the Agent
    // unusable: the saved selection pointed at a provider with no
    // credentials, so every conversation showed "Connect your Agent" until
    // the key was added. Keep the working provider instead and say which
    // variable is missing (the UI can retry after the owner adds it).
    const keyEnv = registry?.keyEnv ?? external?.keyEnv;
    const apiKey = keyEnv ? process.env[keyEnv]?.trim() : undefined;
    if (!apiKey)
      throw new Error(
        `Add ${keyEnv ?? 'an API key'} before selecting ${registry?.label ?? external?.label ?? providerId}. The current provider is unchanged.`,
      );
    this.config.providerId = providerId;
    this.config.model = chosenModel;
    this.config.providerApiType = registry
      ? registry.apiType
      : external?.apiType;
    this.config.providerKeyEnv = keyEnv;
    this.config.providerLabel = registry ? registry.label : external?.label;
    this.config.baseUrl = registry
      ? process.env[registry.baseUrlEnv]?.trim() || registry.baseUrl
      : (external?.baseUrl as string);
    this.config.apiKey = apiKey;
    this.store.updateSettings({ providerId, providerModel: chosenModel });
    if (!this.intelligence && !this.handler && this.localMode)
      this.startLocalRuntime();
    return this.setup();
  }
  requireReady() {
    const missing = this.setup().missing;
    if (missing.length)
      throw new Error(
        `Setup required: ${missing.join(', ')}. Conversations require CopilotKit Intelligence.`,
      );
  }
  async start() {
    this.setupTelemetry.start();
    // Aegis union links (fail-soft, fire-and-forget): probe the daemon
    // memory layer and the optional Aegis computer sidecar, and
    // register the daemon as an MCP Connection if it ever serves
    // Streamable HTTP MCP (a no-op until then   see aegis-daemon.ts).
    void (async () => {
      try {
        this.aegisMemory = await getAegisMemoryState();
        this.aegisSidecar = await probeAegisComputerSidecar(
          this.config.aegisComputerUrl,
        );
        const dotId = this.workspace.dots()[0]?.id;
        if (dotId) await ensureAegisMemoryConnection(this.connections, dotId);
      } catch {
        // Links are optional; a failure here must never block boot.
      }
    })();
    if (this.handler?.channels) {
      try {
        await this.handler.channels.ready({ timeoutMs: 15000 });
        this.channelStartupFailed = false;
      } catch (error) {
        this.channelStartupFailed = true;
        this.setupTelemetry.capture({
          kind: 'setup_failed',
          step: 'settings',
          error_class: 'channel_start_failed',
        });
        throw error;
      }
    }
  }
  async stop() {
    await this.setupTelemetry.stop();
    await this.handler?.channels?.stop();
  }
  async createConversation(dotId: string, title: string) {
    this.requireReady();
    if (!this.workspace.dot(dotId)) throw new Error('Agent not found.');
    const id = randomUUID();
    if (this.intelligence) {
      try {
        await this.intelligence.createThread({
          threadId: id,
          userId: this.workspace.ownerId,
          agentId: dotId,
          name: title,
        });
      } catch {
        throw new Error(
          'Intelligence could not create this conversation. Check the runtime key and connection.',
        );
      }
    }
    // Local mode: the workspace thread binding is the whole thread record.
    return this.workspace.bindThread(id, dotId, title);
  }
  async history(threadId: string): Promise<string> {
    this.requireReady();
    this.workspace.requireThread(threadId);
    if (!this.intelligence)
      return this.workspace
        .threadMessages(threadId)
        .slice(-12)
        .map((message) => `${message.role}: ${message.content}`)
        .join('\n')
        .slice(-12000);
    const history = await this.intelligence.getThreadMessages({
      threadId,
      userId: this.workspace.ownerId,
    });
    return history.messages
      .filter((message) => ['user', 'assistant'].includes(message.role))
      .slice(-12)
      .map(
        (message) =>
          `${message.role}: ${typeof message.content === 'string' ? message.content : ''}`,
      )
      .join('\n')
      .slice(-12000);
  }
  async handle(request: Request): Promise<Response> {
    if (!this.handler)
      return Response.json(
        { error: `Setup required: ${INTELLIGENCE_KEY_MISSING_LABEL}.` },
        { status: 503 },
      );
    let body: unknown;
    if (request.method !== 'GET' && request.method !== 'HEAD')
      body = await request
        .clone()
        .json()
        .catch(() => null);
    try {
      validateRuntimeScope(request, this.workspace, body);
    } catch (error) {
      return Response.json(
        {
          error:
            error instanceof Error
              ? error.message
              : 'Conversation scope denied.',
        },
        { status: 403 },
      );
    }
    return this.handler.fetch(request);
  }
  async turn(
    threadId: string,
    prompt: string,
    signal: AbortSignal,
    metadata?: Record<string, unknown>,
  ): Promise<string> {
    this.requireReady();
    const thread = this.workspace.requireThread(threadId);
    if (!this.intelligence) return this.localTurn(thread, prompt, signal);
    return runThreadTurn(
      this.config.runtimeUrl,
      this.config.ownerToken
        ? { Authorization: `Bearer ${this.config.ownerToken}` }
        : {},
      thread.dotId,
      threadId,
      prompt,
      signal,
      metadata,
    );
  }
  /**
   * Headless turn without Intelligence: run the DotAgent in-process with
   * the locally stored history, then append the exchange to the local
   * thread store. Used by scheduled tasks and voice compute in local mode.
   */
  private async localTurn(
    thread: ReturnType<WorkspaceStore['requireThread']>,
    prompt: string,
    signal: AbortSignal,
  ): Promise<string> {
    const agent = new DotAgent(
      this.store,
      this.workspace,
      this.config,
      thread.dotId,
      false,
      this.setupTelemetry,
      this.computers,
    );
    const history = this.workspace.threadMessages(thread.id).map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
    }));
    const stop = () => agent.abortRun();
    signal.addEventListener('abort', stop, { once: true });
    try {
      signal.throwIfAborted();
      const events = await lastValueFrom(
        agent
          .run({
            threadId: thread.id,
            runId: randomUUID(),
            state: {},
            tools: [],
            context: [],
            messages: [
              ...history,
              { id: randomUUID(), role: 'user' as const, content: prompt },
            ],
            forwardedProps: {},
          })
          .pipe(toArray()),
      );
      signal.throwIfAborted();
      let text = '';
      for (const event of events) {
        if (event.type === EventType.RUN_ERROR)
          throw new Error(
            'message' in event && typeof event.message === 'string'
              ? event.message
              : 'Agent could not complete this turn.',
          );
        if (
          (event.type === EventType.TEXT_MESSAGE_CHUNK ||
            event.type === EventType.TEXT_MESSAGE_CONTENT) &&
          'delta' in event &&
          typeof event.delta === 'string'
        )
          text += event.delta;
      }
      if (!text.trim())
        throw new Error(
          'The current compute turn returned no assistant response.',
        );
      // DotAgent persists the user message and the assistant reply as it
      // runs; appending here as well duplicated every scheduled/voice turn.
      return text;
    } finally {
      signal.removeEventListener('abort', stop);
    }
  }
}
