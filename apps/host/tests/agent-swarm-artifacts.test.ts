// Multi-agent handoff: every specialist writes its own markdown deliverable in
// the run directory, and the orchestrator's reply ends with the artifact index.
//
// These tests exercise the exact functions the swarm's execute() path calls
// (writeSubtaskArtifact → finalizeSwarmRun → assembleFinalReply) against a temp
// swarm dir, so they are deterministic and never touch the owner's data or a
// model provider.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  assembleFinalReply,
  finalizeSwarmRun,
  swarmHandoffMarkdown,
  type SwarmSubtask,
  type SwarmTask,
} from '../src/server/agent-swarm.js';

let swarmRoot = '';
const previous = process.env.AEGIS_SWARM_DIR;

beforeEach(() => {
  swarmRoot = mkdtempSync(join(tmpdir(), 'aegis-swarm-'));
  process.env.AEGIS_SWARM_DIR = swarmRoot;
});

afterEach(() => {
  if (previous === undefined) delete process.env.AEGIS_SWARM_DIR;
  else process.env.AEGIS_SWARM_DIR = previous;
  rmSync(swarmRoot, { recursive: true, force: true });
});

function subtask(
  agentId: SwarmSubtask['agentId'],
  title: string,
  overrides: Partial<SwarmSubtask> = {},
): SwarmSubtask {
  return {
    id: `${agentId}-${title.replace(/\s+/g, '-').toLowerCase()}`,
    agentId,
    title,
    instruction: `Investigate ${title}`,
    status: 'completed',
    createdAt: Date.now(),
    evidence: [
      {
        agentId,
        label: `${agentId} source`,
        source: `${agentId} service`,
        value: 'live value',
      },
    ],
    ...overrides,
  };
}

function task(subtasks: SwarmSubtask[]): SwarmTask {
  const now = Date.now();
  return {
    id: 'run-1234',
    prompt: 'Compare the market position and our security posture',
    title: 'Quarterly brief',
    dotId: 'aegis',
    status: 'synthesizing',
    planSource: 'heuristic',
    createdAt: now,
    updatedAt: now,
    subtasks,
    events: [],
  };
}

function runDirFiles(): string[] {
  const dir = join(swarmRoot, 'run-1234');
  return existsSync(dir) ? readdirSync(dir) : [];
}

it('writes one artifact per specialist with that specialist’s own report', () => {
  const brief = task([
    subtask('rfi', 'Market scan', { report: 'RFI says NVDA is up 3%.' }),
    subtask('security', 'Permission review', {
      report: 'Sentinel found 2 elevated permissions.',
    }),
  ]);

  const handoff = finalizeSwarmRun(brief);

  expect(brief.artifacts).toHaveLength(2);
  for (const subtask of brief.subtasks) {
    expect(subtask.artifactPath).toBeTruthy();
    const file = subtask.artifactPath as string;
    expect(existsSync(file)).toBe(true);
    expect(file.startsWith(join(swarmRoot, 'run-1234'))).toBe(true);
    const body = readFileSync(file, 'utf8');
    expect(body).toContain(subtask.report as string);
    expect(body).toContain(`(${subtask.agentId})`);
    expect(body).toContain('## Evidence');
  }
  // Distinct files, not two names for the same report.
  expect(brief.artifacts?.[0]).not.toBe(brief.artifacts?.[1]);
  expect(readFileSync(brief.artifacts?.[0] as string, 'utf8')).not.toContain(
    'Sentinel found 2 elevated permissions.',
  );

  expect(handoff).toContain('## Specialist artifacts');
  for (const file of brief.artifacts ?? []) {
    expect(handoff).toContain(file.split(/[\\/]/).pop() as string);
  }
  expect(handoff).not.toContain('Specialists without a deliverable');
});

it('lists every artifact path in the orchestrator’s final reply', () => {
  const brief = task([
    subtask('rfi', 'Market scan', { report: 'RFI report body.' }),
    subtask('files', 'Document inventory', { report: 'Three documents were found.' }),
  ]);
  finalizeSwarmRun(brief);

  const reply = assembleFinalReply('Here is the brief.', brief.handoff ?? '');

  expect(reply.startsWith('Here is the brief.')).toBe(true);
  expect(reply).toContain('## Specialist artifacts');
  for (const file of brief.artifacts ?? []) {
    expect(reply).toContain(file.split(/[\\/]/).pop() as string);
  }
});

it('isolates a failing specialist without corrupting the others’ artifacts', () => {
  const brief = task([
    subtask('computer', 'Desktop check', {
      status: 'failed',
      error: 'Computer permission is disabled.',
      report: undefined,
    }),
    subtask('rfi', 'Market scan', { report: 'RFI still delivered.' }),
    subtask('memory', 'Preference recall', { report: 'Owner prefers USD.' }),
  ]);

  const handoff = finalizeSwarmRun(brief);

  const failed = brief.subtasks[0];
  expect(failed.status).toBe('failed');
  expect(failed.artifactPath).toBeUndefined();
  expect(brief.artifacts).toHaveLength(2);

  for (const subtask of brief.subtasks.slice(1)) {
    const body = readFileSync(subtask.artifactPath as string, 'utf8');
    expect(body).toContain(subtask.report as string);
  }
  expect(handoff).toContain('## Specialists without a deliverable');
  expect(handoff).toContain('Computer permission is disabled.');
  // No temp files were left half-written.
  expect(runDirFiles().filter((name) => name.endsWith('.tmp'))).toEqual([]);
});

it('handles the single-specialist case', () => {
  const brief = task([subtask('rfi', 'Market scan', { report: 'Only specialist.' })]);

  const handoff = finalizeSwarmRun(brief);

  expect(brief.artifacts).toHaveLength(1);
  expect(existsSync(brief.artifacts?.[0] as string)).toBe(true);
  expect(handoff).toContain('## Specialist artifacts');
  expect(handoff).toContain('only-specialist' in brief ? '' : '');
  expect(handoff.split('\n').filter((line) => line.startsWith('- '))).toHaveLength(1);
});

it('keeps the run alive when the artifact directory cannot be written', () => {
  const brief = task([
    subtask('rfi', 'Market scan', { report: 'Report survives a write failure.' }),
  ]);
  // Occupy the run-directory path with a file so mkdir/write must fail.
  mkdirSync(swarmRoot, { recursive: true });
  writeFileSync(join(swarmRoot, 'run-1234'), 'not a directory', 'utf8');

  // Must not throw: a failed handoff degrades to "no artifacts", not a crash.
  const handoff = finalizeSwarmRun(brief);

  expect(brief.artifacts).toEqual([]);
  expect(brief.subtasks[0].artifactPath).toBeUndefined();
  expect(handoff).toContain('No artifact files were produced');
  // The orchestrator still gets the specialist report to work from.
  expect(brief.subtasks[0].report).toBe('Report survives a write failure.');
  expect(swarmHandoffMarkdown(brief)).toContain('No artifact files were produced');
});
