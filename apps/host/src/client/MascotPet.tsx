import { useEffect, useRef, useState } from 'react';
import { mountWidget, AegisSounds } from 'aegis-mascot';
import type { CharacterName, MascotShape, SoundPack } from 'aegis-mascot';
import type { Dot, Settings } from '../shared/types';

// The pet is a fixed-position element, so resizing the window used to leave it
// stranded outside the viewport (hidden behind the window edge). Clamp it to
// the visible area on every resize and after each drag.
function clampPetPos(x: number, y: number, size: number) {
  const margin = 6;
  const maxX = Math.max(margin, window.innerWidth - size - margin);
  const maxY = Math.max(margin, window.innerHeight - size - margin);
  return {
    x: Math.min(Math.max(margin, x), maxX),
    y: Math.min(Math.max(margin, y), maxY),
  };
}

export function characterForAgent(
  dot?: { name?: string; surface?: string } | null,
): CharacterName {
  if (!dot) return 'aegi';
  // Workspace tabs/surfaces must NEVER alter the desktop mascot personality.
  // The mascot strictly represents the active Agent or delegated Subagent persona.
  const name = dot.name?.toLowerCase() || '';
  if (name.includes('mail') || name.includes('posty') || name.includes('email'))
    return 'mail';
  if (
    name.includes('social') ||
    name.includes('chatty') ||
    name.includes('whatsapp') ||
    name.includes('slack')
  )
    return 'social';
  if (name.includes('file') || name.includes('filo') || name.includes('doc'))
    return 'files';
  if (
    name.includes('memory') ||
    name.includes('memo') ||
    name.includes('research') ||
    name.includes('brain')
  )
    return 'memory';
  if (
    name.includes('harness') ||
    name.includes('rig') ||
    name.includes('terminal') ||
    name.includes('computer')
  )
    return 'harness';
  if (name.includes('security') || name.includes('guard')) return 'security';

  return 'aegi';
}

export function emitMascot(name: string) {
  try {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('aegis:mascot-emit', { detail: name }));
    }
  } catch {
    // Ignore: mascot widget may not be mounted (e.g. unit tests).
  }
}

function packFor(pack: Settings['soundPack']): SoundPack {
  return pack === 'glassy' ? 'crystal' : 'warm';
}

