import { describe, expect, it } from 'vitest';
import { providerChain } from '../src/server/providers.js';

describe('provider routing', () => {
  it('tries the selected local model before configured cloud fallbacks', () => {
    const active = {
      providerId: 'local',
      label: 'Ollama',
      apiKey: 'ollama',
      model: 'qwen3.5:4b',
      baseUrl: 'http://127.0.0.1:11434/v1',
      apiType: 'openai' as const,
    };

    const attempts = providerChain({ GROQ_API_KEY: 'fixture-groq-key' }, active);

    expect(attempts[0]).toMatchObject({
      providerId: 'local',
      label: 'Ollama',
      model: 'qwen3.5:4b',
    });
    expect(attempts.some((attempt) => attempt.providerId === 'groq')).toBe(true);
    expect(active.providerId).toBe('local');
  });

  it('does not invent cloud fallback attempts when no cloud key is configured', () => {
    const attempts = providerChain({}, {
      providerId: 'local',
      label: 'Ollama',
      apiKey: 'ollama',
      model: 'qwen3.5:4b',
      baseUrl: 'http://127.0.0.1:11434/v1',
      apiType: 'openai',
    });

    expect(attempts.map((attempt) => attempt.providerId)).toEqual(['local']);
  });
});
