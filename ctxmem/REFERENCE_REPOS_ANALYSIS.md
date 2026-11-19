# Aegis Reference Repositories — Analysis & Implementation Guide

> This document analyzes the four reference repos cloned into `D:\Aegis 2\reference-repos\` on 2026-11-17.
> For each repo: **punctuality** (why it's relevant right now), **main reason** for studying it,
> and **what we can implement** in Aegis based on its patterns. Source: `ORCHESTRATION-NOTES.md`
> and direct codebase reading.

---

## Repository Overview

| Repo | Status | Cloned | Primary Value |
|------|--------|--------|---------------|
| n8n-io/nod | ✅ cloned | default branch | File-based subagent handoff with lineage + permission gating |
| cosmicstack-labs/mercury-agent | ✅ cloned | default branch | Durable queues + mailboxes + permission gating + bounded storage |
| google-research/harness2 | ✅ cloned | default branch | Markdown-file-defined subagents + propose→probe→compose review loop |
| croffasia/itsaplan | ✅ cloned | default branch | Agents as first-class members with run queues, leases, typed notification inbox |

No dependencies were installed; source reading only.

---

## 1. n8n-io/nod

### Punctuality (Why Now)
Nod's `delegate` mechanism is the cleanest example of **file-based subagent handoff with lineage and permission gating**. Aegis needs a subagent model where children are isolated, audited, and cannot run away with the owner's conversation or credentials — this is directly relevant to the Aegis agent-swarm module.

### Main Reason for Studying
To understand how to run subagents as separate processes with their own working directory, browser, and tool set — while returning results as **untrusted tool results** that the parent must verify. The lineage model (thread → session → turn → run → parentRun → browser) provides a template for Aegis's execution scope tracking.

### What We Can Implement

| Pattern | Aegis Implementation |
|---------|---------------------|
| `delegate` tool — one subagent per task part, parallel execution | Add to `agent-swarm.ts`: `delegate(task, instruction, workspaceDir)` that spawns a specialist agent in an isolated dir |
| Per-subagent working dir under shared root (`.nod/runs/<runId>/`) | Each specialist gets `tasks/<taskId>/artifacts/<slug>/` |
| ExecutionScope lineage (thread → session → turn → run → parentRun → browser) | Track `parentRunId`/`parentAgentId` in every mail envelope and audit entry |
| Single trust checker — subagents never ask owner; they bubble questions back | Child agents send `kind: question` mail to `user@aegis`; parent decides |
| Fail-closed for non-interactive agents — auto-deny with reason code | If child requests action outside frozen permission scope → auto-deny, journaled |
| Per-turn lock on writes; confirmed actions fenced to exact action + args | Writes to `tasks/<taskId>/artifacts/` run under per-turn lock |

### Source Files Referenced
- `src/runtime/tools.ts:282` — `delegate` tool contract
- `src/runtime/index.ts:867-948` — child spawn with fresh `runId`, browser, workspace dir
- `src/server/local-files.ts`, `src/server/trust.ts` — child cannot ask owner
- `src/server/turn-chain.ts` — ExecutionScope lineage
- `src/server/trust.ts` — single trust checker

---

## 2. cosmicstack-labs/mercury-agent

### Punctuality (Why Now)
Mercury is the **richest reference for durable queues + mailboxes + permission gating + bounded storage**. Aegis's internal mail system (mailbox.ts, mail-routes.ts, mail-orchestrator.ts) directly mirrors Mercury's design. This is the most important reference for the M5 mail milestone.

### Main Reason for Studying
To build a durable, crash-safe internal mail system where agents and the owner communicate through persisted markdown messages with delivery/read state, bounded storage, and permission-aware forwarding.

### What We Can Implement

| Pattern | Aegis Implementation |
|---------|---------------------|
| Durable queue + mail store (SQLite → JSON file lease) | `mailbox.ts` already implements this with `<messageId>.md` files + `reads.json` + `mail.jsonl` audit |
| DurableMail per-bot mailbox (enqueue/drain) | `sendMail()` delivers to each recipient's `inbox/`; `listMailbox()` drains |
| Job row with state (pending|claimed|dead), attempts, idempotencyKey | `mail-processed.json` tracks dispatched messageIds with `reported` flag |
| Claim/lease = 60s heartbeat, expired leases requeue | Mail orchestrator sweep polls every 2s; unread task mail filtered by `!readAt` |
| Append-only inbox + separate read-marks file + rotation at 2MB | `reads.json` separate from `.md` files; `mail.jsonl` audit rotates at 2MB keeping 1000 lines |
| `bot_send(target, message, task?)` — fire-and-forget vs delegation | `sendMail(kind='task')` dispatches; `sendMail(kind='reply')` replies on same thread |
| Fail-closed for non-interactive workers — auto-deny | Child agents outside frozen permission scope get auto-denied with reason code |
| Hard caps at write time (queue 100/bot, DLQ 100) | Per-mailbox cap: 1000 messages, 25MB; archive overflow to `archive/YYYY-MM/` |

### Source Files Referenced
- `src/bots/queue.ts` — durable queue + DurableMail
- `src/bots/tools/bot-send.ts` — delivery semantics (fire-and-forget vs task delegation)
- `src/bots/inbox.ts` — owner inbox with delivery/read state + rotation
- `src/capabilities/permissions.ts` — path-scoped manifests, fail-closed deny

---

## 3. google-research/harness2

### Punctuality (Why Now)
Harness² is an **evaluation/refinement framework**, not a production runtime — but it has the best **markdown-file-defined subagent** pattern and a two-phase **propose → probe → compose** loop. This is relevant for Aegis's specialist agents (RFI, Sentinel, Filo, Memo, Computer, Memory) which need defined roles and review gates.

### Main Reason for Studying
To understand how to define agents as markdown files with strict frontmatter validation, and how to implement a reviewer/auditor gate where a candidate result is not "complete" until it passes a review stage with evidence.

### What We Can Implement

| Pattern | Aegis Implementation |
|---------|---------------------|
| Subagents as Markdown files (`sub_agents/<name>/AGENT.md` with `mode: subagent` + `description:`) | Agent roster in `agent-swarm.ts` with `SwarmAgentDefinition` (id, name, role, description, capabilities, kind) |
| Frontmatter validation requires both mode + description | `SWARM_ROSTER` entries validated at load; missing fields rejected |
| Propose→probe→compose recursion with versioned evidence tree | `agent-swarm.ts` execute loop: plan → specialist evidence gathering → synthesis → report |
| Reviewer/auditor gate — result not "complete" until review stage | `mail-orchestrator.ts` sends `kind: verification` to reviewer before task reaches `completed` |
| Domain/worker concurrency controls with versioned evidence | `maxConcurrent` in mail orchestrator (default 2); tasks queued if at capacity |

### Source Files Referenced
- `harness2/sub_agents/<name>/AGENT.md` — agent definition format
- `harness2/core/tree.py:307-313` — tree validation
- `harness2/substrate/opencode.py:156-161` — composed prompt advertisement
- `harness2/core/recursion.py` — task-level recursion
- `harness2/core/context.py` — evidence tree

---

## 4. croffasia/itsaplan

### Punctuality (Why Now)
itsaplan is the **strongest reference for agents as first-class members with roles, a run queue with leases, concurrency limits, and a typed notification inbox**. Directly relevant to Aegis's agent roster, task dispatch, and mail notification system.

### Main Reason for Studying
To implement per-task run rows with status vs execution state, leases + backoff + terminal failed, instance+workspace concurrency caps, and state-transition triggering — all of which map to Aegis's agent-swarm + mail-orchestrator design.

### What We Can Implement

| Pattern | Aegis Implementation |
|---------|---------------------|
| Agent identity = team_id + user_id + enabled tool keys + run_timeout_sec | SwarmAgentDefinition with id, name, role, capabilities, kind |
| Agent role = project_member row; rights = intersection of role + tool keys | Agent capabilities gate tool access; `configured` flag = provider available |
| `agent_run` rows: status vs executionState, claimed_at, lease_expires_at, attempts | `mail-processed.json` tracks messageId → taskId with dispatchedAt/reportedAt |
| Claims use leases under advisory lock; lease ≥ timeout + 60s | Mail orchestrator sweep polls every 2s; max 2 concurrent |
| Timed-out runs abort → failed (not retried); retry backoff consumes attempts | `reportCompleted()` only sends reports for terminal statuses; failed tasks don't retry |
| Instance-level maxConcurrentRuns (default 5) + per-workspace caps | Mail orchestrator `maxConcurrent` (default 2); configurable per deployment |
| Triggers: @mention, assignment, schedule (cron), workflow state transition | Mail triggers on unread `task`-kind mail arriving in orchestrator inbox |
| Typed notification inbox: readAt, snoozedUntil, actor attribution | `reads.json` tracks readAt per messageId; unreadCount() filters `!readAt` |

### Source Files Referenced
- `docs/dev/agents.md`, `apps/api/src/modules/agents/model.ts` — agent identity model
- `apps/api/src/modules/agents/model.ts` — agent_run rows with status/executionState
- `core/run-admission.ts` — runAdmissionDelay(run) extension point

---

## 5. Recommended Aegis Design (from ORCHESTRATION-NOTES.md)

### Target Architecture (PLANIT.md M5)

**Storage layout** under `.aegis-data/agent-swarm/`:

```
agent-swarm/
├── tasks/<taskId>/
│   ├── plan.md          # orchestrator-owned plan
│   ├── handoff.md       # canonical handoff document
│   └── artifacts/<name>.md  # specialist deliverables
├── mailboxes/
│   ├── user@aegis/
│   │   ├── inbox/<messageId>.md
│   │   ├── sent/<messageId>.md
│   │   ├── reads.json   # {messageId: firstReadAt}
│   │   └── quota.json   # counts/bytes
│   ├── orchestrator@aegis/
│   └── agent/<slug>@aegis/
├── audit/mail.jsonl     # append-only, rotated
└── tasks.json           # task index
```

### Mail File Format (Markdown + YAML frontmatter)

```markdown
---
id: 9f1c…a2
threadId: t_7b0e…
from: orchestrator@aegis
to:
  - agent/rfi@aegis
