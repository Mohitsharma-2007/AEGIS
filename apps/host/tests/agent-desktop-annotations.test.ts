import { describe, expect, it } from 'vitest';
import {
  annotationPayloadFor,
  clearAnnotations,
  lastAnnotation,
  publishActAnnotations,
  subscribeAnnotations,
} from '../src/server/agent-desktop-annotations.js';
import type { AgentDesktopResult } from '../src/server/agent-desktop.js';

const element = {
  ref: '@s1:e4',
  role: 'button',
  name: 'Save',
  frame: { x: 100, y: 200, width: 80, height: 30 },
};

function result(overrides: Partial<AgentDesktopResult> = {}): AgentDesktopResult {
  return {
    ok: true,
    action: { kind: 'click', ref: '@s1:e4' },
    target: element,
    before: { sessionId: 'run-1', generation: 1, elements: [element] },
    after: { sessionId: 'run-1', generation: 2, elements: [element] },
    changed: true,
    cursor: { x: 140, y: 215 },
    durationMs: 12,
    ...overrides,
  };
}

describe('computer-use annotation feed', () => {
  it('emits a cursor + click marker for a scripted act()', () => {
    const payload = annotationPayloadFor(result());
    expect(payload).not.toBeNull();
    expect(payload?.unit).toBe('px');
    const target = payload?.steps?.[0].targets[0];
    expect(target).toMatchObject({ x: 100, y: 200, width: 80, height: 30, click: true });
    expect(target?.pointer).toEqual({ x: 140, y: 215 });
    expect(target?.label).toBe('Save');
    expect(payload?.steps?.[0].explanation).toContain('clicked');
  });

  it('marks an unchanged action as unverified instead of claiming success', () => {
    const payload = annotationPayloadFor(result({ changed: false }));
    expect(payload?.steps?.[0].targets[0].note).toContain('no visible change');
  });

  it('publishes to subscribers and keeps the last event per session', () => {
    const seen: unknown[] = [];
    const unsubscribe = subscribeAnnotations((event) => seen.push(event));
    const published = publishActAnnotations(result());
    unsubscribe();
    expect(seen).toHaveLength(1);
    expect(published?.reason).toBe('act');
    expect(lastAnnotation('run-1')?.payload.steps?.length).toBe(1);
  });

  it('clears the overlay and drops markers when refs expire or a session ends', () => {
    publishActAnnotations(result());
    const cleared = clearAnnotations('run-1', 'stale');
    expect(cleared.payload).toEqual({ unit: 'px', clear: true });
    expect(cleared.reason).toBe('stale');
    expect(lastAnnotation('run-1')?.payload.clear).toBe(true);
  });

  it('returns null when the result carries no drawable frame', () => {
    const payload = annotationPayloadFor(
      result({
        target: { ref: '@s1:e9' },
        before: { sessionId: 'run-2', generation: 1, elements: [] },
        cursor: undefined,
      }),
    );
    expect(payload).toBeNull();
  });
});
