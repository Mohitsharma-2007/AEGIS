// Registry test for the Aegis provider module. Run via tsx from apps/host:
//   cd aegis/apps/host && npx tsx ../tests/check-providers.mts
import assert from 'node:assert';
import {
  PROVIDERS,
  listProviders,
  resolveProvider,
} from '../apps/host/src/server/providers.ts';

// All six endpoints are hard-coded exactly as specified.
assert.equal(PROVIDERS.openrouter.baseUrl, 'https://openrouter.ai/api/v1');
assert.equal(PROVIDERS.groq.baseUrl, 'https://api.groq.com/openai/v1');
assert.equal(PROVIDERS.nvidia.baseUrl, 'https://integrate.api.nvidia.com/v1');
assert.equal(PROVIDERS.conduit.baseUrl, 'https://conduit.ozdoev.net/v1');
assert.equal(PROVIDERS.tokenharbor.baseUrl, 'https://tokenharbor.ai/v1');
assert.equal(PROVIDERS.vercel.baseUrl, 'https://ai-gateway.vercel.sh/v1');
assert.equal(PROVIDERS.openrouter.keyEnv, 'OPENROUTER_API_KEY');
assert.equal(PROVIDERS.vercel.keyEnv, 'VERCEL_AI_KEY');
assert.equal(PROVIDERS.vercel.baseUrlEnv, 'VERCEL_GATEWAY_URL');
console.log('PASS hard-coded endpoints and env names');

// listProviders flags configuration without ever leaking key values.
const listed = listProviders({ OPENROUTER_API_KEY: 'dummy-secret-value' });
assert.equal(listed.length, 7);
assert.equal(listed.find((p) => p.id === 'openrouter')?.configured, true);
assert.equal(listed.find((p) => p.id === 'groq')?.configured, false);
assert.ok(!JSON.stringify(listed).includes('dummy-secret-value'));
console.log('PASS listProviders configured flags, no key leakage');

// AEGIS_PROVIDER + AEGIS_MODEL override + per-provider base URL override.
const picked = resolveProvider({
  AEGIS_PROVIDER: 'groq',
  GROQ_API_KEY: 'g-key',
  OPENROUTER_API_KEY: 'o-key',
  AEGIS_MODEL: 'custom-model-x',
  GROQ_BASE_URL: 'http://127.0.0.1:9999/v1',
});
assert.equal(picked?.providerId, 'groq');
assert.equal(picked?.model, 'custom-model-x');
assert.equal(picked?.baseUrl, 'http://127.0.0.1:9999/v1');
console.log('PASS AEGIS_PROVIDER + AEGIS_MODEL + baseUrl override');

// Stored Settings selection beats ENV selection.
const stored = resolveProvider(
  { AEGIS_PROVIDER: 'groq', GROQ_API_KEY: 'g', NVIDIA_API_KEY: 'n' },
  { providerId: 'nvidia', model: 'qwen/qwen3-235b-a22b' },
);
assert.equal(stored?.providerId, 'nvidia');
assert.equal(stored?.model, 'qwen/qwen3-235b-a22b');
assert.equal(stored?.baseUrl, 'https://integrate.api.nvidia.com/v1');
console.log('PASS stored selection wins over ENV');

// First configured provider in registry order is the fallback.
const first = resolveProvider({
  TOKENHARBOR_API_KEY: 't',
  GROQ_API_KEY: 'g',
});
assert.equal(first?.providerId, 'groq');
assert.equal(first?.model, 'openai/gpt-oss-120b');
console.log('PASS first-configured fallback (registry order)');

// Legacy OPENAI_* fallback carries no registry provider id.
const legacy = resolveProvider({
  OPENAI_API_KEY: 'o',
  OPENAI_MODEL: 'gpt-legacy',
});
assert.equal(legacy?.providerId, undefined);
assert.equal(legacy?.model, 'gpt-legacy');
assert.equal(legacy?.baseUrl, 'https://api.openai.com/v1');
assert.equal(resolveProvider({}), undefined);
console.log('PASS legacy OPENAI_* fallback and empty env');

console.log('ALL PROVIDER CHECKS PASSED');
