import { describe, expect, it } from 'vitest';
import {
  parseSnapshot,
  runAgentDesktop,
  validateAgentDesktopRequest,
} from '../src/server/agent-desktop.js';

describe('Agent Desktop safety boundary', () => {
  it('allows semantic accessibility actions and observations', () => {
    expect(() => validateAgentDesktopRequest('snapshot', ['--interactive-only'])).not.toThrow();
    expect(() => validateAgentDesktopRequest('click', ['@s123:e4'])).not.toThrow();
    expect(() => validateAgentDesktopRequest('set-value', ['@s123:e4', 'Aegis'])).not.toThrow();
  });

  it.each(['launch', 'close-app', 'batch', 'screenshot'])(
    'refuses commands outside the semantic action allowlist: %s',
    (command) => {
      expect(() => validateAgentDesktopRequest(command, [])).toThrow(
        /not in the Agent Desktop observation and semantic-action allowlist/,
      );
    },
  );

  it('does not let a tool override its session or subagent identity', async () => {
    await expect(
      runAgentDesktop('snapshot', ['--session', 'another-agent'], 'owner-session'),
    ).rejects.toMatchObject({ code: 'AGENT_DESKTOP_UNSAFE' });
    await expect(
      runAgentDesktop('snapshot', ['--agent-id=other'], 'owner-session'),
    ).rejects.toMatchObject({ code: 'AGENT_DESKTOP_UNSAFE' });
  });

  it('parses Vercel CLI envelopes and nested numbered accessibility refs', () => {
    const snapshot = parseSnapshot('task-17', {
      version: '2.6',
      ok: true,
      command: 'snapshot',
      data: {
        app: 'Calculator',
        window: { title: 'Calculator' },
        tree: {
          role: 'window',
          name: 'Calculator',
          children: [
            {
              role: 'button',
              name: 'Seven',
              ref_id: '@s123:e7',
              available_actions: ['Click'],
              bounds: { x: 10, y: 20, width: 30, height: 40 },
            },
            { role: 'text', name: 'not actionable' },
          ],
        },
      },
    }, 1);

    expect(snapshot).toMatchObject({
      sessionId: 'task-17',
      app: 'Calculator',
      window: 'Calculator',
      elements: [{
        ref: '@s123:e7', role: 'button', name: 'Seven', enabled: true,
        frame: { x: 10, y: 20, width: 30, height: 40 },
      }],
    });
  });

  it.each(['type', 'press', 'key', 'focus', 'focus-window', 'double-click', 'right-click'])(
    'refuses the physical or focus-taking %s command',
    (command) => {
      expect(() => validateAgentDesktopRequest(command, ['@s123:e4'])).toThrow(
        /disabled because it can take over the owner's desktop/,
      );
    },
  );

  it.each(['--headed', '--headed=true', '--force', '--session=other', '--agent-id=other'])(
    'refuses the unsafe or caller-controlled flag %s',
    (flag) => {
      expect(() => validateAgentDesktopRequest('click', ['@s123:e4', flag])).toThrow(
        /is not allowed/,
      );
    },
  );

  it('refuses trace and screenshot output flags', () => {
    expect(() => validateAgentDesktopRequest('snapshot', ['--trace', 'C:\\trace.jsonl'])).toThrow(
      /--trace/,
    );
    expect(() => validateAgentDesktopRequest('snapshot', ['--screenshot=private.html'])).toThrow(
      /--screenshot/,
    );
  });
});
