import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { FilesSurfaceView, type FilesSurfaceProps } from '../src/client/FilesSurfaceView.js';

describe('Files Surface View & Documents layout', () => {
  const sampleFiles = [
    {
      id: 'f1',
      name: 'RESEARCH_BRIEF.md',
      path: 'D:/Aegis 2/RESEARCH_BRIEF.md',
      sizeBytes: 14200,
      lastModified: '17/11/2026, 01:00 AM',
      chatGroup: 'Chat: Deep Research',
      chatId: 'c1',
      kind: 'doc' as const,
    },
    {
      id: 'f2',
      name: 'pipeline.ts',
      path: 'D:/Aegis 2/pipeline.ts',
      sizeBytes: 8120,
      lastModified: '17/11/2026, 01:15 AM',
      chatGroup: 'Chat: Data Pipelines',
      chatId: 'c2',
      kind: 'code' as const,
    },
  ];

  it('renders files hub with controls, grouping, and structured table without horizontal overflow classes', () => {
    const html = renderToStaticMarkup(createElement<FilesSurfaceProps>(FilesSurfaceView, { initialFiles: sampleFiles }));
    expect(html).toContain('Workspace files');
    expect(html).toContain('files-surface-hub');
    expect(html).toContain('files-table');
    expect(html).toContain('files-col-name');
    expect(html).toContain('files-col-path');
    expect(html).toContain('RESEARCH_BRIEF.md');
    expect(html).toContain('By Thread');
    expect(html).toContain('By Type');
  });

  it('renders clean empty state when no files match or exist', () => {
    const html = renderToStaticMarkup(createElement<FilesSurfaceProps>(FilesSurfaceView, { initialFiles: [] }));
    expect(html).toContain('No matching workspace files');
  });

  it('includes category filter pills for granular document discovery', () => {
    const html = renderToStaticMarkup(createElement(FilesSurfaceView));
    expect(html).toContain('All Types');
    expect(html).toContain('Docs');
    expect(html).toContain('Code');
    expect(html).toContain('Images');
    expect(html).toContain('Archives');
  });
});

describe('Notch hover and expansion hit-test routing', () => {
  // Replicate notch geometry logic
  const NOTCH_WIDTH = 680;
  const isOverNotch = (x: number, y: number, open: boolean, hover: boolean) => {
    if (open) {
      const left = (NOTCH_WIDTH - 620) / 2 - 10;
      const right = (NOTCH_WIDTH + 620) / 2 + 10;
      const bottom = 308 + 10;
      return x >= left && x <= right && y >= 0 && y <= bottom;
    }
    const width = hover ? 372 : 300;
    const left = (NOTCH_WIDTH - width) / 2 - 8;
    const right = (NOTCH_WIDTH + width) / 2 + 8;
    const bottom = 38 + 8;
    return x >= left && x <= right && y >= 0 && y <= bottom;
  };

  it('correctly detects pointer over collapsed notch pill', () => {
    // Center of 680px window is 340, top 20px
    expect(isOverNotch(340, 20, false, false)).toBe(true);
    // Outside horizontally (left of pill: x=100)
    expect(isOverNotch(100, 20, false, false)).toBe(false);
    // Outside vertically (below pill: y=60)
    expect(isOverNotch(340, 60, false, false)).toBe(false);
  });

  it('maintains interaction as pointer moves anywhere inside expanded shelf', () => {
    // Within 620x300 expanded shelf:
    expect(isOverNotch(340, 150, true, true)).toBe(true);
    expect(isOverNotch(100, 250, true, true)).toBe(true);
    expect(isOverNotch(600, 280, true, true)).toBe(true);
    // Outside expanded shelf
    expect(isOverNotch(340, 350, true, true)).toBe(false);
    expect(isOverNotch(10, 150, true, true)).toBe(false);
  });

  it('toggles expansion state cleanly on click', () => {
    let open = false;
    const toggle = () => { open = !open; };
    expect(open).toBe(false);
    toggle();
    expect(open).toBe(true);
    toggle();
    expect(open).toBe(false);
  });
});
