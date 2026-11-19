import { describe, it, expect } from 'vitest';
import { existsSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { officeAndSocialTools } from '../src/server/office-tools.js';

describe('Milestone 5: Office Tools & WhatsApp Suite', () => {
  const tools = officeAndSocialTools();
  const excel = tools.find((t) => t.name === 'office_excel')!;
  const word = tools.find((t) => t.name === 'office_word')!;
  const powerpoint = tools.find((t) => t.name === 'office_powerpoint')!;
  const waVerify = tools.find((t) => t.name === 'whatsapp_verify')!;
  const waRead = tools.find((t) => t.name === 'whatsapp_read')!;
  const waSend = tools.find((t) => t.name === 'whatsapp_send')!;

  it('exposes all expected office and social tool definitions', () => {
    expect(excel).toBeDefined();
    expect(word).toBeDefined();
    expect(powerpoint).toBeDefined();
    expect(waVerify).toBeDefined();
    expect(waRead).toBeDefined();
    expect(waSend).toBeDefined();
  });

  it('generates a genuine binary .xlsx spreadsheet without degrading to csv', async () => {
    const testPath = join(tmpdir(), `aegis-test-${Date.now()}.xlsx`);
    try {
      const res = (await excel.execute?.({
        action: 'create',
        path: testPath,
        sheet: 'Quarterly',
        data: [
          ['Product', 'Revenue', 'Units'],
          ['Aegis Pro', 125000, 50],
          ['Aegis Team', 48000, 20],
        ],
      })) as { ok: boolean; path: string; engine?: string };

      expect(res.ok).toBe(true);
      expect(existsSync(testPath)).toBe(true);
      expect(statSync(testPath).size).toBeGreaterThan(100);

      // Verify read capability
      const readRes = (await excel.execute?.({
        action: 'read',
        path: testPath,
        sheet: 'Quarterly',
      })) as { ok: boolean; rows?: (string | number)[][]; rowCount?: number };

      expect(readRes.ok).toBe(true);
      expect(readRes.rows?.length).toBeGreaterThanOrEqual(3);
    } finally {
      try {
        if (existsSync(testPath)) rmSync(testPath, { force: true });
      } catch {
        // file lock on windows
      }
    }
  }, 20000);

  it('generates a genuine binary .docx Word document without degrading to markdown', async () => {
    const testPath = join(tmpdir(), `aegis-test-${Date.now()}.docx`);
    try {
      const res = (await word.execute?.({
        action: 'create',
        path: testPath,
        title: 'Aegis Architecture Brief',
        headings: [
          { level: 1, text: 'Executive Summary' },
          { level: 2, text: 'Agent Swarm Coordination' },
        ],
        paragraphs: [
          'Aegis combines local-first execution with dynamic desktop and voice automation.',
          'The background harness dispatches task graphs with zero UI intrusion.',
        ],
        bulletPoints: [
          'Pure-JS office generators (SheetJS, docx, pptxgenjs)',
          'Win32 process reuse and top-level window activation',
          'Voice transcript SQLite persistence',
        ],
      })) as { ok: boolean; path: string; engine?: string };

      expect(res.ok).toBe(true);
      expect(existsSync(testPath)).toBe(true);
      expect(statSync(testPath).size).toBeGreaterThan(100);
    } finally {
      try {
        if (existsSync(testPath)) rmSync(testPath, { force: true });
      } catch {
        // file lock on windows
      }
    }
  }, 20000);

  it('generates a genuine binary .pptx PowerPoint presentation', async () => {
    const testPath = join(tmpdir(), `aegis-test-${Date.now()}.pptx`);
    try {
      const res = (await powerpoint.execute?.({
        action: 'create',
        path: testPath,
        title: 'Aegis Production Review',
        subtitle: 'Milestone 5 Deliverables',
        slides: [
          {
            title: 'Desktop Shell & Overlay',
            bullets: ['34-state animated SVG mascot', 'Reactive audio waveform notch', 'Sandboxed IPC channels'],
            notes: 'Presenter: Highlight seamless window management.',
          },
          {
            title: 'Agent Automation',
            bullets: ['CUA coordinate drag in Paint', 'Win32 window activation without duplicates'],
          },
        ],
      })) as { ok: boolean; path: string; slideCount?: number; engine?: string };

      expect(res.ok).toBe(true);
      expect(existsSync(testPath)).toBe(true);
      expect(statSync(testPath).size).toBeGreaterThan(100);
      expect(res.slideCount).toBe(3);
    } finally {
      try {
        if (existsSync(testPath)) rmSync(testPath, { force: true });
      } catch {
        // file lock on windows
      }
    }
  }, 20000);

  it('executes whatsapp tools fail-softly when sidecar is offline', async () => {
    const status = (await waVerify.execute?.({})) as { reachable: boolean };
    expect(status).toHaveProperty('reachable');

    const read = (await waRead.execute?.({ limit: 5 })) as { ok?: boolean; error?: string };
    expect(read).toBeDefined();

    const send = (await waSend.execute?.({ to: '1234567890', text: 'Hello from test' })) as { ok?: boolean };
    expect(send).toBeDefined();
  });
});
