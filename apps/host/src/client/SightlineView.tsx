import { ArrowUpRight } from 'lucide-react';

/**
 * Sightline is the screen-to-scene visual engine: it compiles a short plan into
 * a deterministic 2D diagram or 3D model with guided callouts. It runs from its
 * own build under /sightline/ so Three.js, the OCR assets and the scene
 * compiler stay out of the chat bundle.
 */
export function SightlineView() {
  return (
    <main className="main-content sightline-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">VISUAL STUDIO</span>
          <h1>Visual Studio</h1>
          <p>
            Turn a screen, image or prompt into an interactive 2D diagram or 3D
            model. Airflow Lab and the built-in scenes run without a model.
          </p>
        </div>
        <button
          type="button"
          className="secondary"
          onClick={() => window.open('/sightline/index.html', '_blank', 'noopener')}
        >
          <ArrowUpRight size={15} /> Open full screen
        </button>
      </div>
      <div className="sightline-frame-wrap">
        <iframe
          className="sightline-frame"
          title="Sightline Visual Studio"
          src="/sightline/index.html"
        />
      </div>
    </main>
  );
}
