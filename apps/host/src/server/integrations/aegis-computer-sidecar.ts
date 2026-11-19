// Aegis glue (new file): client for the OPTIONAL Aegis computer sidecar
// (the computer backend transplanted from upstream openmuse   see
// THIRD_PARTY.md at the product root for attribution).
//
// Design: Aegis keeps its OWN computer service
// (src/server/computer-service.ts) as the primary computer for every
// Agent. The transplanted computer capability (Docker / @e2b/desktop
// backends in the openmuse tree's apps/server/src/computer*.ts) is
// registered only as a sidecar the operator can start with
// openmuse/run-aegis.sh and point Aegis at via AEGIS_COMPUTER_URL
// (already declared in aegis/.env.example).
//
// Routes used (verified in the sidecar's apps/server/src/app.ts +
// computer-routes.ts): GET /api/health (public) and GET /api/computer/
// (mounted at "/api/computer", returns the ComputerSnapshot shape copied in
// ./_aegis/computer.ts; requires the sidecar's Bearer session token).
// Nothing here fakes availability: an unreachable or unauthenticated sidecar
// reports itself as such.

import type { ComputerSnapshot } from './_aegis/computer.js';

export interface AegisComputerSidecarHealth {
  configured: boolean;
  available: boolean;
  detail: string;
}

/** AEGIS_COMPUTER_URL, trailing slashes trimmed; undefined when unset/blank. */
export function aegisComputerUrlFromEnv(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const raw = env.AEGIS_COMPUTER_URL?.trim();
  return raw ? raw.replace(/\/+$/, '') : undefined;
}

/** Liveness probe against the sidecar's public health route. */
export async function probeAegisComputerSidecar(
  baseUrl: string | undefined,
  transport: typeof fetch = fetch,
  timeoutMs = 3000,
): Promise<AegisComputerSidecarHealth> {
  if (!baseUrl)
    return { configured: false, available: false, detail: 'AEGIS_COMPUTER_URL is not set.' };
  try {
    const response = await transport(`${baseUrl}/api/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.ok
      ? { configured: true, available: true, detail: 'Aegis computer sidecar answered /api/health.' }
      : {
          configured: true,
          available: false,
          detail: `Aegis computer sidecar answered /api/health with HTTP ${response.status}.`,
        };
  } catch {
    return {
      configured: true,
      available: false,
      detail: 'Aegis computer sidecar did not answer /api/health (not running?).',
    };
  }
}

/**
 * The sidecar's computer snapshot (provider docker | e2b-desktop, status,
 * command log). Needs the sidecar's session token   its auth rejects
 * anonymous calls   so callers pass the token they hold for the sidecar;
 * without one this throws the sidecar's own rejection, it does not guess.
 */
export async function aegisComputerSnapshot(
  baseUrl: string,
  token?: string,
  transport: typeof fetch = fetch,
): Promise<ComputerSnapshot> {
  const response = await transport(`${baseUrl.replace(/\/+$/, '')}/api/computer/`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok)
    throw new Error(`Aegis computer sidecar answered HTTP ${response.status}.`);
  return (await response.json()) as ComputerSnapshot;
}
