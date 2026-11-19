#!/usr/bin/env node
// Aegis host supervisor.
//
// The field failure that motivated this: the host process died between a chat
// request and its reply, leaving the browser tab pointed at a dead server
// ("Failed to fetch") while every sidecar kept running. The supervisor owns
// that process now: it restarts it with backoff, and every line the host prints
// goes to <AEGIS_HOME>/logs/host.log so the next death has a cause.
//
// Usage: node scripts/supervise-host.mjs <cwd> <command...>
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [cwd, ...command] = process.argv.slice(2);
if (!cwd || !command.length) {
  console.error('usage: supervise-host.mjs <cwd> <command...>');
  process.exit(2);
}

const logDir = process.env.AEGIS_LOG_DIR
  ? resolve(process.env.AEGIS_LOG_DIR)
  : resolve(process.env.AEGIS_HOME ?? 'data', 'logs');
mkdirSync(logDir, { recursive: true });
const logFile = join(logDir, 'host.log');

function write(line) {
  const stamped = `[${new Date().toISOString()}] ${line}\n`;
  process.stdout.write(stamped);
  try {
    if (statSync(logFile).size > 5 * 1024 * 1024)
      renameSync(logFile, `${logFile}.1`);
  } catch {
    // no log yet
  }
  try {
    appendFileSync(logFile, stamped);
  } catch {
    // keep supervising even if the log is unwritable
  }
}

const isWindows = process.platform === 'win32';
const delays = [1000, 2000, 5000, 10000, 15000];
let attempt = 0;
let child;
let stopping = false;

function start() {
  write(`supervisor: starting ${command.join(' ')} (cwd ${cwd})`);
  try {
    // Node refuses to spawn .cmd/.bat without a shell on Windows (npm.cmd), so
    // the launcher goes through cmd.exe there. Without this the supervisor
    // started nothing and reported nothing — the same silence this exists to
    // remove.
    child = spawn(command[0], command.slice(1), {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      shell: isWindows,
    });
  } catch (error) {
    write(`supervisor: could not start host: ${error.message}`);
    setTimeout(start, 5000);
    return;
  }
  child.stdout.on('data', (data) => write(String(data).trimEnd()));
  child.stderr.on('data', (data) => write(String(data).trimEnd()));
  child.on('error', (error) => {
    write(`supervisor: could not start host: ${error.message}`);
  });
  child.on('exit', (code, signal) => {
    if (stopping) return;
    attempt += 1;
    const delay = code === 0 && attempt > 3 ? 2000 : delays[Math.min(attempt - 1, delays.length - 1)];
    write(
      `supervisor: host exited (code ${code ?? 'null'}, signal ${signal ?? 'none'}); restarting in ${delay}ms`,
    );
    setTimeout(start, delay);
  });
}

function stop() {
  stopping = true;
  if (child && !child.killed) child.kill(isWindows ? undefined : 'SIGTERM');
  setTimeout(() => process.exit(0), 300);
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
start();
