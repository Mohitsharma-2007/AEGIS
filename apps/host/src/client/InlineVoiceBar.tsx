import { useEffect, useRef } from 'react';
import { Mic, MicOff, Keyboard, AlertCircle, Activity, Square } from 'lucide-react';
import { useLocalVoice, type VoiceAction, type VoicePhase } from './useLocalVoice';
import { useVoiceSession, type VoiceSession } from './voiceSession';
import { Mascot } from './Mascot';

function prettyTool(tool: string): string {
  return tool.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Collapse repeats of the same step so the list stays a summary, not a log. */
function groupSteps(actions: VoiceAction[]) {
  const steps: Array<{
    tool: string;
    rationale: string;
    count: number;
    at: number;
  }> = [];
  for (const action of actions) {
    const last = steps[steps.length - 1];
    if (last && last.rationale === action.rationale) {
      last.count += 1;
      continue;
    }
    steps.push({
      tool: action.tool,
      rationale: action.rationale,
      count: 1,
      at: action.at,
    });
  }
  return steps;
}

/** One short line for the mascot pill: what it is doing right now. */
function currentStepLabel(
  phase: VoicePhase,
  steps: Array<{ tool: string; rationale: string }>,
): string {
  if (phase === 'thinking') {
    const latest = steps[steps.length - 1];
    if (latest) return latest.rationale || prettyTool(latest.tool);
    return 'Thinking…';
  }
  if (phase === 'listening') return 'Listening';
  if (phase === 'speaking') return 'Speaking';
  return PHASE_LABELS[phase];
}

const PHASE_LABELS: Record<VoicePhase, string> = {
  idle: 'Tap the mic to talk',
  connecting: 'Connecting to local voice...',
  warming: 'Warming local models...',
  listening: 'Listening... speak to Aegis',
  thinking: 'Thinking...',
  speaking: 'Speaking... speak to interrupt',
  error: 'Voice pipeline needs attention',
};

interface VoiceBarProps {
  voice: VoiceSession;
  agentId?: string;
  agentName?: string;
  onClose: () => void;
  /** True when the bar must stop the session when it unmounts. */
  ownsSession?: boolean;
}

function VoiceBarUi({
  voice,
  agentId = 'aegis',
  agentName = 'Aegis',
  onClose,
  ownsSession = false,
}: VoiceBarProps) {
  const isLive =
    voice.phase === 'listening' ||
    voice.phase === 'speaking' ||
    voice.phase === 'thinking';
  const actions = (voice as { actions?: VoiceAction[] }).actions ?? [];
  const steps = groupSteps(actions);

  return (
    <div className="inline-voice-container" data-phase={voice.phase}>
      {/* Two columns: the conversation owns the width, the agent keeps a
          narrow rail for its presence and a quiet list of what it is doing. */}
      <div className="voice-stage">
        <section className="voice-transcript-panel voice-session-summary" aria-live="polite">
          <header className="voice-transcript-head">
            <span className="voice-transcript-title">
              Voice session
            </span>
            <span className="voice-transcript-state">
              <i className={`voice-live-dot ${isLive ? 'live' : ''}`} />
              {voice.muted ? 'Microphone off' : PHASE_LABELS[voice.phase]}
            </span>
          </header>
          <p className="voice-session-copy">
            {voice.muted
              ? 'Microphone capture is stopped. Any current task can continue.'
              : voice.phase === 'thinking' || voice.phase === 'speaking'
                ? 'Your spoken turns and Aegis replies appear in this chat.'
                : 'Speak naturally. Your turns appear in this chat.'}
          </p>

          <div className="voice-transcript-lines" aria-label="Voice transcript">
            {voice.lines.length ? voice.lines.slice(-40).map((line) => (
              <div className={`voice-line ${line.role}`} key={line.id}>
                <small>{line.role === 'user' ? 'You' : agentName || 'Aegis'}</small>
                <span>{line.text}</span>
              </div>
            )) : (
              <p className="voice-empty-hint">Your conversation will appear here as you speak.</p>
            )}
          </div>

          {voice.error && (
            <div className="inline-voice-error-text">
              <AlertCircle size={14} /> {voice.error}
            </div>
          )}
        </section>

        <aside className="voice-side" aria-label="Agent activity">
          <div className="inline-voice-mascot-stage">
            <Mascot
              identity={agentId}
              name={agentName}
              state={
                voice.phase === 'speaking'
                  ? 'speaking'
                  : voice.phase === 'listening'
                    ? 'listening'
                    : voice.phase === 'thinking'
                      ? 'thinking'
                      : 'idle'
              }
              size={150}
            />
            <div className="inline-voice-status-pill">
              <span className={`voice-live-dot ${isLive ? 'live' : ''}`} />
              <span>{currentStepLabel(voice.phase, steps)}</span>
            </div>
          </div>

          <div className="voice-activity">
            <header className="voice-activity-head">
              <Activity size={12} />
              <span>Activity</span>
              {actions.length > 0 && (
                <span className="voice-activity-badge">{actions.length}</span>
              )}
            </header>
            {steps.length > 0 ? (
              <ol className="voice-activity-list">
                {steps.slice(-6).map((step, index) => (
                  <li key={`${step.tool}-${step.at}-${index}`} className="voice-activity-item">
                    <span className="voice-activity-tool">{prettyTool(step.tool)}</span>
                    {step.rationale && (
                      <span className="voice-activity-text">{step.rationale}</span>
                    )}
                    {step.count > 1 && (
                      <span className="voice-activity-badge">×{step.count}</span>
                    )}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="voice-activity-empty">
                {voice.phase === 'thinking'
                  ? 'Working on your request…'
                  : 'Steps appear here as they happen.'}
              </p>
            )}
          </div>
        </aside>
      </div>

      {/* Expanded Voice Composer Bar */}
      <div className="inline-voice-box">
        <div className="inline-voice-waveform" aria-hidden="true">
          {Array.from({ length: 16 }).map((_, index) => (
            <i
              key={index}
              style={{
                transform: `scaleY(${
                  voice.phase === 'listening'
                    ? 0.15 + voice.level * (0.35 + ((index * 5) % 8) / 10)
                    : voice.phase === 'speaking'
                      ? 0.25 + ((index * 11) % 9) / 12
                      : 0.12
                })`,
              }}
            />
          ))}
        </div>

        <div className="inline-voice-center-text">
          {voice.error ? (
            <span className="inline-voice-error-text">
              <AlertCircle size={14} /> {voice.error}
            </span>
          ) : (
            <span className="inline-voice-placeholder">
              {voice.muted
                ? 'Mic off · task can continue'
                : voice.phase === 'listening'
                  ? 'Listening · turns appear above'
                  : voice.phase === 'thinking' || voice.phase === 'speaking'
                    ? 'Aegis is working · turns appear above'
                    : 'Start the microphone to talk'}
            </span>
          )}
        </div>

        <div className="inline-voice-actions">
          {(voice.phase === 'thinking' || voice.phase === 'speaking') && (
            <button
              type="button"
              className="inline-voice-stop-btn"
              aria-label="Stop current voice task"
              title="Stop the current voice response and its tool run"
              onClick={voice.stop}
            >
              <Square size={16} />
            </button>
          )}
          <button
            type="button"
            className={`inline-voice-mic-btn ${isLive && !voice.muted ? 'active' : ''}`}
            aria-label={voice.muted || !isLive ? 'Start microphone' : 'Stop microphone'}
            title={
              voice.muted || !isLive
                ? 'Start microphone'
                : 'Stop microphone capture; the current task keeps running'
            }
            onClick={() => {
              if (voice.muted || !isLive) void voice.start();
              else voice.setMuted(true);
            }}
          >
            {voice.muted || !isLive ? <MicOff size={22} /> : <Mic size={22} />}
          </button>

          <button
            type="button"
            className="inline-voice-close-btn"
            aria-label="Switch back to keyboard"
            title="Switch back to keyboard"
            onClick={() => {
              if (ownsSession) voice.stop();
              onClose();
            }}
          >
            <Keyboard size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}

/** A voice bar with its own session, used when the shell has none. */
function LocalVoiceBar({
  pipelineUrl,
  language = 'auto',
  agentId = 'aegis',
  agentName = 'Aegis',
  autoStart = true,
  onClose,
  dotId,
  onTurn,
}: {
  pipelineUrl?: string;
  language?: string;
  dotId?: string;
  onTurn?: (role: 'user' | 'agent', text: string) => void;
  agentId?: string;
  agentName?: string;
  autoStart?: boolean;
  onClose: () => void;
}) {
  const url = pipelineUrl || 'http://127.0.0.1:8766';
  const voice = useLocalVoice(url, language, { dotId: dotId ?? agentId, onTurn });
  const started = useRef(false);

  useEffect(() => {
    if (autoStart && !started.current && !voice.stoppedByOwner) {
      started.current = true;
      void voice.start();
    }
    return () => {
      voice.stop();
    };
  }, [autoStart]);

  return (
    <VoiceBarUi
      voice={voice}
      agentId={agentId}
      agentName={agentName}
      onClose={onClose}
      ownsSession
    />
  );
}

export function InlineVoiceBar(props: {
  pipelineUrl?: string;
  language?: string;
  dotId?: string;
  onTurn?: (role: 'user' | 'agent', text: string) => void;
  agentId?: string;
  agentName?: string;
  autoStart?: boolean;
  onClose: () => void;
  /** Send a spoken line as a real chat message instead of just transcribing. */
  onSubmitText?: (text: string) => void;
}) {
  const session = useVoiceSession();
  // The shell's session survives navigation, so the bar does not tear it down
  // when this conversation view unmounts.
  if (session) {
    return <ShellVoiceBar session={session} {...props} />;
  }
  return <LocalVoiceBar {...props} />;
}

function ShellVoiceBar({
  session,
  autoStart = true,
  agentId,
  agentName,
  onClose,
}: {
  session: VoiceSession;
  autoStart?: boolean;
  agentId?: string;
  agentName?: string;
  onClose: () => void;
}) {
  // Opening the bar in a different conversation resumes the same shell
  // session instead of starting a second microphone   but never resumes a
  // session the owner explicitly stopped.
  useEffect(() => {
    if (autoStart && session.phase === 'idle' && !session.stoppedByOwner) {
      void session.start();
    }
  }, [autoStart, session.phase, session.stoppedByOwner]);
  return (
    <VoiceBarUi
      voice={session}
      agentId={agentId}
      agentName={agentName}
      onClose={onClose}
      ownsSession
    />
  );
}
