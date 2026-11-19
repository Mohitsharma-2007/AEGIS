// AEGIS icon set: the window, taskbar and installer icons are the real
// aegis-mark.svg asset, rasterised (Electron and Windows need PNG/ICO, not
// SVG). Run `npm run icons` after changing the mark.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const assets = path.join(here, '..', 'assets');
const source = path.join(assets, 'aegis-mark.svg');

// The mark is wide (its viewBox is ~1211x806). A Windows icon is square, so
// the art is fitted inside a transparent square with breathing room rather
// than stretched.
const targets = [
  { file: 'icon.png', size: 256, padding: 0.12 },
  { file: 'tray.png', size: 32, padding: 0.06 },
];

const svg = await readFile(source);

for (const target of targets) {
  const pad = Math.round(target.size * target.padding);
  const inner = target.size - pad * 2;
  const art = await sharp(svg, { density: 384 })
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  await sharp({
    create: {
      width: target.size,
      height: target.size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: art, top: pad, left: pad }])
    .png()
    .toFile(path.join(assets, target.file));
  console.log(`wrote ${target.file} (${target.size}px) from aegis-mark.svg`);
}
