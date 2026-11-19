// AEGIS sound design (client): every cue is synthesised with the Web Audio
// API, so the app ships no downloaded audio files, works offline, and has
// no third-party sample licensing. A cue is a short, quiet envelope   the
// owner can turn all of them off in Settings (persisted server-side) and the
// preference is mirrored locally so the UI reacts immediately.
export type Cue =
  | 'sent'
  | 'alert'
  | 'success'
  | 'error'
  | 'paused'
  | 'resumed'
  | 'listen'
  | 'speak';

const STORAGE_KEY = 'aegis-sounds-enabled';
const VOLUME_KEY = 'aegis-sounds-volume';

let enabled = readEnabled();
let volume = readVolume();
let context: AudioContext | undefined;

function readEnabled() {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

function readVolume() {
  try {
    const raw = Number(localStorage.getItem(VOLUME_KEY));
    return Number.isFinite(raw) && raw > 0 && raw <= 1 ? raw : 0.35;
  } catch {
    return 0.35;
  }
}

export function soundsEnabled() {
  return enabled;
}

export function setSoundsEnabled(next: boolean) {
  enabled = next;
  try {
    localStorage.setItem(STORAGE_KEY, next ? 'on' : 'off');
  } catch {
    // storage unavailable: keep the in-memory preference
  }
}

export function setSoundsVolume(next: number) {
  volume = Math.min(1, Math.max(0.01, next));
  try {
    localStorage.setItem(VOLUME_KEY, String(volume));
  } catch {
    // ignore
  }
}

function audio() {
  if (typeof window === 'undefined') return undefined;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return undefined;
  if (!context) context = new Ctor();
  if (context.state === 'suspended') void context.resume();
  return context;
}

/** One short enveloped tone; frequencies in Hz, offsets in seconds. */
function tone(
  ctx: AudioContext,
  frequency: number,
  start: number,
  duration: number,
  gain: number,
  type: OscillatorType = 'sine',
) {
  const oscillator = ctx.createOscillator();
  const envelope = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, ctx.currentTime + start);
  const peak = Math.max(0.0001, volume * gain);
  envelope.gain.setValueAtTime(0.0001, ctx.currentTime + start);
  envelope.gain.exponentialRampToValueAtTime(
    peak,
    ctx.currentTime + start + 0.012,
  );
  envelope.gain.exponentialRampToValueAtTime(
    0.0001,
    ctx.currentTime + start + duration,
  );
  oscillator.connect(envelope).connect(ctx.destination);
  oscillator.start(ctx.currentTime + start);
  oscillator.stop(ctx.currentTime + start + duration + 0.02);
}

const CUES: Record<Cue, [frequency: number, offset: number, length: number, gain: number, type?: OscillatorType][]> = {
  // Message sent: a quick upward blip.
  sent: [
    [880, 0, 0.055, 0.5],
    [1174, 0.045, 0.07, 0.35],
  ],
  // Needs attention (task started / permission request).
  alert: [
    [659, 0, 0.09, 0.55, 'triangle'],
    [988, 0.1, 0.12, 0.5, 'triangle'],
  ],
  success: [
    [523, 0, 0.09, 0.45],
    [784, 0.09, 0.09, 0.45],
    [1047, 0.18, 0.14, 0.4],
  ],
  error: [
    [392, 0, 0.12, 0.5, 'sawtooth'],
    [262, 0.13, 0.18, 0.45, 'sawtooth'],
  ],
  paused: [
    [523, 0, 0.08, 0.4],
    [349, 0.08, 0.14, 0.4],
  ],
  resumed: [
    [349, 0, 0.08, 0.4],
    [523, 0.08, 0.12, 0.4],
  ],
  // Voice: tiny ticks so listening/speaking changes are felt, not shouted.
  listen: [[1318, 0, 0.035, 0.22]],
  speak: [[587, 0, 0.035, 0.22]],
};

export function playCue(cue: Cue) {
  if (!enabled) return;
  const ctx = audio();
  if (!ctx) return;
  try {
    for (const [frequency, offset, length, gain, type] of CUES[cue])
      tone(ctx, frequency, offset, length, gain, type);
    haptic(cue);
  } catch {
    // A blocked audio context must never break a user action.
  }
}

/**
 * "System haptics": on Windows/desktop browsers navigator.vibrate is a no-op,
 * so this only does something on hardware that supports it (Android tablets,
 * some trackpads). It is best-effort and never throws.
 */
function haptic(cue: Cue) {
  if (typeof navigator === 'undefined' || !navigator.vibrate) return;
  const pattern: Partial<Record<Cue, number | number[]>> = {
    sent: 8,
    alert: [12, 40, 12],
    success: [10, 30, 10],
    error: [20, 50, 20],
    paused: 12,
    resumed: 12,
    listen: 5,
    speak: 5,
  };
  const value = pattern[cue];
  if (value) navigator.vibrate(value);
}

/** Adopt the persisted server preference without overwriting a local choice. */
export function adoptServerSoundPreference(value: boolean | undefined) {
  if (typeof value !== 'boolean') return;
  enabled = value;
  try {
    localStorage.setItem(STORAGE_KEY, value ? 'on' : 'off');
  } catch {
    // ignore
  }
}
