// Catalogue test for the models.dev provider system (W-AI). Run via tsx
// from opendots:
//   cd aegis/apps/host && npx tsx ../tests/check-catalogue.mts
// No real key values are used anywhere in this file.
import assert from "node:assert";
import {
  apiTypeForNpm,
  catalogueView,
  currentCatalogue,
  findCatalogueProvider,
  parseCatalogue,
} from "../apps/host/src/server/catalogue.ts";
import {
  anthropicSdkBaseUrl,
  resolveProvider,
} from "../apps/host/src/server/providers.ts";

// The vendored snapshot parses into a full catalogue.
const catalogue = currentCatalogue();
assert.equal(catalogue.source, "snapshot");
assert.ok(
  catalogue.providers.length >= 200,
  `expected >=200 providers, got ${catalogue.providers.length}`,
);
const totalModels = catalogue.providers.reduce(
  (count, provider) => count + provider.models.length,
  0,
);
assert.ok(totalModels >= 8_000, `expected >=8000 models, got ${totalModels}`);
console.log(
  `PASS snapshot parses: ${catalogue.providers.length} providers, ${totalModels} models`,
);

// API-type derivation from the models.dev npm field.
assert.equal(apiTypeForNpm("@ai-sdk/anthropic"), "anthropic");
assert.equal(apiTypeForNpm("@ai-sdk/google-vertex/anthropic"), "anthropic");
assert.equal(apiTypeForNpm("@ai-sdk/openai-compatible"), "openai");
assert.equal(apiTypeForNpm("@openrouter/ai-sdk-provider"), "openai");
assert.equal(apiTypeForNpm("@ai-sdk/google"), "other");
assert.equal(apiTypeForNpm(undefined), "other");
const anthropicType = catalogue.providers.filter(
  (provider) => provider.apiType === "anthropic",
);
assert.ok(
  anthropicType.length >= 5,
  `expected >=5 anthropic-type providers, got ${anthropicType.length}`,
);
console.log(
  `PASS api types: ${anthropicType.length} anthropic-type providers in snapshot`,
);

// Anthropic itself resolves as a runnable external provider.
const anthropic = findCatalogueProvider("anthropic");
assert.ok(anthropic, "anthropic must be resolvable");
assert.equal(anthropic.apiType, "anthropic");
assert.equal(anthropic.keyEnv, "ANTHROPIC_API_KEY");
assert.equal(anthropic.baseUrl, "https://api.anthropic.com/v1");
assert.ok(anthropic.models.length > 0);
assert.ok(anthropic.defaultModel);
// Registry favourites are never shadowed by catalogue resolution.
assert.equal(findCatalogueProvider("openrouter"), undefined);
assert.equal(findCatalogueProvider("groq"), undefined);
assert.equal(findCatalogueProvider("does-not-exist"), undefined);
console.log(
  "PASS findCatalogueProvider: anthropic runnable, favourites owned by registry",
);

// The Anthropic SDK base URL strips the catalogue's trailing /v1.
assert.equal(
  anthropicSdkBaseUrl("https://api.anthropic.com/v1"),
  "https://api.anthropic.com",
);
assert.equal(
  anthropicSdkBaseUrl("https://api.minimax.io/anthropic/v1"),
  "https://api.minimax.io/anthropic",
);
assert.equal(
  anthropicSdkBaseUrl("https://api.subconscious.dev/v1"),
  "https://api.subconscious.dev",
);
console.log("PASS anthropicSdkBaseUrl normalisation");

// resolveProvider honours a catalogue provider via the finder.
const resolved = resolveProvider(
  { ANTHROPIC_API_KEY: "dummy-anthropic-key" },
  { providerId: "anthropic", model: "claude-sonnet-4-6" },
  findCatalogueProvider,
);
assert.equal(resolved?.providerId, "anthropic");
assert.equal(resolved?.apiType, "anthropic");
assert.equal(resolved?.model, "claude-sonnet-4-6");
assert.equal(resolved?.baseUrl, "https://api.anthropic.com/v1");
assert.equal(resolved?.keyEnv, "ANTHROPIC_API_KEY");
const viaEnv = resolveProvider(
  { AEGIS_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "dummy-anthropic-key" },
  undefined,
  findCatalogueProvider,
);
assert.equal(viaEnv?.providerId, "anthropic");
assert.ok(viaEnv?.model);
console.log("PASS resolveProvider resolves catalogue providers (stored + env)");

// The merged view pins the six favourites first and never leaks key values.
const view = catalogueView({
  OPENROUTER_API_KEY: "dummy-openrouter-key",
  ANTHROPIC_API_KEY: "dummy-anthropic-key",
});
assert.deepEqual(
  view.slice(0, 6).map((entry) => entry.id),
  ["openrouter", "groq", "nvidia", "conduit", "tokenharbor", "vercel"],
);
assert.ok(view.slice(0, 6).every((entry) => entry.favourite));
assert.equal(view.find((entry) => entry.id === "openrouter")?.configured, true);
assert.equal(view.find((entry) => entry.id === "groq")?.configured, false);
const anthropicEntry = view.find((entry) => entry.id === "anthropic");
assert.equal(anthropicEntry?.configured, true);
assert.equal(anthropicEntry?.apiType, "anthropic");
assert.equal(anthropicEntry?.runnable, true);
assert.ok(!JSON.stringify(view).includes("dummy-openrouter-key"));
assert.ok(!JSON.stringify(view).includes("dummy-anthropic-key"));
console.log(
  `PASS catalogue view: favourites pinned, ${view.length} entries, no key leakage`,
);

// parseCatalogue handles the live document shape (models as an object).
const liveShape = parseCatalogue({
  example: {
    id: "example",
    name: "Example",
    api: "https://example.invalid/v1",
    npm: "@ai-sdk/openai-compatible",
    env: ["EXAMPLE_API_KEY"],
    models: {
      "m-1": {
        id: "m-1",
        name: "Model 1",
        tool_call: true,
        limit: { context: 1000 },
      },
    },
  },
});
assert.equal(liveShape.length, 1);
assert.equal(liveShape[0]?.apiType, "openai");
assert.equal(liveShape[0]?.models[0]?.id, "m-1");
assert.equal(liveShape[0]?.models[0]?.context, 1000);
console.log("PASS parseCatalogue handles the live models-object shape");

console.log("ALL CATALOGUE CHECKS PASSED");
