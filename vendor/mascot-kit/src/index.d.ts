export type CharacterName = 'aegi'|'mail'|'social'|'files'|'memory'|'harness'|'security';
export type Variant = 'color'|'dark'|'light';
export type SignatureState = 'mail-incoming'|'mail-sending'|'mail-reading'|'social-typing'|'social-message'|'social-react'|'files-organizing'|'files-upload'|'files-found'|'memory-saving'|'memory-recalling'|'memory-linking'|'harness-running'|'harness-testing'|'harness-building'|'security-scanning'|'security-locked'|'security-alert';
export interface Character { name: string; role: string; job: string; mood: string; shape: MascotShape; face: [number, number]; palette: { body: string; detail: string; eye: string; accent: string; onAccent: string; blush: string; bright: string; pop: string } }
export const CHARACTERS: Record<CharacterName, Character>; export const CHARACTER_NAMES: CharacterName[]; export const VARIANTS: Variant[]; export const COMMON_STATES: MascotState[];
export function statesFor(c: CharacterName): MascotState[]; export function characterTheme(c?: CharacterName, v?: Variant): Theme; export function resolveTheme(t?: ThemeName | Partial<Theme>, c?: CharacterName): Theme;
export type MascotState = SignatureState|'idle'|'hello'|'listening'|'thinking'|'searching'|'working'|'speaking'|'sending'|'paused'|'cancelled'|'done'|'notification'|'confused'|'error'|'sleeping'|'celebrate';
export type MascotShape = 'aegi'|'aegis'|'mail'|'social'|'files'|'memory'|'harness'|'security'|'leaf'|'orb'|'squircle'|'blob'|'drop';
export type ThemeName = Variant|'terracotta'|'dark'|'light'|'snow'|'aurora'|'sunset'|'ocean'|'candy'|'neon';
export type Paint = string | string[];
export interface Theme { label?: string; body: Paint; eye: Paint; accent: string; onAccent: string; blush: string; stroke?: Paint; strokeWidth?: number; detail?: string; pop?: string }
export interface MascotOptions { character?: CharacterName; state?: MascotState; theme?: ThemeName | Partial<Theme>; shape?: MascotShape; size?: number; follow?: boolean; autoplay?: boolean; emblem?: boolean; rim?: boolean; shadow?: boolean; onStateEnd?: (s: MascotState) => void }
export class AegisMascot { constructor(target: Element | string, opts?: MascotOptions); state: MascotState;
  setState(s: MascotState, o?: { then?: MascotState }): this; setTheme(t: ThemeName | Partial<Theme>): this; setShape(s: MascotShape | null): this; setCharacter(c: CharacterName, o?: { theme?: ThemeName | Partial<Theme>; state?: MascotState }): this; setSize(px: number): this;
  follow(on?: boolean): this; play(): this; pause(): this; destroy(): void }
export function renderSVG(o?: { character?: CharacterName; emblem?: boolean; shadow?: boolean; state?: MascotState; theme?: ThemeName | Partial<Theme>; shape?: MascotShape; animated?: boolean; t?: number; size?: number; fps?: number; title?: string }): string;
export function createTheme(o?: Partial<Theme>, c?: CharacterName): Theme;
export function defineElement(tag?: string): void;
export const STATES: Record<MascotState, { dur: number; poster: number; once?: boolean; then?: MascotState; label: string; when: string }>;
export const THEMES: Record<ThemeName, Theme>; export const SHAPES: Record<MascotShape, number[]>;
export const STATE_NAMES: MascotState[]; export const THEME_NAMES: ThemeName[];
export type SoundName = 'tap'|'send'|'send-soft'|'receive'|'listen-start'|'listen-stop'|'pause'|'resume'|'cancel'|'done'|'notify'|'error'|'confused'|'wake'|'sleep'|'celebrate'|'thinking-loop';
export type SoundPack = 'warm'|'crystal';
export class AegisSounds { constructor(o?: { pack?: SoundPack; volume?: number; enabled?: boolean }); enabled: boolean;
  play(name: SoundName, o?: { volume?: number; rate?: number }): AudioBufferSourceNode | null; startLoop(name?: SoundName): void; stopLoop(name?: SoundName): void;
  setPack(p: SoundPack): this; setVolume(v: number): this; preload(names?: SoundName[]): this }
export function renderSound(name: SoundName, pack?: SoundPack): Float32Array; export function encodeWav(s: Float32Array, sr?: number): Uint8Array;
export const SOUNDS: Record<SoundName, { dur: number; level: number; loop?: boolean; label: string; when: string }>; export const SOUND_NAMES: SoundName[];
export const EVENTS: Record<string, { state: MascotState | null; sound: SoundName | null }>;
export function createAegis(target: Element | string, o?: MascotOptions & { sounds?: object; events?: typeof EVENTS }): { mascot: AegisMascot; sounds: AegisSounds; emit(name: string): boolean };
export const STATE_SOUNDS: Partial<Record<MascotState, SoundName>>;
export type WidgetKind = 'pill'|'pet'|'panel'|'card'|'toast';
export interface WidgetOptions { character?: CharacterName; theme?: ThemeName | Partial<Theme>; ui?: 'light'|'dark'; shape?: MascotShape; size?: number; state?: MascotState; sounds?: AegisSounds; follow?: boolean; title?: string; placeholder?: string; timeout?: number; events?: typeof EVENTS; status?: string; sub?: string }
export interface WidgetPatch { status?: string; sub?: string; progress?: number | null; steps?: { label: string; state?: 'todo'|'active'|'done' }[]; transcript?: { role: 'user'|'agent'; text: string }[] }
export interface Widget { el: HTMLElement; mascot: AegisMascot; kind: WidgetKind; setState(s: MascotState, o?: { silent?: boolean; then?: MascotState }): Widget; emit(event: string): Widget; update(p: WidgetPatch): Widget;
  say(role: 'user'|'agent', text: string): Widget; on(action: 'mic'|'send'|'pause'|'resume'|'cancel'|'mute'|'close'|'*', fn: (action: string, data?: unknown) => void): Widget; setTheme(t: ThemeName | Partial<Theme>): Widget; setCharacter(c: CharacterName): Widget; setUI(ui: 'light'|'dark'): Widget; destroy(): void; dismiss?(): void }
export function mountWidget(target: Element | string, kind?: WidgetKind, opts?: WidgetOptions): Widget;
export function toast(target: Element | string, opts?: WidgetOptions): Widget;
export function linkWidgets(widgets: Widget[]): Omit<Widget, 'el'|'mascot'|'kind'|'destroy'> & { widgets: Widget[] };
export function renderTrayIcon(o?: { character?: CharacterName; state?: MascotState; theme?: ThemeName | Partial<Theme>; shape?: MascotShape; dot?: boolean; size?: number }): string;
export const STATUS_COLORS: Record<MascotState, string | null>; export const STATUS_TEXT: Record<MascotState, [string, string]>;
