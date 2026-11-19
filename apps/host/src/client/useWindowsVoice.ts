import { useCallback, useEffect, useRef, useState } from 'react';

export type WindowsVoicePhase =
  | 'idle'
  | 'connecting'
  | 'warming'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'error';

export interface WindowsVoiceLine {
  id: string;
  role: 'user' | 'agent';
  text: string;
  at: number;
}

export interface WindowsVoiceAction {
  action: string;
  command?: string;
  at: number;
}

export interface WindowsVoiceCommand {
  phrase: string;
  intent: string;
  action: string;
  reply: string;
}

export interface WindowsVoiceHealth {
  ok: boolean;
  url?: string;
  available?: boolean;
  language?: string;
  commandCount?: number;
  privacyBlocked?: boolean;
  privacyHelp?: string;
  listening?: boolean;
  llmModel?: string;
  error?: string;
}

const TARGET_RATE = 16_000;
const DEFAULT_BRIDGE = 'http://127.0.0.1:8767';

function pcm16ToFloat(input: Int16Array) {
  const output = new Float32Array(input.length);
  for (let i = 0; i < input.length; i += 1) output[i] = input[i] / 0x8000;
  return output;
}

function bridgeUrl(base: string) {
  const trimmed = (base || DEFAULT_BRIDGE).trim().replace(/\/$/, '');
  const url = new URL(trimmed);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = `${url.pathname.replace(/\/$/, '')}/ws`;
  return url.toString();
}

export interface UseWindowsVoiceOptions {
  onTurn?: (role: 'user' | 'agent', text: string) => void;
}

/**
 * Drives the Aegis Windows Voice Bridge.
 *
 * The Windows speech engine owns the microphone, so this hook never asks the
 * browser for one: it opens a WebSocket, listens for commands, and plays the
 * spoken answers that come back.
 */
