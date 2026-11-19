/*! aegis-mascot — app event map. Edit freely. */
/** Which mascot state + sound goes with which app event. Edit freely.
 *  An event may also name a `character`: the mascot then switches to that crew member first. */
export const EVENTS = {
  'app:start':        { state: 'hello',        sound: 'wake' },
  'key:enter':        { state: null,           sound: 'tap' },
  'prompt:send':      { state: 'sending',      sound: 'send' },
  'mic:start':        { state: 'listening',    sound: 'listen-start' },
  'mic:stop':         { state: 'thinking',     sound: 'listen-stop' },
  'agent:thinking':   { state: 'thinking',     sound: null },
  'agent:searching':  { state: 'searching',    sound: null },
  'agent:working':    { state: 'working',      sound: null },
  'agent:reply':      { state: 'speaking',     sound: 'receive' },
  'agent:speaking':   { state: 'speaking',     sound: null },
  'agent:confused':   { state: 'confused',     sound: 'confused' },
  'agent:done':       { state: 'done',         sound: 'done' },
  'agent:error':      { state: 'error',        sound: 'error' },
  'agent:celebrate':  { state: 'celebrate',    sound: 'celebrate' },
  'user:pause':       { state: 'paused',       sound: 'pause' },
  'user:resume':      { state: 'working',      sound: 'resume' },
  'user:cancel':      { state: 'cancelled',    sound: 'cancel' },
  'notify':           { state: 'notification', sound: 'notify' },
  'app:idle':         { state: 'idle',         sound: null },
  'app:sleep':        { state: 'sleeping',     sound: 'sleep' },
  // ── specialists: these also switch the mascot to the right crew member ──
  'mail:new':         { character: 'mail',     state: 'mail-incoming',     sound: 'notify' },
  'mail:read':        { character: 'mail',     state: 'mail-reading',      sound: null },
  'mail:send':        { character: 'mail',     state: 'mail-sending',      sound: 'send' },
  'social:message':   { character: 'social',   state: 'social-message',    sound: 'receive' },
  'social:typing':    { character: 'social',   state: 'social-typing',     sound: null },
  'social:react':     { character: 'social',   state: 'social-react',      sound: 'tap' },
  'files:organize':   { character: 'files',    state: 'files-organizing',  sound: null },
  'files:upload':     { character: 'files',    state: 'files-upload',      sound: 'send-soft' },
  'files:found':      { character: 'files',    state: 'files-found',       sound: 'done' },
  'memory:save':      { character: 'memory',   state: 'memory-saving',     sound: 'send-soft' },
  'memory:recall':    { character: 'memory',   state: 'memory-recalling',  sound: 'receive' },
  'memory:link':      { character: 'memory',   state: 'memory-linking',    sound: null },
  'harness:run':      { character: 'harness',  state: 'harness-running',   sound: 'tap' },
  'harness:test':     { character: 'harness',  state: 'harness-testing',   sound: null },
  'harness:build':    { character: 'harness',  state: 'harness-building',  sound: null },
  'security:scan':    { character: 'security', state: 'security-scanning', sound: null },
  'security:locked':  { character: 'security', state: 'security-locked',   sound: 'done' },
  'security:alert':   { character: 'security', state: 'security-alert',    sound: 'error' },
  'crew:lead':        { character: 'aegi',     state: 'hello',             sound: 'wake' },
};

/** The natural sound for each mascot state (states not listed are silent). */
export const STATE_SOUNDS = { hello: 'wake', listening: 'listen-start', sending: 'send', speaking: 'receive', paused: 'pause', cancelled: 'cancel', done: 'done',
  notification: 'notify', confused: 'confused', error: 'error', sleeping: 'sleep', celebrate: 'celebrate' };

