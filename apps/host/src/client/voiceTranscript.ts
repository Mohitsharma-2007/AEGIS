import { api } from './api';

// Voice turns are first-class conversation turns. Every completed utterance
// (user) and every completed spoken reply (agent) is written to the same
// thread store the typed chat uses, echoed to the open chat immediately, and
// mirrored into the memory daemon so later turns can recall it.

export interface VoiceTurn {
  threadId: string;
  role: 'user' | 'agent';
  text: string;
  id?: string;
}

const MEMORY_URL = 'http://127.0.0.1:8765/memories';

function remember(turn: VoiceTurn) {
  void fetch(MEMORY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: turn.text,
      content: turn.text,
      source: 'voice',
      role: turn.role === 'agent' ? 'assistant' : 'user',
      threadId: turn.threadId,
      createdAt: Date.now(),
    }),
  }).catch(() => {
    // The daemon is optional; the conversation copy above is authoritative.
  });
}

export async function persistVoiceTurn(
  threadId: string,
  role: 'user' | 'agent',
  text: string,
) {
  const value = text.trim();
  if (!threadId || !value) return;
  const turn: VoiceTurn = { threadId, role, text: value };
  try {
    const saved = await api<{ id?: string }>(
      `/conversations/${threadId}/messages`,
      'POST',
      { role: role === 'agent' ? 'assistant' : 'user', content: value },
    );
    if (saved && typeof saved.id === 'string') turn.id = saved.id;
  } catch {
    // Keep the spoken turn visible even if persistence failed; the UI event
    // still fires and the error is visible in the transcript on reload.
  }
  remember(turn);
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function')
    window.dispatchEvent(new CustomEvent<VoiceTurn>('aegis:voice-turn', { detail: turn }));
}

/** Subscribe to voice turns for one thread. Returns an unsubscribe function. */
export function subscribeVoiceTurns(
  threadId: string,
  listener: (turn: VoiceTurn) => void,
) {
  // Test renderers and non-browser shells may expose a partial window.
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function')
    return () => {};
  const handler = (event: Event) => {
    const turn = (event as CustomEvent<VoiceTurn>).detail;
    if (!turn || turn.threadId !== threadId) return;
    listener(turn);
  };
  window.addEventListener('aegis:voice-turn', handler);
  return () => window.removeEventListener('aegis:voice-turn', handler);
}