export function useWindowsVoice(
  baseUrl: string = DEFAULT_BRIDGE,
  options: UseWindowsVoiceOptions = {},
) {
  const [phase, setPhase] = useState<WindowsVoicePhase>('idle');
  const [lines, setLines] = useState<WindowsVoiceLine[]>([]);
  const [actions, setActions] = useState<WindowsVoiceAction[]>([]);
  const [commands, setCommands] = useState<WindowsVoiceCommand[]>([]);
  const [health, setHealth] = useState<WindowsVoiceHealth>();
  const [error, setError] = useState('');
  const [muted, setMutedState] = useState(false);
  const mutedRef = useRef(false);
  const onTurnRef = useRef(options?.onTurn);
  useEffect(() => {
    onTurnRef.current = options?.onTurn;
  }, [options?.onTurn]);

  const setMuted = useCallback((value: boolean) => {
    mutedRef.current = value;
    setMutedState(value);
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      try {
        ws.current.send(JSON.stringify({ type: 'mute', muted: value }));
      } catch {
        // best effort
      }
    }
  }, []);

  const toggleMute = useCallback(() => {
    setMuted(!mutedRef.current);
  }, [setMuted]);

  const ws = useRef<WebSocket | null>(null);
  const playbackContext = useRef<AudioContext | null>(null);
  const playAt = useRef(0);
  const pending = useRef(0);
  const assistantDraft = useRef('');
  const session = useRef(0);

  const addLine = useCallback((role: 'user' | 'agent', text: string) => {
    const value = text.trim();
    if (!value) return;
    setLines((previous) => {
      const last = previous[previous.length - 1];
      if (last && last.role === role && last.text === value) return previous;
      return [
        ...previous.slice(-40),
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          role,
          text: value,
          at: Date.now(),
        },
      ];
    });
  }, []);

  const stop = useCallback(() => {
    session.current += 1;
    try {
      ws.current?.close();
    } catch {
      // ignore
    }
    ws.current = null;
    void playbackContext.current?.close().catch(() => {});
    playbackContext.current = null;
    playAt.current = 0;
    pending.current = 0;
    assistantDraft.current = '';
    setPhase('idle');
    setError('');
  }, []);

  const playChunk = useCallback((chunk: Int16Array) => {
    const context = playbackContext.current;
    if (!context) return;
    const buffer = context.createBuffer(1, chunk.length, TARGET_RATE);
    buffer.copyToChannel(pcm16ToFloat(chunk), 0);
    const node = context.createBufferSource();
    node.buffer = buffer;
    node.connect(context.destination);
    const now = context.currentTime;
    const start = Math.max(now + 0.01, playAt.current || now + 0.01);
    playAt.current = start + buffer.duration;
    pending.current += 1;
    node.onended = () => {
      pending.current = Math.max(0, pending.current - 1);
      if (pending.current === 0) {
        setPhase((current) => (current === 'speaking' ? 'listening' : current));
      }
    };
    node.start(start);
  }, []);

  const check = useCallback(async () => {
    try {
      const response = await fetch('/api/voice/windows');
      const info = (await response.json()) as WindowsVoiceHealth;
      setHealth(info);
      return info;
    } catch (failure) {
      setHealth({
        ok: false,
        error:
          failure instanceof Error
            ? failure.message
            : 'Windows Voice Bridge is not reachable.',
      });
      return undefined;
    }
  }, []);

  const loadCommands = useCallback(async () => {
    try {
      const response = await fetch('/api/voice/windows/commands');
      const info = (await response.json()) as {
        commands?: WindowsVoiceCommand[];
      };
      setCommands(info.commands ?? []);
    } catch {
      // The list is a nicety; the session still works without it.
    }
  }, []);

  const start = useCallback(async () => {
    if (ws.current) return;
    const run = session.current + 1;
    session.current = run;
    setError('');
    setPhase('connecting');
    try {
      const playback = new AudioContext({ sampleRate: TARGET_RATE });
      playbackContext.current = playback;
      await playback.resume().catch(() => {});

      const socket = new WebSocket(bridgeUrl(baseUrl));
      socket.binaryType = 'arraybuffer';
      ws.current = socket;

      socket.onopen = () => {
        if (session.current !== run) return;
        setPhase('warming');
      };

      socket.onmessage = (event) => {
        if (session.current !== run) return;
        if (typeof event.data !== 'string') {
          playChunk(new Int16Array(event.data as ArrayBuffer));
          return;
        }
        try {
          const message = JSON.parse(event.data) as {
            type?: string;
            state?: WindowsVoicePhase;
            text?: string;
            error?: string;
            action?: string;
            command?: string;
            commands?: WindowsVoiceCommand[];
          };
          if (message.type === 'status' && message.state) {
            setPhase(message.state);
            if (message.state === 'thinking') assistantDraft.current = '';
            if (message.state === 'speaking') playAt.current = 0;
          } else if (message.type === 'ready') {
            if (message.commands) setCommands(message.commands);
            setPhase('listening');
          } else if (message.type === 'transcription' && message.text) {
            if (!mutedRef.current) {
              addLine('user', message.text);
              onTurnRef.current?.('user', message.text);
            }
          } else if (message.type === 'text' && message.text) {
            assistantDraft.current += message.text;
          } else if (message.type === 'response-end') {
            const agentText = assistantDraft.current;
            addLine('agent', agentText);
            if (agentText.trim()) {
              onTurnRef.current?.('agent', agentText);
            }
            assistantDraft.current = '';
          } else if (message.type === 'action' && message.action) {
            setActions((previous) => [
              ...previous.slice(-20),
              {
                action: message.action ?? '',
                command: message.command,
                at: Date.now(),
              },
            ]);
            if (typeof window !== 'undefined') {
              const act = message.action.toLowerCase();
              if (act.startsWith('open-')) {
                const targetView = act.replace('open-', '');
                const map: Record<string, string> = {
                  chat: 'chat',
                  computer: 'computer',
                  browser: 'browser',
                  settings: 'settings',
                  files: 'files',
                  memory: 'memories',
                  memories: 'memories',
                  research: 'research',
                  terminal: 'terminal',
                  tasks: 'tasks',
                  activity: 'tasks',
                  integrations: 'integrations',
                  tools: 'integrations',
                  companion: 'companion',
                  agents: 'agents',
                };
                window.dispatchEvent(
                  new CustomEvent('aegis:nav', { detail: map[targetView] || targetView }),
                );
              } else if (act === 'computer') {
                window.dispatchEvent(
                  new CustomEvent('aegis:computer-action', {
                    detail: { command: message.command, parameters: message },
                  }),
                );
              }
              window.dispatchEvent(
                new CustomEvent('aegis:action', {
                  detail: {
                    action: message.action,
                    command: message.command,
                    parameters: message,
                    at: Date.now(),
                  },
                }),
              );
            }
          } else if (message.type === 'error') {
            setError(message.error ?? 'Windows voice error.');
          }
        } catch {
          // Ignore unknown control frames.
        }
      };

      socket.onerror = () => {
        if (session.current !== run) return;
        setPhase('error');
        setError(
          `Windows Voice Bridge offline at ${baseUrl}. Start it with .\\run_windows_voice.ps1.`,
        );
      };

      socket.onclose = () => {
        if (session.current !== run) return;
        setPhase('idle');
      };
    } catch (failure) {
      stop();
      setPhase('error');
      setError(
        failure instanceof Error ? failure.message : 'Could not start Windows voice.',
      );
    }
  }, [addLine, baseUrl, playChunk, stop]);

  /** Run a command without speaking it (handy for testing the wiring). */
  const runCommand = useCallback(async (text: string) => {
    const value = text.trim();
    if (!value) return;
    try {
      const response = await fetch('/api/voice/windows/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: value }),
      });
      const info = (await response.json()) as { error?: string };
      if (info.error) setError(info.error);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Windows Voice Bridge is not reachable.',
      );
    }
  }, []);

  useEffect(() => {
    void check();
    void loadCommands();
  }, [check, loadCommands]);

  useEffect(() => () => stop(), [stop]);

  return {
    phase,
    lines,
    actions,
    commands,
    health,
    error,
    muted,
    setMuted,
    toggleMute,
    start,
    stop,
    check,
    runCommand,
  };
}
