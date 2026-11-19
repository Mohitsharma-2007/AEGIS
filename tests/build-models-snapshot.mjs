// Regenerates opendots/src/server/models-dev.json from the live
// models.dev catalogue (the same source OpenCode uses). The server also
// refreshes the catalogue live at runtime and falls back to this snapshot,
// so regenerating is a maintenance task, not a release step.
// Run: node aegis/tests/build-models-snapshot.mjs
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, '..', 'apps', 'host', 'src', 'server', 'models-dev.json');

const response = await fetch('https://models.dev/api.json');
if (!response.ok) throw new Error(`models.dev HTTP ${response.status}`);
const full = await response.json();

const trimmed = {};
for (const [id, provider] of Object.entries(full)) {
  trimmed[id] = {
    id: provider.id,
    name: provider.name,
    ...(provider.api ? { api: provider.api } : {}),
    ...(provider.npm ? { npm: provider.npm } : {}),
    env: provider.env ?? [],
    ...(provider.doc ? { doc: provider.doc } : {}),
    models: Object.values(provider.models ?? {}).map((model) => ({
      id: model.id,
      name: model.name,
      ...(model.reasoning ? { reasoning: true } : {}),
      ...(model.tool_call ? { tool_call: true } : {}),
      ...(model.limit?.context ? { context: model.limit.context } : {}),
      ...(model.limit?.output ? { output: model.limit.output } : {}),
    })),
  };
}
writeFileSync(target, JSON.stringify(trimmed));
const providers = Object.keys(trimmed).length;
const models = Object.values(trimmed).reduce(
  (count, provider) => count + provider.models.length,
  0,
);
console.log(`Wrote ${target}: ${providers} providers, ${models} models.`);
