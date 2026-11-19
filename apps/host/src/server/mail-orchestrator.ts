// Orchestrator mail consumer (Milestone 5): the background half of the Aegis
// mail system. The owner sends `task` mail to orchestrator@aegis; this loop
// picks unread task mail up from the orchestrator inbox, dispatches each
// through the swarm task runner, and replies by mail with a markdown report
// once the task finishes. Agents and owner therefore talk entirely over the
// internal @aegis bus.
//
// Crash safety: dispatched mail is recorded in a persisted JSON index under
// `.aegis-data/agent-swarm/mail-processed.json` keyed by message id, so a host
// restart never dispatches the same mail twice, and reports for tasks that
// were still in flight when the host stopped are still sent on the next boot.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import {
  listMailbox,
  markRead,
  ORCHESTRATOR_ADDRESS,
  readMail,
  sendMail,
  unreadCount,
  type MailboxPaths,
  type MailSummary,
} from './mailbox.js';
import { aegisRootDir } from './harness.js';
import { log } from './log.js';

export interface MailOrchestratorTask {
  id: string;
  status: string;
  prompt?: string;
  title?: string;
  synthesis?: string;
  handoff?: string;
  artifacts?: string[];
  error?: string;
}

export interface DispatchTaskInput {
  /** Trimmed markdown body of the task mail. */
  prompt: string;
  /** Thread the original mail belongs to; replies thread back to it. */
  threadId: string;
  /** Id of the triggering mail message. */
  messageId: string;
}

export type DispatchTaskFn = (
  input: DispatchTaskInput,
) => { id: string } | Promise<{ id: string }>;

export type GetTaskFn = (taskId: string) => MailOrchestratorTask | undefined;

export interface MailOrchestratorOptions {
  /** Mailbox paths (see `mailboxPaths`). */
  paths: MailboxPaths;
  /** Create a swarm task for a task mail; must return the new task id. */
  dispatchTask: DispatchTaskFn;
  /** Resolve a task by id (the swarm's getter). */
  getTask: GetTaskFn;
  /** Return true when the host should not start new work (e.g. owner paused). */
  isPaused?: () => boolean;
  /** Poll interval in ms. Defaults to 2000. */
  intervalMs?: number;
  /** Maximum in-flight task mails. Defaults to 2. */
  maxConcurrent?: number;
  /**
   * Persisted processed-mail index path. Defaults to
   * `.aegis-data/agent-swarm/mail-processed.json`.
   */
  processedIndexFile?: string;
}

export interface MailOrchestratorSweepResult {
  /** Task mails newly dispatched. */
  dispatched: number;
  /** Reports sent for completed tasks. */
  reported: number;
  /** Unread task mails skipped (already processed or invalid). */
  skipped: number;
  /** Tasks currently tracked as in flight. */
  inflight: number;
}

export interface MailOrchestratorHandle {
  /** Stop the periodic polling loop. */
  stop(): void;
  /** Run one poll cycle now (used by the loop and by tests). */
  sweep(): Promise<MailOrchestratorSweepResult>;
}

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);

const processedEntrySchema = z.object({
  messageId: z.string(),
  threadId: z.string(),
  from: z.string(),
  taskId: z.string().optional(),
  dispatchedAt: z.string().nullable().optional(),
  reported: z.boolean().optional(),
  reportedAt: z.string().nullable().optional(),
  error: z.string().optional(),
});

const processedIndexSchema = z.object({
  version: z.literal(1).optional(),
  messages: z.record(z.string(), processedEntrySchema).optional(),
});

interface ProcessedEntry {
  messageId: string;
  threadId: string;
  from: string;
  taskId?: string;
  dispatchedAt?: string | null;
  reported?: boolean;
  reportedAt?: string | null;
  error?: string;
}

interface ProcessedIndex {
  version?: 1;
  messages: Record<string, ProcessedEntry>;
}

function loadProcessed(file: string): ProcessedIndex {
  try {
    if (!existsSync(file)) return { version: 1, messages: {} };
    const parsed = processedIndexSchema.safeParse(
      JSON.parse(readFileSync(file, 'utf8')),
    );
    if (!parsed.success) return { version: 1, messages: {} };
    return { version: 1, messages: parsed.data.messages ?? {} };
  } catch {
    return { version: 1, messages: {} };
  }
}

function saveProcessed(file: string, index: ProcessedIndex): boolean {
  let lastError: unknown;
  // Retry up to 3 times with brief delay to handle transient write failures
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      mkdirSync(dirname(file), { recursive: true });
      const tmp = `${file}.tmp.${process.pid}.${attempt}`;
      writeFileSync(tmp, JSON.stringify(index, null, 2), 'utf8');
      renameSync(tmp, file);
      return true;
    } catch (error) {
      lastError = error;
      if (attempt < 2) {
        // Brief delay before retry
        const start = Date.now();
        while (Date.now() - start < 100) {
          // wait 100ms
        }
      }
    }
  }
  log.error('Mail orchestrator processed index could not be written after 3 retries', {
    error: lastError instanceof Error ? lastError.message : String(lastError),
    file,
  });
  return false;
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

