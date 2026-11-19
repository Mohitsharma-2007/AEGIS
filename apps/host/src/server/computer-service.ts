import { createHmac, randomUUID } from 'node:crypto';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import {
  mkdir,
  readdir,
  readFile,
  stat,
  writeFile,
  appendFile,
} from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type { BrowserContext, Page } from 'playwright';
import { z } from 'zod';
import {
  computerInputs,
  computerPermissionsSchema,
  type ComputerAction,
  type ComputerControl,
  type ComputerStatus,
} from '../shared/computer-types.js';
import type { WorkspaceStore } from './workspace.js';
import type { PlatformConfig } from './platform-config.js';
import { probeAegisComputerSidecar } from './integrations/aegis-computer-sidecar.js';
import { launchPersistentWithFallback } from './browser-launch.js';
import { runAgentDesktop } from './agent-desktop.js';
import { log } from './log.js';

// AEGIS (W-COMP) local computer mode: when PlatformConfig.computerMode is
// 'local' (the product default   see computerModeFromEnv in
// platform-config.ts), a "computer" is NOT a Docker container. It is a
// local process on the host: a Playwright Chromium launched with a
// persistent profile directory, plus a per-Agent workspace directory for
// files/shell, both under computerLocalRoot (default
// <cwd>/data/aegis-computers/<dotId>/). The action surface and result
// shapes mirror the upstream OpenBot computer service (navigate/read/
// snapshot/screenshot return the same fields; files return
// {path, entries|text, truncated, bytes}; exec returns
// {stdout, stderr, exitCode}). HONEST LIMIT: local mode has NO sandbox
// isolation   shell commands run as the host user, confined only by
// their working directory and the file tools' path checks   and the
// status payload says so (computerMode:'local', isolated:false).
// Actions that only exist on the full desktop container (none of the
// current surface: every action maps to the browser, the workspace, or
// the shell) would return an error here rather than a stub success.
const LOCAL_VIEWPORT = { width: 1200, height: 800 };
const SNAPSHOT_SELECTOR =
  'a[href], button, input, textarea, select, [role="button"], [role="link"], [role="textbox"], [role="checkbox"], [contenteditable="true"]';
