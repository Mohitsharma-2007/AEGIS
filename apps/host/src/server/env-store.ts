// Owner-editable environment settings (Settings   Environment).
//
// The desktop app already reads `.env` and `.env.local` at the product root
// when it launches services. This module lets the running host read the same
// file, show masked values, and persist edits made in Settings. Values are
// never logged and are masked in every response.
import fs from 'node:fs';
import path from 'node:path';
import { PROVIDERS } from './providers.js';

const KEY_PATTERN = /^[A-Z][A-Z0-9_]{1,80}$/;

export type EnvGroup = 'provider' | 'voice' | 'runtime' | 'other';

export interface EnvEntry {
  key: string;
  /** Masked display value ('' when unset). */
  value: string;
  configured: boolean;
  /** True for values that look like credentials. */
  secret: boolean;
  group: EnvGroup;
  /** Short human description shown in Settings. */
  hint?: string;
}

const DESCRIPTIONS: Record<string, string> = {
  AEGIS_PROVIDER: 'Active model provider id',
  AEGIS_MODEL: 'Active model id override',
  OPENROUTER_API_KEY: 'OpenRouter API key',
  GROQ_API_KEY: 'Groq API key',
  NVIDIA_API_KEY: 'NVIDIA NIM API key',
  CONDUIT_API_KEY: 'Conduit API key',
  TOKENHARBOR_API_KEY: 'TokenHarbor API key',
  VERCEL_AI_KEY: 'Vercel AI Gateway key',
  OLLAMA_API_KEY: 'Local model server key (any value, e.g. "ollama")',
  OLLAMA_BASE_URL: 'Local model server base URL (http://127.0.0.1:11434/v1)',
  OPENROUTER_BASE_URL: 'OpenRouter base URL override',
  GROQ_BASE_URL: 'Groq base URL override',
  NVIDIA_BASE_URL: 'NVIDIA base URL override',
  CONDUIT_BASE_URL: 'Conduit base URL override',
  TOKENHARBOR_BASE_URL: 'TokenHarbor base URL override',
  VERCEL_GATEWAY_URL: 'Vercel AI Gateway base URL override',
  VOICE_PIPELINE_URL: 'Local Pipecat voice pipeline (http://127.0.0.1:8766)',
  VOICE_BASE_URL: 'Hosted OpenAI-compatible voice endpoint',
  VOICE_API_KEY: 'Hosted voice API key',
  VOICE_MODEL: 'Hosted realtime voice model',
  VOICE_NAME: 'Hosted voice name',
  STT_ENDPOINT: 'OpenAI-compatible STT endpoint',
  TTS_ENDPOINT: 'OpenAI-compatible TTS endpoint',
  WHISPER_MODEL: 'faster-whisper model (large-v3-turbo)',
  PIPER_VOICE: 'Piper voice id (hi_IN-pratham-medium)',
  VOICES_DIR: 'Directory containing Piper .onnx voices',
  LLM_BASE_URL: 'Voice pipeline LLM base URL',
  LLM_API_KEY: 'Voice pipeline LLM API key',
  LLM_MODEL: 'Voice pipeline LLM model',
  AEGIS_DAEMON_URL: 'Aegis daemon URL',
  AEGIS_COMPUTER_MODE: 'Computer mode: local | docker',
  AEGIS_COMPUTER_WORKSPACE_DIR: 'Local computer workspace root',
  AEGIS_BROWSE_ENGINE: 'Legacy browser engine switch (Playwright is the only engine)',
  AEGIS_COMPUTER_URL: 'Aegis computer sidecar URL',
  AEGIS_LOG_DIR: 'Host log directory',
  COMPOSIO_API_KEY: 'Composio API key',
  OPENAI_API_KEY: 'OpenAI API key',
  OPENAI_MODEL: 'OpenAI model',
};

const VOICE_KEYS = [
  'VOICE_PIPELINE_URL',
  'VOICE_BASE_URL',
  'VOICE_API_KEY',
  'VOICE_MODEL',
  'VOICE_NAME',
  'STT_ENDPOINT',
  'TTS_ENDPOINT',
  'WHISPER_MODEL',
  'PIPER_VOICE',
  'VOICES_DIR',
  'LLM_BASE_URL',
  'LLM_API_KEY',
  'LLM_MODEL',
];