kind: task
taskId: t_42
milestone: 2
createdAt: 2026-11-17T10:04:00Z
deliveredAt: 2026-11-17T10:04:01Z
requiresApproval: false
---

## Task: research RFI for Aegis

<markdown payload>
```

### Orchestrator Workflow (7 Steps)

1. **Plan** — User creates task; orchestrator mints taskId, writes plan.md, creates mail thread
2. **Dispatch** — Orchestrator sends `kind: task` mail to `agent/<slug>@aegis`; concurrency/depth limits enforced
3. **Child runtime** — Subagent reads mailbox, works in own artifacts dir, replies with `kind: report` or `kind: handoff`
4. **Delivery/read state** — Messenger writes sent/ copy, delivers to recipient inbox/, records readAt in reads.json
5. **Permission-aware approval** — `question`/`verification` mail → within scope = auto-allow; outside scope + interactive = forward to `user@aegis`; outside scope + non-interactive = auto-deny
6. **Reviewer/auditor stages** — `kind: verification` to reviewer before task completes; reviewer's `report` is a gate
7. **Completion & bounded storage** — Final report sent; mailbox caps enforced (1000 msgs / 25MB per mailbox)

### Mapping Table

| PLANIT Requirement | Borrowed From |
|-------------------|---------------|
| Internal persisted mailboxes | Mercury DurableMail + itsaplan run rows |
| Stable IDs, sender/recipient, timestamps, task links | nod ExecutionScope lineage + envelope frontmatter |
| Delivery/read state | Mercury inbox.jsonl + inbox-read.json; itsaplan readAt/unread |
| Markdown handoffs + progress files | existing agent-swarm.ts artifacts + handoff.md; Nod child-dir files |
| Bounded storage | Mercury hard caps at write + rotation/janitor |
| Permission-aware approval forwarding | nod trust gate + Mercury fail-closed auto_deny + user inbox |
| Concurrency/depth limits, orchestrator-controlled spawn | Mercury supervisor queue + lineage parents map; itsaplan maxConcurrentRuns |
| Reviewer/auditor stages | Harness² review gate on evidence; itsaplan state-transition triggers |
| No external email/SMTP | mailbox addresses are internal @aegis only |

### Minimal Implementation Order
1. Mailbox dirs + envelope format + messenger (send/deliver/read/audit) + mail.jsonl
2. Wire agent-swarm.ts to send/receive mail instead of direct synthesis
3. Spawn gate with concurrency/depth limits + frozen permission context
4. Approval forwarding + auto-deny
5. Reviewer/auditor stage + quota/rotation

---

## Implementation Status

All four reference repos have been **read and analyzed**. Their patterns have been incorporated into:

- `apps/host/src/server/mailbox.ts` — markdown mail core (Mercury + nod patterns)
- `apps/host/src/server/mail-routes.ts` — mail API routes (Mercury + itsaplan patterns)
- `apps/host/src/server/mail-orchestrator.ts` — orchestrator mail consumer (Mercury + itsaplan + Harness² patterns)
- `apps/host/src/server/agent-swarm.ts` — agent orchestration (nod + mercury + itsaplan patterns)
- `docs/ORCHESTRATION-NOTES.md` — full design specification

**No code was copied** — patterns were adopted and reimplemented in Aegis's own style with TypeScript/Node.js.
