# Orchestration & Message-Passing Notes for Aegis (Milestone 5)

Reference repos cloned (shallow, `--depth 1`, default branch) into this folder on 2026-11-17:

| Repo | Status | Branch/Head |
|---|---|---|
| n8n-io/nod | ✅ cloned | default |
| cosmicstack-labs/mercury-agent | ✅ cloned | default |
| google-research/harness2 | ✅ cloned | default |
| croffasia/itsaplan | ✅ cloned | default |

No dependencies were installed and nothing was built; this is source reading only.

---

## 1. n8n Nod

Nod is a personal agent (not a multi-agent platform), but its `delegate` mechanism is the
cleanest example of **file-based subagent handoff with lineage and permission gating**.

**Pattern: task decomposition + parallel in-process subagents + per-subagent workspace dir + reply-as-tool-result.**

- The `delegate` tool (`src/runtime/tools.ts:282`) runs one part of a request as a subagent.
  Key contract text:

  > "Run one part of the request as a subagent with its own browser, Nod's tools and the shared
  > workspace, and get its final answer back. Call it several times in one step to run independent
  > parts in parallel… The instruction must be complete on its own: the subagent does not see this
  > conversation. Each subagent writes new files in its own directory inside the shared workspace.
  > A subagent cannot delegate, ask or send chat messages to the owner, connect apps, sign in, pay
  > or open saved browser sessions. It returns questions and blockers to you; handle those yourself."

