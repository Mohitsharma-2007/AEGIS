import { useEffect, useRef, useState } from 'react';

// "Hey Aegis" background wake word.
//
// The desktop app already ships a fully local voice pipeline (Pipecat +
// faster-whisper + Piper). A dedicated always-on wake-word model would need
// another native dependency, so this uses the operating system's speech
// recogniser (Chromium exposes it as webkitSpeechRecognition on Windows and
// macOS). Recognition runs only while the setting is on, restarts itself when
// the browser ends a continuous session, and never records or stores audio.
// If the platform has no recogniser we report `unsupported` instead of
// pretending the wake word works.

type RecognitionResult = {
  isFinal: boolean;
  0: { transcript: string };
};

type RecognitionEvent = {
  resultIndex: number;
  results: { length: number } & Record<number, RecognitionResult>;
};

interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

type RecognitionConstructor = new () => Recognition;

function recogniser(): RecognitionConstructor | undefined {
  if (typeof window === 'undefined') return undefined;
  const scope = window as unknown as {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
}

// English, Devanagari and common transliterations all trigger. The optional
// greeting prefix keeps ordinary uses of the word "Aegis" from opening the
// overlay while still accepting a bare "Aegis?" when the user is already
// looking at the mascot.
const WAKE = /(?:^|\s)(?:hey|hi|ok|okay|oye|arre)?\s*(?:aegis|aegiz|agis| | )(?:\s|$|[,.!?])/i;

const LANG: Record<string, string> = {
  auto: 'en-IN',
  en: 'en-IN',
  hi: 'hi-IN',
  hinglish: 'en-IN',
};

export type WakeWordStatus = 'off' | 'starting' | 'listening' | 'unsupported' | 'denied' | 'error';

export function useWakeWord({
  enabled,
  language,
  onWake,
}: {
  enabled: boolean;
  language: string;
  onWake: () => void;
}) {
  const [status, setStatus] = useState<WakeWordStatus>('off');
  const [lastHeard, setLastHeard] = useState('');
  const wakeRef = useRef(onWake);
  wakeRef.current = onWake;
  const heardRef = useRef(false);
  const [manualOff, setManualOff] = useState(false);
  const [captureActive, setCaptureActive] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onPolicy = (event: Event) => {
      const detail = (event as CustomEvent<{ manualOff?: boolean; captureActive?: boolean }>).detail;
      setManualOff(detail?.manualOff === true);
      setCaptureActive(detail?.captureActive === true);
      if (detail?.manualOff === true || detail?.captureActive === true) {
        setLastHeard('');
      }
    };
    window.addEventListener('aegis:microphone-policy', onPolicy);
    return () => window.removeEventListener('aegis:microphone-policy', onPolicy);
  }, []);

  useEffect(() => {
    if (!enabled || manualOff || captureActive) {
      setStatus('off');
      return;
    }
    const Constructor = recogniser();
    if (!Constructor) {
      setStatus('unsupported');
      return;
    }
    let active = true;
    let recognition: Recognition | undefined;
    let restart: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;

    const begin = () => {
      if (!active) return;
      try {
        recognition = new Constructor();
        recognition.lang = LANG[language] ?? 'en-IN';
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;
        recognition.onstart = () => {
          failures = 0;
          setStatus('listening');
        };
        recognition.onresult = (event) => {
          let transcript = '';
          for (let i = event.resultIndex; i < event.results.length; i += 1) {
            transcript += ` ${event.results[i]?.[0]?.transcript ?? ''}`;
          }
          const text = transcript.trim();
          if (!text) return;
          setLastHeard(text.slice(-120));
          if (WAKE.test(text) && !heardRef.current) {
            heardRef.current = true;
            // A short cooldown stops one utterance opening the overlay twice.
            window.setTimeout(() => {
              heardRef.current = false;
            }, 4000);
            wakeRef.current();
          }
        };
        recognition.onerror = (event) => {
          const error = event.error ?? '';
          if (error === 'not-allowed' || error === 'service-not-allowed') {
            active = false;
            setStatus('denied');
            return;
          }
          if (error === 'no-speech' || error === 'aborted') return;
          failures += 1;
          setStatus(failures > 4 ? 'error' : 'starting');
        };
        recognition.onend = () => {
          if (!active) return;
          // Chromium ends continuous recognition periodically; restart with
          // a small backoff so we do not spin when the service is down.
          restart = setTimeout(begin, Math.min(4000, 350 + failures * 500));
        };
        recognition.start();
      } catch {
        setStatus('error');
      }
    };

    begin();
    return () => {
      active = false;
      if (restart) clearTimeout(restart);
      try {
        recognition?.abort();
      } catch {
        // ignore
      }
      recognition = undefined;
      setStatus('off');
    };
  }, [enabled, language, manualOff, captureActive]);

  return { status, lastHeard };
}
