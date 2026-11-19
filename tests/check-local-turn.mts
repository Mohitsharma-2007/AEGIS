// In-process local-mode check: Platform with ONLY a registry provider key
// (no Intelligence account) must create a conversation, complete a turn
// against the stub LLM, and persist history in the local thread store.
// Run via tsx from apps/host:
//   cd aegis/apps/host && npx tsx ../tests/check-local-turn.mts
import assert from 'node:assert';
import { createStubServer, CANNED_REPLY } from './stub-llm.mjs';
import { Store } from '../apps/host/src/server/store.ts';
import { WorkspaceStore } from '../apps/host/src/server/workspace.ts';
import { Platform } from '../apps/host/src/server/platform.ts';
import { resolveProvider } from '../apps/host/src/server/providers.ts';
import type { PlatformConfig } from '../apps/host/src/server/platform-config.ts';

process.env.DO_NOT_TRACK = '1';

const stub = createStubServer();
await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
const address = stub.address();
assert.ok(address && typeof address === 'object');
const stubBase = `http://127.0.0.1:${address.port}/v1`;

const store = new Store(':memory:');
const workspace = new WorkspaceStore(':memory:', 'owner');
try {
  const resolved = resolveProvider({
    AEGIS_PROVIDER: 'openrouter',
    OPENROUTER_API_KEY: 'dummy-local-key',
    OPENROUTER_BASE_URL: stubBase,
  });
  assert.ok(resolved);
  const config: PlatformConfig = {
    providerId: resolved.providerId,
    apiKey: resolved.apiKey,
    model: resolved.model,
    baseUrl: resolved.baseUrl,
    runtimeUrl: '',
    voiceName: 'marin',
    slackUsers: [],
  };
  const platform = new Platform(store, workspace, config);
  assert.equal(platform.localMode, true);
  assert.deepEqual(platform.setup().missing, []);
  assert.equal(platform.setup().intelligence, false);
  assert.equal(platform.setup().activeProvider?.id, 'openrouter');
  assert.ok(platform.handler, 'local runtime handler must exist');
  console.log('PASS local mode active with only a provider key');

  const dot = workspace.dots()[0];
  const conversation = await platform.createConversation(dot.id, 'Local check');
  const text = await platform.turn(
    conversation.id,
    'Say hello',
    AbortSignal.timeout(30_000),
  );
  assert.equal(text, CANNED_REPLY);
  console.log(`PASS platform.turn returned canned reply: ${text}`);

  const history = await platform.history(conversation.id);
  assert.ok(history.includes(`user: Say hello`));
  assert.ok(history.includes(`assistant: ${CANNED_REPLY}`));
  assert.equal(workspace.threadMessages(conversation.id).length, 2);
  console.log('PASS local thread history persisted');

  const second = await platform.turn(
    conversation.id,
    'And again',
    AbortSignal.timeout(30_000),
  );
  assert.equal(second, CANNED_REPLY);
  assert.equal(workspace.threadMessages(conversation.id).length, 4);
  console.log('PASS second turn appends to local history');

  // Selecting an unconfigured provider is reported honestly in setup.
  platform.applyProviderSelection('groq', 'llama-3.1-8b-instant');
  assert.deepEqual(platform.setup().missing, ['GROQ_API_KEY']);
  assert.equal(store.settings().providerId, 'groq');
  assert.equal(store.settings().providerModel, 'llama-3.1-8b-instant');
  console.log('PASS provider selection persists and reports missing key');
} finally {
  store.close();
  workspace.close();
  stub.close();
}
console.log('ALL LOCAL TURN CHECKS PASSED');
