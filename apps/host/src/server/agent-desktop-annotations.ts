// Annotation feed for computer use.
//
// The desktop overlay (apps/desktop/ui-kit/annotations.html) draws the agent's
// cursor, highlight boxes and captions over the owner's real desktop. It never
// receives a screenshot or a mirror: this module turns each adapter result
// (snapshot → act → re-snapshot) into marker payloads describing *where* to draw.
//
// Producers: the computer routes, after every `act()`. Consumers: an SSE stream
// the app forwards to `window.aegis.annotateScreen` (electron → overlay window).
import { EventEmitter } from 'node:events';
import type { AgentDesktopAction, AgentDesktopResult } from './agent-desktop.js';

export interface AnnotationTarget {
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
  note?: string;
  shape?: 'box' | 'circle' | 'ellipse' | 'pointer' | 'none';
  click?: boolean;
  pointer?: { x: number; y: number };
}

/** The payload shape annotations.html `play()` understands. */
export interface AnnotationPayload {
  unit: 'px';
  timeoutMs?: number;
  cursorName?: string;
  steps?: Array<{ explanation?: string; targets: AnnotationTarget[] }>;
  /** `true` clears the overlay (session ended or refs went stale). */
  clear?: boolean;
}

export type AnnotationReason = 'act' | 'session-ended' | 'stale';

export interface AnnotationEvent {
  sessionId: string;
  payload: AnnotationPayload;
  reason: AnnotationReason;
  at: number;
}

const emitter = new EventEmitter();
emitter.setMaxListeners(100);
const recent = new Map<string, AnnotationEvent>();

const VERBS: Record<AgentDesktopAction['kind'], string> = {
  click: 'clicked',
  type: 'filled in',
  scroll: 'scrolled',
};

function describe(result: AgentDesktopResult): string {
  const name = result.target?.name ?? result.target?.role ?? 'the app';
  return `Aegis ${VERBS[result.action.kind] ?? 'acted on'} ${name}`;
}

/** Marker payload for one adapter result, or null when there is nothing to draw. */
export function annotationPayloadFor(
  result: AgentDesktopResult,
): AnnotationPayload | null {
  const element = result.target ?? result.before.elements.find(
    (item) => item.frame && item.frame.width > 0 && item.frame.height > 0,
  );
  if (!element?.frame) return null;
  const cursor = result.cursor ?? {
    x: element.frame.x + Math.round(element.frame.width / 2),
    y: element.frame.y + Math.round(element.frame.height / 2),
  };
  const target: AnnotationTarget = {
    x: element.frame.x,
    y: element.frame.y,
    width: element.frame.width,
    height: element.frame.height,
    label: element.name ?? element.role ?? 'Here',
    note: result.changed
      ? 'changed — verified by a fresh snapshot'
      : 'no visible change in the snapshot',
    shape: 'box',
    pointer: cursor,
    click: result.action.kind === 'click',
  };
  return {
    unit: 'px',
    timeoutMs: 6000,
    cursorName: 'Aegis',
    steps: [{ explanation: describe(result), targets: [target] }],
  };
}

function publish(event: AnnotationEvent): AnnotationEvent {
  recent.set(event.sessionId, event);
  if (recent.size > 25) {
    const oldest = recent.keys().next().value;
    if (oldest) recent.delete(oldest);
  }
  emitter.emit('annotation', event);
  return event;
}

/** Publish cursor + marker for a completed act(). Returns null when undrawable. */
export function publishActAnnotations(
  result: AgentDesktopResult,
): AnnotationEvent | null {
  const payload = annotationPayloadFor(result);
  if (!payload) return null;
  return publish({
    sessionId: result.before.sessionId,
    payload,
    reason: 'act',
    at: Date.now(),
  });
}

/** Publish a caller-supplied marker payload (used by the demo/test surface). */
export function publishAnnotation(
  sessionId: string,
  payload: AnnotationPayload,
): AnnotationEvent {
  return publish({ sessionId, payload, reason: 'act', at: Date.now() });
}

/**
 * Clear the overlay: refs expired (`stale`) or the run ended (`session-ended`).
 * The session's recent markers are dropped too, so a late SSE subscriber cannot
 * replay drawing instructions for a session that no longer exists.
 */
export function clearAnnotations(
  sessionId: string,
  reason: Exclude<AnnotationReason, 'act'> = 'session-ended',
): AnnotationEvent {
  recent.delete(sessionId);
  return publish({ sessionId, payload: { unit: 'px', clear: true }, reason, at: Date.now() });
}

/** Last event for a session (used by the snapshot endpoint and tests). */
export function lastAnnotation(sessionId: string): AnnotationEvent | undefined {
  return recent.get(sessionId);
}

export function subscribeAnnotations(
  listener: (event: AnnotationEvent) => void,
): () => void {
  emitter.on('annotation', listener);
  return () => emitter.off('annotation', listener);
}
