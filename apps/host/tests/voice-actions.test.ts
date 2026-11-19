import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useVoice } from '../src/client/useVoice';

// Polyfill window & CustomEvent for Node environment if missing
if (typeof globalThis.window === 'undefined') {
  (globalThis as any).window = globalThis;
}
if (typeof globalThis.CustomEvent === 'undefined') {
  class CustomEvent<T = any> extends Event {
    detail: T;
    constructor(type: string, eventInitDict?: CustomEventInit<T>) {
      super(type, eventInitDict);
      this.detail = eventInitDict?.detail as T;
    }
  }
  (globalThis as any).CustomEvent = CustomEvent;
  (globalThis.window as any).CustomEvent = CustomEvent;
}

const eventListeners: Record<string, Function[]> = {};
globalThis.window.dispatchEvent = vi.fn((event: Event) => {
  const listeners = eventListeners[event.type] || [];
  listeners.forEach((listener) => listener(event));
  return true;
}) as any;
globalThis.window.addEventListener = vi.fn((type: string, listener: any) => {
  eventListeners[type] = eventListeners[type] || [];
  eventListeners[type].push(listener);
}) as any;
globalThis.window.removeEventListener = vi.fn((type: string, listener: any) => {
  if (eventListeners[type]) {
    eventListeners[type] = eventListeners[type].filter((l) => l !== listener);
  }
}) as any;

const api = vi.hoisted(() => vi.fn());
vi.mock('../src/client/api', () => ({
  api,
  authHeaders: () => ({}),
}));

let voice: ReturnType<typeof useVoice>;
let root: ReactTestRenderer;
let pc: FakePeer;
const track = { stop: vi.fn(), enabled: true };

class FakeDataChannel {
  readyState = 'open';
  close = vi.fn();
  send = vi.fn();
  onmessage?: (event: { data: string }) => void;
  onopen?: () => void;
  onclose?: () => void;
}

class FakePeer {
  connectionState = 'new';
  onconnectionstatechange?: () => void;
  channel = new FakeDataChannel();
  constructor() {
    pc = this;
  }
  createDataChannel() {
    return this.channel;
  }
  addTrack() {}
  async createOffer() {
    return { sdp: 'offer' };
  }
  async setLocalDescription() {}
  async setRemoteDescription() {}
  close() {}
  state(value: string) {
    this.connectionState = value;
    this.onconnectionstatechange?.();
  }
}

function Hook() {
  voice = useVoice('thread', () => {});
  return null;
}

describe('Voice AI Action Execution (R5)', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('RTCPeerConnection', FakePeer);
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia: async () => ({ getTracks: () => [track] }) },
    });
    vi.stubGlobal(
      'Audio',
      class {
        autoplay = false;
        srcObject = null;
        pause() {}
      },
    );
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({}));

    api.mockReset().mockImplementation(async (path: string, method?: string, body?: any) => {
      if (path === '/voice/calls') return { id: 'call_test_1', sdp: 'answer' };
      if (path.includes('/compute')) return { text: `Computed turn result for: ${body?.request}` };
      return { endedAt: null };
    });

    await act(async () => {
      root = create(createElement(Hook));
    });
    await act(async () => {
      await voice.start();
      pc.state('connected');
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('handles computer_control tool call and returns function_call_output', async () => {
    const actionEvents: any[] = [];
    const computerEvents: any[] = [];
    const onAction = (e: Event) => actionEvents.push((e as CustomEvent).detail);
    const onComputer = (e: Event) => computerEvents.push((e as CustomEvent).detail);
    window.addEventListener('aegis:action', onAction);
    window.addEventListener('aegis:computer-action', onComputer);

    await act(async () => {
      pc.channel.onmessage?.({
        data: JSON.stringify({
          type: 'response.function_call_arguments.done',
          name: 'computer_control',
          call_id: 'call_cua_1',
          arguments: JSON.stringify({
            action: 'click',
            params: { x: 500, y: 300 },
          }),
        }),
      });
    });

    expect(actionEvents).toHaveLength(1);
    expect(actionEvents[0].tool).toBe('computer_control');
    expect(actionEvents[0].action).toBe('click');
    expect(computerEvents).toHaveLength(1);
    expect(computerEvents[0].action).toBe('click');

    // Verify channel sent function_call_output
    const sentMessages = pc.channel.send.mock.calls.map(([arg]) => JSON.parse(arg));
    const outputMessage = sentMessages.find(
      (m: any) => m.type === 'conversation.item.create' && m.item?.type === 'function_call_output',
    );
    expect(outputMessage).toBeDefined();
    expect(outputMessage.item.call_id).toBe('call_cua_1');
    expect(outputMessage.item.output).toContain('Execute computer action: click');

    window.removeEventListener('aegis:action', onAction);
    window.removeEventListener('aegis:computer-action', onComputer);
  });

  it('handles recall_memory tool call and returns function_call_output', async () => {
    const actionEvents: any[] = [];
    const onAction = (e: Event) => actionEvents.push((e as CustomEvent).detail);
    window.addEventListener('aegis:action', onAction);

    await act(async () => {
      pc.channel.onmessage?.({
        data: JSON.stringify({
          type: 'response.function_call_arguments.done',
          name: 'recall_memory',
          call_id: 'call_mem_1',
          arguments: JSON.stringify({
            query: 'user preferred programming language',
          }),
        }),
      });
    });

    expect(actionEvents).toHaveLength(1);
    expect(actionEvents[0].tool).toBe('recall_memory');
    expect(actionEvents[0].query).toBe('user preferred programming language');

    const sentMessages = pc.channel.send.mock.calls.map(([arg]) => JSON.parse(arg));
    const outputMessage = sentMessages.find(
      (m: any) => m.type === 'conversation.item.create' && m.item?.type === 'function_call_output',
    );
    expect(outputMessage).toBeDefined();
    expect(outputMessage.item.call_id).toBe('call_mem_1');
    expect(outputMessage.item.output).toContain('Recall memory for: user preferred programming language');

    window.removeEventListener('aegis:action', onAction);
  });

  it('handles arbitrary function calls without dropping them', async () => {
    const actionEvents: any[] = [];
    const onAction = (e: Event) => actionEvents.push((e as CustomEvent).detail);
    window.addEventListener('aegis:action', onAction);

    await act(async () => {
      pc.channel.onmessage?.({
        data: JSON.stringify({
          type: 'response.function_call_arguments.done',
          name: 'browser_navigate',
          call_id: 'call_nav_1',
          arguments: JSON.stringify({
            url: 'https://news.ycombinator.com',
          }),
        }),
      });
    });

    expect(actionEvents).toHaveLength(1);
    expect(actionEvents[0].tool).toBe('browser_navigate');

    const sentMessages = pc.channel.send.mock.calls.map(([arg]) => JSON.parse(arg));
    const outputMessage = sentMessages.find(
      (m: any) => m.type === 'conversation.item.create' && m.item?.type === 'function_call_output',
    );
    expect(outputMessage).toBeDefined();
    expect(outputMessage.item.call_id).toBe('call_nav_1');
    expect(outputMessage.item.output).toContain('Execute tool call browser_navigate');

    window.removeEventListener('aegis:action', onAction);
  });
});
