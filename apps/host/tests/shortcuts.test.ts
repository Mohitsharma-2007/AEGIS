import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import {
  shortcutsRoutes,
  loadShortcuts,
  saveShortcuts,
  runShortcut,
  getShortcutAuditLog,
  clearShortcutAuditLog,
  DEFAULT_SHORTCUTS,
  type Shortcut,
} from '../src/server/shortcuts.js';
import { capabilityTools } from '../src/server/capabilities.js';
import { Store, setGlobalStore } from '../src/server/store.js';

describe('App Shortcuts & Automation Engine', () => {
  let app: Hono;
  let store: Store;

  beforeEach(() => {
    store = new Store(':memory:');
    setGlobalStore(store);
    app = new Hono();
    app.route('/api', shortcutsRoutes());
    clearShortcutAuditLog();
  });

  it('loads default seeded shortcuts', () => {
    const list = loadShortcuts();
    expect(list.length).toBeGreaterThanOrEqual(5);

    const ids = list.map((s) => s.id);
    expect(ids).toContain('sc_calc');
    expect(ids).toContain('sc_notepad');
    expect(ids).toContain('sc_explorer');
    expect(ids).toContain('sc_chrome');
    expect(ids).toContain('sc_terminal');
  });

  it('CRUD operations via HTTP routes', async () => {
    // 1. List
    const listRes = await app.request('/api/shortcuts');
    expect(listRes.status).toBe(200);
    const list = await listRes.json();
    expect(list.length).toBeGreaterThanOrEqual(5);

    // 2. Create
    const createRes = await app.request('/api/shortcuts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'GitHub Web',
        target: 'https://github.com',
        type: 'url',
        description: 'Open GitHub in default browser',
      }),
    });
    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    expect(created.id).toBeDefined();
    expect(created.name).toBe('GitHub Web');

    // 3. Get by ID
    const getRes = await app.request(`/api/shortcuts/${created.id}`);
    expect(getRes.status).toBe(200);
    const fetched = await getRes.json();
    expect(fetched.name).toBe('GitHub Web');

    // 4. Update
    const patchRes = await app.request(`/api/shortcuts/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description: 'Updated description',
      }),
    });
    expect(patchRes.status).toBe(200);
    const updated = await patchRes.json();
    expect(updated.description).toBe('Updated description');

    // 5. Delete
    const delRes = await app.request(`/api/shortcuts/${created.id}`, {
      method: 'DELETE',
    });
    expect(delRes.status).toBe(200);
  });

  it('runs command shortcut and captures audit trail', async () => {
    const isWindows = process.platform === 'win32';
    const original = loadShortcuts();

    const cmdShortcut: Shortcut = {
      id: 'sc_echo_test',
      name: 'Echo Test',
      description: 'Test echo command',
      target: isWindows ? 'powershell -NoProfile -Command "Write-Output SHORTCUT_OK"' : 'echo "SHORTCUT_OK"',
      type: 'command',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    saveShortcuts([cmdShortcut, ...original]);

    try {
      const res = await runShortcut('sc_echo_test');
      expect(res.ok).toBe(true);
      expect(res.output).toContain('SHORTCUT_OK');

      const audits = getShortcutAuditLog();
      expect(audits.some((a) => a.shortcutId === 'sc_echo_test' && a.status === 'success')).toBe(true);
    } finally {
      saveShortcuts(original);
    }
  });

  it('capabilityTools exports all required memory and shortcut agent tools', async () => {
    const tools = capabilityTools();
    const names = tools.map((t) => t.name);

    expect(names).toContain('memory_create_document');
    expect(names).toContain('memory_update_document');
    expect(names).toContain('memory_search');
    expect(names).toContain('memory_list_documents');
    expect(names).toContain('memory_reindex');
    expect(names).toContain('run_shortcut');
    expect(names).toContain('list_shortcuts');
    expect(names).toContain('create_shortcut');
    expect(names).toContain('run_sequence');

    // Execute memory_create_document tool
    const createDocTool = tools.find((t) => t.name === 'memory_create_document')!;
    const created = await (createDocTool.execute as any)({
      title: 'Agent Scratchpad',
      content: '# Notes\nCreated by agent tool.',
    });
    expect(created.ok).toBe(true);
    expect(created.title).toBe('Agent Scratchpad');

    // Execute memory_list_documents tool
    const listDocsTool = tools.find((t) => t.name === 'memory_list_documents')!;
    const listed = await (listDocsTool.execute as any)({});
    expect(listed.count).toBe(1);

    // Execute list_shortcuts tool
    const listScTool = tools.find((t) => t.name === 'list_shortcuts')!;
    const scList = await (listScTool.execute as any)({});
    expect(scList.count).toBeGreaterThanOrEqual(5);
  });
});
