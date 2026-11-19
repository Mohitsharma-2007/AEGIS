// The orchestrator mail consumer: unread `task` mail in the orchestrator inbox
// is dispatched through the swarm runner, and a markdown `report` reply is
// mailed back to the sender, threaded to the same threadId. These tests run the
// orchestrator in-process against a temp data root with a fake task runner, so
// no model calls or host services are touched.
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  listMailbox,
  mailboxPaths,
  ORCHESTRATOR_ADDRESS,
  readMail,
  sendMail,
  unreadCount,
  USER_ADDRESS,
  type MailboxPaths,
  type SendOptions,
} from '../src/server/mailbox.js';
import {
  startMailOrchestrator,
  type DispatchTaskFn,
  type GetTaskFn,
  type MailOrchestratorHandle,
  type MailOrchestratorOptions,
  type MailOrchestratorTask,
} from '../src/server/mail-orchestrator.js';

interface FakeRunner {
  tasks: Map<string, MailOrchestratorTask>;
  dispatchCalls: Array<{ prompt: string; threadId: string; messageId: string }>;
  nextId: number;
}

function makeRunner() {
  const runner: FakeRunner = {
    tasks: new Map(),
    dispatchCalls: [],
    nextId: 0,
  };
  const dispatchTask = (input: {
    prompt: string;
    threadId: string;
    messageId: string;
  }) => {
    runner.dispatchCalls.push(input);
    const id = `fake-task-${++runner.nextId}`;
    runner.tasks.set(id, {
      id,
      status: 'running',
      prompt: input.prompt,
      title: input.prompt.slice(0, 40),
    });
    return { id };
  };
  const getTask = (id: string) => runner.tasks.get(id);
  const complete = (id: string, synthesis: string) => {
    const task = runner.tasks.get(id);
    if (!task) throw new Error(`unknown task ${id}`);
    task.status = 'completed';
    task.synthesis = synthesis;
  };
  return { runner, dispatchTask, getTask, complete };
}

let root = '';
let paths: MailboxPaths;
let processedFile = '';
const handles: MailOrchestratorHandle[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'aegis-mail-orchestrator-'));
  paths = mailboxPaths(root);
  processedFile = join(root, 'agent-swarm', 'mail-processed.json');
});

afterEach(() => {
  for (const handle of handles) handle.stop();
  handles.length = 0;
  rmSync(root, { recursive: true, force: true });
});

function start(
  options: Partial<
    Omit<MailOrchestratorOptions, 'dispatchTask' | 'getTask'>
  > & { dispatchTask: DispatchTaskFn; getTask: GetTaskFn },
): MailOrchestratorHandle {
  const handle = startMailOrchestrator({
    paths,
    processedIndexFile: processedFile,
    ...options,
  });
  handles.push(handle);
  return handle;
}