function buildReportMarkdown(task: MailOrchestratorTask): string {
  const lines: string[] = ['# Task report', ''];
  lines.push(`- Status: **${task.status}**`);
  if (task.title) lines.push(`- Task: ${task.title}`);
  if (task.prompt) lines.push(`- Request: ${clip(task.prompt, 240)}`);
  lines.push('');
  const synthesis = task.synthesis?.trim() ?? '';
  const handoff = task.handoff?.trim() ?? '';
  if (synthesis) lines.push(synthesis);
  else if (handoff) lines.push(handoff);
  else lines.push('The task finished without producing a synthesis.');
  if (task.error) lines.push('', `**Error:** ${task.error}`);
  if (Array.isArray(task.artifacts) && task.artifacts.length) {
    lines.push(`- Artifacts: ${task.artifacts.length} written on disk`);
  }
  return `${lines.join('\n')}\n`;
}

interface InflightContext {
  messageId: string;
  threadId: string;
  from: string;
}

export function startMailOrchestrator(
  options: MailOrchestratorOptions,
): MailOrchestratorHandle {
  const intervalMs = options.intervalMs ?? 2000;
  const maxConcurrent = Math.max(1, options.maxConcurrent ?? 2);
  const processedFile =
    options.processedIndexFile ??
    join(aegisRootDir(), '.aegis-data', 'agent-swarm', 'mail-processed.json');

  /** taskId -> the mail thread this task answers to. */
  const inflight = new Map<string, InflightContext>();
  let sweeping = false;

  const reportCompleted = async (): Promise<number> => {
    const index = loadProcessed(processedFile);
    const candidates: Array<
      InflightContext & { taskId: string; entry?: ProcessedEntry }
    > = [];
    for (const [taskId, ctx] of inflight) {
      candidates.push({ taskId, ...ctx, entry: index.messages[ctx.messageId] });
    }
    // Recovery: tasks dispatched before a restart are still recorded without a
    // report, so their report can be sent once the task turns terminal.
    for (const [messageId, entry] of Object.entries(index.messages)) {
      if (!entry.taskId || entry.reported || inflight.has(entry.taskId))
        continue;
      candidates.push({
        taskId: entry.taskId,
        messageId,
        threadId: entry.threadId,
        from: entry.from,
        entry,
      });
    }
    let reported = 0;
    for (const candidate of candidates) {
      const task = options.getTask(candidate.taskId);
      if (!task || !TERMINAL_STATUSES.has(task.status)) continue;
      try {
        sendMail(
          options.paths,
          ORCHESTRATOR_ADDRESS,
          [candidate.from],
          buildReportMarkdown(task),
          {
            threadId: candidate.threadId,
            inReplyTo: candidate.messageId,
            taskId: candidate.taskId,
            kind: 'report',
            subject: `Re: ${task.title ?? 'Agent task'}`,
          },
        );
        const entry =
          candidate.entry ??
          (index.messages[candidate.messageId] = {
            messageId: candidate.messageId,
            threadId: candidate.threadId,
            from: candidate.from,
            taskId: candidate.taskId,
            dispatchedAt: null,
            reported: true,
            reportedAt: new Date().toISOString(),
          });
        entry.reported = true;
        entry.reportedAt = new Date().toISOString();
        saveProcessed(processedFile, index);
        inflight.delete(candidate.taskId);
        markRead(options.paths, ORCHESTRATOR_ADDRESS, candidate.messageId);
        reported += 1;
        log.info('Mail orchestrator sent a task report', {
          taskId: candidate.taskId,
          to: candidate.from,
          threadId: candidate.threadId,
        });
      } catch (error) {
        log.warn('Mail orchestrator could not send a report', {
          taskId: candidate.taskId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return reported;
  };

  const dispatchOne = async (mail: MailSummary): Promise<boolean> => {
    const index = loadProcessed(processedFile);
    if (index.messages[mail.id]) {
      markRead(options.paths, ORCHESTRATOR_ADDRESS, mail.id);
      return false;
    }
    const message = readMail(options.paths, ORCHESTRATOR_ADDRESS, mail.id);
    const prompt = message?.body.trim() ?? '';
    if (!prompt) {
      index.messages[mail.id] = {
        messageId: mail.id,
        threadId: mail.threadId,
        from: mail.from,
        error: 'empty-body',
      };
      if (!saveProcessed(processedFile, index)) {
        log.error('Mail orchestrator could not persist empty-body skip; mail will be retried', {
          messageId: mail.id,
        });
        return false;
      }
      markRead(options.paths, ORCHESTRATOR_ADDRESS, mail.id);
      log.warn('Mail orchestrator skipped an empty task mail', {
        messageId: mail.id,
      });
      return false;
    }
    try {
      const task = await options.dispatchTask({
        prompt,
        threadId: mail.threadId,
        messageId: mail.id,
      });
      const taskId = typeof task?.id === 'string' ? task.id : '';
      if (!taskId) throw new Error('The dispatcher returned no task id.');
      inflight.set(taskId, {
        messageId: mail.id,
        threadId: mail.threadId,
        from: mail.from,
      });
      index.messages[mail.id] = {
        messageId: mail.id,
        threadId: mail.threadId,
        from: mail.from,
        taskId,
        dispatchedAt: new Date().toISOString(),
        reported: false,
        reportedAt: null,
      };
      if (!saveProcessed(processedFile, index)) {
        // If we can't persist the dispatch, remove from inflight so it can be retried
        inflight.delete(taskId);
        delete index.messages[mail.id];
        log.error('Mail orchestrator could not persist task dispatch; mail will be retried', {
          messageId: mail.id,
          taskId,
        });
        return false;
      }
      markRead(options.paths, ORCHESTRATOR_ADDRESS, mail.id);
      log.info('Mail orchestrator dispatched task', {
        messageId: mail.id,
        taskId,
        threadId: mail.threadId,
        from: mail.from,
      });
      return true;
    } catch (error) {
      log.warn('Mail orchestrator failed to dispatch a task', {
        messageId: mail.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  };

  const sweep = async (): Promise<MailOrchestratorSweepResult> => {
    if (sweeping) {
      return {
        dispatched: 0,
        reported: 0,
        skipped: 0,
        inflight: inflight.size,
      };
    }
    sweeping = true;
    const result: MailOrchestratorSweepResult = {
      dispatched: 0,
      reported: 0,
      skipped: 0,
      inflight: 0,
    };
    try {
      result.reported = await reportCompleted();

      const paused = options.isPaused?.() ?? false;
      if (!paused && unreadCount(options.paths, ORCHESTRATOR_ADDRESS) > 0) {
        const inbox = listMailbox(options.paths, ORCHESTRATOR_ADDRESS)
          .filter((m) => m.kind === 'task' && !m.readAt)
          .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
        for (const mail of inbox) {
          if (inflight.size >= maxConcurrent) break;
          if (await dispatchOne(mail)) result.dispatched += 1;
          else result.skipped += 1;
        }
      }
    } catch (error) {
      log.error('Mail orchestrator sweep failed', error);
    } finally {
      sweeping = false;
      result.inflight = inflight.size;
    }
    return result;
  };

  // Startup reconciliation: recover tasks dispatched before a crash whose
  // reports were never sent. This handles the case where the host crashed
  // after saveProcessed succeeded but before the task completed, leaving
  // entries in mail-processed.json with reported: false and an empty
  // in-memory inflight map.
  function reconcileOnStartup(): void {
    const index = loadProcessed(processedFile);
    let recovered = 0;
    let stillInflight = 0;
    for (const [messageId, entry] of Object.entries(index.messages)) {
      if (!entry.taskId || entry.reported) continue;
      const task = options.getTask(entry.taskId);
      if (!task) {
        stillInflight += 1;
        log.warn('Mail orchestrator startup: task not found in swarm, may be orphaned', {
          messageId,
          taskId: entry.taskId,
          threadId: entry.threadId,
        });
        continue;
      }
      if (TERMINAL_STATUSES.has(task.status)) {
        try {
          sendMail(
            options.paths,
            ORCHESTRATOR_ADDRESS,
            [entry.from],
            buildReportMarkdown(task),
            {
              threadId: entry.threadId,
              inReplyTo: messageId,
              taskId: entry.taskId,
              kind: 'report',
              subject: `Re: ${task.title ?? 'Agent task'}`,
            },
          );
          entry.reported = true;
          entry.reportedAt = new Date().toISOString();
          recovered += 1;
          log.info('Mail orchestrator startup: recovered task report', {
            messageId,
            taskId: entry.taskId,
            threadId: entry.threadId,
            status: task.status,
          });
        } catch (error) {
          log.warn('Mail orchestrator startup: could not send recovered report', {
            messageId,
            taskId: entry.taskId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      } else {
        stillInflight += 1;
        // Re-add to inflight so it's tracked on subsequent sweeps
        inflight.set(entry.taskId, {
          messageId,
          threadId: entry.threadId,
          from: entry.from,
        });
      }
    }
    if (recovered > 0) {
      saveProcessed(processedFile, index);
    }
    log.info('Mail orchestrator startup reconciliation complete', {
      recovered,
      stillInflight,
      totalTracked: Object.keys(index.messages).length,
    });
  }

  reconcileOnStartup();

  const timer = setInterval(() => {
    void sweep();
  }, intervalMs);
  timer.unref?.();

  return {
    stop: () => clearInterval(timer),
    sweep,
  };
}
