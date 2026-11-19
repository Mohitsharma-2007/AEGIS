// Test fixture: a stand-in "host" process that lazily starts the WhatsApp
// sidecar and then stays alive so the test can kill it abruptly.
//
// It prints `READY:<sidecar pid>:reachable=true` once the sidecar answers, which
// is how the test learns the child PID to compare across an owner change.
import {
  disposeWhatsAppSidecar,
  getWhatsAppStatus,
  whatsappSidecarPids,
} from '../../src/server/whatsapp-routes.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// The first call provisions and launches the sidecar but reports unreachable
// (it tried before the child was listening), so poll until it answers.
let status = await getWhatsAppStatus();
const deadline = Date.now() + 20_000;
while (!status.reachable && Date.now() < deadline) {
  await sleep(250);
  status = await getWhatsAppStatus();
}
process.stdout.write(
  `READY:${whatsappSidecarPids().join(',')}:reachable=${status.reachable}\n`,
);
// Graceful-exit mode: the test asks for a normal host shutdown (the same
// dispose path SIGTERM takes) instead of killing the process.
if (process.env.OWNER_SHUTDOWN_ON_STDIN === '1') {
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => {
    if (!chunk.includes('shutdown')) return;
    void disposeWhatsAppSidecar().finally(() => process.exit(0));
  });
  process.stdin.resume();
}

setInterval(() => {}, 1_000);
