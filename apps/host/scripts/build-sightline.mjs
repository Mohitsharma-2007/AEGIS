#!/usr/bin/env node
/**
 * Builds the Sightline viewer into the host's public directory.
 *
 * The 3D Library serves `/sightline/index.html` as static output, but that
 * directory is generated and ignored by git, and nothing produced it — so a
 * fresh clone showed an empty model viewer. This builds the separate Sightline
 * app (Three.js and the OCR assets stay out of the chat bundle) and copies its
 * output into `public/sightline`.
 *
 * Safe to re-run; it skips the build when the source is older than the copy.
 */
import { execSync } from 'node:child_process';
import { cpSync, existsSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const hostRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(hostRoot, '..', '..');
const source = join(repoRoot, 'apps', 'sightline');
const target = join(hostRoot, 'public', 'sightline');

if (!existsSync(join(source, 'package.json'))) {
  console.log('[sightline] source app not found; skipping');
  process.exit(0);
}

const force = process.argv.includes('--force');
const marker = join(target, 'index.html');
const buildIfNeeded = () => {
  if (!force && existsSync(marker)) {
    const built = statSync(marker).mtimeMs;
    const srcIndex = join(source, 'src', 'App.jsx');
    if (existsSync(srcIndex) && statSync(srcIndex).mtimeMs < built) {
      console.log('[sightline] up to date');
      return false;
    }
  }
  return true;
};

if (buildIfNeeded()) {
  if (!existsSync(join(source, 'node_modules'))) {
    console.error(
      '[sightline] dependencies are missing. Run `npm install` in apps/sightline first.',
    );
    process.exit(1);
  }
  console.log('[sightline] building viewer...');
  execSync('npm run build', { cwd: source, stdio: 'inherit' });
  rmSync(target, { recursive: true, force: true });
  cpSync(join(source, 'dist'), target, { recursive: true });
  console.log('[sightline] copied to apps/host/public/sightline');
}