const RUNTIME_KEYS = [
  'AEGIS_PROVIDER',
  'AEGIS_MODEL',
  'AEGIS_DAEMON_URL',
  'AEGIS_COMPUTER_MODE',
  'AEGIS_COMPUTER_WORKSPACE_DIR',
  'AEGIS_BROWSE_ENGINE',
  'AEGIS_COMPUTER_URL',
  'AEGIS_LOG_DIR',
  'COMPOSIO_API_KEY',
  'OPENAI_API_KEY',
  'OPENAI_MODEL',
];

function isProductRoot(dir: string) {
  try {
    return (
      fs.existsSync(path.join(dir, 'apps', 'host', 'package.json')) &&
      fs.existsSync(path.join(dir, 'services', 'daemon'))
    );
  } catch {
    return false;
  }
}

export function envRoot(): string {
  if (process.env.AEGIS_ROOT) return path.resolve(process.env.AEGIS_ROOT);
  let dir = process.cwd();
  for (let i = 0; i < 5; i += 1) {
    if (isProductRoot(dir)) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

export function envFilePath(): string {
  return path.join(envRoot(), '.env.local');
}

function parseEnv(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const at = line.indexOf('=');
    const key = line.slice(0, at).trim();
    if (!key) continue;
    env[key] = line.slice(at + 1).trim();
  }
  return env;
}

export function readEnv(): Record<string, string> {
  try {
    return parseEnv(fs.readFileSync(envFilePath(), 'utf8'));
  } catch {
    return {};
  }
}

function looksSecret(key: string) {
  return /(KEY|TOKEN|SECRET|PASSWORD)/.test(key);
}

export function maskValue(key: string, value: string): string {
  if (!value) return '';
  if (!looksSecret(key)) return value;
  if (value.length <= 8) return ' ';
  return `${value.slice(0, 3)} ${value.slice(-3)}`;
}

function groupFor(key: string): EnvGroup {
  if (key.includes('API_KEY') || key.includes('_KEY') || key.includes('BASE_URL'))
    return 'provider';
  if (VOICE_KEYS.includes(key)) return 'voice';
  if (RUNTIME_KEYS.includes(key)) return 'runtime';
  return 'other';
}

export function envEntries(): EnvEntry[] {
  const fileEnv = readEnv();
  const keys = new Set<string>([
    ...Object.values(PROVIDERS).flatMap((provider) => [
      provider.keyEnv,
      provider.baseUrlEnv,
    ]),
    ...VOICE_KEYS,
    ...RUNTIME_KEYS,
    ...Object.keys(fileEnv),
  ]);
  return [...keys]
    .filter((key) => KEY_PATTERN.test(key))
    .sort((a, b) => a.localeCompare(b))
    .map((key) => {
      const value = fileEnv[key] ?? process.env[key] ?? '';
      return {
        key,
        value: maskValue(key, value),
        configured: !!value,
        secret: looksSecret(key),
        group: groupFor(key),
        hint: DESCRIPTIONS[key],
      };
    });
}

/**
 * Persist environment updates to `.env.local` and apply them to the running
 * process. A null/empty value removes the key. Returns the refreshed view.
 */
export function writeEnv(updates: Record<string, string | null>): EnvEntry[] {
  const file = envFilePath();
  const existing = readEnv();
  const next = { ...existing };
  for (const [rawKey, rawValue] of Object.entries(updates)) {
    const key = rawKey.trim();
    if (!KEY_PATTERN.test(key))
      throw new Error(`Invalid environment variable name: ${key}`);
    const value = (rawValue ?? '').trim();
    if (value) next[key] = value;
    else delete next[key];
    if (value) process.env[key] = value;
    else delete process.env[key];
  }
  const lines = Object.keys(next)
    .sort((a, b) => a.localeCompare(b))
    .map((key) => `${key}=${next[key]}`);
  const body = [
    '# Aegis owner environment. Edited from Settings   Environment.',
    '# This file is local only and is never committed.',
    '',
    ...lines,
    '',
  ].join('\n');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, body, { mode: 0o600 });
  fs.renameSync(temp, file);
  return envEntries();
}
