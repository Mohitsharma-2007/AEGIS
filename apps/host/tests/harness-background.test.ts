import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { OpsView } from '../src/client/OpsView';
import { getHarnessStatus } from '../src/server/harness';
import type { Dot, State } from '../src/shared/types';

vi.mock('../src/client/api', () => ({
  getHarnessStatus: vi.fn().mockResolvedValue({
    running: true,
    engine: 'native',
    version: '1.0.0',
    detail: 'Native execution engine active in background',
  }),
  authHeaders: () => ({}),
}));

// Mock sub-panels so OpsView tests remain fast and clean
vi.mock('../src/client/ComputerPanel', () => ({
  ComputerPanel: ({ section }: any) => createElement('div', { className: 'mock-computer-panel', 'data-section': section }),
}));
vi.mock('../src/client/ActivityView', () => ({
  ActivityView: ({ dotId }: any) => createElement('div', { className: 'mock-activity-view', 'data-dot-id': dotId }),
}));

describe('Background Execution Harness Decoupling (R4)', () => {
  const mockDot: Dot = {
    id: 'dot-1',
    name: 'Operator',
    instructions: 'Assist with tasks',
    spaceId: 'space-1',
    spaceIds: ['space-1'],
    researchAllowed: true,
    memoryAllowed: true,
    appsAllowed: true,
    composioToolkits: [],
    createdAt: Date.now(),
  };

  const mockState: State = {
    settings: {} as any,
    memories: [],
    tasks: [],
    mode: 'sample',
    configured: true,
  };

  it('OpsView renders terminal and activity tabs without a standalone harness tab', () => {
    const html = renderToStaticMarkup(
      createElement(OpsView, {
        state: mockState,
        dot: mockDot,
        initialTab: 'terminal',
      }),
    );

    // Tab buttons check
    expect(html).toContain('Terminal');
    expect(html).toContain('Activity &amp; Tasks');
    // Standalone harness tab button must NOT exist
    expect(html).not.toContain('<button type="button" role="tab" class="ops-tab" onClick={() => setTab(\'harness\')}>');
    expect(html).not.toMatch(/role="tab"[^>]*>\s*<svg[^>]*><\/svg>\s*Harness<\/button>/);

    // Background harness diagnostics indicator MUST exist
    expect(html).toContain('Harness Engine:');
    expect(html).toContain('ops-harness-diagnostics');
  });

  it('defaults to terminal tab and switches to activity tab', async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    let root: ReactTestRenderer;
    await act(async () => {
      root = create(
        createElement(OpsView, {
          state: mockState,
          dot: mockDot,
        }),
      );
    });

    // Root should render ComputerPanel for Terminal by default
    const terminalPanel = root!.root.findByProps({ className: 'mock-computer-panel' });
    expect(terminalPanel).toBeDefined();
    expect(terminalPanel.props['data-section']).toBe('Terminal');

    // Find and click Activity tab
    const buttons = root!.root.findAllByType('button');
    const activityButton = buttons.find((b) => b.props.children?.toString().includes('Activity'));
    expect(activityButton).toBeDefined();

    await act(async () => {
      activityButton!.props.onClick();
    });

    const activityView = root!.root.findByProps({ className: 'mock-activity-view' });
    expect(activityView).toBeDefined();
    expect(activityView.props['data-dot-id']).toBe('dot-1');
  });

  it('backend execution harness remains functional in background', async () => {
    const status = await getHarnessStatus();
    expect(status).toBeDefined();
    expect(status.engine).toBe('native');
    // Backend harness is available as execution engine
    expect(typeof status.running).toBe('boolean');
  });
});
