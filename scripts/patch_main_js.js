const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'apps', 'desktop', 'main.js');
let code = fs.readFileSync(file, 'utf8');

// 1. Sanitize logs in writeLog
const oldWriteLog = `function writeLog(line) {
  const stamped = \`[\${new Date().toISOString()}] \${line}\\n\`;
  process.stdout.write(stamped);
  if (!logFile) return;
  try {
    fs.appendFileSync(logFile, stamped);
  } catch {
    // keep the shell usable if the log cannot be written
  }
}`;

const newWriteLog = `function sanitizeLog(text) {
  return String(text)
    .replace(/(bearer\\s+)[a-zA-Z0-9_\\-\\.]+([a-zA-Z0-9]{4})/gi, '$1[REDACTED]')
    .replace(/("username":\\s*")\\d{9,15}(")/gi, '$1[REDACTED_PHONE]$2')
    .replace(/(api[_-]?key["':\\s]+)[a-zA-Z0-9_\\-\\.]+/gi, '$1[REDACTED]');
}

function writeLog(line) {
  const sanitized = sanitizeLog(line);
  const stamped = \`[\${new Date().toISOString()}] \${sanitized}\\n\`;
  process.stdout.write(stamped);
  if (!logFile) return;
  try {
    fs.appendFileSync(logFile, stamped);
  } catch {
    // keep the shell usable if the log cannot be written
  }
}`;

code = code.replace(oldWriteLog, newWriteLog);

// 2. Fail-fast waitForHost
const oldWaitForHost = `async function waitForHost(timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !quitting) {
    try {
      const response = await fetch(\`\${HOST_URL}/api/health\`, {
        signal: AbortSignal.timeout(1500),
      });
      if (response.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return false;
}`;

const newWaitForHost = `async function waitForHost(timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !quitting) {
    if (buildState === 'missing-build' || !root) return false;
    try {
      const response = await fetch(\`\${HOST_URL}/api/health\`, {
        signal: AbortSignal.timeout(1500),
      });
      if (response.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return false;
}`;

code = code.replace(oldWaitForHost, newWaitForHost);

// 3. Navigation security in createWindow()
const oldCreateWindowP1 = `  installShortcutGuard(mainWindow);
  mainWindow.loadFile(path.join(__dirname, 'loading.html'), {`;

const newCreateWindowP1 = `  installShortcutGuard(mainWindow);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
        shell.openExternal(url);
      }
    } catch {}
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    try {
      const parsed = new URL(url);
      if (parsed.origin !== 'http://127.0.0.1:4310') {
        event.preventDefault();
        if (['http:', 'https:'].includes(parsed.protocol)) {
          shell.openExternal(url);
        }
      }
    } catch {
      event.preventDefault();
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'loading.html'), {`;

code = code.replace(oldCreateWindowP1, newCreateWindowP1);

// 4. showMain with unminimize check
const oldShowMain = `function showMain() {
  if (!mainWindow) createWindow();
  else {
    mainWindow.show();
    mainWindow.focus();
  }
}`;

const newShowMain = `function showMain() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
  } else {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
}`;

code = code.replace(oldShowMain, newShowMain);

// 5. Windows process tree-kill and signal handling
const oldQuitBlock = `  app.on('will-quit', () => {
    for (const child of children) {
      if (!child.killed) {
        try {
          child.kill();
        } catch {
          // already gone
        }
      }
    }
  });`;

const newQuitBlock = `  function killProcessTree(child) {
    if (!child || !child.pid) return;
    try {
      if (isWindows) {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
          stdio: 'ignore',
          windowsHide: true,
        });
      } else {
        child.kill('SIGTERM');
      }
    } catch {
      try { child.kill(); } catch {}
    }
  }

  function cleanupChildren() {
    for (const child of children) {
      killProcessTree(child);
    }
  }

  process.on('SIGINT', () => {
    quitting = true;
    cleanupChildren();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    quitting = true;
    cleanupChildren();
    process.exit(0);
  });

  process.on('uncaughtException', (err) => {
    writeLog(\`desktop uncaughtException: \${err && err.stack || err}\`);
  });

  process.on('unhandledRejection', (reason) => {
    writeLog(\`desktop unhandledRejection: \${reason && reason.stack || reason}\`);
  });

  app.on('will-quit', () => {
    cleanupChildren();
  });`;

code = code.replace(oldQuitBlock, newQuitBlock);

fs.writeFileSync(file, code, 'utf8');
console.log('apps/desktop/main.js successfully patched with audit fixes!');