- Implementation (`src/runtime/index.ts:867-948`): each child gets a fresh `runId`, its own
  browser and its own directory under the shared sandbox workspace:

  ```ts
  const runId = randomUUID();
  const source: ExecutionScope = { ...execution, runId, parentRunId: execution.runId, browserId: childBrowser };
  const childPath = `${workspace.path}/.nod/runs/${runId}`;
  // child = await agent.open({ ...source, ephemeral: true, workspace: { path: childPath }, ... });
  // child.prompt(`You are a subagent doing one part of the owner's request… ${instruction}
  //   Your working directory is ${childPath}. Write new files there. The shared workspace is ${workspace.path}.
  //   Return any question or browser blocker to the parent agent. …`)
  ```

  The child's final text is returned to the parent as an **untrusted tool result**; children can
  write files into their own dir but cannot ask the owner (a child action that would ask is
  refused — `src/server/local-files.ts`, `src/server/trust.ts`).

- **Identity/lineage:** one `ExecutionScope` links thread → session → turn → run → parentRun →
  browser IDs (`src/server/turn-chain.ts`, `src/runtime/index.ts`). Subagents are identified by
  `execution.parentRunId`; every turn/action is audited (`turn_events`, `model_usage` ledger).

- **Permission gating:** a single trust checker (`src/server/trust.ts`) must quote the owner's
  words verbatim for any committed action. Subagents never ask — they bubble the question back to
  the parent, which is the only component allowed to ask. Writes run under a per-turn lock
  (`withTurnLock`) so Stop refuses late writes. Confirmed actions are fenced to the exact action +
  arguments; repeats are refused.

- **Message passing:** there is no internal mailbox. Communication is (a) the parent→child prompt
  instruction, (b) child→parent returned answer, and (c) files in the shared workspace
  (`.nod/runs/<runId>/`). Concurrency is bounded by the browser pool and per-turn budgets, not by
  a spawn queue. Sessions are serial per thread, parallel across threads.

**What Aegis should take:** self-contained instruction contract (child never sees the parent
conversation), per-subagent working directory in a shared root, lineage IDs, and "a subagent
cannot ask; return the question to the parent" escalation rule + trust-check gating.

---

## 2. Mercury Agent (cosmicstack-labs)

Mercury is the richest reference for **durable queues + mailboxes + permission gating + bounded
storage**. Two layers: in-process subagents (supervisor) and a full bot fleet (queue + bus +
inbox).

### 2a. Sub-agent supervisor (`src/core/subagent.ts`, `src/core/supervisor.ts`)

- `SubAgent` is an in-process coroutine: own LLM loop (`maxSteps` default 25), tool allowlist,
  file locks (read/write per path), token tracking, progress callbacks, a **frozen permission
  context derived at spawn** (`deriveChildContext`; child ⊆ parent). All tool resolution runs
  under that context via `AsyncLocalStorage`:

  ```ts
  // sub-agent.ts
  private permissionContext?: PermissionContext;
  async run(): Promise<SubAgentResult> {
    const ctx = this.getPermissionContext();
    // frozen at spawn: child ⊆ parent (see permission-context.ts)
    return permissions.withContext(ctx, () => this.runInContext());
  }
  ```

- `Supervisor.spawn()` (`src/core/supervisor.ts:126`) snapshots the caller's permission context
  **now**, registers lineage (`parents` map: agentId → parentId), and enforces concurrency:

  ```ts
  if (!this.resourceManager.canSpawn()) { this.waitQueue.push(fullConfig); return id; }
  const running = this.getRunningCount();
  if (running >= this.resourceManager.getMaxConcurrent()) { this.waitQueue.push(fullConfig); return id; }
  ```

  The `TaskBoard` tracks `pending/running/…` + progress + token usage per agent, persisted across
  restarts (progress files).

### 2b. Durable bot queue — jobs AND mail in one store (`src/bots/queue.ts`)

- Backend chain: SQLite → WASM sql.js → JSON-file lease store (chosen by probe; correctness never
  depends on SQLite because the queue is single-writer).
- Job row: `id, botId, trigger, prompt, fromBot, attachments (paths), source, state
  (pending|claimed|dead), attempts, createdAt, leaseExpiresAt, idempotencyKey, reasonCode,
  settledAt, runAfter`. Claim/lease = 60s heartbeat, expired leases requeue; `attempts` cap →
  DLQ (cap 100, inspectable/replayable). Idempotency keys dedupe.
- **Mail is a first-class durable object in the same store:**

  ```ts
  export interface DurableMail { id: string; botId: string; from: string; content: string; createdAt: number; }
  // backend: enqueueMail(mail): string;  drainMail(botId): DurableMail[];
  ```

- Delivery semantics (`src/bots/tools/bot-send.ts`): `bot_send(target, message, task?)` —
  fire-and-forget vs **delegation**. `task:true` enqueues a job; the target's result is delivered
  back to the sender's mailbox on completion. Roster check (`canMessage`), no self-messaging,
  typed failure codes (`target_disabled`, `queue_full`, `busy_timeout`). No nested invocation —
  always queued behind the target's active turn.

### 2c. Owner inbox — delivery/read state with bounded storage (`src/bots/inbox.ts`)

- Append-only JSONL log (`inbox.jsonl`) + separate read-marks file (`inbox-read.json`), so
  appends never rewrite read state. Rotation at 2 MB keeping the newest 500 entries.
- Entry shape (this is essentially the Aegis "delivery/read" model):

  ```ts
  export type BotInboxKind = 'result' | 'failed' | 'needs-you';
  export interface BotInboxEntry {
    id: string; botId: string; botName: string; runId: string;
    kind: BotInboxKind;
    title: string;            // short line for lists/notifications
    summary: string;          // capped at 4000 chars
    files: string[];          // delivered artifact paths
    complete?: boolean;
    reasonCode?: string;      // why it needs you (dead-lettered)
    approvalId?: string;      // a bot question waiting for your answer
    at: number; read: boolean;
  }
  ```

### 2d. Permission/approval gating (`src/capabilities/permissions.ts`)

- Path-scoped manifests (`FileScope {path, read, write}`, `approveWrite`, auto-approved command
  patterns), per-context approval maps, turn grants.
- **Fail-closed for non-interactive workers:** bots get no interactive approval ever — a prompt
  inside a bot turn auto-resolves **deny** and is journaled with an `auto_deny` reason code. The
  owner sees denials in the journal and can widen scopes at setup/review time.
- Hard caps enforced at write time (not cleanup crons): queue 100/bot, DLQ 100, transcripts,
  inbox rotation; shared-folder janitor (7-day hot → archive → 30-day delete; `outputs/` exempt).

**What Aegis should take:** durable queue+mail store with leases and DLQ, idempotency keys,
append-only inbox + separate read marks + rotation, fail-closed deny for subagents, spawn-time
frozen permission context, and mandatory per-store caps.

---

## 3. Google Research Harness²

Harness² is an evaluation/refinement framework, not a production runtime — but it has the best
**markdown-file-defined subagent** pattern and a two-phase **propose → probe → compose** loop.

- **Subagents are files:** `sub_agents/<name>/AGENT.md` with frontmatter `mode: subagent` and
  `description:`. Tree validation requires both (`harness2/core/tree.py:307-313`); the composed
  prompt advertises them and invokes them via a `task` tool in their own context:

  ```
  # AVAILABLE SUBAGENTS
  Delegate with the `task` tool when the situation matches:
  - `name`: description
  ```

  (`harness2/substrate/opencode.py:156-161`, `core/prompts.py:429-437`; the codex substrate uses
  the same `sub_agents/<name>/AGENT.md` convention.)

- **Task-level recursion** (`core/recursion.py`): a proposer proposes invariant/domain candidate
  edits, probes execute them as rollouts (separate working dirs), a composer combines evidence into
  the final harness. Parallel mode runs `k` candidates per scope; the evidence tree
  (`core/context.py`) is "the only way evidence reaches a model" — i.e., structured, versioned
  evidence handoff rather than chat.

- **Concurrency:** `--workers N` runs N domains concurrently, tasks within a domain stay ordered;
  `--max-tasks` caps per domain; `ThreadPoolExecutor(max_workers=parallel)`; invalid proposals get
  one retry before inheriting the current harness; shared base executions are deduplicated.

- **No mailboxes, no approval gating** — it is a batch eval loop. Versioned, task-scoped harness
  revisions require a promotion gate + rollback (per PLANIT's Harness² section).

**What Aegis should take:** markdown-defined agent roles (`mode: subagent` + `description:`)
with strict frontmatter validation, and the reviewer/auditor gate concept: a candidate result is
not "complete" until it passes a review stage with evidence.

---

## 4. It's a Plan (itsaplan)

The strongest reference for **agents as first-class members with roles, a run queue with leases,
concurrency limits, and a typed notification inbox (delivery/read state)**.

- **Agent identity:** `ai_agent` row = `team_id` + `user_id` (a bot user it acts as) + enabled
  tool keys + `run_timeout_sec`. An agent's role is its `project_member` row per project; its
  rights are the **intersection** of that role and its tool keys. Agents can never be project
  owners (`docs/dev/agents.md`, `apps/api/src/modules/agents/model.ts`).

- **Runs:** `agent_run` rows carry `id, agentId, projectId, issueId, scheduleId, trigger,
  status, executionState, claimed_at, lease_expires_at, attempts, next_attempt_at,
  execution_started_at, last_error, input/outputTokens`. `status` stays `pending` while claimed;
  `executionState` is `running|queued`. Claims use leases under an advisory lock (safe across API
  replicas); a claim's lease is ≥ timeout + 60s; timed-out runs abort → `failed` and are **not**
  retried; retry backoff with `attempts` consumes attempts.

- **Concurrency limits:** instance-level `maxConcurrentRuns` (default 5, 0 = none) applied under
  an advisory lock, plus per-workspace `max_concurrent_runs`; a deferred/backoff run leaves its
  slot. Admission is an extension point (`core/run-admission.ts`: `runAdmissionDelay(run)`).

- **Triggers (dispatch):** a run starts on an @mention in a comment on an issue/document, on an
  assignment, on a schedule (cron), or on a workflow state transition — "build a workflow that
  passes an issue from agent to agent" via automatic assignment when an issue moves to a state.
  External runner queue exists too (Codex session links; transcripts per attempt with event-offset
  dedupe, 2,000-event / 1 MB caps).

- **Notification inbox (delivery/read state):** `notifications` rows —

  ```ts
  { id, type: 'assigned'|'mentioned'|'commented'|'state_changed'|'reacted',
    actorUserId, actorName, readAt, snoozedUntil, createdAt,
    issueId, issueSeq, issueTitle, issueStateType, issueCommentId,
    documentId, documentTitle, documentIcon, documentCommentId,
    projectId, projectKey, projectName, fromState, toState, reactionEmoji }
  ```

  Cursor paging, unread counts, bulk mark-read/delete scopes. This is a full "inbox with read
  state" primitive (minus BCC — there is no CC concept).

**What Aegis should take:** per-task run rows with status vs execution state, leases + backoff +
terminal failed, instance+workspace concurrency caps with admission hooks, state-transition
triggering, and the typed notification inbox with `readAt`/snooze and actor attribution.

---

## 5. Recommended design for Aegis

Target: PLANIT.md M5 — "internal, persisted mailboxes for the user and agents… orchestrator
owns dispatch; agents can send Markdown handoffs, questions, and verification requests to named
recipients, and the user can address an agent directly. Mail threads need stable IDs, sender/
recipient identity, timestamps, task links, delivery/read state, audit records, bounded storage,
and permission-aware approval forwarding. In-app simulation only — no SMTP/Gmail/external mail.
Agent spawning remains orchestrator-controlled, with explicit concurrency/depth limits and
reviewer/auditor steps."

Aegis already has a file-based orchestrator: `apps/host/src/server/agent-swarm.ts` (roster =
`aegis` orchestrator + 5 specialists; tasks persisted under `.aegis-data/agent-swarm/`; per-task
markdown artifact files + a `handoff` summary). The design below extends that module rather than
adding a new runtime. The host's existing `harness.ts` stays the execution engine; this is the
reasoning/mail layer.

### 5a. Storage layout

All under `<aegisRoot>/.aegis-data/agent-swarm/` (same root as today):

```
agent-swarm/
├── tasks/<taskId>/
│   ├── plan.md                  # orchestrator-owned plan: milestones, permissions, reviewer/auditor slots
│   ├── handoff.md               # canonical handoff document (existing M5 spec item)
│   └── artifacts/<name>.md      # specialist deliverables (existing)
├── mailboxes/
│   ├── user@aegis/              # one mailbox for the owner
│   │   ├── inbox/<messageId>.md
│   │   ├── sent/<messageId>.md
│   │   ├── reads.json           # { "<messageId>": firstReadAt } — separate from mail files
│   │   └── quota.json           # counts/bytes (bounded storage)
│   ├── orchestrator@aegis/
│   └── agent/<slug>@aegis/      # one per spawned subagent (slug = agent id, e.g. agent/rfi@aegis)
├── audit/mail.jsonl              # append-only audit log (bounded, rotated)
└── tasks.json                    # existing task index
```

### 5b. Mail file format (Markdown + YAML frontmatter)

One file per message; the body is the Markdown handoff, the envelope is frontmatter. Delivery =
atomic copy/rename into each recipient's `inbox/` (no rewriting of a message for read state —
read state lives in `reads.json`, like Mercury's `inbox-read.json`).

```markdown
---
id: 9f1c…a2
threadId: t_7b0e…            # stable thread ID across replies
from: orchestrator@aegis
to:
  - agent/rfi@aegis
