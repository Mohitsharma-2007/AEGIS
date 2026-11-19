import { useEffect, useRef } from 'react';
import {
  AegisMascot,
  renderSVG,
  type CharacterName,
  type MascotState,
} from 'aegis-mascot';

// The live Aegis mascot component. Instead of a flat static SVG shield,
// this mounts the real animated character (Aegi or the active specialist)
// with eye tracking, breathing, idle loops, and talking animations.
export function Mascot({
  state = 'idle',
  small = false,
  name = 'Agent',
  decorative = false,
  size,
  character = 'aegi',
}: {
  state?: string;
  small?: boolean;
  identity?: string;
  name?: string;
  decorative?: boolean;
  /** Explicit pixel size for stages that need a larger or smaller mark. */
  size?: number;
  character?: CharacterName;
}) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const mascotRef = useRef<AegisMascot | null>(null);

  const resolvedSize = size ?? (small ? 36 : 96);
  const validState: MascotState =
    state === 'speaking' ||
    state === 'listening' ||
    state === 'thinking' ||
    state === 'working' ||
    state === 'done' ||
    state === 'error' ||
    state === 'paused' ||
    state === 'sleeping'
      ? state
      : 'idle';

  useEffect(() => {
    if (!containerRef.current) return;
    try {
      containerRef.current.innerHTML = '';
      const m = new AegisMascot(containerRef.current, {
        character,
        state: validState,
        size: resolvedSize,
        follow: !small,
        autoplay: true,
      });
      mascotRef.current = m;
      return () => {
        try {
          m.destroy();
        } catch {
          // ignore cleanup error
        }
      };
    } catch {
      // Fallback to SVG if DOM mount fails
      if (containerRef.current) {
        containerRef.current.innerHTML = renderSVG({
          character,
          state: validState,
          size: resolvedSize,
          animated: true,
        });
      }
    }
  }, [character, resolvedSize]);

  useEffect(() => {
    if (mascotRef.current) {
      try {
        mascotRef.current.setState(validState);
      } catch {
        // ignore
      }
    }
  }, [validState]);

  return (
    <span
      ref={containerRef}
      className={`mascot live-aegis-mascot ${state} ${small ? 'small' : ''}`}
      style={{
        width: resolvedSize,
        height: resolvedSize,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : `${name} mascot is ${state}`}
    />
  );
}
