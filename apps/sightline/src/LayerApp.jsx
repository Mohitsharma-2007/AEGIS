// AEGIS Visual Layer.
//
// This is the same Sightline engine as the studio, mounted as a transparent
// always-on-top surface over the owner's desktop. It reuses Stage, Scene3D,
// the callout annotation system and the aero lab instead of drawing a second,
// hand-written overlay: the layer is a host for the engine, not a copy of it.
//
// Flow: Win+Shift+Space opens the layer -> circle a region over any app ->
// ask a question -> the host returns a plan -> compilePlan()/aeroScene() build
// the scene -> 3D geometry with leader-line annotations animates over the app.
import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Brush, Eraser, LoaderCircle, Mic, Sparkles, X } from 'lucide-react';
import { compilePlan } from './engine/compile.js';
import { aeroScene, labKind } from './engine/aero/scenes.js';
import { useAeroLab } from './components/AeroLab.jsx';
import Stage from './components/Stage.jsx';

const INK = '#3ea8ff';
const layerSource = { type: 'demo', name: 'Desktop', url: null };

function speechEngine() {
  return typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;
}

export default function LayerApp() {
  const [active, setActive] = useState(true);
  const [pen, setPen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [mode, setMode] = useState('3d');
  const [scene, setScene] = useState(null);
  const [plan, setPlan] = useState(null);
  const [labId, setLabId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [tour, setTour] = useState(null);
  const [hasInk, setHasInk] = useState(false);
  const [listening, setListening] = useState(false);
  const [elapsed, setElapsed] = useState(null);
  const [sourceLabel, setSourceLabel] = useState('Sightline engine');

  const aero = useAeroLab(labId || labKind(scene));
  const canvasRef = useRef(null);
  const inputRef = useRef(null);
  const strokesRef = useRef([]);
  const liveRef = useRef(null);
  const recognitionRef = useRef(null);

  // ---- inking ------------------------------------------------------------
  function paint() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const all = liveRef.current ? [...strokesRef.current, liveRef.current] : strokesRef.current;
    if (!all.length) return;
    const xs = [], ys = [];
    for (const stroke of all) for (const point of stroke) { xs.push(point.x); ys.push(point.y); }
    if (xs.length) {
      const x = Math.min(...xs), y = Math.min(...ys);
      const w = Math.max(...xs) - x, h = Math.max(...ys) - y;
      ctx.save();
      ctx.strokeStyle = 'rgba(62,168,255,.30)';
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 6]);
      ctx.strokeRect(x - 9, y - 9, w + 18, h + 18);
      ctx.restore();
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(62,168,255,.72)';
    ctx.shadowBlur = 9;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.4;
    for (const stroke of all) {
      if (stroke.length < 2) {
        const only = stroke[0];
        if (!only) continue;
        ctx.beginPath();
        ctx.arc(only.x, only.y, 2.1, 0, Math.PI * 2);
        ctx.fillStyle = INK;
        ctx.fill();
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(stroke[0].x, stroke[0].y);
      for (let i = 1; i < stroke.length - 1; i += 1) {
        const a = stroke[i], b = stroke[i + 1];
        ctx.quadraticCurveTo(a.x, a.y, (a.x + b.x) / 2, (a.y + b.y) / 2);
      }
      const last = stroke[stroke.length - 1];
      ctx.lineTo(last.x, last.y);
      ctx.stroke();
    }
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const fit = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(window.innerWidth * dpr));
      canvas.height = Math.max(1, Math.round(window.innerHeight * dpr));
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      paint();
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  function pointOf(event) {
    const rect = canvasRef.current?.getBoundingClientRect();
    return { x: event.clientX - (rect?.left || 0), y: event.clientY - (rect?.top || 0) };
  }
  function onDown(event) {
    if (event.button !== 0) return;
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* capture is best-effort */ }
    liveRef.current = [pointOf(event)];
    paint();
  }
  function onMove(event) {
    if (!liveRef.current) return;
    liveRef.current.push(pointOf(event));
    paint();
  }
  function onUp() {
    if (!liveRef.current) return;
    if (liveRef.current.length > 1) {
      strokesRef.current = [...strokesRef.current, liveRef.current];
      setHasInk(true);
    }
    liveRef.current = null;
    paint();
  }
  function clearInk() {
    strokesRef.current = [];
    liveRef.current = null;
    setHasInk(false);
    paint();
  }
  function regionText() {
    const all = strokesRef.current;
    if (!all.length) return '';
    const points = all.flat();
    const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
    const x = Math.min(...xs), y = Math.min(...ys);
    return `marked region x ${Math.round(x)}..${Math.round(Math.max(...xs))} of ${window.innerWidth}, y ${Math.round(y)}..${Math.round(Math.max(...ys))} of ${window.innerHeight}`;
  }

  // ---- submit -----------------------------------------------------------
  async function visualize(text) {
    // Read the live field as well as state: a submit must never be dropped
    // because the last keystroke had not been committed to React yet.
    const typed = text ?? inputRef.current?.value ?? prompt;
    const query = String(typed).trim();
    if (!query || busy) return;
    if (query !== prompt) setPrompt(query);
    const started = performance.now();
    setBusy(true);
    setError(null);
    setPen(false);
    try {
      const response = await fetch('/api/visual/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: query, region: regionText(), mode }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || (!data?.plan && !data?.lab)) {
        throw new Error(data?.error || 'The visual service did not return a scene.');
      }
      let nextScene;
      if (data.lab) {
        setPlan(null);
        setLabId(data.lab);
        nextScene = aeroScene(data.lab, mode);
      } else {
        setLabId(null);
        setPlan(data.plan);
        nextScene = compilePlan(data.plan, mode);
      }
      setScene(nextScene);
      setSourceLabel(
        data.source === 'model'
          ? [data.provider, data.model].filter(Boolean).join(' · ') || 'Model plan'
          : 'Sightline engine',
      );
      // The walkthrough only auto-plays when its title matches the scene, so the
      // tour is keyed to the scene the engine actually built.
      setTour({ title: nextScene.title });
      setElapsed(performance.now() - started);
      clearInk();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not build that layer.');
    } finally {
      setBusy(false);
    }
  }

  function changeMode(next) {
    if (next === mode) return;
    setMode(next);
    if (labId) setScene(aeroScene(labId, next));
    else if (plan) {
      try { setScene(compilePlan(plan, next)); } catch { /* keep the current scene */ }
    }
  }

  function onLabTab(kind) {
    const next = aeroScene(kind, mode);
    setLabId(kind);
    setPlan(null);
    setScene(next);
    setTour({ title: next.title });
  }

  function clearLayer() {
    clearInk();
    setScene(null);
    setPlan(null);
    setLabId(null);
    setTour(null);
    setElapsed(null);
    setError(null);
  }

  function togglePen() {
    if (!pen) { setActive(true); setPen(true); }
    else setPen(false);
  }

  function toggleVoice() {
    if (listening) { recognitionRef.current?.stop(); return; }
    const Speech = speechEngine();
    if (!Speech) { setError('Voice capture is unavailable in this build.'); return; }
    try {
      const recognition = new Speech();
      recognition.lang = 'en-US';
      recognition.interimResults = true;
      recognition.continuous = false;
      recognition.onresult = (event) => {
        let text = '';
        for (const result of event.results) text += result[0].transcript;
        setPrompt(text.trim());
      };
      recognition.onend = () => setListening(false);
      recognition.onerror = () => setListening(false);
      recognitionRef.current = recognition;
      setListening(true);
      recognition.start();
    } catch {
      setListening(false);
      setError('Voice capture could not start.');
    }
  }

  // ---- lifecycle --------------------------------------------------------
  useEffect(() => {
    setActive(true);
    inputRef.current?.focus();
    const bridge = window.aegisVisual;
    const off = bridge?.onOpen?.(() => {
      setActive(true);
      setTimeout(() => inputRef.current?.focus(), 60);
    });
    return () => { if (typeof off === 'function') off(); };
  }, []);

  // The transparent window is click-through unless the owner is in the layer.
  useEffect(() => {
    window.aegisVisual?.setInteractive?.(active);
    if (active) setTimeout(() => inputRef.current?.focus(), 60);
  }, [active]);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') {
        if (pen) { setPen(false); return; }
        if (active) { setActive(false); setError(null); return; }
        window.aegisVisual?.close?.();
        return;
      }
      const typing = event.target?.closest?.('input, textarea, [contenteditable]');
      if (!typing && (event.key === 'Backspace' || event.key === 'Delete')) clearInk();
      if (!typing && event.key.toLowerCase() === 'b') { event.preventDefault(); togglePen(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pen, active]);

  useEffect(() => () => {
    try { recognitionRef.current?.abort?.(); } catch { /* already stopped */ }
  }, []);

  const hasScene = !!scene;
  return (
    <div className={`layer${active ? ' is-active' : ''}${pen ? ' is-drawing' : ''}`}>
      {hasScene && (
        <div className="layer-stage">
          <Stage
            scene={scene}
            mode={mode}
            source={layerSource}
            busy={busy}
            busyKind="model"
            sceneOrigin={plan ? 'AI' : 'local'}
            modelLabel={sourceLabel}
            elapsed={elapsed}
            onFallback={() => changeMode('2d')}
            sessionIndex={1}
            lab={aero}
            onLabTab={onLabTab}
            tour={tour || undefined}
          />
        </div>
      )}

      <canvas
        ref={canvasRef}
        className="layer-ink"
        aria-label="Draw a region over the desktop"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      />

      {!active && (
        <div className="layer-idle">
          <i />
          <span>AEGIS</span>
          <b>Win+Shift+Space</b>
        </div>
      )}

      {active && (
        <>
          <div className="layer-top">
            <div className="layer-mark"><i /><span>AEGIS</span><b>VISUAL LAYER</b></div>
            <div className="layer-hint">
              {hasInk ? 'Region marked — ask what it does' : pen ? 'Circle the part you want explained' : 'Draw a region, or just ask'}
            </div>
            <button type="button" className="layer-close" aria-label="Close visual layer" title="Close (Esc)" onClick={() => window.aegisVisual?.close?.()}>
              <X size={15} />
            </button>
          </div>

          {!hasScene && !busy && (
            <div className="layer-empty">
              <Sparkles size={15} />
              <strong>A layer over anything</strong>
              <span>Press <kbd>B</kbd> to draw a region, then ask AEGIS about it.</span>
            </div>
          )}

          {error && <div className="layer-error" role="status">{error}</div>}

          <form
            className="layer-bar"
            onSubmit={(event) => { event.preventDefault(); visualize(); }}
          >
            <button
              type="button"
              className={pen ? 'layer-tool on' : 'layer-tool'}
              aria-pressed={pen}
              title={pen ? 'Stop drawing (B)' : 'Draw a region (B)'}
              aria-label={pen ? 'Stop drawing' : 'Draw a region'}
              onClick={togglePen}
            >
              <Brush size={16} />
            </button>
            <input
              ref={inputRef}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                visualize();
              }}
              placeholder="Ask about what you circled — e.g. how a fighter-jet engine reaches Mach 3"
              aria-label="Ask about the marked region"
              spellCheck={false}
            />
            <button
              type="button"
              className={listening ? 'layer-tool on' : 'layer-tool'}
              title="Speak instead of typing"
              aria-label="Speak instead of typing"
              onClick={toggleVoice}
            >
              <Mic size={16} />
            </button>
            <button type="submit" className="layer-go" disabled={!prompt.trim() || busy} aria-label="Build the layer">
              {busy ? <LoaderCircle size={16} className="spin" /> : <ArrowUp size={16} />}
            </button>
            <span className="layer-split" />
            <div className="layer-modes" role="group" aria-label="Scene renderer">
              <button type="button" aria-pressed={mode === '3d'} onClick={() => changeMode('3d')}>3D</button>
              <button type="button" aria-pressed={mode === '2d'} onClick={() => changeMode('2d')}>2D</button>
            </div>
            <button type="button" className="layer-tool" title="Clear the layer" aria-label="Clear the layer" onClick={clearLayer} disabled={!hasScene && !hasInk}>
              <Eraser size={16} />
            </button>
          </form>
        </>
      )}
    </div>
  );
}