function seedTaskMail(
  body = 'Analyze NVDA and write a short brief.',
  overrides: SendOptions = {},
) {
  return sendMail(paths, USER_ADDRESS, [ORCHESTRATOR_ADDRESS], body, {
    kind: 'task',
    subject: 'Run analysis',
    ...overrides,
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('condition was not met in time');
}

describe('mail orchestrator', () => {
  it('dispatches an unread task mail and replies with a threaded report', async () => {
    const { dispatchTask, getTask, complete, runner } = makeRunner();
    const mail = seedTaskMail();
    const handle = start({ dispatchTask, getTask });

    const first = await handle.sweep();

    expect(first.dispatched).toBe(1);
    expect(unreadCount(paths, ORCHESTRATOR_ADDRESS)).toBe(0);
    expect(runner.dispatchCalls).toHaveLength(1);
    expect(runner.dispatchCalls[0].prompt).toBe(
      'Analyze NVDA and write a short brief.',
    );
    expect(runner.dispatchCalls[0].threadId).toBe(mail.envelope.threadId);

    const taskId = [...runner.tasks.keys()][0];
    complete(taskId, '**Synthesis:** NVDA is up 3% today.\n\n- Evidence item.');

    // The task is terminal now, so the next sweep sends the report.
    const second = await handle.sweep();
    expect(second.reported).toBe(1);
    expect(second.inflight).toBe(0);

    const reports = listMailbox(paths, USER_ADDRESS).filter(
      (m) => m.kind === 'report',
    );
    expect(reports).toHaveLength(1);
    expect(reports[0].threadId).toBe(mail.envelope.threadId);
    expect(reports[0].taskId).toBe(taskId);

    const report = readMail(paths, USER_ADDRESS, reports[0].id);
    expect(report).not.toBeNull();
    expect(report!.envelope.from).toBe(ORCHESTRATOR_ADDRESS);
    expect(report!.envelope.inReplyTo).toBe(mail.envelope.id);
    expect(report!.envelope.kind).toBe('report');
    expect(report!.body).toContain('NVDA is up 3% today.');
  });

  it('never dispatches the same task mail twice', async () => {
    const { dispatchTask, getTask, runner } = makeRunner();
    seedTaskMail();
    const handle = start({ dispatchTask, getTask });

    await handle.sweep();
    await handle.sweep();
    expect(runner.dispatchCalls).toHaveLength(1);

    // A fresh orchestrator instance (e.g. after a host restart) shares the
    // persisted processed index, so it must not dispatch again either.
    const restarted = start({ dispatchTask, getTask });
    const afterRestart = await restarted.sweep();
    expect(afterRestart.dispatched).toBe(0);
    expect(runner.dispatchCalls).toHaveLength(1);
  });

  it('caps concurrent task mails', async () => {
    const { dispatchTask, getTask, complete, runner } = makeRunner();
    seedTaskMail('First task.');
    seedTaskMail('Second task.');
    seedTaskMail('Third task.');
    const handle = start({ dispatchTask, getTask, maxConcurrent: 1 });

    await handle.sweep();
    expect(runner.dispatchCalls).toHaveLength(1);
    expect(unreadCount(paths, ORCHESTRATOR_ADDRESS)).toBe(2);

    complete([...runner.tasks.keys()][0], 'done');
    await handle.sweep();
    expect(runner.dispatchCalls).toHaveLength(2);

    complete([...runner.tasks.keys()][1], 'done');
    await handle.sweep();
    expect(runner.dispatchCalls).toHaveLength(3);
    expect(unreadCount(paths, ORCHESTRATOR_ADDRESS)).toBe(0);
  });

  it('keeps retrying a mail whose dispatch failed', async () => {
    let fail = true;
    const dispatchTask = () => {
      if (fail) throw new Error('provider down');
      return { id: 'fake-task-1' };
    };
    const getTask = () => undefined;
    seedTaskMail();
    const handle = start({ dispatchTask, getTask });

    await handle.sweep();
    expect(unreadCount(paths, ORCHESTRATOR_ADDRESS)).toBe(1);

    fail = false;
    const retry = await handle.sweep();
    expect(retry.dispatched).toBe(1);
    expect(unreadCount(paths, ORCHESTRATOR_ADDRESS)).toBe(0);
  });

  it('does not start new work while the host is paused', async () => {
    const { dispatchTask, getTask, complete, runner } = makeRunner();
    const mail = seedTaskMail();
    let paused = true;
    const handle = start({
      dispatchTask,
      getTask,
      isPaused: () => paused,
    });

    await handle.sweep();
    expect(runner.dispatchCalls).toHaveLength(0);
    expect(unreadCount(paths, ORCHESTRATOR_ADDRESS)).toBe(1);

    // Reports still flow while paused; only new dispatches are gated.
    paused = false;
    await handle.sweep();
    expect(runner.dispatchCalls).toHaveLength(1);
    complete([...runner.tasks.keys()][0], 'done');
    paused = true;
    await handle.sweep();
    const reports = listMailbox(paths, USER_ADDRESS).filter(
      (m) => m.kind === 'report',
    );
    expect(reports).toHaveLength(1);
    expect(reports[0].threadId).toBe(mail.envelope.threadId);
  });

  it('runs automatically on a short interval until stopped', async () => {
    const { dispatchTask, getTask, runner } = makeRunner();
    seedTaskMail();
    const handle = start({ dispatchTask, getTask, intervalMs: 10 });

    await waitFor(() => runner.dispatchCalls.length === 1);
    expect(unreadCount(paths, ORCHESTRATOR_ADDRESS)).toBe(0);

    handle.stop();
    const before = runner.dispatchCalls.length;
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(runner.dispatchCalls.length).toBe(before);
  });
});
