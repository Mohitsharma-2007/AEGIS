const { runShortcut } = require('./apps/host/dist/server/server/shortcuts.js');
(async () => {
  for (const name of ['chrome', 'Google Chrome', 'calc', 'Calculator']) {
    const r = await runShortcut(name);
    console.log(`runShortcut(${JSON.stringify(name)}) → ok=${r.ok} error=${r.error ?? ''}`);
  }
})();
