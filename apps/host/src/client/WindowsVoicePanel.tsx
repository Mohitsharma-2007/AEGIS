import { useState } from 'react';
import { Activity, Keyboard, RefreshCw, ShieldAlert, Terminal } from 'lucide-react';
import { useWindowsVoice } from './useWindowsVoice';

/**
 * Windows Voice Bridge panel.
 *
 * Windows Voice Access has no third-party API, so Aegis talks to the speech
 * engine underneath it through the local bridge.  This panel shows whether
 * that engine is ready, lets the owner start a command-only session, and
 * lists the commands Aegis understands.
 */
export function WindowsVoicePanel() {
  const voice = useWindowsVoice();
  const [command, setCommand] = useState('');
  const [showCommands, setShowCommands] = useState(false);
  const health = voice.health;
  const listening = voice.phase === 'listening' || voice.phase === 'speaking';

  return (
    <div className="assistant-card windows-voice-panel">
      <div className="voice-health">
        <span
          className={`online-dot ${health?.available ? '' : 'off'}`}
          aria-hidden="true"
        />
        <span>
          {health?.available
            ? `Windows speech engine   ${health.commandCount ?? 0} commands   ${health.llmModel ?? 'Aegis LLM'}`
            : health?.error ?? 'Windows Voice Bridge not checked yet.'}
        </span>
        <button
          type="button"
          className="text-button"
          onClick={() => void voice.check()}
        >
          <RefreshCw size={13} /> Check
        </button>
      </div>

      {health?.privacyBlocked && (
        <div className="windows-voice-warning" role="status">
          <ShieldAlert size={14} />
          <span>
            {health.privacyHelp ??
              'Windows blocks speech recognition until the speech privacy setting is on.'}
          </span>
          <button
            type="button"
            className="text-button"
            onClick={() => {
              void fetch('/api/voice/windows/privacy-settings', {
                method: 'POST',
              });
            }}
          >
            Open Windows settings
          </button>
        </div>
      )}

      <div className="voice-health">
        <button
          type="button"
          className="text-button"
          onClick={() => (listening ? voice.stop() : void voice.start())}
        >
          <Activity size={13} />
          {listening ? 'Stop listening' : 'Start listening'}
        </button>
        <span>
          {voice.phase === 'error'
            ? voice.error
            : voice.phase === 'idle'
              ? 'Command-only access through the Windows speech engine.'
              : `Phase: ${voice.phase}`}
        </span>
      </div>

      {voice.lines.length > 0 && (
        <ul className="windows-voice-log">
          {voice.lines.slice(-6).map((line) => (
            <li key={line.id} data-role={line.role}>
              {line.role === 'user' ? 'You: ' : 'Aegis: '}
              {line.text}
            </li>
          ))}
        </ul>
      )}

      {voice.actions.length > 0 && (
        <ul className="windows-voice-log">
          {voice.actions.slice(-4).map((action) => (
            <li key={`${action.at}-${action.action}`} data-role="action">
              <Terminal size={12} /> {action.action}
              {action.command ? `   ${action.command}` : ''}
            </li>
          ))}
        </ul>
      )}

      <div className="voice-health">
        <input
          aria-label="Run a Windows voice command"
          value={command}
          placeholder="open settings"
          onChange={(event) => setCommand(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            void voice.runCommand(command);
            setCommand('');
          }}
        />
        <button
          type="button"
          className="text-button"
          onClick={() => {
            void voice.runCommand(command);
            setCommand('');
          }}
        >
          <Keyboard size={13} /> Run
        </button>
        <button
          type="button"
          className="text-button"
          onClick={() => setShowCommands((value) => !value)}
        >
          {showCommands ? 'Hide commands' : 'Commands'}
        </button>
      </div>

      {showCommands && (
        <ul className="windows-voice-commands">
          {voice.commands.map((item) => (
            <li key={item.phrase}>
              <strong>{item.phrase}</strong>
              <span>{item.intent}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
