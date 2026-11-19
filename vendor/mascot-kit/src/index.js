export * from './mascot.js';
export * from './sounds.js';
export * from './events.js';
export * from './widgets.js';
import { AegisMascot } from './mascot.js';
import { AegisSounds } from './sounds.js';
import { EVENTS } from './events.js';

/** One object that drives both: const aegi = createAegis('#mascot', { character: 'aegi', theme: 'color' }); aegi.emit('prompt:send'); aegi.emit('mail:new'); */
export function createAegis(target, { sounds = {}, events = EVENTS, ...mascotOpts } = {}) {
  const mascot = new AegisMascot(target, mascotOpts), sfx = new AegisSounds(sounds);
  return { mascot, sounds: sfx, events,
    emit(name) { const e = events[name]; if (!e) return false; if (e.character && e.character !== mascot.o.character) mascot.setCharacter(e.character); if (e.state) mascot.setState(e.state); if (e.sound) sfx.play(e.sound); return true; } };
}
