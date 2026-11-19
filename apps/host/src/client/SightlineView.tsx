import { useState } from 'react';
import { ArrowUpRight, Boxes, Cuboid, Layers, Maximize2 } from 'lucide-react';

/**
 * The 3D model library.
 *
 * Every entry is a scene the Sightline engine already builds, so the preview,
 * the labelled parts and the 2D diagram are the same code the viewer runs —
 * no screenshots and no duplicated geometry. The viewer is a separate build
 * under `/sightline/` (Three.js and the OCR assets stay out of the chat
 * bundle), reached through the query parameters it reads on boot.
 */
interface ModelPart {
  name: string;
  note: string;
}

interface ModelEntry {
  id: string;
  name: string;
  category: string;
  summary: string;
  description: string;
  /** Preview artwork from the engine's own example set. */
  preview: string;
  /** `w`/`h` of the preview SVG, used to keep the grid from shifting. */
  aspect: string;
  /** The engine's variant selector, when a scene has more than one. */
  variant?: string;
  has2d: boolean;
  parts: ModelPart[];
}

const MODELS: ModelEntry[] = [
  {
    id: 'pi',
    name: 'Raspberry Pi 5',
    category: 'Hardware',
    summary: 'Anatomy of a single-board computer',
    description:
      'The full board in 3D, turned so the header, system-on-chip and both USB stacks read clearly. Switch to the 2D map for a flat top-down view of the same connectors.',
    preview: '/sightline/examples/pi.svg',
    aspect: '620 / 386',
    has2d: true,
    parts: [
      {
        name: '40-pin GPIO',
        note: 'The general-purpose input/output header connects sensors, displays, and other small peripherals.',
      },
      {
        name: 'ARM processor',
        note: 'The BCM2712 is the main system-on-chip: a quad-core Arm Cortex-A76 CPU.',
      },
      {
        name: 'USB 3.0',
        note: 'The two blue USB 3.0 ports connect high-speed accessories, such as an external drive.',
      },
      {
        name: 'Camera connector',
        note: 'Small ribbon-cable connectors for compatible camera or display modules.',
      },
      {
        name: 'Gigabit Ethernet',
        note: 'A wired network jack rated for up to 1 gigabit per second.',
      },
    ],
  },
  {
    id: 'pi',
    name: 'Connect a Pi camera',
    category: 'Hardware',
    summary: 'A ribbon-cable connection, illustrated',
    description:
      'The same board with the camera path opened up: latch, ribbon and connector. The 2D diagram turns it into a three-step procedure you can follow with the board in front of you.',
    preview: '/sightline/examples/pi.svg',
    aspect: '620 / 386',
    variant: 'camera',
    has2d: true,
    parts: [
      {
        name: 'Camera module',
        note: 'The ribbon bridges the camera module and the small camera/display connector on the Pi.',
      },
      {
        name: 'Ribbon cable',
        note: 'Use a cable with the correct ends: the Pi 5 uses a narrow 22-pin board-side connector.',
      },
      {
        name: 'CAM/DISP connector',
        note: 'With the Pi powered off, lift the latch gently, seat the cable in the correct orientation, then close the latch.',
      },
    ],
  },
  {
    id: 'tokens',
    name: 'Next-token prediction',
    category: 'Machine learning',
    summary: 'Turn a sequence into training examples',
    description:
      'Each longer prefix becomes another training example with the real next token as its target. The 3D scene stacks the prefixes; the 2D view lays the same idea out as a table.',
    preview: '/sightline/examples/tokens.svg',
    aspect: '620 / 386',
    has2d: true,
    parts: [
      {
        name: 'Input context',
        note: 'The input is the prefix of tokens the model can see.',
      },
      {
        name: 'Training target',
        note: 'The target is the real token immediately following that prefix.',
      },
    ],
  },
  {
    id: 'fan',
    name: 'How a fan moves air',
    category: 'Physics',
    summary: 'Pitched blades push air through a shroud',
    description:
      'A side view of flow through an axial fan. The arrows show direction and staging, not a simulation — the engine states that in the caption rather than implying a CFD result.',
    preview: '/sightline/examples/fan.svg',
    aspect: '620 / 386',
    has2d: true,
    parts: [
      {
        name: 'Angled blades',
        note: 'Rotating, pitched blades exert a force on the air and move it along the fan’s axis.',
      },
      {
        name: 'Air intake',
        note: 'Air is drawn toward the low-pressure side of the fan.',
      },
      {
        name: 'Forward airflow',
        note: 'Air leaves the front of the fan as a moving stream.',
      },
    ],
  },
  {
    id: 'lab',
    name: 'Twinjet wind tunnel',
    category: 'Wind tunnel',
    summary: 'A live 2D flow slice over an aircraft',
    description:
      'The airflow lab runs a real solver and maps the slice onto an original civilian airframe. This is the one entry that is computed rather than drawn.',
    preview: '/sightline/examples/lab.svg',
    aspect: '620 / 386',
    has2d: false,
    parts: [
      {
        name: 'Inflow',
        note: 'The left boundary continually introduces air at the selected wind setting.',
      },
      {
        name: 'Wing',
        note: 'The plan-view silhouette is a solid mask in the flow domain.',
      },
      {
        name: 'Wake',
        note: 'The wake is where the flow has changed after passing the silhouette.',
      },
    ],
  },
  {
    id: 'lab',
    name: 'Turbofan cutaway',
    category: 'Wind tunnel',
    summary: 'A civilian engine sectioned along its centerline',
    description:
      'The engine variant of the lab: fan, bypass duct, compressor, combustor, turbine and exhaust, sectioned so the core and bypass streams stay legible.',
    preview: '/sightline/examples/lab.svg',
    aspect: '620 / 386',
    variant: 'engine',
    has2d: true,
    parts: [
      { name: 'Fan', note: 'The broad front fan accelerates the incoming stream.' },
      {
        name: 'Bypass duct',
        note: 'The outer passage carries cooler air around the core.',
      },
      {
        name: 'Compressor',
        note: 'Alternating blade rows compress air before it enters the combustor.',
      },
      { name: 'Combustor', note: 'This chamber adds heat to the core air.' },
      {
        name: 'Turbine',
        note: 'The core stream turns turbine stages that drive the shaft.',
      },
      {
        name: 'Exhaust',
        note: 'The rear passages guide core and bypass flow out of the engine.',
      },
    ],
  },
  {
    id: 'filter',
    name: 'Water filtration',
    category: 'Engine recipe',
    summary: 'From intake to cleaner water',
    description:
      'Drawn by the plan compiler rather than loaded from an asset, which is why it doubles as the demo for arbitrary process diagrams.',
    preview: '/sightline/examples/filter.svg',
    aspect: '620 / 386',
    has2d: true,
    parts: [
      { name: 'Intake', note: 'Water enters the treatment system.' },
      {
        name: 'Filter bed',
        note: 'Porous media traps suspended particles.',
      },
      { name: 'Outlet', note: 'Filtered water leaves through the outlet.' },
    ],
  },
];

