import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
const require=createRequire(import.meta.url);
const folder=join(import.meta.dirname,'../public/ocr');
mkdirSync(folder,{recursive:true});
const library=dirname(require.resolve('tesseract.js/package.json'));
const cores=dirname(require.resolve('tesseract.js-core/package.json'));
const english=dirname(require.resolve('@tesseract.js-data/eng/package.json'));
for(const [from,to] of [
  [join(library,'dist/worker.min.js'),'worker.min.js'],
  [join(library,'dist/worker.min.js.LICENSE.txt'),'worker.min.js.LICENSE.txt'],
  [join(cores,'tesseract-core-simd-lstm.wasm.js'),'tesseract-core-simd-lstm.wasm.js'],
  [join(cores,'tesseract-core-lstm.wasm.js'),'tesseract-core-lstm.wasm.js'],
  [join(english,'4.0.0_best_int/eng.traineddata.gz'),'eng.traineddata.gz'],
  [join(cores,'LICENSE'),'Tesseract-LICENSE.txt'],
])copyFileSync(from,join(folder,to));
