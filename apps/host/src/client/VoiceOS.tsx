import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, MicOff, PhoneOff, RotateCcw, X, Sparkles, Bot, Play } from 'lucide-react';
import { AegisMascot, AegisSounds } from 'aegis-mascot';
import type {
  CharacterName,
  MascotState,
  SoundPack,
} from 'aegis-mascot';
import type { Settings } from '../shared/types';
import { api } from './api';
import { useLocalVoice, type VoicePhase } from './useLocalVoice';

// The voice operating system: one large, calm centre surface that opens when
// the owner clicks the mascot, presses the notch mic, or says "Hey Aegis".
// It drives the real local Pipecat pipeline (faster-whisper STT, OpenAI-
// compatible LLM, Piper TTS) and mirrors the pipeline phase into the mascot.
//
// Nothing here fakes a conversation: the transcript below the mascot is the
// pipeline's own transcription / reply stream, and the status line reports
// whether the local service actually answered.

const PHASE_STATE: Record<VoicePhase, MascotState> = {
  idle: 'idle',
  connecting: 'working',
  warming: 'working',
  listening: 'listening',
  thinking: 'thinking',
  speaking: 'speaking',
  error: 'error',
};

const PHASE_LABEL: Record<VoicePhase, string> = {
  idle: 'Tap the mic to talk',
  connecting: 'Opening the local pipeline',
  warming: 'Warming local models',
  listening: 'Listening',
  thinking: 'Thinking',
  speaking: 'Speaking',
  error: 'Voice pipeline needs attention',
};

const CHARACTERS: { id: Settings['mascotCharacter']; label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'aegi', label: 'Aegi' },
  { id: 'harness', label: 'Rig' },
  { id: 'files', label: 'Filo' },
  { id: 'memory', label: 'Memo' },
  { id: 'social', label: 'Chatty' },
  { id: 'mail', label: 'Posty' },
  { id: 'security', label: 'Guard' },
];

const LANGUAGES: { id: Settings['voiceLanguage']; label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'en', label: 'English' },
  { id: 'hi', label: ' ' },
  { id: 'hinglish', label: 'Hinglish' },
];

function packFor(pack: Settings['soundPack']): SoundPack {
  return pack === 'glassy' ? 'crystal' : 'warm';
}

