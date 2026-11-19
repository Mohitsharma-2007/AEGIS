// Minimal, context-isolated bridge for the shell's own pages.
const { contextBridge, ipcRenderer, webUtils, desktopCapturer } = require('electron');

contextBridge.exposeInMainWorld('aegis', {
  show: () => ipcRenderer.send('aegis:show'),
  ask: (text) => ipcRenderer.send('aegis:ask', String(text ?? '')),
  quit: () => ipcRenderer.send('aegis:quit'),
  voice: () => ipcRenderer.send('aegis:voice'),
  status: (value) => ipcRenderer.send('aegis:status', value),
  // Pause/Resume goes through the host so the app, notch and widgets agree.
  setPaused: (paused) => ipcRenderer.invoke('aegis:set-paused', !!paused),
  getDesktopPreferences: () => ipcRenderer.invoke('aegis:get-desktop-preferences'),
  getNotchSettings: () => ipcRenderer.invoke('aegis:get-notch-settings'),
  setNotchSettings: (settings) => ipcRenderer.invoke('aegis:set-notch-settings', settings),
  onNotchSettings: (callback) => {
    const listener = (_event, settings) => callback(settings);
    ipcRenderer.on('aegis:notch-settings', listener);
    return () => ipcRenderer.removeListener('aegis:notch-settings', listener);
  },
  setMinimizeToTray: (enabled) => ipcRenderer.invoke('aegis:set-minimize-to-tray', !!enabled),
  setClipboardHistoryEnabled: (enabled) => ipcRenderer.invoke('aegis:set-clipboard-history', !!enabled),
  setExternalAgentDiscovery: (enabled) => ipcRenderer.invoke('aegis:set-external-agent-discovery', !!enabled),
  onLoginSetting: (callback) => {
    const listener = (_event, enabled) => callback(!!enabled);
    ipcRenderer.on('aegis:login-setting', listener);
    return () => ipcRenderer.removeListener('aegis:login-setting', listener);
  },
  hideOverlay: () => ipcRenderer.send('aegis:hide-overlay'),
  toggleVisualLayer: () => ipcRenderer.send('aegis:visual-toggle'),
  hideNotch: () => ipcRenderer.send('aegis:toggle-notch'),
  hideWidgets: () => ipcRenderer.send('aegis:hide-widgets'),
  toggleMascot: () => ipcRenderer.send('aegis:toggle-mascot'),
  toggleNotch: () => ipcRenderer.send('aegis:toggle-notch'),
  toggleWidgets: () => ipcRenderer.send('aegis:toggle-widgets'),
  showWidgets: () => ipcRenderer.send('aegis:show-widgets'),
  wantFocus: (focused) => ipcRenderer.send('aegis:want-focus', !!focused),
  // Overlay surfaces are click-through by default; the page flips this off
  // while the pointer is over a real element so buttons and drags work.
  setClickThrough: (through) => ipcRenderer.send('aegis:click-through', !!through),
  mediaControl: (control) => ipcRenderer.send('aegis:media-control', control),
  getMediaSession: () => ipcRenderer.invoke('aegis:get-media-session'),
  getExternalAgents: () => ipcRenderer.invoke('aegis:get-external-agents'),
  getSystemMetrics: () => ipcRenderer.invoke('aegis:system-metrics'),
  getWeather: () => ipcRenderer.invoke('aegis:get-weather'),
  getAgents: () => ipcRenderer.invoke('aegis:get-agents'),
  importDroppedFiles: (files) => ipcRenderer.invoke('aegis:import-dropped-files', Array.from(files || [], (file) => webUtils.getPathForFile(file))),
  openWorkspaceFile: (filePath) => ipcRenderer.invoke('aegis:open-workspace-file', String(filePath || '')),
  readFileTrayFile: (filePath) => ipcRenderer.invoke('aegis:read-file-tray-file', String(filePath || '')),

  // Transparent window click-through: ignore mouse events unless hovering interactive content
  hover: (over) => ipcRenderer.send('aegis:hover', !!over),

  // Dynamic system tray updates
  trayUpdate: (data) => ipcRenderer.send('aegis:tray-update', data),

  // Actions dispatched by overlay, notch, and widgets
  action: (name, data) => ipcRenderer.send('aegis:action', name, data),
  onAction: (callback) => {
    const listener = (_event, action, data) => callback(action, data);
    ipcRenderer.on('aegis:action', listener);
    return () => ipcRenderer.removeListener('aegis:action', listener);
  },

  // Event stream listeners
  onEvent: (callback) => {
    const listener = (_event, name, data) => callback(name, data);
    ipcRenderer.on('aegis:event', listener);
    return () => ipcRenderer.removeListener('aegis:event', listener);
  },

  // Rich status listener (carries { status, state, character, text })
  onStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('aegis:status', listener);
    return () => ipcRenderer.removeListener('aegis:status', listener);
  },

  // Rich update listener (carries { status, sub, progress, steps, transcript })
  onUpdate: (callback) => {
    const listener = (_event, patch) => callback(patch);
    ipcRenderer.on('aegis:update', listener);
    return () => ipcRenderer.removeListener('aegis:update', listener);
  },
  onWidgets: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('aegis:widgets', listener);
    return () => ipcRenderer.removeListener('aegis:widgets', listener);
  },
  getHarness: () => ipcRenderer.invoke('aegis:get-harness'),
  setHarnessPlugin: (name, disabled) => ipcRenderer.invoke('aegis:set-harness-plugin', String(name || ''), disabled === true),
  onAgents: (callback) => {
    const listener = (_event, agents) => callback(agents);
    ipcRenderer.on('aegis:agents', listener);
    return () => ipcRenderer.removeListener('aegis:agents', listener);
  },
  onNotify: (callback) => {
    const listener = (_event, notification) => callback(notification);
    ipcRenderer.on('aegis:notify', listener);
    return () => ipcRenderer.removeListener('aegis:notify', listener);
  },
  onAsk: (callback) => {
    const listener = (_event, text) => callback(String(text ?? ''));
    ipcRenderer.on('aegis:open-ask', listener);
    return () => ipcRenderer.removeListener('aegis:open-ask', listener);
  },
  onDesktopAction: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('aegis:desktop-action', listener);
    return () => ipcRenderer.removeListener('aegis:desktop-action', listener);
  },

  // Set thought / status back to the main process
  setStatus: (status) => ipcRenderer.send('aegis:set-thought', status),

  // Screen annotation HUD (Hey Clicky model): draw guidance above any app.
  annotateScreen: (payload) => ipcRenderer.send('aegis:annotate', payload || {}),
  clearAnnotations: () => ipcRenderer.send('aegis:clear-annotations'),

  // Window controls
  minimizeWindow: () => ipcRenderer.send('aegis:minimize-window'),
  maximizeWindow: () => ipcRenderer.send('aegis:maximize-window'),
  closeWindow: () => ipcRenderer.send('aegis:close-window'),

  // Screen sharing
  getScreenSources: () => ipcRenderer.invoke('aegis:get-screen-sources'),
  startScreenShare: (sourceId) => ipcRenderer.send('aegis:start-screen-share', sourceId),
  stopScreenShare: () => ipcRenderer.send('aegis:stop-screen-share'),
  onScreenSource: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('aegis:screen-source', listener);
    return () => ipcRenderer.removeListener('aegis:screen-source', listener);
  },

  // Annotation toggle
  toggleAnnotation: () => ipcRenderer.send('aegis:show-annotations'),
  onAnnotationToggle: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('aegis:toggle-annotation', listener);
    return () => ipcRenderer.removeListener('aegis:toggle-annotation', listener);
  },

  // Voice-mode desktop live screen: the host renderer streams the screen the
  // agent is looking at ({ active, frame, state, character, ... }) and the
  // shell floats it above every other window.

  // The main window receives this when the tray, the notch, the overlay or a
  // keyboard shortcut asks Aegis to open its voice surface.
  onOpenVoice: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('aegis:open-voice', listener);
    return () => ipcRenderer.removeListener('aegis:open-voice', listener);
  },
  platform: process.platform,
});

