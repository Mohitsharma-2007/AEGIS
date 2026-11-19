# aegis-mascot kit

- **[MASCOT.md](MASCOT.md)** — the crew of 7 mascots (Aegi = lead assistant, Posty = mail, Chatty = whatsapp & socials, Filo = files, Memo = memory, Rig = harness, Guard = security): which SVG for which state, colours, integration.
- **[SOUNDS.md](SOUNDS.md)** — the sound set: which sound for which event, integration.
- **[INTEGRATION.md](INTEGRATION.md)** — the brief for a coding agent: widgets, tray, Electron wiring, checklist.
- `demo/index.html` — open in a browser: the playground with every mascot (guides at the bottom). `demo/widgets.html` — desktop widgets.
- `electron-example/` — minimal Electron host.

```
node tools/docs.mjs   # regenerate MASCOT.md, SOUNDS.md, INTEGRATION.md
npm run build         # regenerate svg/, tray/svg, sounds/*.wav, manifest.json, demo/ (embeds the guides)
python3 tools/tray.py # tray/png + tray/ico
```