export function VoiceOS({
  open,
  settings,
  onClose,
  autoStart = false,
  threadId,
  dotId = 'aegis',
}: {
  open: boolean;
  settings: Settings;
  onClose: () => void;
  autoStart?: boolean;
  threadId?: string;
  dotId?: string;
}) {
  const voice = useLocalVoice(settings.voicePipelineUrl, settings.voiceLanguage);
  const mascotHost = useRef<HTMLDivElement>(null);
  const mascot = useRef<AegisMascot | null>(null);
  const sounds = useRef<AegisSounds | null>(null);
  const transcriptEnd = useRef<HTMLDivElement>(null);
  const [pipeline, setPipeline] = useState<
    { ok: boolean; url: string; whisperModel?: string; voice?: string; error?: string }
  >();
  const [language, setLanguage] = useState<Settings['voiceLanguage']>(
    settings.voiceLanguage,
  );
  const [character, setCharacter] = useState<Settings['mascotCharacter']>(
    settings.mascotCharacter,
  );
  const started = useRef(false);
  const [voiceAction, setVoiceAction] = useState<{
    type: 'agent' | 'task' | 'nav' | 'error';
    title: string;
    detail: string;
  } | null>(null);
  const lastProcessedLineId = useRef<string | null>(null);
const savedLineIds = useRef<Set<string>>(new Set());

// Persist voice transcript lines to the conversation store.
useEffect(() => {
  if (!threadId || !voice.lines.length) return;
  const unsaved = voice.lines.filter((line) => !savedLineIds.current.has(line.id));
  if (!unsaved.length) return;
  let cancelled = false;
  (async () => {
    for (const line of unsaved) {
      if (cancelled) return;
      try {
        await fetch(`/api/conversations/${encodeURIComponent(threadId)}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: line.role === 'agent' ? 'assistant' : 'user', content: line.text }),
        });
        savedLineIds.current.add(line.id);
      } catch {
        // best effort; retry on next change
      }
    }
  })();
  return () => { cancelled = true; };
}, [voice.lines, threadId]);

  // Real-time voice command parser & executor
  useEffect(() => {
    if (!voice.lines.length) return;
    const latest = voice.lines[voice.lines.length - 1];
    if (latest.role !== 'user' || latest.id === lastProcessedLineId.current) return;
    lastProcessedLineId.current = latest.id;

    const text = latest.text.trim();
    // 1. Agent creation command: "create agent <name> for <task>"
    const agentMatch = text.match(/(?:create|make|spawn|new)\s+agent\s+([a-zA-Z0-9_-]+)(?:\s+(?:for|to|with task)\s+(.*))?/i);
    if (agentMatch) {
      const name = agentMatch[1];
      const task = agentMatch[2] || 'Autonomous agent spawned via voice command';
      api('/dots', 'POST', { name, prompt: task })
        .then(() => {
          setVoiceAction({
            type: 'agent',
            title: `Created Agent "${name}"`,
            detail: task,
          });
          sounds.current?.play('wake');
        })
        .catch((err) => {
          setVoiceAction({
            type: 'error',
            title: `Failed to create agent "${name}"`,
            detail: err instanceof Error ? err.message : String(err),
          });
        });
      return;
    }

    // 2. Task execution command: "run task <task>" or "execute <task>"
    const taskMatch = text.match(/(?:run|execute|schedule|start)\s+(?:task\s+)?(.*)/i);
    if (taskMatch) {
      const prompt = taskMatch[1].trim();
      if (prompt.length > 2 && !prompt.toLowerCase().startsWith('agent')) {
        api('/tasks', 'POST', { prompt })
          .then(() => {
            setVoiceAction({
              type: 'task',
              title: 'Dispatched Task',
              detail: prompt,
            });
            sounds.current?.play('wake');
          })
          .catch((err) => {
            setVoiceAction({
              type: 'error',
              title: 'Failed to dispatch task',
              detail: err instanceof Error ? err.message : String(err),
            });
          });
        return;
      }
    }

    // 3. Navigation command: "open computer" / "open files" / "show memory"
    const navMatch = text.match(/(?:open|show|switch to|go to)\s+(computer|browser|files|memory|memories|settings|terminal|tasks)/i);
    if (navMatch) {
      const target = navMatch[1].toLowerCase();
      const navTarget =
        target === 'memory' || target === 'memories' ? 'memories'
        : target;
      window.dispatchEvent(new CustomEvent('aegis:nav', { detail: navTarget }));
      setVoiceAction({
        type: 'nav',
        title: `Switched View`,
        detail: `Navigated to ${target}`,
      });
      sounds.current?.play('wake');
      return;
    }

    // 4. Launch a desktop app or website: "open calculator", "launch notepad".
    //    Kept short and single-purpose so it never swallows a sentence.
    const appMatch = text.match(
      /^(?:open|launch|start|run)\s+(?:the\s+)?([a-z0-9][a-z0-9 .+_-]{1,24})$/i,
    );
    if (appMatch) {
      const app = appMatch[1].trim();
      api(`/dots/${encodeURIComponent(dotId)}/computer/actions`, 'POST', {
        action: 'open_app',
        input: { app },
      })
        .then(() => {
          setVoiceAction({ type: 'agent', title: 'Opening app', detail: app });
          sounds.current?.play('wake');
        })
        .catch((err) => {
          setVoiceAction({
            type: 'error',
            title: `Could not open ${app}`,
            detail: err instanceof Error ? err.message : String(err),
          });
        });
    }
  }, [voice.lines, dotId]);

  // Voice computer control: the realtime voice model (and the local pipeline)
  // emit aegis:computer-action when they want to drive the desktop. Execute it
  // against this dot's computer, so "open calculator" really opens it.
  useEffect(() => {
    if (!open) return;
    const onComputerAction = (event: Event) => {
      const detail = (event as CustomEvent<{
        action?: string;
        parameters?: Record<string, unknown>;
      }>).detail;
      const action = detail?.action;
      if (!action) return;
      const params = detail?.parameters ?? {};
      const input =
        action === 'open_app'
          ? {
              app: String(
                (params.app ?? params.name ?? params.target ?? '') as string,
              ),
            }
          : params;
      void api(`/dots/${encodeURIComponent(dotId)}/computer/actions`, 'POST', {
        action,
        input,
      }).catch(() => undefined);
    };
    window.addEventListener('aegis:computer-action', onComputerAction);
    return () =>
      window.removeEventListener('aegis:computer-action', onComputerAction);
  }, [open, dotId]);

  const resolvedCharacter: CharacterName =
    character === 'auto' ? 'aegi' : character;

  // Sounds follow the owner's pack/volume; the kit exposes warm + crystal.
  useEffect(() => {
    sounds.current?.setPack(packFor(settings.soundPack));
    sounds.current?.setVolume(settings.soundVolume);
  }, [settings.soundPack, settings.soundVolume]);

  useEffect(() => {
    if (!open || !mascotHost.current) return;
    sounds.current = new AegisSounds({
      pack: packFor(settings.soundPack),
      volume: settings.soundVolume,
    });
    mascot.current = new AegisMascot(mascotHost.current, {
      character: resolvedCharacter,
      size: 280,
      theme: 'color',
      state: 'idle',
      shadow: true,
      emblem: true,
    });
    return () => {
      mascot.current?.destroy();
      mascot.current = null;
    };
    // Mounted per open session, after the host element exists.
  }, [open]);

  useEffect(() => {
    mascot.current?.setCharacter(resolvedCharacter);
  }, [resolvedCharacter]);

  useEffect(() => {
    mascot.current?.setState(PHASE_STATE[voice.phase]);
  }, [voice.phase]);

  useEffect(() => {
    transcriptEnd.current?.scrollIntoView({ block: 'end' });
  }, [voice.lines.length]);

  const checkPipeline = useCallback(async () => {
    try {
      const info = await api<{
        ok: boolean;
        url: string;
        whisperModel?: string;
        voice?: string;
        error?: string;
      }>('/voice/pipeline');
      setPipeline(info);
    } catch (error) {
      setPipeline({
        ok: false,
        url: settings.voicePipelineUrl,
        error: error instanceof Error ? error.message : 'Unreachable.',
      });
    }
  }, [settings.voicePipelineUrl]);

  useEffect(() => {
    if (!open) {
      started.current = false;
      voice.stop();
      sounds.current?.play('listen-stop');
      return;
    }
    sounds.current?.play('wake');
    void checkPipeline();
    if (autoStart && !started.current) {
      started.current = true;
      // A click opened us, so the browser should accept the mic request.
      void voice.start();
    }
    // voice.start is stable; re-running on open only.
  }, [open, autoStart]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const speaking =
    voice.phase === 'listening' ||
    voice.phase === 'connecting' ||
    voice.phase === 'warming';

  const characterLabel =
    CHARACTERS.find((option) => option.id === character)?.label ?? 'Aegis';

  return (
    <div
      className="voice-os-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Aegis voice"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="voice-os">
        {/* The stage IS the voice OS: one large mascot with the state text
            overlaid on it. No separate app chrome. */}
        <div className="voice-os-stage">
          <div className="voice-os-aura" data-phase={voice.phase} aria-hidden="true" />
          <div ref={mascotHost} className="voice-os-mascot" />
          <div className="voice-os-overlay">
            <strong className="voice-os-agent-name">{characterLabel}</strong>
            <span className="voice-os-phase">{PHASE_LABEL[voice.phase]}</span>
            <span className="voice-os-hint">
              {voice.phase === 'warming'
                ? 'The first run loads the local brain and voices   this can take a minute.'
                : voice.phase === 'listening'
                  ? 'Speak in English, Hindi or Hinglish.'
                  : voice.phase === 'thinking'
                    ? 'Aegis is composing a spoken reply.'
                    : voice.phase === 'speaking'
                      ? 'Aegis is talking. Speak to interrupt.'
                      : voice.phase === 'error'
                        ? voice.error || pipeline?.error || 'Start the local pipeline.'
                        : 'Your voice stays on this machine.'}
            </span>
          </div>
          <span className="voice-os-live" data-on={voice.phase !== 'error'} aria-hidden="true" />
          <button
            className="icon-button voice-os-close"
            aria-label="Close voice"
            onClick={onClose}
          >
            <X size={18} />
          </button>
          <div className="voice-os-level" aria-hidden="true">
            {Array.from({ length: 22 }).map((_, index) => (
              <i
                key={index}
                style={{
                  transform: `scaleY(${
                    voice.phase === 'listening'
                      ? 0.15 + voice.level * (0.35 + ((index * 7) % 10) / 10)
                      : voice.phase === 'speaking'
                        ? 0.2 + ((index * 13) % 10) / 12
                        : 0.08
                  })`,
                }}
              />
            ))}
          </div>
        </div>

        {voiceAction && (
          <div className={`voice-action-banner ${voiceAction.type}`}>
            <div className="voice-action-header">
              <Sparkles size={14} className="action-sparkle" />
              <strong>{voiceAction.title}</strong>
              <button
                className="action-banner-close"
                onClick={() => setVoiceAction(null)}
                aria-label="Dismiss voice action"
              >
                &times;
              </button>
            </div>
            <p>{voiceAction.detail}</p>
          </div>
        )}

        <div className="voice-os-transcript" aria-live="polite">
          {!voice.lines.length && (
            <p className="voice-os-empty">
              Ask anything    What s on my plate today? ,  Research this page ,
              or  Mujhe Hindi mein samjhao. 
            </p>
          )}
          {voice.lines.map((line) => (
            <div className="voice-os-line" data-role={line.role} key={line.id}>
              <span>{line.role === 'user' ? 'You' : 'Aegis'}</span>
              <p>{line.text}</p>
            </div>
          ))}
          {voice.phase === 'thinking' && (
            <div className="voice-os-line" data-role="agent" data-thinking="true">
              <span>Aegis</span>
              <p className="voice-os-dots">
                <i />
                <i />
                <i />
              </p>
            </div>
          )}
          <div ref={transcriptEnd} />
        </div>

        {voice.error && (
          <p className="voice-os-error" role="alert">
            {voice.error}
          </p>
        )}

        <div className="voice-quick-actions">
          <span className="quick-label">Voice shortcuts:</span>
          <button
            type="button"
            className="voice-quick-pill"
            onClick={() => {
              void api('/dots', 'POST', { name: 'Researcher', prompt: 'Deep web research and analysis' });
              setVoiceAction({ type: 'agent', title: 'Created Agent "Researcher"', detail: 'Deep web research and analysis' });
              sounds.current?.play('wake');
            }}
          >
            <Bot size={11} /> Create Agent
          </button>
          <button
            type="button"
            className="voice-quick-pill"
            onClick={() => {
              void api('/tasks', 'POST', { prompt: 'Audit repository workspace' });
              setVoiceAction({ type: 'task', title: 'Dispatched Task', detail: 'Audit repository workspace' });
              sounds.current?.play('wake');
            }}
          >
            <Play size={11} /> Run Task
          </button>
          <button
            type="button"
            className="voice-quick-pill"
            onClick={() => {
              window.dispatchEvent(new CustomEvent('aegis:nav', { detail: 'computer' }));
              setVoiceAction({ type: 'nav', title: 'Switched View', detail: 'Navigated to Computer' });
              sounds.current?.play('wake');
            }}
          >
            Open Computer
          </button>
        </div>

        {/* Keep live voice monitoring inside Aegis. */}

        <div className="voice-os-controls">
          <label className="voice-os-select">
            <span>Language</span>
            <select
              value={language}
              onChange={(event) => {
                const next = event.target.value as Settings['voiceLanguage'];
                setLanguage(next);
                voice.stop();
                window.setTimeout(() => void voice.start(), 120);
              }}
            >
              {LANGUAGES.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button
            className={`voice-os-mic ${speaking ? 'live' : ''}`}
            aria-label={speaking ? 'Stop the microphone' : 'Start talking'}
            onClick={() => {
              sounds.current?.play(speaking ? 'listen-stop' : 'listen-start');
              if (speaking) voice.stop();
              else void voice.start();
            }}
          >
            {speaking ? <MicOff size={28} /> : <Mic size={28} />}
          </button>
          <button
            type="button"
            className={`voice-os-mute-btn ${voice.muted ? 'active' : ''}`}
            aria-label={voice.muted ? 'Unmute microphone' : 'Mute microphone'}
            title={voice.muted ? 'Unmute microphone' : 'Mute microphone'}
            style={{
              padding: '6px 12px',
              borderRadius: '8px',
              border: '1px solid rgba(255,255,255,0.18)',
              background: voice.muted ? 'rgba(239, 68, 68, 0.25)' : 'rgba(255,255,255,0.06)',
              color: voice.muted ? '#f87171' : 'inherit',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: 500,
            }}
            onClick={() => {
              const nextMuted = !voice.muted;
              voice.setMuted(nextMuted);
              sounds.current?.play(nextMuted ? 'listen-stop' : 'listen-start');
            }}
          >
            {voice.muted ? <MicOff size={16} /> : <Mic size={16} />}
            <span>{voice.muted ? 'Muted' : 'Mute'}</span>
          </button>
          <label className="voice-os-select">
            <span>Mascot</span>
            <select
              value={character}
              onChange={(event) =>
                setCharacter(
                  event.target.value as Settings['mascotCharacter'],
                )
              }
            >
              {CHARACTERS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <footer className="voice-os-foot">
          <button
            className="text-button"
            onClick={() => {
              voice.stop();
              void voice.start();
            }}
          >
            <RotateCcw size={14} /> Restart session
          </button>
          <span className="muted">
            {pipeline?.ok
              ? `${pipeline.whisperModel ?? 'local STT'}   ${pipeline.voice ?? 'Piper'}`
              : 'Checking the local pipeline '}
          </span>
          <button
            className="text-button danger"
            onClick={() => {
              voice.stop();
              onClose();
            }}
          >
            <PhoneOff size={14} /> End voice
          </button>
        </footer>
      </section>
    </div>
  );
}
