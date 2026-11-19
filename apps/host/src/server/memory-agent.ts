// AGS memory agent: the one place that decides what is worth remembering.
//
// The main agent does not write memory directly. It hands the candidate to
// this module, which judges it against a policy (durable fact or preference
// about the owner, vs. task narration, tool noise, one-off detail, secret),
// dedupes it, and only then commits it to the memory engine. Clutter that used
// to pile up in retrieval ("[Action: desktop_ui] Take snapshot to get refs",
// "Let me open WhatsApp", screenshot narrations) is rejected here.

import type { Store } from './store.js';
import { indexDocument } from './memory-document-service.js';

export type MemoryKind = 'fact' | 'preference' | 'event' | 'instruction' | 'note';

export interface MemoryCandidate {
  text: string;
  source?: string;
  kind?: MemoryKind;
  context?: string;
  category?: 'personal' | 'task' | 'preference' | 'note';
  scopeId?: string;
  /** The owner asked for this explicitly, so skip the durability policy. */
  force?: boolean;
}

export interface MemoryDecision {
  accept: boolean;
  reason?: string;
  kind: MemoryKind;
  importance: number;
  text: string;
}

export interface MemoryAgentResult {
  stored: boolean;
  reason?: string;
  id?: string;
  text?: string;
  kind?: MemoryKind;
  duplicateOf?: string;
}

const MIN_LENGTH = 8;
const MAX_LENGTH = 600;

/** Narration of what the agent is doing right now is not memory. */
const TRANSIENT_PATTERNS: RegExp[] = [
  /\[Action:/i,
  /^\s*(let me|i'?ll|i will|i'?m going to|now i|next,|first,|okay,|sure,)\b/i,
  /^\s*(searching|opening|taking|capturing|checking|clicking|reading|snapshotting)\b/i,
  /\b(screenshot|snapshot|desktop_ui|list_windows|open_app|tool call|tool result)\b/i,
  /\b(thinking|working on it|one moment)\b/i,
];

/** Secrets never belong in memory, even if the owner says them. */
const SECRET_PATTERN =
  /(password|passwd|api[\s_-]?key|secret|access[\s_-]?token|bearer\s|-----BEGIN|sk-[a-z0-9]{12,})/i;

/** Statements that usually describe something durable about the owner. */
const DURABLE_PATTERNS: RegExp[] = [
  /\b(i|my|me|we|our)\b[^.]{0,60}\b(prefer|like|love|hate|want|need|use|work|live|study|am from|name is|call me|go by)\b/i,
  /\bmy (name|timezone|time zone|location|address|language|editor|browser|stack|company|team|role)\b/i,
  /\b(always|never|from now on|remember (that|this)|by default|instead of|don'?t|do not|please use|stick to)\b/i,
  /\b(answers?|replies|responses?)\b[^.]{0,40}\b(short|concise|brief|detailed|formal|casual|bullet)\b/i,
];

const PREFERENCE_PATTERN =
  /\b(prefer|like|hate|always|never|by default|from now on|don'?t|do not|instead of)\b/i;

function normalise(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/^["'“”]+|["'“”]+$/g, '')
    .trim();
}

/**
 * Judge a candidate without writing anything. Pure and deterministic so the
 * same input always lands the same way and a test can assert on it.
 */
export function decideMemory(
  candidate: MemoryCandidate,
): MemoryDecision {
  const kind = candidate.kind ?? 'fact';
  const text = normalise(candidate.text ?? '');
  const reject = (reason: string, importance = 0.2): MemoryDecision => ({
    accept: false,
    reason,
    kind,
    importance,
    text,
  });

  if (candidate.force === true) {
    // Secrets are still refused even for an explicit save request.
    if (SECRET_PATTERN.test(text)) return reject('contains_secret');
    return { accept: true, kind, importance: 0.9, text };
  }

  if (text.length < MIN_LENGTH) return reject('too_short');
  if (text.length > MAX_LENGTH) return reject('too_long');
  if (SECRET_PATTERN.test(text)) return reject('contains_secret');
  if (/\?\s*$/.test(text)) return reject('is_a_question');
  if (TRANSIENT_PATTERNS.some((pattern) => pattern.test(text))) {
    return reject('task_narration');
  }

  const durable = DURABLE_PATTERNS.some((pattern) => pattern.test(text));
  // An explicit instruction from the owner is worth keeping even when it does
  // not mention "I": "Always answer in Hinglish" carries no first person.
  const explicitInstruction =
    kind === 'instruction' && !TRANSIENT_PATTERNS.some((p) => p.test(text));

  if (!durable && !explicitInstruction) return reject('not_durable');

  const importance = PREFERENCE_PATTERN.test(text) ? 0.8 : 0.65;
  const resolvedKind: MemoryKind = PREFERENCE_PATTERN.test(text)
    ? 'preference'
    : candidate.kind ?? 'fact';

  return { accept: true, kind: resolvedKind, importance, text };
}

/** True when this text is already stored (avoids the same fact twice). */
function findDuplicate(store: Store, text: string): string | undefined {
  const needle = normalise(text).toLowerCase();
  const existing = store
    .memoryDocuments()
    .find((doc) => normalise(doc.content).toLowerCase().includes(needle));
  if (existing) return existing.id;
  const personal = store
    .memories?.()
    ?.find((memory) => normalise(memory.text).toLowerCase() === needle);
  return personal?.id;
}

/**
 * Memory agent entry point: decide, dedupe, then commit through the memory
 * engine. Returns a decision either way so the caller can tell the owner that
 * something was deliberately not saved.
 */
export async function runMemoryAgent(
  store: Store,
  candidate: MemoryCandidate,
): Promise<MemoryAgentResult> {
  const decision = decideMemory(candidate);
  if (!decision.accept) {
    return { stored: false, reason: decision.reason, kind: decision.kind };
  }

  const duplicateOf = findDuplicate(store, decision.text);
  if (duplicateOf) {
    return {
      stored: false,
      reason: 'duplicate',
      duplicateOf,
      kind: decision.kind,
      text: decision.text,
    };
  }

  const header = [
    `[kind: ${decision.kind}]`,
    `[source: ${candidate.source ?? 'agent'}]`,
    `[importance: ${decision.importance.toFixed(2)}]`,
    candidate.context ? `[context: ${candidate.context}]` : null,
  ]
    .filter(Boolean)
    .join(' ');

  const doc = store.saveMemoryDocument({
    title:
      decision.text.length > 60
        ? `${decision.text.slice(0, 57)}…`
        : decision.text,
    content: `${header}\n\n${decision.text}`,
    format: 'memory',
    indexState: 'pending',
  });
  // The memory engine indexes it so retrieval can use it immediately.
  await indexDocument(store, doc, {
    category: candidate.category ?? 'personal',
    scopeId: candidate.scopeId,
  });

  return {
    stored: true,
    id: doc.id,
    text: decision.text,
    kind: decision.kind,
  };
}
