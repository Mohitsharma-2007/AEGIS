import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { useLocalVoice } from '../src/client/useLocalVoice';

let voice: ReturnType<typeof useLocalVoice>;
let root: ReactTestRenderer;
let socket: FakeSocket;
const track = { stop: vi.fn() };

class FakeSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  readyState = 0;
  binaryType = '';
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  close = vi.fn(() => { this.readyState = 3; });
  constructor() { socket = this; }
  open() { this.readyState = 1; this.onopen?.(); }
  message(data: string) { this.onmessage?.({ data }); }
}

class FakeAudioContext {
  sampleRate = 48_000;
  destination = {};
  currentTime = 1;
  state = 'running';
  async resume() {}
  async close() { this.state = 'closed'; }
  createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
  createScriptProcessor() { return { connect() {}, disconnect() {}, onaudioprocess: null as ((event: unknown) => void) | null }; }
  createGain() { return { gain: { value: 1 }, connect() {} }; }
}

function Hook() {
  voice = useLocalVoice('http://127.0.0.1:8766', 'en-US', { onTurn });
  return null;
}
const onTurn = vi.fn();

afterEach(async () => {
  await act(async () => root?.unmount());
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it('stops every input track when muted, keeps the task socket alive, and deduplicates repeated transcript frames', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('AudioContext', FakeAudioContext);
  vi.stubGlobal('navigator', {
    mediaDevices: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [track] }) },
  });
  await act(async () => { root = create(createElement(Hook)); });
  await act(async () => { await voice.start(); });
  await act(async () => { socket.open(); await Promise.resolve(); });
  expect(socket.onmessage).toBeTypeOf('function');
  expect(voice.muted).toBe(false);
  expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);

  await act(async () => {
    socket.message(JSON.stringify({ type: 'transcription', text: 'Open the browser' }));
    socket.message(JSON.stringify({ type: 'transcription', text: 'Open the browser' }));
  });
  expect(voice.lines).toHaveLength(1);
  expect(voice.lines[0].text).toBe('Open the browser');
  expect(onTurn).not.toHaveBeenCalled();
  await act(async () => {
    socket.message(JSON.stringify({ type: 'status', state: 'thinking' }));
  });
  expect(onTurn).toHaveBeenCalledTimes(1);
  expect(onTurn).toHaveBeenCalledWith('user', 'Open the browser');

  await act(async () => { voice.setMuted(true); });
  expect(track.stop).toHaveBeenCalledTimes(1);
  expect(socket.close).not.toHaveBeenCalled();
  expect(voice.muted).toBe(true);

  await act(async () => {
    socket.message(JSON.stringify({ type: 'transcription', text: 'Open the browser' }));
  });
  expect(onTurn).toHaveBeenCalledTimes(1);
});
