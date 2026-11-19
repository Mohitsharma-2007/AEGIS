// Sidecar lifecycle: process signals must never leave a lazily spawned child
// behind. The host's own shutdown handling stays in index.ts; this module only
// owns "on SIGTERM/SIGINT, stop the WhatsApp sidecar".
//
// Injectable so it can be tested headlessly (fake emitter + fake dispose)
// without importing the server entry point.
import { disposeWhatsAppSidecar } from './whatsapp-routes.js';

type SignalEmitter = {
  on(event: string, listener: () => void): unknown;
  off?(event: string, listener: () => void): unknown;
};

/**
 * Register sidecar disposal on the given signals.
 * Returns an uninstall function (used by tests and by the host's own teardown).
 */
export function installSidecarShutdown(
  dispose: () => Promise<void> = disposeWhatsAppSidecar,
  proc: SignalEmitter = process,
  signals: readonly string[] = ['SIGTERM', 'SIGINT'],
): () => void {
  let disposed = false;
  const handler = () => {
    if (disposed) return;
    disposed = true;
    void dispose().catch(() => {
      // Exit must not depend on a sidecar that is already gone.
    });
  };
  for (const signal of signals) proc.on(signal, handler);
  return () => {
    for (const signal of signals) proc.off?.(signal, handler);
  };
}
