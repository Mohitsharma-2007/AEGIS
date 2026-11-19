#!/usr/bin/env node
/**
 * AEGIS <-> AG-UI interop test — the unification proof.
 *
 * Starts the real Python daemon, then drives it with the REAL
 * @ag-ui/client (HttpAgent) at the exact version the CopilotKit repo
 * pins (1.0.2), resolved from ../frontend/node_modules. Asserts the
 * client's own parser accepts the daemon's stream and that
 * RUN_STARTED, TEXT_MESSAGE_CONTENT and RUN_FINISHED arrive well-formed,
 * and that a remembered fact comes back through the AG-UI channel.
 *
 * Usage: node tests/interop_agui.mjs   (exit 0 = pass)
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const PORT = 8973;
const BASE = `http://127.0.0.1:${PORT}`;

const require = createRequire(join(ROOT, "apps", "desktop", "package.json"));
const { HttpAgent } = require("@ag-ui/client");
const { EventType } = require("@ag-ui/core");

const results = [];
function record(name, ok, detail = "") {
  results.push([name, ok]);
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? " — " + detail : ""}`);
}

async function waitHealth(timeoutMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return await r.json();
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("daemon did not become healthy");
}

async function runTurn(agent, text, threadId) {
  const events = [];
  const runId = "run_" + Math.random().toString(16).slice(2, 10);
  const input = {
    threadId,
    runId,
    messages: [{ id: "m_" + runId, role: "user", content: text }],
    tools: [],
    context: [],
    state: {},
    forwardedProps: {},
  };
  await new Promise((resolve, reject) => {
    agent.run(input).subscribe({
      next: (ev) => events.push(ev),
      error: reject,
      complete: resolve,
    });
  });
  return events;
}

async function main() {
  const home = mkdtempSync(join(tmpdir(), "aegis-interop-"));
  const venvPy = join(ROOT, "daemon", ".venv", "bin", "python");
  const daemon = spawn(venvPy, ["-m", "aegis_daemon.main"], {
    cwd: join(ROOT, "daemon"),
    env: {
      ...process.env,
      AEGIS_HOME: home,
      AEGIS_PORT: String(PORT),
      AEGIS_NO_LLM: "1", // deterministic: retrieval tier, no network calls
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let daemonLog = "";
  daemon.stdout.on("data", (d) => (daemonLog += d));
  daemon.stderr.on("data", (d) => (daemonLog += d));
  try {
    const health = await waitHealth();
    record("daemon healthy, tier offline (AEGIS_NO_LLM=1)",
      health.ok === true && health.tier === "offline",
      `tier=${health.tier}`);

    const agent = new HttpAgent({ url: `${BASE}/agui` });
    const threadId = "thread_interop";

    // Turn 1: remember a fact through the AG-UI channel itself.
    const ev1 = await runTurn(agent, "Remember that my favourite editor is Helix", threadId);
    const types1 = ev1.map((e) => e.type);
    record("turn 1: RUN_STARTED first", types1[0] === EventType.RUN_STARTED,
      `first=${types1[0]}`);
    record("turn 1: RUN_FINISHED last",
      types1[types1.length - 1] === EventType.RUN_FINISHED,
      `last=${types1[types1.length - 1]}`);

    // Turn 2: ask for the fact; the real client must deliver the content.
    const ev2 = await runTurn(agent, "What is my favourite editor?", threadId);
    const types2 = ev2.map((e) => e.type);
    const deltas = ev2
      .filter((e) => e.type === EventType.TEXT_MESSAGE_CONTENT)
      .map((e) => e.delta || "")
      .join("");
    record("turn 2: RUN_STARTED/TEXT_MESSAGE_CONTENT/RUN_FINISHED present",
      types2.includes(EventType.RUN_STARTED) &&
      types2.includes(EventType.TEXT_MESSAGE_CONTENT) &&
      types2.includes(EventType.RUN_FINISHED),
      `types=${[...new Set(types2)].join(",")}`);
    record("turn 2: answer text delivered by @ag-ui/client contains the fact",
      deltas.includes("Helix"), `answer=${JSON.stringify(deltas.slice(0, 120))}`);
    const snapshot = ev2.find((e) => e.type === EventType.STATE_SNAPSHOT);
    const cites = snapshot?.snapshot?.aegis?.citations || [];
    record("turn 2: STATE_SNAPSHOT carries citations (provenance over AG-UI)",
      Array.isArray(cites) && cites.length > 0,
      `citations=${cites.length}`);

    // Turn 3: unknown fact must abstain, still well-formed.
    const ev3 = await runTurn(agent, "What is my hedge fund's assets under management?", threadId);
    const snap3 = ev3.find((e) => e.type === EventType.STATE_SNAPSHOT);
    record("turn 3: unknown fact abstains (snapshot.aegis.abstained)",
      snap3?.snapshot?.aegis?.abstained === true,
      `abstained=${snap3?.snapshot?.aegis?.abstained}`);
  } catch (err) {
    record("interop run", false, String(err && err.message || err));
    console.log("--- daemon log tail ---\n" + daemonLog.slice(-1500));
  } finally {
    daemon.kill("SIGTERM");
    rmSync(home, { recursive: true, force: true });
  }
  const passed = results.filter(([, ok]) => ok).length;
  console.log(`INTEROP: ${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
}

main();