// The transparent annotation window listens here for its drawing commands.
contextBridge.exposeInMainWorld('aegisAnnotations', {
  onDraw: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('aegis:annotate', listener);
    return () => ipcRenderer.removeListener('aegis:annotate', listener);
  },
  onClear: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('aegis:clear-annotations', listener);
    return () => ipcRenderer.removeListener('aegis:clear-annotations', listener);
  },
});

// Mascot overlay / notch / widgets backwards-compatible helpers
contextBridge.exposeInMainWorld('aegisOverlay', {
  onStatus: (callback) => {
    const listener = (_event, status) => callback(String(status ?? ''));
    ipcRenderer.on('aegis:update-thought', listener);
    return () => ipcRenderer.removeListener('aegis:update-thought', listener);
  },
  onUpdate: (callback) => {
    const listener = (_event, patch) => callback(patch);
    ipcRenderer.on('aegis:update', listener);
    return () => ipcRenderer.removeListener('aegis:update', listener);
  },
  hover: (over) => ipcRenderer.send('aegis:hover', !!over),
  trayUpdate: (data) => ipcRenderer.send('aegis:tray-update', data),
});

// AEGIS Visual Layer: the transparent Windows overlay that draws explanations
// over other applications. The page asks the shell for a screen capture and a
// scene; the shell talks to the host's /api/visual/explain route.
contextBridge.exposeInMainWorld('aegisVisual', {
  ask: (payload) => ipcRenderer.invoke('aegis:visual-ask', payload || {}),
  capture: () => ipcRenderer.invoke('aegis:visual-capture'),
  close: () => ipcRenderer.send('aegis:visual-close'),
  // The full-screen layer is click-through over empty desktop. The page flips
  // this on while the owner is in the layer so drawing and orbiting work.
  setInteractive: (on) => ipcRenderer.send('aegis:visual-interactive', !!on),
  onOpen: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('aegis:visual-open', listener);
    return () => ipcRenderer.removeListener('aegis:visual-open', listener);
  },
});
