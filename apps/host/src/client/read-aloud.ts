import { authHeaders } from './api';

let activeAudio: HTMLAudioElement | undefined;
let activeUrl: string | undefined;
let finish: (() => void) | undefined;

function settle() {
  const done = finish;
  finish = undefined;
  done?.();
}

/**
 * Strip punctuation, markdown artifacts, and raw syntax from text before TTS.
 * Removes: ** $ ? # / * _ ~ ` > + - [ ] ( ) : ; , . ! and other non-speech characters.
 * Collapses whitespace and normalizes sentence boundaries.
 */
function sanitizeForTTS(text: string): string {
  let cleaned = text
    // Remove markdown bold/italic
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/__/g, '')
    .replace(/_/g, '')
    // Remove markdown headers
    .replace(/^#{1,6}\s+/gm, '')
    // Remove blockquotes
    .replace(/^>\s+/gm, '')
    // Remove list markers
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    // Remove code ticks
    .replace(/`+/g, '')
    // Remove tildes (strikethrough)
    .replace(/~/g, '')
    // Remove all punctuation that shouldn't be spoken: ? # / $ @ & \` + = [ ] { } | \ < > : ; , . !
    .replace(/[?#\/$@&`+=\[\]{}|\\<>:;,.!]/g, '')
    // Replace remaining sentence-ending punctuation with pause
    .replace(/[.!]+$/g, '')
    // Replace commas and semicolons with pause (comma)
    .replace(/[,;]/g, ', ')
    // Replace colons with pause
    .replace(/:/g, ', ')
    // Replace dashes with pause
    .replace(/—/g, ', ')
    .replace(/--/g, ', ')
    // Collapse multiple spaces
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned;
}

export function stopReadAloud() {
  try {
    window.speechSynthesis?.cancel();
  } catch {
    // ignore
  }
  if (activeAudio) {
    activeAudio.onended = null;
    activeAudio.onerror = null;
    activeAudio.pause();
  }
  activeAudio = undefined;
  if (activeUrl) {
    URL.revokeObjectURL(activeUrl);
    activeUrl = undefined;
  }
  settle();
}

/**
 * Speak text with the local voice (Kokoro, or Piper as a fallback) through the
 * host proxy, and fall back to the browser voice when the local pipeline is not
 * running. The promise resolves when playback finishes or is stopped.
 */
export async function readAloud(
  text: string,
  language: 'auto' | 'en' | 'hi' | 'hinglish' = 'auto',
): Promise<'local' | 'browser'> {
  const value = sanitizeForTTS(text).slice(0, 4000);
  if (!value) return 'browser';
  stopReadAloud();
  try {
    const response = await fetch('/api/voice/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ text: value, language }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    activeUrl = URL.createObjectURL(blob);
    const audio = new Audio(activeUrl);
    activeAudio = audio;
    let played = false;
    await new Promise<void>((resolve) => {
      finish = resolve;
      audio.onended = () => {
        stopReadAloud();
      };
      audio.onerror = () => {
        stopReadAloud();
      };
      void audio.play().then(() => {
        played = true;
      }).catch(() => {
        // Autoplay or codec blocked by the renderer: stop the failed local
        // attempt and let the catch block fall back to browser speech synthesis
        // instead of reporting "completed with no audio".
        stopReadAloud();
        played = false;
        resolve();
      });
    });
    if (played) return 'local';
    throw new Error('Local audio playback blocked.');
  } catch {
    const utterance = new SpeechSynthesisUtterance(value);
    utterance.rate = 1;
    if (language === 'hi' || language === 'hinglish') utterance.lang = 'hi-IN';
    else if (language === 'en') utterance.lang = 'en-IN';
    await new Promise<void>((resolve) => {
      finish = resolve;
      utterance.onend = () => settle();
      utterance.onerror = () => settle();
      window.speechSynthesis.speak(utterance);
    });
    return 'browser';
  }
}
