import { useCallback, useEffect, useRef, useState } from 'react';

export type VoicePhase =
  | 'idle'
  | 'connecting'
  | 'warming'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'error';

export interface VoiceLine {
  id: string;
  role: 'user' | 'agent';
  text: string;
  at: number;
}

/**
 * One step the voice agent is taking this turn. These are collected as a
 * grouped activity list instead of being concatenated into the reply text,
 * which used to leave `[Action: ...]` fragments scattered through chat.
 */
export interface VoiceAction {
  id: string;
  tool: string;
  rationale: string;
  at: number;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onresult: ((event: { resultIndex: number; results: Array<Array<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

const TARGET_RATE = 16_000;

function downsample(input: Float32Array, from: number, to: number) {
  if (from === to) return input;
  const ratio = from / to;
  const length = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j += 1) sum += input[j];
    output[i] = end > start ? sum / (end - start) : input[start] ?? 0;
  }
  return output;
}

function floatToPcm16(input: Float32Array) {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    const value = Math.max(-1, Math.min(1, input[i]));
    output[i] = value < 0 ? value * 0x8000 : value * 0x7fff;
  }
  return output;
}

function pcm16ToFloat(input: Int16Array) {
  const output = new Float32Array(input.length);
  for (let i = 0; i < input.length; i += 1) output[i] = input[i] / 0x8000;
  return output;
}

function wsUrl(base: string, language: string, dotId?: string) {
  const trimmed = base.trim().replace(/\/$/, '');
  const url = new URL(trimmed);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = `${url.pathname.replace(/\/$/, '')}/ws`;
  // The pipeline executes tools against the Aegis Computer of this Agent, so
  // it needs the Agent id with the session, not just the audio stream.
  const params = new URLSearchParams({ language });
  if (dotId) params.set('dot', dotId);
  url.search = `?${params.toString()}`;
  return url.toString();
}

export interface LocalVoiceOptions {
  /** Agent whose Aegis Computer the voice tools drive. */
  dotId?: string;
  /** Called once per completed turn so the caller can persist the transcript. */
  onTurn?: (role: 'user' | 'agent', text: string) => void;
}

export function useLocalVoice(
  baseUrl: string,
  language: string,
  options: LocalVoiceOptions = {},
) {
  const [phase, setPhase] = useState<VoicePhase>('idle');
  const [lines, setLines] = useState<VoiceLine[]>([]);
  const [actions, setActions] = useState<VoiceAction[]>([]);
  const [error, setError] = useState('');
  const [level, setLevel] = useState(0);
  const [muted, setMutedState] = useState(false);
  const mutedRef = useRef(false);
  const [supported, setSupported] = useState(true);
  // Set when the owner stops voice, so remounting the bar (switching views,
  // opening a chat) cannot silently start listening again.
  const [stoppedByOwner, setStoppedByOwner] = useState(false);

  const ws = useRef<WebSocket | null>(null);
  const inputContext = useRef<AudioContext | null>(null);
  const playbackContext = useRef<AudioContext | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const processor = useRef<ScriptProcessorNode | null>(null);
  const source = useRef<MediaStreamAudioSourceNode | null>(null);
  const recognizer = useRef<SpeechRecognitionLike | null>(null);
  const captureRequest = useRef(false);
  const captureGeneration = useRef(0);
  const playAt = useRef(0);
  const pending = useRef(0);
  const assistantDraft = useRef('');
  // Speech arrives as several transcription segments. They are accumulated into
  // one utterance here so the owner's turn is committed (and persisted) once,
  // not once per partial chunk.
  const utteranceDraft = useRef('');
  const lastLine = useRef<{ role: 'user' | 'agent'; text: string; at: number } | null>(null);
  const session = useRef(0);
  // Persisting a turn must not re-create the socket, so the callback is held
  // in a ref and read at the moment the turn actually completes.
  const onTurn = useRef(options.onTurn);
  onTurn.current = options.onTurn;
  const dotId = options.dotId;

  const notifyMicrophonePolicy = useCallback((manualOff: boolean, captureActive: boolean) => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('aegis:microphone-policy', { detail: { manualOff, captureActive } }),
      );
    }
  }, []);

  const releaseInput = useCallback(() => {
    captureGeneration.current += 1;
    captureRequest.current = false;
    try {
      recognizer.current?.abort();
    } catch {
      // ignore
    }
    recognizer.current = null;
    processor.current?.disconnect();
    source.current?.disconnect();
    stream.current?.getTracks().forEach((track) => track.stop());
    void inputContext.current?.close().catch(() => {});
    processor.current = null;
    source.current = null;
    stream.current = null;
    inputContext.current = null;
    setLevel(0);
  }, []);

  const stopCapture = useCallback(() => {
    mutedRef.current = true;
    setMutedState(true);
    releaseInput();
    notifyMicrophonePolicy(true, false);
    setPhase((current) =>
      current === 'thinking' || current === 'speaking' ? current : 'idle',
    );
  }, [notifyMicrophonePolicy, releaseInput]);

  const setMuted = useCallback((value: boolean) => {
    if (value) {
      stopCapture();
      return;
    }
    mutedRef.current = false;
    setMutedState(false);
    notifyMicrophonePolicy(false, true);
  }, [notifyMicrophonePolicy, stopCapture]);

  const addLine = useCallback((role: 'user' | 'agent', text: string) => {
    const value = text.trim();
    if (!value) return false;
    const now = Date.now();
    if (
      lastLine.current?.role === role &&
      lastLine.current.text === value &&
      now - lastLine.current.at < 2500
    ) return false;
    lastLine.current = { role, text: value, at: now };
    setLines((previous) => {
      return [
        ...previous.slice(-40),
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          role,
          text: value,
          at: now,
        },
      ];
    });
    return true;
  }, []);

  const stop = useCallback(() => {
    session.current += 1;
    try {
      ws.current?.close();
    } catch {
      // ignore
    }
    ws.current = null;
    releaseInput();
    notifyMicrophonePolicy(true, false);
    void playbackContext.current?.close().catch(() => {});
    playbackContext.current = null;
    playAt.current = 0;
    pending.current = 0;
    assistantDraft.current = '';
    utteranceDraft.current = '';
    setPhase('idle');
    setStoppedByOwner(true);
    mutedRef.current = true;
    setMutedState(true);
    setLevel(0);
    // Closing or restarting a session should not leave the previous failure
    // on screen when voice is opened again.
    setError('');
  }, [notifyMicrophonePolicy, releaseInput]);

  const captureFromSocket = useCallback(async (socket: WebSocket, run: number) => {
    if (captureRequest.current || mutedRef.current) return;
    captureRequest.current = true;
    const generation = captureGeneration.current;
    notifyMicrophonePolicy(false, true);
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (
        session.current !== run ||
        captureGeneration.current !== generation ||
        mutedRef.current ||
        socket.readyState !== WebSocket.OPEN
      ) {
        media.getTracks().forEach((track) => track.stop());
        captureRequest.current = false;
        return;
      }
      stream.current = media;
      const input = new AudioContext();
      inputContext.current = input;
      const mediaSource = input.createMediaStreamSource(media);
      source.current = mediaSource;
      const node = input.createScriptProcessor(4096, 1, 1);
      processor.current = node;
      mediaSource.connect(node);
      const silent = input.createGain();
      silent.gain.value = 0;
      node.connect(silent);
      silent.connect(input.destination);
      node.onaudioprocess = (event) => {
        if (socket.readyState !== WebSocket.OPEN || mutedRef.current) return;
        const samples = event.inputBuffer.getChannelData(0);
        let sum = 0;
        for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
        setLevel(Math.min(1, Math.sqrt(sum / samples.length) * 6));
        socket.send(floatToPcm16(downsample(samples, input.sampleRate, TARGET_RATE)).buffer);
      };
      setMutedState(false);
      setPhase((current) => current === 'idle' || current === 'connecting' ? 'listening' : current);
    } catch (failure) {
      captureRequest.current = false;
      mutedRef.current = true;
      setMutedState(true);
      notifyMicrophonePolicy(true, false);
      setPhase('error');
      setError(failure instanceof Error ? failure.message : 'Could not start the microphone.');
    }
  }, [notifyMicrophonePolicy]);

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

  const start = useCallback(async () => {
    // Opening voice again is an explicit act; clearing here lets the bar
    // auto-start on first open without resuming a session the owner stopped.
    setStoppedByOwner(false);
    if (ws.current?.readyState === WebSocket.OPEN) {
      mutedRef.current = false;
      setMutedState(false);
      void captureFromSocket(ws.current, session.current);
      return;
    }
    if (ws.current?.readyState === WebSocket.CONNECTING) return;
    if (ws.current) {
      try { ws.current.close(); } catch { /* ignore */ }
      ws.current = null;
    }
    const run = session.current + 1;
    session.current = run;
    mutedRef.current = false;
    setMutedState(false);
    notifyMicrophonePolicy(false, true);
    setError('');
    setPhase('connecting');
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      setSupported(false);
      notifyMicrophonePolicy(true, false);
      setPhase('error');
      setError('Microphone capture is not available in this window.');
      return;
    }
    try {
      const socket = new WebSocket(wsUrl(baseUrl, language, dotId));
      socket.binaryType = 'arraybuffer';
      ws.current = socket;

      const playback = new AudioContext({ sampleRate: TARGET_RATE });
      playbackContext.current = playback;
      await playback.resume().catch(() => {});

      socket.onopen = () => {
        if (session.current !== run) return;
        void captureFromSocket(socket, run);
      };

      socket.onmessage = (event) => {
        if (session.current !== run) return;
        if (typeof event.data !== 'string') {
          const chunk = new Int16Array(event.data as ArrayBuffer);
          playChunk(chunk);
          return;
        }
        try {
          const message = JSON.parse(event.data) as {
            type?: string;
            state?: VoicePhase;
            text?: string;
            error?: string;
            tool?: string;
            action?: string;
            parameters?: Record<string, unknown>;
            rationale?: string;
            result?: unknown;
          };
          if (message.type === 'status' && message.state) {
            if (message.state === 'listening' && mutedRef.current) {
              setPhase((current) => current === 'thinking' || current === 'speaking' ? current : 'idle');
            } else {
              setPhase(message.state);
            }
            if (message.state === 'thinking') {
              // The owner finished speaking: commit the accumulated utterance
              // exactly once, so chat gets one message instead of fragments.
              if (utteranceDraft.current) {
                const finished = utteranceDraft.current;
                utteranceDraft.current = '';
                onTurn.current?.('user', finished);
              }
              assistantDraft.current = '';
              setActions([]);
            }
            if (message.state === 'speaking') playAt.current = 0;
          } else if (message.type === 'transcription' && message.text) {
            if (!mutedRef.current) {
              const segment = message.text.trim();
              const previousDraft = utteranceDraft.current;
              if (!previousDraft || previousDraft.startsWith(segment) || previousDraft === segment) {
                utteranceDraft.current = previousDraft || segment;
              } else if (segment.startsWith(previousDraft)) {
                utteranceDraft.current = segment;
              } else {
                utteranceDraft.current = `${previousDraft} ${segment}`.trim();
              }
              const growing = utteranceDraft.current;
              setLines((previous) => {
                const last = previous[previous.length - 1];
                // A still-growing utterance replaces its own row instead of
                // stacking one line per partial result.
                if (last && last.role === 'user' && growing.startsWith(last.text)) {
                  return [
                    ...previous.slice(0, -1),
                    { ...last, text: growing, at: Date.now() },
                  ];
                }
                return [
                  ...previous.slice(-40),
                  {
                    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                    role: 'user' as const,
                    text: growing,
                    at: Date.now(),
                  },
                ];
              });
            }
          } else if (message.type === 'text' && message.text) {
            assistantDraft.current += message.text;
          } else if (message.type === 'response-end') {
            if (addLine('agent', assistantDraft.current)) onTurn.current?.('agent', assistantDraft.current);
            assistantDraft.current = '';
          } else if (message.type === 'tool-result') {
            if (typeof window !== 'undefined') {
              window.dispatchEvent(
                new CustomEvent('aegis:tool-result', {
                  detail: { tool: message.tool, result: message.result, at: Date.now() },
                }),
              );
            }
          } else if (message.type === 'action') {
            const tool = String(message.tool || message.action || 'unknown');
            const parameters = (message.parameters as Record<string, unknown>) || {};
            if (typeof window !== 'undefined') {
              if (tool === 'ui_navigate' && typeof parameters.view === 'string') {
                window.dispatchEvent(new CustomEvent('aegis:nav', { detail: parameters.view }));
              }
              if (tool === 'computer_control') {
                window.dispatchEvent(
                  new CustomEvent('aegis:computer-action', {
                    detail: { action: parameters.action, parameters },
                  }),
                );
              }
              if (tool === 'annotate_screen') {
                (
                  window as unknown as {
                    aegis?: {
                      annotateScreen?: (payload: unknown) => void;
                      clearAnnotations?: () => void;
                    };
                  }
                ).aegis?.annotateScreen?.({
                  ...parameters,
                  explanation: parameters.explanation ?? parameters.rationale ?? '',
                });
              }
              if (tool === 'clear_annotations') {
                (
                  window as unknown as {
                    aegis?: { clearAnnotations?: () => void };
                  }
                ).aegis?.clearAnnotations?.();
              }
              window.dispatchEvent(
                new CustomEvent('aegis:action', {
                  detail: {
                    tool,
                    parameters,
                    rationale: message.rationale,
                    at: Date.now(),
                  },
                }),
              );
            }
            setActions((previous) => {
              const rationale = (message.rationale || '').trim();
              const last = previous[previous.length - 1];
              // Repeats of the same step collapse instead of stacking up.
              if (last && last.tool === tool && last.rationale === rationale) {
                return previous;
              }
              return [
                ...previous,
                {
                  id: `${tool}-${Date.now()}-${previous.length}`,
                  tool,
                  rationale,
                  at: Date.now(),
                },
              ];
            });
          } else if (message.type === 'error') {
            setError(message.error ?? 'Voice pipeline error.');
          }
        } catch {
          // Ignore unknown control frames.
        }
      };

      socket.onerror = () => {
        if (session.current !== run) return;
        releaseInput();
        const SpeechRec =
          typeof window !== 'undefined'
            ? (window as unknown as { webkitSpeechRecognition?: unknown; SpeechRecognition?: unknown })
                .webkitSpeechRecognition ||
              (window as unknown as { webkitSpeechRecognition?: unknown; SpeechRecognition?: unknown })
                .SpeechRecognition
            : null;
        if (SpeechRec && typeof SpeechRec === 'function') {
          try {
            const fallback = new (SpeechRec as new () => SpeechRecognitionLike)();
            recognizer.current = fallback;
            fallback.continuous = true;
            fallback.interimResults = true;
            fallback.lang = language === 'auto' ? 'en-US' : language;
            fallback.onstart = () => {
              if (session.current !== run || mutedRef.current) {
                try { fallback.abort(); } catch { /* ignore */ }
                return;
              }
              notifyMicrophonePolicy(false, true);
              setPhase('listening');
              setError('');
            };
            fallback.onresult = (e) => {
              if (session.current !== run || mutedRef.current) return;
              let transcript = '';
              for (let i = e.resultIndex; i < e.results.length; i++) {
                transcript += e.results[i][0].transcript;
              }
              // Accumulate transcript instead of sending immediately;
              // commit only when recognition ends (onend) so we don't
              // send partial sentences.
              if (transcript.trim()) {
                utteranceDraft.current = (utteranceDraft.current || '') + ' ' + transcript.trim();
                utteranceDraft.current = utteranceDraft.current.trim();
                const growing = utteranceDraft.current;
                setLines((previous) => {
                  const last = previous[previous.length - 1];
                  if (last && last.role === 'user' && growing.startsWith(last.text)) {
                    return [
                      ...previous.slice(0, -1),
                      { ...last, text: growing, at: Date.now() },
                    ];
                  }
                  return [
                    ...previous.slice(-40),
                    {
                      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                      role: 'user' as const,
                      text: growing,
                      at: Date.now(),
                    },
                  ];
                });
              }
            };
            fallback.onend = () => {
              // Commit the accumulated utterance exactly once when the user
              // stops speaking, preventing premature message sending.
              if (utteranceDraft.current) {
                const finished = utteranceDraft.current;
                utteranceDraft.current = '';
                onTurn.current?.('user', finished);
              }
              recognizer.current = null;
              notifyMicrophonePolicy(true, false);
              setPhase('idle');
            };
            fallback.onerror = () => {
              if (session.current !== run || mutedRef.current) return;
              recognizer.current = null;
              notifyMicrophonePolicy(true, false);
              setPhase('error');
              setError('Voice recognition needs access or local daemon.');
            };
            fallback.start();
            return;
          } catch {
            // Fallthrough to standard error
          }
        }
        setPhase('error');
        setError(
          `Local voice pipeline offline at ${baseUrl}. Start it with .\\run_voice.ps1 or configure keys in Settings.`,
        );
      };

      socket.onclose = () => {
        if (session.current !== run) return;
        releaseInput();
        mutedRef.current = true;
        setMutedState(true);
        notifyMicrophonePolicy(true, false);
        setPhase('idle');
        setLevel(0);
      };
    } catch (failure) {
      stop();
      setPhase('error');
      setError(
        failure instanceof Error
          ? failure.message
          : 'Could not start the microphone.',
      );
    }
  }, [addLine, baseUrl, captureFromSocket, language, notifyMicrophonePolicy, playChunk, releaseInput, stop]);

  // Ensure WebSocket and AudioContext are always cleaned up on unmount,
  // preventing memory leaks from orphaned audio contexts and socket connections.
  useEffect(() => {
    return () => {
      try {
        ws.current?.close();
      } catch {
        /* ignore */
      }
      ws.current = null;
      try {
        playbackContext.current?.close();
      } catch {
        /* ignore */
      }
      playbackContext.current = null;
      try {
        source.current?.disconnect();
      } catch {
        /* ignore */
      }
      source.current = null;
      try {
        processor.current?.disconnect();
      } catch {
        /* ignore */
      }
      processor.current = null;
      try {
        stream.current?.getTracks().forEach((track) => track.stop());
      } catch {
        /* ignore */
      }
      stream.current = null;
      stop();
    };
  }, [stop]);

  return {
    phase,
    lines,
    error,
    level,
    supported,
    muted,
    setMuted,
    stopCapture,
    start,
    stop,
    actions,
    stoppedByOwner,
  };
}
