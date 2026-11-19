import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import {
  hooksRoutes,
  loadHooks,
  saveHooks,
  executeHook,
  emitHook,
  getHookAuditLog,
  clearHookAuditLog,
  type LifecycleHook,
} from '../src/server/hooks.js';

describe('Lifecycle Hooks Engine & API', () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
    app.route('/api', hooksRoutes());
    clearHookAuditLog();
  });

  it('CRUD operations via HTTP routes', async () => {
    // 1. List
    const listRes = await app.request('/api/hooks');
    expect(listRes.status).toBe(200);

    // 2. Create
    const createRes = await app.request('/api/hooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Audit Tool Call',
        event: 'pre_tool',
        command: 'echo "Pre-tool hook executed"',
        enabled: true,
        timeoutMs: 3000,
      }),
    });
    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    expect(created.id).toBeDefined();
    expect(created.name).toBe('Audit Tool Call');
    expect(created.event).toBe('pre_tool');

    // 3. Get by ID
    const getRes = await app.request(`/api/hooks/${created.id}`);
    expect(getRes.status).toBe(200);
    const fetched = await getRes.json();
    expect(fetched.name).toBe('Audit Tool Call');

    // 4. Update
    const patchRes = await app.request(`/api/hooks/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enabled: false,
      }),
    });
    expect(patchRes.status).toBe(200);
    const updated = await patchRes.json();
    expect(updated.enabled).toBe(false);

    // 5. Delete
    const deleteRes = await app.request(`/api/hooks/${created.id}`, {
      method: 'DELETE',
    });
    expect(deleteRes.status).toBe(200);

    // Confirm deleted
    const checkRes = await app.request(`/api/hooks/${created.id}`);
    expect(checkRes.status).toBe(404);
  });

  it('executes hook command with sanitized environment and records audit', async () => {
    const isWindows = process.platform === 'win32';
    const testCommand = isWindows
      ? 'Write-Output "HOOK_ACTIVE"'
      : 'echo "HOOK_ACTIVE"';

    const testHook: LifecycleHook = {
      id: 'test_hook_exec',
      name: 'Test Exec',
      event: 'run_start',
      command: testCommand,
      enabled: true,
      timeoutMs: 4000,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const audit = await executeHook(testHook, { taskId: 'task-123' });
    expect(audit.hookId).toBe('test_hook_exec');
    expect(audit.status).toBe('success');
    expect(audit.output).toContain('HOOK_ACTIVE');
    expect(audit.durationMs).toBeGreaterThan(0);

    // Audit log should retain this execution
    const auditLogs = getHookAuditLog();
    expect(auditLogs.some((a) => a.hookId === 'test_hook_exec')).toBe(true);
  });

  it('emitHook triggers matching enabled hooks without throwing', async () => {
    const isWindows = process.platform === 'win32';
    const originalHooks = loadHooks();

    const sampleHook: LifecycleHook = {
      id: 'test_emit_hook',
      name: 'Emit Test',
      event: 'shortcut_run',
      command: isWindows ? 'Write-Output "SHORTCUT_FIRED"' : 'echo "SHORTCUT_FIRED"',
      enabled: true,
      timeoutMs: 4000,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    saveHooks([sampleHook]);

    try {
      const audits = await emitHook('shortcut_run', { shortcutId: 'calc' });
      expect(audits.length).toBe(1);
      expect(audits[0].output).toContain('SHORTCUT_FIRED');

      // Non-matching event should return empty
      const emptyAudits = await emitHook('memory_write', {});
      expect(emptyAudits.length).toBe(0);
    } finally {
      saveHooks(originalHooks);
    }
  });

  it('handles timeouts safely without crashing', async () => {
    const isWindows = process.platform === 'win32';
    const sleepCmd = isWindows ? 'Start-Sleep -Seconds 4' : 'sleep 4';

    const hangHook: LifecycleHook = {
      id: 'test_hang',
      name: 'Hanging Hook',
      event: 'run_end',
      command: sleepCmd,
      enabled: true,
      timeoutMs: 1000, // strict 1s timeout
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const audit = await executeHook(hangHook);
    expect(audit.status).toBe('timeout');
    expect(audit.output).toContain('timed out');
  });
});
