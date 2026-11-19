import { useEffect, useRef, useState } from 'react';
import { Eraser, Loader2, Play, Shapes, Square, X } from 'lucide-react';

export type PenDemo = 'pyth' | 'shapes';
export const PEN_DEMOS: PenDemo[] = ['pyth', 'shapes'];

/**
 * Opens the Pen Board (or sends a demo to it). Used by chat commands and the
 * agent's frontend tool. Events are dispatched on window so any mounted
 * PenBoardPanel picks them up.
 */
export function openPenBoard(demo?: PenDemo) {
  window.dispatchEvent(
    new CustomEvent('aegis:penboard', { detail: { open: true, demo } }),
  );
}

export function closePenBoard() {
  window.dispatchEvent(
    new CustomEvent('aegis:penboard', { detail: { open: false } }),
  );
}

export function PenBoardPanel() {
  const [open, setOpen] = useState(false);
  const [demo, setDemo] = useState<PenDemo>();
  const [ready, setReady] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const pendingRef = useRef<PenDemo | undefined>(undefined);

  useEffect(() => {
    const onEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ open?: boolean; demo?: PenDemo }>).detail;
      if (detail?.open) {
        setOpen(true);
        if (detail.demo) {
          pendingRef.current = detail.demo;
          setDemo(detail.demo);
        }
      } else if (detail?.open === false) {
        setOpen(false);
      }
    };
    window.addEventListener('aegis:penboard', onEvent);
    return () => window.removeEventListener('aegis:penboard', onEvent);
  }, []);

  // Post a demo as soon as the frame has loaded.
  useEffect(() => {
    if (!open || !ready || !pendingRef.current) return;
    const target = pendingRef.current;
    pendingRef.current = undefined;
    frameRef.current?.contentWindow?.postMessage(`annot:${target}`, '*');
  }, [open, ready]);

  const run = (next: PenDemo) => {
    pendingRef.current = next;
    setDemo(next);
    if (ready) {
      const target = pendingRef.current;
      pendingRef.current = undefined;
      frameRef.current?.contentWindow?.postMessage(`annot:${target}`, '*');
    }
  };

  const clear = () => {
    frameRef.current?.contentWindow?.postMessage('annot:clear', '*');
  };

  if (!open) return null;

  return (
    <div className="penboard-overlay" role="dialog" aria-label="Pen board">
      <div className="penboard-panel">
        <header className="penboard-head">
          <span className="penboard-title">
            <Square size={14} /> Pen Board
          </span>
          <div className="penboard-actions">
            <button type="button" className={demo === 'pyth' ? 'active' : ''} onClick={() => run('pyth')}>
              <Play size={13} /> Pythagoras
            </button>
            <button type="button" className={demo === 'shapes' ? 'active' : ''} onClick={() => run('shapes')}>
              <Shapes size={13} /> Shapes
            </button>
            <button type="button" onClick={clear}>
              <Eraser size={13} /> Clear
            </button>
            <button type="button" aria-label="Close pen board" onClick={() => setOpen(false)}>
              <X size={14} />
            </button>
          </div>
        </header>
        <div className="penboard-stage">
          {!ready && (
            <div className="penboard-loading">
              <Loader2 size={16} className="ag-spin" /> Preparing the pen board
            </div>
          )}
          <iframe
            ref={frameRef}
            src="/penboard.html?wb=1"
            title="Aegis pen board"
            onLoad={() => setReady(true)}
          />
        </div>
      </div>
    </div>
  );
}