// The floating desktop mascot is a real control: click the character (or the
// mic) and the large voice OS opens. It strictly follows the active Agent /
// Orchestrator / Subagent handling the turn in the conversation (NOT the
// workspace tab), unless the owner explicitly pinned a character in Settings.
export function MascotPet({
  character: propCharacter,
  agent,
  settings,
  onVoice,
  hidden = false,
}: {
  view?: string;
  character?: CharacterName;
  agent?: Dot | null;
  settings?: Settings;
  onVoice?: () => void;
  hidden?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<ReturnType<typeof mountWidget> | null>(null);
  const soundsRef = useRef<AegisSounds | null>(null);
  const voiceRef = useRef(onVoice);
voiceRef.current = onVoice;
const wasDraggedRef = useRef(false);
  voiceRef.current = onVoice;
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number; moved: boolean } | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number }>(() => {
    try {
      const saved = localStorage.getItem('aegis_mascot_pos');
      if (saved) {
        const p = JSON.parse(saved);
        if (typeof p.x === 'number' && typeof p.y === 'number')
          return clampPetPos(p.x, p.y, 120);
      }
    } catch { /* ignore */ }
    return clampPetPos(window.innerWidth - 132, window.innerHeight - 132, 120);
  });

  const handleDragStart = (event: { clientX: number; clientY: number; preventDefault: () => void }) => {
    dragRef.current = { startX: event.clientX, startY: event.clientY, origX: pos.x, origY: pos.y, moved: false };
    event.preventDefault();
  };
  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = event.clientX - d.startX;
      const dy = event.clientY - d.startY;
      // A drag is a drag from 6px on: below that it is still a tap, so a
      // slightly shaky click must not be swallowed (or become a voice start).
      if (Math.hypot(dx, dy) > 6) d.moved = true;
      const next = clampPetPos(d.origX + dx, d.origY + dy, 120);
      setPos(next);
    };
    const onUp = () => {
      if (dragRef.current) {
        if (dragRef.current.moved) {
          wasDraggedRef.current = true;
          // Clear the suppression on the next tick so a later, separate click
          // still opens voice; only the click ending this drag is ignored.
          window.setTimeout(() => {
            wasDraggedRef.current = false;
          }, 250);
        }
        dragRef.current = null;
        try { localStorage.setItem('aegis_mascot_pos', JSON.stringify(pos)); } catch { /* ignore */ }
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [pos]);

  useEffect(() => {
    const onResize = () => {
      setPos((current) => {
        const next = clampPetPos(current.x, current.y, 120);
        if (next.x === current.x && next.y === current.y) return current;
        try {
          localStorage.setItem('aegis_mascot_pos', JSON.stringify(next));
        } catch { /* ignore */ }
        return next;
      });
    };
    window.addEventListener('resize', onResize);
    onResize();
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const handleClick = () => {
    if (wasDraggedRef.current) { wasDraggedRef.current = false; return; }
    window.dispatchEvent(new CustomEvent('aegis:nav', { detail: 'chat' }));
    window.dispatchEvent(new CustomEvent('aegis:sidebar', { detail: true }));
  };

  const enabled = settings?.mascotEnabled ?? true;
  const pinned = settings?.mascotCharacter ?? 'auto';
  const size = settings?.mascotSize ?? 96;
  const shapeSetting = settings?.mascotShape ?? 'auto';
  const shape: MascotShape | undefined =
    shapeSetting === 'auto' ? undefined : (shapeSetting as MascotShape);
  const uiMode: 'light' | 'dark' =
    typeof document !== 'undefined' &&
    document.documentElement.dataset.theme === 'light'
      ? 'light'
      : 'dark';
  const pack = packFor(settings?.soundPack ?? 'warm');
  const volume = settings?.soundVolume ?? 0.5;

  const resolvedCharacter: CharacterName =
    pinned !== 'auto'
      ? (pinned as CharacterName)
      : (propCharacter ?? characterForAgent(agent) ?? 'aegi');

  useEffect(() => {
    if (!enabled || !hostRef.current) return;
    const sounds = new AegisSounds({ pack, volume });
    soundsRef.current = sounds;
    const widget = mountWidget(hostRef.current, 'pet', {
      character: resolvedCharacter,
      theme: 'color',
      ui: uiMode,
      shape,
      size,
      sounds,
      follow: true,
      status: 'Aegis',
      sub: 'Click to talk',
    });
    widgetRef.current = widget;
    widget.on('mic', () => {
      // Dragging the mascot must never start voice mode.
      if (wasDraggedRef.current) return;
      voiceRef.current?.();
    });
    widget.emit('app:start');
    return () => {
      widget.destroy();
      widgetRef.current = null;
      soundsRef.current = null;
    };
  }, [enabled]);

  useEffect(() => {
    const widget = widgetRef.current;
    if (!widget) return;
    widget.setCharacter(resolvedCharacter);
    widget.mascot.setSize(size);
    widget.mascot.setShape(shape ?? null);
  }, [resolvedCharacter, size, shape]);

  // The floating pet follows the app theme instead of always drawing a dark
  // chrome, so the light theme stays light on the desktop overlay too.
  useEffect(() => {
    const apply = () => {
      widgetRef.current?.setUI(
        document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
      );
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    soundsRef.current?.setPack(pack);
    soundsRef.current?.setVolume(volume);
  }, [pack, volume]);

  useEffect(() => {
    const onEmit = (event: Event) => {
      const name = (event as CustomEvent<string>).detail;
      if (typeof name === 'string') {
        if (name.startsWith('crew:') || name.startsWith('character:')) {
          const char = name.split(':')[1] as CharacterName;
          if (char && widgetRef.current && pinned === 'auto') {
            widgetRef.current.setCharacter(char);
            return;
          }
        }
      }
      widgetRef.current?.emit(name);
    };
    window.addEventListener('aegis:mascot-emit', onEmit);
    return () => window.removeEventListener('aegis:mascot-emit', onEmit);
  }, [pinned]);

  if (!enabled || hidden) return null;

  return (
    <div
      ref={hostRef}
      className="mascot-pet-host"
      style={{
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        zIndex: 40,
        cursor: 'move',
      }}
      onMouseDown={handleDragStart}
      onClick={handleClick}
    />
  );
}