/** Query string the Sightline build reads on boot to open a specific scene. */
function viewerUrl(model: ModelEntry, mode: '3d' | '2d') {
  const query = new URLSearchParams({ demo: model.id, mode });
  if (model.variant) query.set('variant', model.variant);
  return `/sightline/index.html?${query.toString()}`;
}

export function SightlineView() {
  const [selected, setSelected] = useState(0);
  const [mode, setMode] = useState<'3d' | '2d'>('3d');
  const model = MODELS[selected];
  const effectiveMode = model.has2d ? mode : '3d';

  return (
    <main className="main-content model-library-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">3D LIBRARY</span>
          <h1>3D Models</h1>
          <p>
            Labelled models and their 2D diagrams, rendered by the same engine
            `/draw` and the visual layer use.
          </p>
        </div>
        <button
          type="button"
          className="secondary"
          onClick={() =>
            window.open(viewerUrl(model, effectiveMode), '_blank', 'noopener')
          }
        >
          <Maximize2 size={15} /> Open in a window
        </button>
      </div>

      <div className="model-library">
        <div className="model-grid" role="list">
          {MODELS.map((entry, index) => (
            <button
              type="button"
              role="listitem"
              key={`${entry.id}:${entry.variant ?? 'base'}`}
              className={`model-card ${index === selected ? 'is-selected' : ''}`}
              aria-pressed={index === selected}
              onClick={() => {
                setSelected(index);
                setMode('3d');
              }}
            >
              <span className="model-card-preview">
                <img src={entry.preview} alt="" loading="lazy" />
              </span>
              <span className="model-card-body">
                <span className="model-card-kind">{entry.category}</span>
                <strong>{entry.name}</strong>
                <span className="model-card-summary">{entry.summary}</span>
              </span>
            </button>
          ))}
        </div>

        <section className="model-detail" aria-live="polite">
          <header className="model-detail-head">
            <div>
              <span className="eyebrow">{model.category.toUpperCase()}</span>
              <h2>{model.name}</h2>
              <p>{model.description}</p>
            </div>
            {model.has2d && (
              <div className="model-mode" role="group" aria-label="Render mode">
                <button
                  type="button"
                  className={mode === '3d' ? 'is-active' : ''}
                  onClick={() => setMode('3d')}
                >
                  <Cuboid size={14} /> 3D
                </button>
                <button
                  type="button"
                  className={mode === '2d' ? 'is-active' : ''}
                  onClick={() => setMode('2d')}
                >
                  <Layers size={14} /> 2D diagram
                </button>
              </div>
            )}
          </header>

          <div className="model-viewer">
            <iframe
              key={`${model.id}:${model.variant ?? 'base'}:${effectiveMode}`}
              className="model-viewer-frame"
              title={`${model.name} model`}
              src={viewerUrl(model, effectiveMode)}
            />
          </div>

          <div className="model-parts">
            <h3>
              <Boxes size={15} /> Labelled parts
            </h3>
            <ol>
              {model.parts.map((part) => (
                <li key={part.name}>
                  <strong>{part.name}</strong>
                  <span>{part.note}</span>
                </li>
              ))}
            </ol>
            <a
              className="model-detail-link"
              href={viewerUrl(model, effectiveMode)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open the full viewer <ArrowUpRight size={14} />
            </a>
          </div>
        </section>
      </div>
    </main>
  );
}
