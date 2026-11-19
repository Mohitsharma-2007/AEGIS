import { disposeWhatsAppSidecar } from '../src/server/whatsapp-routes.js';

/**
 * Vitest global teardown.
 *
 * The host's lazy WhatsApp launch owns its child process (whatsapp-routes.ts
 * tracks it and kills it on process exit); this is the suite's explicit
 * teardown so a test run can never leave a sidecar listening on the WhatsApp
 * port. It is a no-op when nothing was spawned.
 */
export default async function globalTeardown(): Promise<void> {
  await disposeWhatsAppSidecar();
}