cc:
  - agent/security@aegis
bcc: []                       # stripped from recipient copies; kept only in sender's sent/ copy + audit
inReplyTo: 3ae8…11            # for replies
taskId: t_42
milestone: 2
kind: task                    # task | handoff | question | verification | reply | progress | report | approval-request | approval-decision
createdAt: 2026-11-17T10:04:00Z
deliveredAt: 2026-11-17T10:04:01Z   # set by the messenger on delivery
readAt: null                  # derived from reads.json, not stored in the file
requiresApproval: false       # true => orchestrator routes through the approval gate
audit: []                    # append-only event refs (mail.jsonl line ids)
---

## Task: research RFI for Aegis

<payload markdown — the handoff/instruction/question/verification/report>
```

- **IDs:** `messageId` = uuid; `threadId` = uuid minted on first send of a thread; `taskId`
  links mail to the plan. Sender/recipients are mailbox addresses (`user@aegis`,
  `orchestrator@aegis`, `agent/<slug>@aegis`) — stable, internal, never external.
- **Kinds:** `task` (dispatch), `handoff` (pass a partial result + open questions to the next
  specialist), `question`/`verification` (request confirmation — these are what get approval-gated),
  `progress`, `report` (final), `approval-request`/`approval-decision` (reviewer/auditor/user lanes).

### 5c. Orchestrator workflow

1. **Plan.** User creates a task (chat or drop). Orchestrator mints `taskId`, writes
   `tasks/<taskId>/plan.md` with milestones, required permissions, and assigned reviewer/auditor
   slots, and creates the task's mail thread (`threadId`).
2. **Dispatch = spawning.** The orchestrator owns every spawn (no other component may spawn).
   It sends `kind: task` mail to `agent/<slug>@aegis`. Spawning obeys explicit limits
   (Mercury supervisor + itsaplan):
   - concurrency: `maxConcurrentAgents` (host setting, default 5) — excess spawns stay `pending`
     in the task plan and are queued, not refused;
   - depth: `maxDepth` 3 (a subagent may request a spawn, but the orchestrator decides; children
     can never spawn grandchildren autonomously);
   - lineage: each spawned agent records `parentRunId`/`parentAgentId` in its envelope and audit.
3. **Child runtime.** When a subagent runs, its mailbox is its input source. The host hands it a
   `mail_read` / `mail_reply` tool (or the runtime reads its `inbox/` directly). The child works
   in its own `tasks/<taskId>/artifacts/<slug>/` directory, writes progress as `kind: progress`
   mail (and `progress` files), and replies with `kind: report` or `kind: handoff` (with CCs).
4. **Delivery/read state.** The messenger service: (a) on send, writes `sent/<messageId>.md` to
   the sender and appends to `audit/mail.jsonl`; (b) delivers a copy into each recipient's
   `inbox/` (setting `deliveredAt`), BCC copies only to sender + audit; (c) records `readAt` in
   `reads.json` when a recipient reads it. The user's inbox is surfaced in the app (list, unread
   count, thread view) — same UX as the existing chat/activity surfaces.
5. **Permission-aware approval forwarding.** When a child sends `question`/`verification` mail
   (or tries an action outside its frozen permission scope), the orchestrator applies the gate:
   - within the child's granted scope → auto-allow (with audit);
   - outside scope, interactive owner available → forward as `approval-request` to
     `user@aegis`; the owner's `approval-decision` reply is appended to the thread and the
     orchestrator releases the blocked child by delivering new mail to its inbox;
   - outside scope, non-interactive (e.g. scheduled/auditor context) → **auto-deny**, journaled
     with a reason code (Mercury fail-closed rule). A subagent never prompts the user directly.
6. **Reviewer/auditor stages.** The plan may name a reviewer mailbox (e.g.
   `agent/security@aegis`). Before a task reaches `completed`, the orchestrator sends
   `kind: verification` to the reviewer; the reviewer's `report` (approve/request-changes) is a
   gate. All gates are audit-logged with the message IDs. (This is the Harness² promotion-gate
   idea applied to mail.)
7. **Completion & bounded storage.** On completion, orchestrator sends final `report` to the user
   and closes the task. Mailboxes are bounded at write time: per-mailbox cap of 1,000 messages /
   25 MB, `inbox` rotation to `archive/<yyyy-mm>/` and purge after 31 days (Mercury janitor rule);
   `audit/mail.jsonl` rotates at 2 MB keeping the newest 1,000 lines; `reads.json` is pruned with
   the archived messages.

### 5d. What maps to what

| PLANIT requirement | Borrowed from |
|---|---|
| Internal, persisted mailboxes | Mercury `DurableMail` + itsaplan run rows (persisted under `.aegis-data/agent-swarm`) |
| Stable IDs, sender/recipient, timestamps, task links | nod `ExecutionScope` lineage + envelope frontmatter |
| Delivery/read state | Mercury `inbox.jsonl` + `inbox-read.json`; itsaplan `readAt`/unread counts |
| Markdown handoffs + progress files | existing `agent-swarm.ts` artifacts + `handoff.md`; Nod child-dir files |
| Bounded storage | Mercury hard caps at write + rotation/janitor |
| Permission-aware approval forwarding | nod trust gate (subagent never asks) + Mercury fail-closed `auto_deny` + user inbox forwarding |
| Concurrency/depth limits, orchestrator-controlled spawn | Mercury supervisor queue (`canSpawn`/`getMaxConcurrent`) + lineage `parents` map; itsaplan `maxConcurrentRuns` + admission hook |
| Reviewer/auditor stages | Harness² review gate on evidence; itsaplan state-transition triggers |
| No external email/SMTP | mailbox addresses are internal `@aegis` only; no gateway |

**Minimal implementation order:** (1) mailbox dirs + envelope format + messenger (send/deliver/
read/audit) + `mail.jsonl`; (2) wire `agent-swarm.ts` to send/receive instead of direct synthesis
(keep existing artifact flow); (3) spawn gate with concurrency/depth limits + frozen permission
context; (4) approval forwarding + auto-deny; (5) reviewer/auditor stage + quota/rotation.