const execAsync = promisify(exec);
interface LocalComputerSession {
  context: BrowserContext;
  page: Page;
  workspaceDir: string;
  snapshotId: number;
  control: ComputerControl;
  /** W-FIX 1a: label of the browser binary that launched this session
   * (bundled Chromium or a system Edge/Chrome fallback). */
  browserBinary: string;
}
const stateSchema = z.object({
  botId: z.string(),
  container: z.string(),
  status: z.string(),
  port: z.number().int().min(1024).max(65535).optional(),
  url: z.string().optional(),
});
const controlSchema = z.object({
  holder: z.enum(['bot', 'human']),
  requested: z.boolean(),
  transitioning: z.boolean(),
  resumeSnapshotRequired: z.boolean(),
  request: z.object({ id: z.string(), status: z.string() }).optional(),
});
export class ComputerService {
  constructor(
    private workspace: WorkspaceStore,
    private config: PlatformConfig,
    private paused: () => boolean,
    private transport: typeof fetch = fetch,
    private deadlineMs = 70000,
  ) {
    this.localSessions = new Map();
    this.sessionStartTimes = new Map();
    // Reap stale sessions every 5 minutes to prevent orphaned browser
    // processes after a host crash or owner abandonment.
    this.reapStaleSessions();
    const reaper = setInterval(() => this.reapStaleSessions(), 5 * 60 * 1000);
    reaper.unref?.();
  }
  private localSessions = new Map<string, LocalComputerSession>();
  private sessionStartTimes = new Map<string, number>();
  /** Sessions idle for more than 30 minutes are reaped to prevent orphaned
   *  browser processes after a host crash or owner abandonment. */
  private static readonly SESSION_TTL_MS = 30 * 60 * 1000;
  /** Provisioning mode. Configs built without the field (upstream-style
   * manual configs, older tests) keep the upstream Docker behaviour; the
   * product's own config builder always sets it via
   * computerModeFromEnv(), whose default is 'local'. */
  get mode(): 'local' | 'docker' {
    return this.config.computerMode ?? 'docker';
  }
  get configured() {
    if (this.mode === 'local') return true;
    return !!(
      this.config.computerSupervisorUrl?.trim() &&
      this.config.computerSupervisorToken?.trim() &&
      this.config.computerToken?.trim()
    );
  }
  private localRoot() {
    return this.config.computerLocalRoot?.trim()
      ? resolve(this.config.computerLocalRoot.trim())
      : join(process.cwd(), 'data', 'aegis-computers');
  }
  private localWorkspaceDir(id: string) {
    return join(this.localRoot(), id, 'workspace');
  }
  /** Status fields describing the mode honestly, incl. the sidecar slot. */
  private async modeFields(): Promise<
    Pick<
      ComputerStatus,
      'computerMode' | 'isolated' | 'engine' | 'aegisSidecar'
    >
  > {
    const sidecar = await probeAegisComputerSidecar(
      this.config.aegisComputerUrl,
      fetch,
      1000,
    );
    return {
      computerMode: this.mode,
      // Local mode isolates browser state in a Playwright context, but the
      // workspace shell runs as the host user and is not an OS sandbox.
      isolated: false,
      engine: this.mode === 'local' ? 'playwright' : 'docker-container',
      aegisSidecar: {
        label: 'AEGIS Computer (openmuse engine)',
        configured: sidecar.configured,
        available: sidecar.available,
        detail: sidecar.detail,
      },
    };
  }
  private token(id: string) {
    return createHmac('sha256', this.config.computerToken!.trim())
      .update(`aegis-computer:${id}`)
      .digest('hex');
  }
  private requireDot(id: string) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(id) || !this.workspace.dot(id))
      throw new Error('Agent not found.');
  }
  private allowed(
    id: string,
    kind: 'browser' | 'files' | 'shell' | undefined,
    actor: 'agent' | 'owner',
  ) {
    this.requireDot(id);
    if (!this.configured)
      throw new Error('Computer service is not configured.');
    const policy = this.workspace.computers.permissions(id);
    if (!policy.enabled || (kind && !policy[kind]))
      throw new Error('Computer permission is disabled.');
    if (actor === 'agent' && this.paused())
      throw new Error('Agents are paused.');
  }
  private async json(
    url: string,
    token: string,
    body: unknown | undefined,
    signal?: AbortSignal,
    dotId?: string,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.deadlineMs);
    const combined = signal
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal;
    try {
      const response = await this.transport(url, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          ...(dotId ? { 'x-openbot-bot-id': dotId } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'error',
        signal: combined,
      });
      if (response.status === 409)
        throw new Error(
          'Computer service returned HTTP 409: refresh the browser with computer_snapshot before retrying. If the owner has control, wait for them to release it; do not bypass takeover.',
        );
      if (!response.ok)
        throw new Error(`Computer service returned HTTP ${response.status}.`);
      if (!response.body)
        throw new Error('Computer service returned an empty response.');
      const reader = response.body.getReader();
      let size = 0;
      const chunks: Uint8Array[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 4_000_000) {
          await reader.cancel();
          throw new Error('Computer response exceeded its size limit.');
        }
        chunks.push(value);
      }
      // Infrastructure secrets must never leave the gateway even if an upstream response reflects one.
      let text = Buffer.concat(chunks).toString('utf8');
      for (const secret of [
        token,
        this.config.computerToken?.trim(),
        this.config.computerSupervisorToken?.trim(),
      ])
        if (secret) text = text.split(secret).join('[redacted]');
      return JSON.parse(text);
    } catch (error) {
      if (combined.aborted)
        throw new Error('Computer request was cancelled or timed out.', {
          cause: error,
        });
      if (
        error instanceof Error &&
        /^Computer (service returned|response exceeded)/.test(error.message)
      )
        throw error;
      throw new Error(
        'Computer service is unavailable or returned an invalid response.',
        { cause: error },
      );
    } finally {
      clearTimeout(timeout);
    }
  }
  private supervisor(path: string, body?: unknown, signal?: AbortSignal) {
    return this.json(
      `${this.config.computerSupervisorUrl!.replace(/\/$/, '')}${path}`,
      this.config.computerSupervisorToken!.trim(),
      body,
      signal,
    );
  }
  private parseUpstream<T>(schema: z.ZodType<T>, raw: unknown): T {
    const result = schema.safeParse(raw);
    if (!result.success)
      throw new Error('Computer service returned an invalid response.', {
        cause: result.error,
      });
    return result.data;
  }
  private endpoint(id: string, raw: unknown) {
    const state = this.parseUpstream(stateSchema, raw);
    const ns = this.config.computerNamespace ?? 'aegis';
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(ns))
      throw new Error('Invalid computer namespace.');
    const expected = `${ns}-computer-${id}`;
    if (state.botId !== id || state.container !== expected)
      throw new Error('Computer identity mismatch.');
    const url = new URL(
      state.url ??
        (state.port
          ? `http://127.0.0.1:${state.port}`
          : `http://${expected}:4100`),
    );
    const network =
      url.hostname === expected.toLowerCase() && url.port === '4100';
    const local =
      url.hostname === '127.0.0.1' &&
      !!state.port &&
      url.port === String(state.port) &&
      new URL(this.config.computerSupervisorUrl!).hostname === '127.0.0.1';
    if (
      url.protocol !== 'http:' ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      (!network && !local)
    )
      throw new Error('Computer endpoint is not bound to this Agent.');
    return url.origin;
  }
  private async existing(id: string, signal?: AbortSignal) {
    const listing = this.parseUpstream(
      z.object({ computers: z.array(stateSchema) }),
      await this.supervisor('/computers', undefined, signal),
    );
    return listing.computers.find((c) => c.botId === id);
  }
  private async running(id: string, signal?: AbortSignal) {
    const state = await this.existing(id, signal);
    if (!state || state.status !== 'running')
      throw new Error('Start this Agent s computer first.');
    return this.endpoint(id, state);
  }
  async status(id: string): Promise<ComputerStatus> {
    this.requireDot(id);
    const base = {
      configured: this.configured,
      permissions: this.workspace.computers.permissions(id),
      audit: this.workspace.computers.audit(id),
      ...(await this.modeFields()),
    };
    if (this.mode === 'local') {
      const session = this.localSessions.get(id);
      if (!session) return { ...base, state: 'stopped' };
      return {
        ...base,
        state: 'running',
        control: session.control,
        browserBinary: session.browserBinary,
      };
    }
    if (!this.configured) return { ...base, state: 'not_configured' };
    try {
      const state = await this.existing(id);
      if (!state || state.status !== 'running')
        return { ...base, state: 'stopped' };
      const url = this.endpoint(id, state);
      const control = controlSchema.parse(
        await this.json(
          `${url}/control`,
          this.token(id),
          undefined,
          undefined,
          id,
        ),
      );
      return { ...base, state: 'running', control };
    } catch {
      return {
        ...base,
        state: 'unavailable',
        error:
          'Computer service is unavailable. Check the supervisor configuration and connection.',
      };
    }
  }
  private async audited<T>(
    id: string,
    action: string,
    actor: 'owner' | 'agent',
    fn: () => Promise<T>,
  ): Promise<T> {
    this.requireDot(id);
    const receipt = this.workspace.computers.begin(id, action, actor);
    try {
      const result = await fn();
      this.workspace.computers.finish(receipt, 'succeeded');
      return result;
    } catch (error) {
      this.workspace.computers.finish(receipt, 'failed');
      throw error;
    }
  }
  async permissions(id: string, input: unknown) {
    const patch = computerPermissionsSchema.partial().parse(input);
    await this.audited(id, 'permissions', 'owner', async () =>
      this.workspace.computers.patch(id, patch),
    );
    return this.status(id);
  }
  async start(id: string) {
    await this.audited(id, 'start', 'owner', async () => {
      this.allowed(id, undefined, 'owner');
      if (this.mode === 'local') {
        await this.localStart(id);
        return;
      }
      this.endpoint(id, await this.supervisor(`/computers/${id}/ensure`, {}));
    });
    return this.status(id);
  }
  async stop(id: string) {
    await this.audited(id, 'stop', 'owner', async () => {
      if (!this.configured)
        throw new Error('Computer service is not configured.');
      if (this.mode === 'local') {
        await this.localStop(id);
        return;
      }
      await this.supervisor(`/computers/${id}/stop`, {});
    });
    return this.status(id);
  }
  /** Launch (or reuse) the local Chromium + workspace for this Agent. */
  private async localStart(id: string): Promise<LocalComputerSession> {
    const existing = this.localSessions.get(id);
    if (existing) return existing;
    const workspaceDir = this.localWorkspaceDir(id);
    await mkdir(workspaceDir, { recursive: true });
    const profileDir = join(this.localRoot(), id, 'profile');
    await mkdir(profileDir, { recursive: true });
    const options = {
      headless: true,
      args: ['--disable-dev-shm-usage'],
      viewport: LOCAL_VIEWPORT,
    };
    // W-FIX 1a: walk the launch ladder (bundled Chromium -> full build
    // -> system Edge -> system Chrome -> system executable paths) so a
    // machine whose Playwright binaries were never installed still gets
    // a working browser, labelled with the binary that served it.
    const { context, binary } = await launchPersistentWithFallback(
      profileDir,
      options,
    );
    const page = context.pages()[0] ?? (await context.newPage());
    const session: LocalComputerSession = {
      context,
      page,
      workspaceDir,
      browserBinary: binary,
      snapshotId: 0,
      control: {
        holder: 'bot',
        requested: false,
        transitioning: false,
        resumeSnapshotRequired: false,
      },
    };
    this.localSessions.set(id, session);
    this.sessionStartTimes.set(id, Date.now());
    context.on('close', () => {
      if (this.localSessions.get(id) === session) {
        this.localSessions.delete(id);
        this.sessionStartTimes.delete(id);
      }
    });
    return session;
  }
  private async localStop(id: string) {
    const session = this.localSessions.get(id);
    this.localSessions.delete(id);
    this.sessionStartTimes.delete(id);
    await session?.context.close().catch(() => {});
  }
  private localSession(id: string): LocalComputerSession {
    const session = this.localSessions.get(id);
    if (!session) throw new Error('Start this Agent s computer first.');
    return session;
  }

  /** Reap sessions that have been idle longer than SESSION_TTL_MS. Called
   *  periodically and on startup to prevent orphaned browser processes. */
  private reapStaleSessions(): void {
    const now = Date.now();
    const stale: string[] = [];
    for (const [id, startedAt] of this.sessionStartTimes.entries()) {
      if (now - startedAt > ComputerService.SESSION_TTL_MS) stale.push(id);
    }
    for (const id of stale) {
      log.warn('Computer service reaping stale session', { id });
      void this.localStop(id).catch(() => {});
    }
  }
  async control(id: string, verb: 'take' | 'release') {
    await this.audited(id, verb, 'owner', async () => {
      if (!this.configured)
        throw new Error('Computer service is not configured.');
      if (this.mode === 'local') {
        if (verb === 'take') {
          this.allowed(id, 'browser', 'owner');
          const session = this.localSession(id);
          session.control = {
            holder: 'human',
            requested: true,
            transitioning: false,
            resumeSnapshotRequired: false,
            request: session.control.request ?? {
              id: randomUUID(),
              status: 'taken',
            },
          };
        } else {
          // Handback must stay possible after permissions are revoked
          // (same rule as the Docker path below).
          const session = this.localSessions.get(id);
          if (session)
            session.control = {
              holder: 'bot',
              requested: false,
              transitioning: false,
              resumeSnapshotRequired: true,
              ...(session.control.request
                ? {
                    request: {
                      ...session.control.request,
                      status: 'released',
                    },
                  }
                : {}),
            };
        }
        return;
      }
      if (verb === 'take') this.allowed(id, 'browser', 'owner');
      const url = await this.running(id);
      if (verb === 'take') this.allowed(id, 'browser', 'owner');
      let control: ComputerControl = this.parseUpstream(
        controlSchema,
        await this.json(
          `${url}/control`,
          this.token(id),
          undefined,
          undefined,
          id,
        ),
      );
      if (verb === 'take' && !control.request)
        control = this.parseUpstream(
          controlSchema,
          await this.json(
            `${url}/control/request`,
            this.token(id),
            { reason: 'Owner requested control.' },
            undefined,
            id,
          ),
        );
      if (
        verb === 'take' &&
        control.request &&
        !['waiting', 'taken'].includes(control.request.status)
      )
        control = this.parseUpstream(
          controlSchema,
          await this.json(
            `${url}/control/request`,
            this.token(id),
            { reason: 'Owner requested control.' },
            undefined,
            id,
          ),
        );
      if (!control.request)
        throw new Error('There is no active control request.');
      await this.json(
        `${url}/control/${verb}`,
        this.token(id),
        { requestId: control.request.id },
        undefined,
        id,
      );
    });
    return this.status(id);
  }
  async action(
    id: string,
    action: ComputerAction,
    input: unknown,
    actor: 'owner' | 'agent' = 'owner',
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (!Object.hasOwn(computerInputs, action))
      throw new Error('Unknown computer action.');
    const parsed = computerInputs[action].parse(input);
    const dispatch = async () => {
      if (actor === 'agent' && action.startsWith('human_'))
        throw new Error('Human controls are owner-only.');
      if (actor === 'agent' && action === 'exec' && this.mode === 'local')
        throw new Error('Shell execution is disabled for agents in local mode because it is not OS-isolated. Use the Docker computer mode for sandboxed shell work.');
      const kind =
        action === 'exec' ||
        action === 'open_app' ||
        action.startsWith('window_')
          ? 'shell'
          : action.startsWith('files_')
            ? 'files'
            : 'browser';
      this.allowed(id, kind, actor);
      if (this.mode === 'local') {
        const result = await this.localAction(id, action, parsed, actor, signal);
        this.allowed(id, kind, actor);
        return result;
      }
      const cancellation = new AbortController();
      const activeSignal = signal
        ? AbortSignal.any([signal, cancellation.signal])
        : cancellation.signal;
      const watcher = setInterval(() => {
        try {
          this.allowed(id, kind, actor);
        } catch {
          cancellation.abort();
        }
      }, 50);
      try {
        const url = await this.running(id, activeSignal);
        this.allowed(id, kind, actor);
        activeSignal.throwIfAborted();
        const path = action
          .replace(/^files_/, 'files/')
          .replace(/^human_/, 'human/');
        const result = await this.json(
          `${url}/${path}`,
          this.token(id),
          ['read', 'screenshot'].includes(action) ? undefined : parsed,
          activeSignal,
          id,
        );
        this.allowed(id, kind, actor);
        if (action === 'exec' && result && typeof result === 'object') {
          const copy = { ...result } as Record<string, unknown>;
          delete copy.command;
          return copy;
        }
        return result;
      } finally {
        clearInterval(watcher);
      }
    };
    // The Computer panel refreshes the screen every few seconds. Recording each
    // refresh would push the Dot's own actions out of the activity log, so an
    // owner's screenshot is recorded only when it fails.
    if (actor === 'owner' && action === 'screenshot') {
      this.requireDot(id);
      try {
        return await dispatch();
      } catch (error) {
        this.workspace.computers.finish(
          this.workspace.computers.begin(id, action, actor),
          'failed',
        );
        throw error;
      }
    }
    return this.audited(id, action, actor, dispatch);
  }

  // ---- Local mode implementation (see the header comment) ----
  /** Resolve a workspace-relative path, refusing anything outside it. */
  private localPath(session: LocalComputerSession, rel: string) {
    const full = resolve(session.workspaceDir, rel || '.');
    if (
      full !== session.workspaceDir &&
      !full.startsWith(session.workspaceDir + sep)
    )
      throw new Error('Use a relative workspace path without traversal.');
    return full;
  }
  private async localRef(
    session: LocalComputerSession,
    input: { ref: string; snapshotId: number },
  ) {
    if (input.snapshotId !== session.snapshotId)
      throw new Error(
        'Snapshot is stale: refresh the browser with computer_snapshot before retrying.',
      );
    const match = /^e(\d+)$/.exec(input.ref);
    const index = match ? Number(match[1]) - 1 : -1;
    const locator = session.page.locator(SNAPSHOT_SELECTOR).nth(index);
    if (index < 0 || (await locator.count()) === 0)
      throw new Error(
        `Nothing on this page has the ref ${input.ref}. Take a new snapshot and use the refs it returns.`,
      );
    return locator;
  }
  private async localAction(
    id: string,
    action: ComputerAction,
    parsed: unknown,
    actor: 'owner' | 'agent',
    signal?: AbortSignal,
  ): Promise<unknown> {
    const session = this.localSession(id);
    const page = session.page;
    switch (action) {
      case 'navigate': {
        const { url } = parsed as { url: string };
        const response = await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: 25_000,
        });
        if (response && response.status() >= 400)
          throw new Error(`Source returned HTTP ${response.status()}.`);
        session.snapshotId += 1;
        const text = (
          await page.locator('body').innerText({ timeout: 5000 })
        ).slice(0, 30_000);
        return {
          url: page.url(),
          title: await page.title(),
          text,
          truncated: text.length >= 30_000,
        };
      }
      case 'browser_back': {
        await page.goBack().catch(() => null);
        session.snapshotId += 1;
        return {
          url: page.url(),
          title: await page.title(),
        };
      }
      case 'browser_forward': {
        await page.goForward().catch(() => null);
        session.snapshotId += 1;
        return {
          url: page.url(),
          title: await page.title(),
        };
      }
      case 'browser_reload': {
        await page.reload().catch(() => null);
        session.snapshotId += 1;
        return {
          url: page.url(),
          title: await page.title(),
        };
      }
      case 'read': {
        const text = (
          await page.locator('body').innerText({ timeout: 5000 })
        ).slice(0, 30_000);
        return {
          url: page.url(),
          title: await page.title(),
          text,
          truncated: text.length >= 30_000,
        };
      }
      case 'snapshot': {
        const elements = await page.evaluate((selector) => {
          const roleFor = (el: Element): string => {
            const role = el.getAttribute('role');
            if (role) return role;
            switch (el.tagName) {
              case 'A':
                return 'link';
              case 'BUTTON':
                return 'button';
              case 'TEXTAREA':
                return 'textbox';
              case 'SELECT':
                return 'combobox';
              case 'INPUT': {
                const type = (el as HTMLInputElement).type;
                return type === 'checkbox'
                  ? 'checkbox'
                  : type === 'submit' || type === 'button'
                    ? 'button'
                    : 'textbox';
              }
              default:
                return 'generic';
            }
          };
          const found: {
            ref: string;
            role: string;
            name: string;
            value?: string;
          }[] = [];
          document.querySelectorAll(selector).forEach((el, index) => {
            const rect = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            if (
              rect.width === 0 ||
              rect.height === 0 ||
              style.visibility === 'hidden' ||
              style.display === 'none'
            )
              return;
            const html = el as HTMLElement;
            const name = (
              el.getAttribute('aria-label') ||
              html.innerText ||
              (el as HTMLInputElement).value ||
              el.getAttribute('placeholder') ||
              el.getAttribute('name') ||
              ''
            )
              .trim()
              .replace(/\s+/g, ' ')
              .slice(0, 120);
            const value =
              el instanceof HTMLInputElement ||
              el instanceof HTMLTextAreaElement ||
              el instanceof HTMLSelectElement
                ? el.value.slice(0, 120)
                : undefined;
            found.push({
              ref: `e${index + 1}`,
              role: roleFor(el),
              name,
              ...(value ? { value } : {}),
            });
          });
          return found;
        }, SNAPSHOT_SELECTOR);
        session.snapshotId += 1;
        return {
          snapshotId: session.snapshotId,
          url: page.url(),
          title: await page.title(),
          elements,
          truncated: false,
        };
      }
      case 'screenshot': {
        // JPEG keeps the payload small so the capture is fast to move and
        // cheap for the model to look at.
        const buffer = await page.screenshot({ type: 'jpeg', quality: 75 });
        const size = page.viewportSize() ?? LOCAL_VIEWPORT;
        return {
          base64: buffer.toString('base64'),
          width: size.width,
          height: size.height,
          url: page.url(),
          capturedAt: new Date().toISOString(),
          format: 'image/jpeg',
        };
      }
      case 'click': {
        const locator = await this.localRef(
          session,
          parsed as { ref: string; snapshotId: number },
        );
        await locator.click({ timeout: 5000 });
        return { ok: true, url: page.url() };
      }
      case 'type': {
        const typed = parsed as {
          ref: string;
          snapshotId: number;
          text: string;
          submit?: boolean;
        };
        const locator = await this.localRef(session, typed);
        const tag = await locator.evaluate((el) => el.tagName);
        if (tag === 'SELECT') {
          await locator.selectOption({ label: typed.text }).catch(async () => {
            await locator.selectOption(typed.text);
          });
        } else if (tag === 'INPUT' || tag === 'TEXTAREA') {
          await locator.fill(typed.text);
        } else {
          await locator.click({ timeout: 5000 });
          await page.keyboard.type(typed.text);
        }
        if (typed.submit) await page.keyboard.press('Enter');
        return { ok: true, url: page.url() };
      }
      case 'key': {
        await page.keyboard.press((parsed as { key: string }).key);
        return { ok: true, url: page.url() };
      }
      case 'scroll': {
        const { deltaY } = parsed as { deltaY: number };
        await page.evaluate((dy) => window.scrollBy(0, dy), deltaY);
        return { ok: true, url: page.url() };
      }
      case 'human_click': {
        if (actor === 'agent')
          throw new Error('Human controls are owner-only.');
        const { x, y } = parsed as { x: number; y: number };
        await page.mouse.click(x, y);
        return { ok: true, url: page.url() };
      }
      case 'human_type': {
        if (actor === 'agent')
          throw new Error('Human controls are owner-only.');
        await page.keyboard.type((parsed as { text: string }).text);
        return { ok: true, url: page.url() };
      }
      case 'human_key': {
        if (actor === 'agent')
          throw new Error('Human controls are owner-only.');
        await page.keyboard.press((parsed as { key: string }).key);
        return { ok: true, url: page.url() };
      }
      case 'human_scroll': {
        if (actor === 'agent')
          throw new Error('Human controls are owner-only.');
        const { deltaY } = parsed as { deltaY: number };
        await page.mouse.wheel(0, deltaY);
        return { ok: true, url: page.url() };
      }
      case 'files_list': {
        const { path: rel } = parsed as { path: string };
        const start = this.localPath(session, rel);
        const info = await stat(start).catch(() => null);
        if (!info) throw new Error(`There is no folder at ${rel || '.'}.`);
        if (!info.isDirectory())
          throw new Error(`${rel} is a file, not a folder.`);
        const entries: { path: string; kind: string; bytes?: number }[] = [];
        let truncated = false;
        const walk = async (dir: string): Promise<void> => {
          if (truncated) return;
          for (const item of await readdir(dir, { withFileTypes: true })) {
            if (entries.length >= 200) {
              truncated = true;
              return;
            }
            const full = join(dir, item.name);
            const shown = full.slice(session.workspaceDir.length + 1).replace(/\\/g, '/');
            if (item.isDirectory()) {
              entries.push({ path: shown, kind: 'folder' });
              await walk(full);
            } else if (item.isFile()) {
              const size = await stat(full).catch(() => null);
              entries.push({
                path: shown,
                kind: 'file',
                ...(size ? { bytes: size.size } : {}),
              });
            }
          }
        };
        await walk(start);
        return { path: rel, entries, truncated };
      }
      case 'files_read': {
        const { path: rel } = parsed as { path: string };
        const full = this.localPath(session, rel);
        const info = await stat(full).catch(() => null);
        if (!info) throw new Error(`There is no file at ${rel}.`);
        if (info.isDirectory())
          throw new Error(`${rel} is a directory, not a file.`);
        const buffer = await readFile(full);
        const slice = buffer.subarray(0, 200_000);
        return {
          path: rel,
          text: slice.toString('utf8'),
          truncated: buffer.byteLength > slice.byteLength,
          bytes: buffer.byteLength,
        };
      }
      case 'files_write': {
        const written = parsed as {
          path: string;
          contents: string;
          append?: boolean;
        };
        const full = this.localPath(session, written.path);
        await mkdir(dirname(full), { recursive: true });
        if (written.append) await appendFile(full, written.contents, 'utf8');
        else await writeFile(full, written.contents, 'utf8');
        return {
          path: written.path,
          bytes: Buffer.byteLength(written.contents),
        };
      }
      case 'exec': {
        const command = parsed as { command: string; timeoutMs: number };
        
        // Command whitelist — only safe, read-only commands allowed
        const ALLOWED_COMMANDS = [
          'cd', 'dir', 'echo', 'type', 'find', 'findstr', 'where', 'ver',
          'hostname', 'whoami', 'date', 'time', 'set', 'path', 'vol',
          'tree', 'fc', 'comp', 'sort', 'more', 'clip',
        ];
        
        const rawCmd = command.command.trim();
        
        // Extract the base command (first word before any space or pipe)
        const baseCmd = rawCmd.split(/\s+|[|&;]/)[0].toLowerCase();
        
        // Remove .exe suffix for comparison
        const baseCmdNoExt = baseCmd.replace(/\.exe$/i, '');
        
        if (!ALLOWED_COMMANDS.includes(baseCmdNoExt)) {
          throw new Error(
            `Command "${baseCmd}" is not in the allowed list. ` +
            `Allowed: ${ALLOWED_COMMANDS.join(', ')}. ` +
            'Use explicit approval for arbitrary commands.'
          );
        }
        
        // Block dangerous shell metacharacters
        const DANGEROUS_CHARS = /[|&;<>$`(){}[\]\\]/;
        if (DANGEROUS_CHARS.test(rawCmd)) {
          throw new Error(
            `Command contains dangerous characters: "${rawCmd}". ` +
            'Shell metacharacters are not allowed.'
          );
        }
        
        const cmdToRun =
          process.platform === 'win32' && baseCmdNoExt === 'pwd'
            ? 'cd'
            : rawCmd;
        try {
          const { stdout, stderr } = await execAsync(cmdToRun, {
            cwd: session.workspaceDir,
            timeout: command.timeoutMs,
            maxBuffer: 1_000_000,
            signal,
          });
          return { stdout, stderr, exitCode: 0 };
        } catch (error) {
          const failed = error as {
            stdout?: string;
            stderr?: string;
            code?: number | string;
            killed?: boolean;
          };
          if (signal?.aborted)
            throw new Error('Computer request was cancelled or timed out.', {
              cause: error,
            });
          return {
            stdout: failed.stdout ?? '',
            stderr: failed.stderr ?? '',
            exitCode: typeof failed.code === 'number' ? failed.code : 1,
          };
        }
      }
      case 'open_app': {
        const { app, url } = parsed as { app: string; url?: string };
        let lastError: unknown;

        // Whitelist of allowed app names — only alphanumeric, hyphens, underscores
        const ALLOWED_APP_PATTERN = /^[a-zA-Z0-9_-]+$/;
        if (!ALLOWED_APP_PATTERN.test(app)) {
          throw new Error(`Invalid app name: "${app}". Only alphanumeric, hyphens, and underscores allowed.`);
        }

        const aliases: Record<string, string[]> = {
          calculator: ['calc.exe', 'start calc:', 'win32calc.exe'],
          calc: ['calc.exe', 'start calc:'],
          notepad: ['notepad.exe', 'notepad'],
          explorer: ['explorer.exe', 'explorer'],
          paint: ['mspaint.exe', 'mspaint'],
          cmd: ['cmd.exe'],
          terminal: ['wt.exe', 'powershell.exe', 'cmd.exe'],
          settings: ['start ms-settings:'],
          edge: ['msedge.exe'],
          chrome: ['chrome.exe'],
          youtube: ['chrome.exe', 'msedge.exe'],
          browser: ['chrome.exe', 'msedge.exe'],
          whatsapp: ['WhatsApp.exe', 'chrome.exe'],
          excel: ['excel.exe'],
          word: ['winword.exe', 'word.exe'],
          powerpoint: ['powerpnt.exe', 'powerpoint.exe'],
        };
        // A browser target with a URL is navigated there instead of opening a
        // blank window, so "open YouTube" lands on youtube.com.
        if (url) {
          const browserAlias = ['chrome', 'edge', 'browser', 'youtube'];
          if (browserAlias.includes(app.toLowerCase())) {
            // Validate URL is a safe http/https URL
            let targetUrl: string;
            try {
              targetUrl = new URL(url).toString();
            } catch {
              throw new Error(`Invalid URL: "${url}"`);
            }
            if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
              throw new Error(`URL must be http or https: "${url}"`);
            }
            const browser = app.toLowerCase() === 'edge' ? 'msedge.exe' : 'chrome.exe';
            // Use PowerShell -Command with properly escaped arguments instead of shell interpolation
            const psCommand = `Start-Process -FilePath "${browser}" -ArgumentList "${targetUrl}" -WindowStyle Normal`;
            try {
              await execAsync(
                `powershell -NoProfile -NonInteractive -Command "${psCommand.replace(/"/g, '`"')}"`,
                { cwd: session.workspaceDir, signal },
              );
              return { ok: true, app, launched: `${browser} ${targetUrl}`, url: targetUrl };
            } catch (error) {
              lastError = error;
            }
          }
        }
        const candidates = aliases[app.toLowerCase()] ?? [app];
        const win = process.platform === 'win32';
        // Reuse the running instance instead of launching a second one. The
        // owner usually means "bring my Chrome/WhatsApp forward", not "start
        // another copy"; launching a new process was the bug behind duplicate
        // Chrome windows.
        if (win) {
          const names = candidates
            .map((candidate) =>
              candidate
                .replace(/^start\s+/, '')
                .replace(/^.*[:/]/, '')
                .replace(/\.exe$/i, '')
                .trim(),
            )
            .filter((name) => name && !name.includes(':'));
          // Build match hint from whitelisted aliases only — never include raw user input
          const matchHint = names.join('|');
          const script = `
$ProgressPreference = 'SilentlyContinue';
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class WinReuse {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);
}
'@ -ErrorAction SilentlyContinue

$hint = '${matchHint}';
$names = $hint.Split('|') | Where-Object { $_ }
$procs = Get-Process -ErrorAction SilentlyContinue | Where-Object {
  $_.MainWindowHandle -ne [IntPtr]::Zero -and (
    ($names -contains $_.ProcessName) -or
    ($_.MainWindowTitle -match $hint) -or
    ($_.ProcessName -match $hint)
  )
}
$hit = $procs | Select-Object -First 1
if ($hit -and $hit.MainWindowHandle -ne [IntPtr]::Zero) {
  $h = $hit.MainWindowHandle
  try {
    [WinReuse]::keybd_event(0x12, 0, 0, 0)
    [WinReuse]::keybd_event(0x12, 0, 2, 0)
    if ([WinReuse]::IsIconic($h)) {
      [WinReuse]::ShowWindowAsync($h, 9) | Out-Null
    } else {
      [WinReuse]::ShowWindowAsync($h, 3) | Out-Null
    }
    [WinReuse]::SetForegroundWindow($h) | Out-Null
    [WinReuse]::BringWindowToTop($h) | Out-Null
  } catch {}
  [PSCustomObject]@{ reused = $true; pid = $hit.Id; process = $hit.ProcessName; title = $hit.MainWindowTitle; activated = $true } | ConvertTo-Json -Compress
} else { '{"reused":false}' }
`;
          try {
            const encoded = Buffer.from(script, 'utf16le').toString('base64');
            const { stdout } = await execAsync(
              `powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`,
              { cwd: session.workspaceDir, timeout: 10000, maxBuffer: 200_000, signal },
            );
            const parsedReuse = JSON.parse(stdout.trim() || '{"reused":false}') as {
              reused?: boolean;
              pid?: number;
              process?: string;
              title?: string;
            };
            if (parsedReuse.reused) {
              return {
                ok: true,
                app,
                reused: true,
                pid: parsedReuse.pid,
                title: parsedReuse.title,
              };
            }
          } catch {
            // Fall through to launching when the probe fails.
          }
        }
        for (const candidate of candidates) {
          try {
            if (win) {
              if (candidate.startsWith('start ')) {
                await execAsync(candidate, {
                  cwd: session.workspaceDir,
                  signal,
                });
              } else {
                await execAsync(`start "" "${candidate}"`, {
                  cwd: session.workspaceDir,
                  signal,
                });
              }
            } else {
              await execAsync(candidate, {
                cwd: session.workspaceDir,
                signal,
              });
            }
            return { ok: true, app, launched: candidate };
          } catch (error) {
            lastError = error;
          }
        }
        throw new Error(
          `Could not open "${app}" (${lastError instanceof Error ? lastError.message : 'launch failed'}).`,
        );
      }
      case 'list_windows': {
        if (process.platform !== 'win32') {
          return { ok: true, windows: [] };
        }
        const script = `
$ProgressPreference = 'SilentlyContinue';
$windows = @()
$procs = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -and $_.MainWindowTitle.Trim().Length -gt 0 }
foreach ($p in $procs) {
  $windows += [PSCustomObject]@{
    id = $p.Id
    processName = $p.ProcessName
    title = $p.MainWindowTitle
  }
}
if ($windows.Count -eq 0) {
  $guiNames = @('calc', 'CalculatorApp', 'notepad', 'explorer', 'chrome', 'msedge', 'code', 'electron', 'cmd', 'powershell', 'WindowsTerminal')
  $activeGui = Get-Process -ErrorAction SilentlyContinue | Where-Object { $guiNames -contains $_.ProcessName }
  foreach ($p in $activeGui) {
    $windows += [PSCustomObject]@{
      id = $p.Id
      processName = $p.ProcessName
      title = if ($p.MainWindowTitle) { $p.MainWindowTitle } else { $p.ProcessName }
    }
  }
}
$windows | ConvertTo-Json -Compress
`;
        try {
          const encoded = Buffer.from(script, 'utf16le').toString('base64');
          const { stdout } = await execAsync(
            `powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`,
            { cwd: session.workspaceDir, timeout: 10000, maxBuffer: 1_000_000, signal },
          );
          const cleaned = stdout.replace(/#< CLIXML[\s\S]*?<\/Objs>/g, '').trim();
          let parsedJson = cleaned ? JSON.parse(cleaned) : [];
          if (!Array.isArray(parsedJson)) {
            parsedJson = parsedJson ? [parsedJson] : [];
          }
          return { ok: true, windows: parsedJson };
        } catch (err) {
          return { ok: true, windows: [], error: err instanceof Error ? err.message : String(err) };
        }
      }
      case 'switch_window':
      case 'window_switch':
      case 'minimize_window':
      case 'window_minimize':
      case 'maximize_window':
      case 'window_maximize':
      case 'resize_window':
      case 'window_resize': {
        if (actor === 'agent')
          throw new Error('Window focus and layout controls are owner-only.');
        if (process.platform !== 'win32')
          throw new Error('Window controls are available on Windows only.');
        const input = parsed as { title: string; width?: number; height?: number; x?: number; y?: number };

        // Validate window title: only alphanumeric, spaces, hyphens, underscores, dots, parentheses
        const WINDOW_TITLE_PATTERN = /^[a-zA-Z0-9\s\-_.()]+$/;
        if (!WINDOW_TITLE_PATTERN.test(input.title)) {
          throw new Error(`Invalid window title: "${input.title}". Only alphanumeric, spaces, hyphens, underscores, dots, and parentheses allowed.`);
        }

        const verb =
          action.includes('minimize') ? 6 : action.includes('maximize') ? 3 : 9;
        const isResize = action.includes('resize');
        const targetX = input.x ?? 0;
        const targetY = input.y ?? 0;
        const targetW = input.width ?? 1280;
        const targetH = input.height ?? 720;
        const script = `
$ProgressPreference = 'SilentlyContinue';
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class WinCtl {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int hh, bool repaint);
  [DllImport("user32.dll")] public static extern IntPtr FindWindow(string cls, string title);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);
}
'@
$match = '${input.title.replace(/'/g, "''")}'
$procs = Get-Process -ErrorAction SilentlyContinue | Where-Object {
  $_.MainWindowHandle -ne [IntPtr]::Zero -and (
    ($_.MainWindowTitle -like "*$match*") -or
    ($_.ProcessName -like "*$match*")
  )
}
$hit = $procs | Select-Object -First 1
if ($hit) {
  $h = $hit.MainWindowHandle
} else {
  $h = [WinCtl]::FindWindow($null, $match)
}
if ($h -eq [IntPtr]::Zero -or $h -eq $null) {
  Write-Output "window_not_found"
  exit 0
}
try {
  [WinCtl]::keybd_event(0x12, 0, 0, 0)
  [WinCtl]::keybd_event(0x12, 0, 2, 0)
  if ([WinCtl]::IsIconic($h)) {
    [WinCtl]::ShowWindow($h, 9) | Out-Null
  }
  [WinCtl]::SetForegroundWindow($h) | Out-Null
  [WinCtl]::BringWindowToTop($h) | Out-Null
  if (${isResize ? 'true' : 'false'}) {
    [WinCtl]::MoveWindow($h, ${targetX}, ${targetY}, ${targetW}, ${targetH}, $true) | Out-Null
  } else {
    [WinCtl]::ShowWindow($h, ${verb}) | Out-Null
  }
} catch {}
Write-Output "ok"
`;
        const encoded = Buffer.from(script, 'utf16le').toString('base64');
        const { stdout } = await execAsync(
          `powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`,
          { cwd: session.workspaceDir, timeout: 15000, maxBuffer: 1_000_000, signal },
        );
        const result = stdout.replace(/#< CLIXML[\s\S]*?<\/Objs>/g, '').trim();
        if (result.includes('window_not_found')) {
          return { ok: false, action, title: input.title, error: `No active window found matching "${input.title}".` };
        }
        return { ok: true, action, title: input.title };
      }
      case 'annotate': {
        const a = parsed as Record<string, unknown>;
        // The renderer draws this over the real desktop (see annotations.html).
        // The service validates and echoes the payload so the tool result and
        // the audit trail say exactly what was shown and when.
        return {
          ok: true,
          action,
          annotation: {
            ...a,
            x: Number(a.x ?? 0),
            y: Number(a.y ?? 0),
            width: Number(a.width ?? 0),
            height: Number(a.height ?? 0),
            shownAt: new Date().toISOString(),
          },
        };
      }
      case 'clear_annotations':
        return { ok: true, action };
      case 'desktop_snapshot': {
        if (process.platform === 'win32') {
          const psScript = `
$ProgressPreference = 'SilentlyContinue';
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class AegisDpi {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
}
'@
# A DPI-unaware process only sees the scaled desktop, which crops the capture
# on high-DPI screens (the owner's "only a portion is visible"). Mark the
# process DPI-aware first so the whole desktop is captured at real resolution.
[AegisDpi]::SetProcessDPIAware() | Out-Null
# Capture the whole virtual desktop (every monitor), not just the primary one.
$b = [System.Windows.Forms.SystemInformation]::VirtualScreen
$full = New-Object System.Drawing.Bitmap $b.Width, $b.Height
$gfx = [System.Drawing.Graphics]::FromImage($full)
$gfx.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
# Draw the live cursor so the agent and the owner both see exactly where the
# pointer is: a bright yellow ring with a soft halo.
$pt = New-Object AegisDpi+POINT
if ([AegisDpi]::GetCursorPos([ref]$pt)) {
  $cx = $pt.X - $b.X
  $cy = $pt.Y - $b.Y
  $halo = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(70, 250, 204, 21))
  $ring = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 250, 204, 21)), 4
  $gfx.FillEllipse($halo, $cx - 22, $cy - 22, 44, 44)
  $gfx.DrawEllipse($ring, $cx - 13, $cy - 13, 26, 26)
  $halo.Dispose(); $ring.Dispose()
}
# Downscale to a readable width and encode JPEG: a full-resolution PNG base64
# is several megabytes and made every capture slow to move and slow for the
# model.
$maxW = 1600
$scale = [Math]::Min(1.0, $maxW / [double]$b.Width)
$outW = [int][Math]::Round($b.Width * $scale)
$outH = [int][Math]::Round($b.Height * $scale)
$out = New-Object System.Drawing.Bitmap $outW, $outH
$og = [System.Drawing.Graphics]::FromImage($out)
$og.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$og.DrawImage($full, 0, 0, $outW, $outH)
$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$params = New-Object System.Drawing.Imaging.EncoderParameters(1)
$params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]82)
$stream = New-Object System.IO.MemoryStream
$out.Save($stream, $codec, $params)
$gfx.Dispose(); $full.Dispose(); $og.Dispose(); $out.Dispose()
$bytes = $stream.ToArray()
$stream.Dispose()
Write-Output "$outW x $outH"
[Convert]::ToBase64String($bytes)
`;
          try {
            const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
            const { stdout } = await execAsync(
              `powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`,
              { cwd: session.workspaceDir, timeout: 12000, maxBuffer: 50 * 1024 * 1024, signal },
            );
            const cleaned = stdout.replace(/#< CLIXML[\s\S]*?<\/Objs>/g, '').trim();
            const [sizeLine, ...rest] = cleaned.split(/\r?\n/);
            const b64 = rest.join('').trim();
            if (b64.length > 100) {
              const [w, h] = sizeLine.split('x').map((n) => Number(n.trim()));
              return {
                base64: b64,
                width: Number.isFinite(w) ? w : 1280,
                height: Number.isFinite(h) ? h : 720,
                capturedAt: new Date().toISOString(),
                format: 'image/jpeg',
                source: 'desktop',
              };
            }
          } catch {
            // Fallback to browser viewport screenshot
          }
        }
        const buffer = await page.screenshot({ type: 'jpeg', quality: 75 });
        const size = page.viewportSize() ?? LOCAL_VIEWPORT;
        return {
          base64: buffer.toString('base64'),
          width: size.width,
          height: size.height,
          capturedAt: new Date().toISOString(),
          format: 'image/jpeg',
          source: 'browser_viewport',
        };
      }
      case 'mouse_click': {
        if (actor === 'agent')
          throw new Error('Coordinate mouse actions are disabled for agents; use browser refs or Agent Desktop accessibility refs.');
        const { x, y, button, double } = parsed as {
          x: number;
          y: number;
          button?: 'left' | 'right' | 'middle';
          double?: boolean;
        };
        if (actor === 'owner' && process.platform === 'win32') {
          const downFlag = button === 'right' ? 0x08 : button === 'middle' ? 0x20 : 0x02;
          const upFlag = button === 'right' ? 0x10 : button === 'middle' ? 0x40 : 0x04;
          const clicks = double ? 2 : 1;
          const ps = `
$ProgressPreference = 'SilentlyContinue';
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class WinMouse {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(int dwFlags, int dx, int dy, int cButtons, int dwExtraInfo);
}
'@
[WinMouse]::SetCursorPos(${Math.round(x)}, ${Math.round(y)}) | Out-Null
for ($i=0; $i -lt ${clicks}; $i++) {
  [WinMouse]::mouse_event(${downFlag}, 0, 0, 0, 0)
  Start-Sleep -Milliseconds 25
  [WinMouse]::mouse_event(${upFlag}, 0, 0, 0, 0)
  Start-Sleep -Milliseconds 40
}
Write-Output "ok"
`;
          const encoded = Buffer.from(ps, 'utf16le').toString('base64');
          await execAsync(
            `powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`,
            { cwd: session.workspaceDir, timeout: 5000, signal },
          ).catch(() => null);
        }
        await page.mouse.click(x, y, {
          button: button ?? 'left',
          clickCount: double ? 2 : 1,
        }).catch(() => null);
        return { ok: true, x, y, button: button ?? 'left', double: !!double };
      }
      case 'mouse_move': {
        if (actor === 'agent')
          throw new Error('Moving the physical cursor is owner-only.');
        const { x, y } = parsed as { x: number; y: number };
        if (actor === 'owner' && process.platform === 'win32') {
          const ps = `
$ProgressPreference = 'SilentlyContinue';
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class WinMove {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
}
'@
[WinMove]::SetCursorPos(${Math.round(x)}, ${Math.round(y)}) | Out-Null
Write-Output "ok"
`;
          const encoded = Buffer.from(ps, 'utf16le').toString('base64');
          await execAsync(
            `powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`,
            { cwd: session.workspaceDir, timeout: 5000, signal },
          ).catch(() => null);
        }
        await page.mouse.move(x, y).catch(() => null);
        return { ok: true, x, y };
      }
      case 'mouse_drag': {
        if (actor === 'agent')
          throw new Error('Physical mouse dragging is owner-only.');
        const dragArgs = parsed as {
          fromX?: number;
          fromY?: number;
          toX?: number;
          toY?: number;
          points?: [number, number][];
        };
        const points =
          dragArgs.points && dragArgs.points.length >= 2
            ? dragArgs.points
            : [
                [dragArgs.fromX ?? 0, dragArgs.fromY ?? 0] as [number, number],
                [dragArgs.toX ?? 0, dragArgs.toY ?? 0] as [number, number],
              ];
        const [startX, startY] = points[0];
        const [lastX, lastY] = points[points.length - 1];

        if (actor === 'owner' && process.platform === 'win32') {
          const moveSteps = points
            .slice(1)
            .map(
              ([px, py]) => `
[WinDrag]::SetCursorPos(${Math.round(px)}, ${Math.round(py)}) | Out-Null
Start-Sleep -Milliseconds 40
`,
            )
            .join('');

          const ps = `
$ProgressPreference = 'SilentlyContinue';
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class WinDrag {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(int dwFlags, int dx, int dy, int cButtons, int dwExtraInfo);
}
'@
[WinDrag]::SetCursorPos(${Math.round(startX)}, ${Math.round(startY)}) | Out-Null
[WinDrag]::mouse_event(0x02, 0, 0, 0, 0)
Start-Sleep -Milliseconds 50
${moveSteps}
[WinDrag]::mouse_event(0x04, 0, 0, 0, 0)
Write-Output "ok"
`;
          const encoded = Buffer.from(ps, 'utf16le').toString('base64');
          await execAsync(
            `powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`,
            { cwd: session.workspaceDir, timeout: 10000, signal },
          ).catch(() => null);
        }
        await page.mouse.move(startX, startY).catch(() => null);
        await page.mouse.down().catch(() => null);
        for (const [px, py] of points.slice(1)) {
          await page.mouse.move(px, py).catch(() => null);
        }
        await page.mouse.up().catch(() => null);
        return { ok: true, fromX: startX, fromY: startY, toX: lastX, toY: lastY, points };
      }
      case 'keyboard_type': {
        if (actor === 'agent')
          throw new Error('Physical keyboard input is owner-only; use browser refs or Agent Desktop set-value.');
        const { text } = parsed as { text: string };
        if (actor === 'owner' && process.platform === 'win32') {
          const escaped = text.replace(/([+^%~(){}[\]])/g, '{$1}').replace(/"/g, '""');
          const ps = `
$ProgressPreference = 'SilentlyContinue';
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait("${escaped}")
Write-Output "ok"
`;
          const encoded = Buffer.from(ps, 'utf16le').toString('base64');
          await execAsync(
            `powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`,
            { cwd: session.workspaceDir, timeout: 8000, signal },
          ).catch(() => null);
        }
        await page.keyboard.type(text).catch(() => null);
        return { ok: true, typedLength: text.length };
      }
      case 'keyboard_press': {
        if (actor === 'agent')
          throw new Error('Physical key presses are owner-only.');
        const { key } = parsed as { key: string };
        if (actor === 'owner' && process.platform === 'win32') {
          const keyMap: Record<string, string> = {
            Enter: '{ENTER}',
            Return: '{ENTER}',
            Tab: '{TAB}',
            Escape: '{ESC}',
            Esc: '{ESC}',
            Backspace: '{BACKSPACE}',
            Delete: '{DELETE}',
            ArrowUp: '{UP}',
            ArrowDown: '{DOWN}',
            ArrowLeft: '{LEFT}',
            ArrowRight: '{RIGHT}',
            Home: '{HOME}',
            End: '{END}',
            PageUp: '{PGUP}',
            PageDown: '{PGDN}',
          };
          const sendKey = keyMap[key] ?? (key.startsWith('{') ? key : `{${key}}`);
          const ps = `
$ProgressPreference = 'SilentlyContinue';
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait("${sendKey}")
Write-Output "ok"
`;
          const encoded = Buffer.from(ps, 'utf16le').toString('base64');
          await execAsync(
            `powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`,
            { cwd: session.workspaceDir, timeout: 5000, signal },
          ).catch(() => null);
        }
        await page.keyboard.press(key).catch(() => null);
        return { ok: true, key };
      }
      case 'ui_automation_tree': {
        const input = (parsed as { processName?: string; title?: string; maxDepth?: number }) || {};
        const depth = input.maxDepth ?? 3;
        if (process.platform === 'win32') {
          const ps = `
$ProgressPreference = 'SilentlyContinue';
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$targetTitle = "${(input.title ?? '').replace(/[\\"']/g, '')}"
$targetProc = "${(input.processName ?? '').replace(/[\\"']/g, '')}"
$root = [System.Windows.Automation.AutomationElement]::RootElement

$found = New-Object System.Collections.ArrayList
function Dump-Tree($elem, $currentDepth) {
  if ($currentDepth -gt ${depth}) { return }
  try {
    $children = $elem.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
    foreach ($child in $children) {
      $rect = $child.Current.BoundingRectangle
      [void]$found.Add([PSCustomObject]@{
        name = $child.Current.Name
        type = $child.Current.ControlType.ProgrammaticName
        id = $child.Current.AutomationId
        bounds = "$($rect.X),$($rect.Y),$($rect.Width),$($rect.Height)"
        depth = $currentDepth
      })
      Dump-Tree $child ($currentDepth + 1)
    }
  } catch {}
}

if ($targetTitle -ne '' -or $targetProc -ne '') {
  $p = Get-Process -ErrorAction SilentlyContinue | Where-Object { ($targetTitle -ne '' -and $_.MainWindowTitle -like "*$targetTitle*") -or ($targetProc -ne '' -and $_.ProcessName -like "*$targetProc*") } | Select-Object -First 1
  if ($p -and $p.MainWindowHandle -ne [IntPtr]::Zero) {
    try {
      $winElem = [System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)
      if ($winElem) { Dump-Tree $winElem 1 }
    } catch {}
  }
}
if ($found.Count -eq 0) {
  Dump-Tree $root 1
}
$found | Select-Object -First 100 | ConvertTo-Json -Compress
`;
          try {
            const encoded = Buffer.from(ps, 'utf16le').toString('base64');
            const { stdout } = await execAsync(
              `powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`,
              { cwd: session.workspaceDir, timeout: 12000, maxBuffer: 2 * 1024 * 1024, signal },
            );
            const cleaned = stdout.replace(/#< CLIXML[\s\S]*?<\/Objs>/g, '').trim();
            let elements = cleaned ? JSON.parse(cleaned) : [];
            if (!Array.isArray(elements)) elements = elements ? [elements] : [];
            if (elements.length > 0) {
              return { ok: true, source: 'uiautomation', elements };
            }
          } catch {
            // UIAutomation is best-effort; fall back to DOM elements below.
          }
        }
        const domElements = await page.evaluate((selector) => {
          return Array.from(document.querySelectorAll(selector)).slice(0, 50).map((el) => {
            const rect = el.getBoundingClientRect();
            return {
              name: el.textContent?.trim() || el.getAttribute('aria-label') || '',
              type: el.tagName.toLowerCase(),
              id: el.id || '',
              bounds: `${Math.round(rect.x)},${Math.round(rect.y)},${Math.round(rect.width)},${Math.round(rect.height)}`,
            };
          });
        }, SNAPSHOT_SELECTOR);
        return { ok: true, source: 'browser_dom', elements: domElements };
      }
      case 'desktop': {
        // Vercel Labs agent-desktop: accessibility-tree computer use. A
        // snapshot lists every actionable element with a stable @ref and
        // click/type/set-value act on that ref, so apps (Calculator, Chrome)
        // are driven by their real controls instead of blind pixels.
        const input = parsed as {
          command: string;
          args?: string[];
          label?: string;
        };
        const result = await runAgentDesktop(
          input.command,
          input.args ?? [],
          id,
          input.label,
          signal,
        );
        return { ok: true, action: 'desktop', command: input.command, result };
      }
      default:
        throw new Error(
          `Computer action ${action} is not available in local mode.`,
        );
    }
  }
}
