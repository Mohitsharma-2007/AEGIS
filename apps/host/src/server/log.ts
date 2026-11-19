// Aegis host logging: one append-only line per event, credentials redacted.
// A silent process death was the field failure this exists to prevent: every
// boot, request failure and fatal error now lands in <AEGIS_HOME>/logs/host.log
// (or <cwd>/data/logs) and in the console.
import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const MAX_BYTES = 5 * 1024 * 1024;
const SECRET = [
  /sk-[A-Za-z0-9_-]{6,}/g,
  /gsk_[A-Za-z0-9]{6,}/g,
  /nvapi-[A-Za-z0-9_-]{6,}/g,
  /thk_[A-Za-z0-9_-]{6,}/g,
  /vck_[A-Za-z0-9_-]{6,}/g,
  /(authorization"\s*:\s*")[^"]+/gi,
  /(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/g,
];

export function redact(value: string): string {
  let out = value;
  for (const pattern of SECRET)
    out = out.replace(pattern, (match, prefix?: string) =>
      prefix ? `${prefix}[redacted]` : '[redacted]',
    );
  return out;
}

let logFile: string | undefined;
let logBroken = false;

export function logPath(): string | undefined {
  return logFile;
}

function rotate(file: string) {
  try {
    if (statSync(file).size < MAX_BYTES) return;
    renameSync(file, `${file}.1`);
  } catch {
    // Missing file or a locked previous log: keep appending.
  }
}

export function initLogging(): void {
  if (logFile) return;
  const base = process.env.AEGIS_LOG_DIR
    ? resolve(process.env.AEGIS_LOG_DIR)
    : resolve(process.env.AEGIS_HOME ?? 'data', 'logs');
  try {
    mkdirSync(base, { recursive: true });
    logFile = join(base, 'host.log');
    rotate(logFile);
  } catch {
    logBroken = true;
  }
}

function write(level: string, message: string, detail?: unknown): void {
  const record: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    message: redact(message),
  };
  if (detail !== undefined) {
    if (detail instanceof Error) {
      record.error = redact(detail.message);
      if (detail.stack) record.stack = redact(detail.stack);
    } else if (typeof detail === 'object') {
      record.detail = JSON.parse(redact(JSON.stringify(detail)));
    } else {
      record.detail = redact(String(detail));
    }
  }
  const line = JSON.stringify(record);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
  if (!logFile || logBroken) return;
  try {
    appendFileSync(logFile, `${line}\n`);
  } catch {
    logBroken = true;
  }
}

export const log = {
  info: (message: string, detail?: unknown) => write('info', message, detail),
  warn: (message: string, detail?: unknown) => write('warn', message, detail),
  error: (message: string, detail?: unknown) => write('error', message, detail),
};

let installed = false;

/**
 * Process-level safety net. An unhandled rejection used to terminate Node
 * (Node >=15 default) with nothing recorded; now it is logged and the server
 * keeps serving. Uncaught exceptions are logged, then the process exits so
 * the launcher's supervisor can restart a clean instance instead of leaving a
 * half-dead server that answers nothing.
 */
export function installProcessSafetyNet(): void {
  if (installed) return;
  installed = true;
  initLogging();
  process.on('unhandledRejection', (reason) => {
    log.error('Unhandled promise rejection (server kept running)', reason);
  });
  process.on('uncaughtException', (error) => {
    log.error('Uncaught exception (restarting host)', error);
    setTimeout(() => process.exit(1), 50);
  });
  process.on('warning', (warning) => {
    if (warning.name === 'DeprecationWarning') return;
    log.warn(`Process warning: ${warning.name}`, warning.message);
  });
}
