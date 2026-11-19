import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  isPathAllowed,
  isCommandAllowed,
  scrubEnv,
  capOutput,
  sandboxRoutes,
  getSandboxMode,
  setSandboxMode,
  clearSandboxAudits,
  getSandboxAudits,
} from '../src/server/sandbox.js';
import { aegisRootDir } from '../src/server/harness.js';

describe('Sandbox Policy & Enforcement', () => {
  let app: Hono;

  beforeEach(() => {
    setSandboxMode('workspace');
    clearSandboxAudits();
    app = new Hono();
    app.route('/api', sandboxRoutes());
  });

  it('allows paths within workspace and system temp', () => {
    const root = aegisRootDir();
    const validFile = join(root, 'package.json');
    const validSubdir = join(root, 'src', 'server', 'index.ts');
    const validTemp = join(tmpdir(), 'scratch.txt');

    expect(isPathAllowed(validFile, 'workspace').allowed).toBe(true);
    expect(isPathAllowed(validSubdir, 'workspace').allowed).toBe(true);
    expect(isPathAllowed(validTemp, 'workspace').allowed).toBe(true);
  });

  it('denies paths escaping workspace via directory traversal', () => {
    const root = aegisRootDir();
    const escapingPath = join(root, '..', '..', 'Windows', 'System32', 'cmd.exe');
    const foreignDrive = process.platform === 'win32' ? 'Z:\\secret\\passwords.txt' : '/var/secrets/keys';

    const check1 = isPathAllowed(escapingPath, 'workspace');
    expect(check1.allowed).toBe(false);
    expect(check1.reason).toContain('escapes workspace boundary');

    const check2 = isPathAllowed(foreignDrive, 'workspace');
    expect(check2.allowed).toBe(false);
  });

  it('strict mode denies sensitive credential files even within workspace', () => {
    const root = aegisRootDir();
    const envFile = join(root, '.env');
    const gitFile = join(root, '.git', 'config');
    const sshKey = join(root, 'id_rsa');

    expect(isPathAllowed(envFile, 'strict').allowed).toBe(false);
    expect(isPathAllowed(gitFile, 'strict').allowed).toBe(false);
    expect(isPathAllowed(sshKey, 'strict').allowed).toBe(false);
  });

  it('off mode permits all paths', () => {
    const root = aegisRootDir();
    const escapingPath = join(root, '..', '..', 'Windows');
    expect(isPathAllowed(escapingPath, 'off').allowed).toBe(true);
  });

  it('blocks destructive command patterns', () => {
    const dangerousCommands = [
      'rm -rf /',
      'rmdir /s /q C:\\',
      'del /s /q C:\\Windows',
      'format D:',
      'diskpart /s script.txt',
      'DROP DATABASE users;',
      'shutdown -s -t 0',
      ':(){ :|:& };:',
    ];

    for (const cmd of dangerousCommands) {
      const check = isCommandAllowed(cmd, 'workspace');
      expect(check.allowed).toBe(false);
      expect(check.reason).toContain('blocked by sandbox policy');
    }

    // Safe commands must be allowed
    expect(isCommandAllowed('npm run test', 'workspace').allowed).toBe(true);
    expect(isCommandAllowed('git status', 'workspace').allowed).toBe(true);
    expect(isCommandAllowed('ls -la', 'workspace').allowed).toBe(true);
  });

  it('scrubs sensitive tokens and credentials from env', () => {
    const dirtyEnv = {
      PATH: '/usr/bin;C:\\Windows',
      USER: 'aegis',
      OPENAI_API_KEY: 'sk-proj-1234567890',
      ANTHROPIC_API_KEY: 'sk-ant-1234567890',
      GROQ_API_SECRET: 'gsk_secret_123',
      DATABASE_PASSWORD: 'supersecretpassword',
      AWS_SECRET_ACCESS_KEY: 'aws-secret-123',
      SAFE_CONFIG: 'production',
    };

    const clean = scrubEnv(dirtyEnv);
    expect(clean.PATH).toBeDefined();
    expect(clean.USER).toBe('aegis');
    expect(clean.SAFE_CONFIG).toBe('production');

    expect(clean.OPENAI_API_KEY).toBeUndefined();
    expect(clean.ANTHROPIC_API_KEY).toBeUndefined();
    expect(clean.GROQ_API_SECRET).toBeUndefined();
    expect(clean.DATABASE_PASSWORD).toBeUndefined();
    expect(clean.AWS_SECRET_ACCESS_KEY).toBeUndefined();
  });

  it('caps large output buffers', () => {
    const smallText = 'Hello Aegis';
    expect(capOutput(smallText, 50)).toBe('Hello Aegis');

    const hugeText = 'X'.repeat(500);
    const capped = capOutput(hugeText, 100);
    expect(capped.length).toBeLessThan(200);
    expect(capped).toContain('...[output capped at 100 bytes]');
  });

  it('GET /api/sandbox and PATCH /api/sandbox controls sandbox mode', async () => {
    const res = await app.request('/api/sandbox');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe('workspace');
    expect(body.workspaceRoot).toBeDefined();

    const patchRes = await app.request('/api/sandbox', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'strict' }),
    });
    expect(patchRes.status).toBe(200);
    expect(getSandboxMode()).toBe('strict');
  });
});
