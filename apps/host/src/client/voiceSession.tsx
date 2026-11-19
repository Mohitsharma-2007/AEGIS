import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useLocalVoice } from './useLocalVoice';

// One voice session for the whole app. The microphone, the WebSocket and the
// tool bridge belong to the shell, not to one screen: moving to Computer,
// Files, Settings or Integrations must not disconnect voice or drop a reply.
export type VoiceSession = ReturnType<typeof useLocalVoice>;

const VoiceSessionContext = createContext<VoiceSession | null>(null);

export function VoiceSessionProvider({
  dotId,
  baseUrl,
  language,
  onTurn,
  children,
}: {
  dotId?: string;
  baseUrl: string;
  language: string;
  onTurn?: (role: 'user' | 'agent', text: string) => void;
  children: ReactNode;
}) {
  const voice = useLocalVoice(baseUrl, language, { dotId, onTurn });
  // Keep desktop surfaces in sync with the actual shared session instead of
  // guessing from the button that was clicked.
  useEffect(() => {
    const aegis = (window as Window & { aegis?: { status?: (value: unknown) => void; trayUpdate?: (value: unknown) => void } }).aegis;
    const state = voice.phase === 'listening' ? 'listening'
      : voice.phase === 'thinking' || voice.phase === 'connecting' || voice.phase === 'warming' ? 'thinking'
        : voice.phase === 'speaking' ? 'speaking'
          : voice.phase === 'error' ? 'error' : 'idle';
    const text = state === 'listening' ? 'Listening…'
      : state === 'thinking' ? 'Working on your request…'
        : state === 'speaking' ? 'Aegis is speaking'
          : state === 'error' ? voice.error || 'Voice unavailable' : '';
    aegis?.status?.({ state, status: text, text, voice: { phase: voice.phase, muted: voice.muted } });
    aegis?.trayUpdate?.({ state, tooltip: `Aegis — ${text || 'Ready'}` });
  }, [voice.phase, voice.muted, voice.error]);
  return (
    <VoiceSessionContext.Provider value={voice}>
      {children}
    </VoiceSessionContext.Provider>
  );
}

/** Handles Talk/Stop requests from the tray and Notch against the one shell session. */
export function DesktopVoiceCommand({ onOpen }: { onOpen: () => void }) {
  const voice = useVoiceSession();
  useEffect(() => {
    const onToggle = () => {
      if (!voice) return;
      const active = ['connecting', 'warming', 'listening', 'thinking', 'speaking'].includes(voice.phase);
      if (active) voice.stop();
      else onOpen();
    };
    window.addEventListener('aegis:desktop-voice', onToggle);
    return () => window.removeEventListener('aegis:desktop-voice', onToggle);
  }, [voice, onOpen]);
  return null;
}

/** The shell's session when one is mounted (App). */
export function useVoiceSession() {
  return useContext(VoiceSessionContext);
}
