// Aegis glue (new file): surface/mode -> Agent preset mapping. The
// surfaces/modes below are transplanted from upstream openmuse (see
// THIRD_PARTY.md at the product root for attribution).
//
// WHAT THE UPSTREAM SURFACE MODEL ACTUALLY DEFINES (evidence, quoted
// from the copied sources in ./_aegis/domain.ts, originally
// CopilotKit/openmuse packages/domain/src/index.ts):
//   export type WorkspaceMode = "sample" | "live";
//   export type Section =
//     | "today" | "chat" | "mail" | "calendar" | "browser" | "files"
//     | "activity" | "connections" | "ideas" | "goals" | "apps";
// There is NO per-agent "mode" enum upstream. The other mode-like axes are:
//   - Config.agentBackend: "sample" | "model" | "agui"
//     (apps/server/src/config.ts in the sidecar tree, env AGENT_BACKEND)  
//     a server-level runtime choice, not a per-Agent setting, so it is NOT
//     mapped onto Agents.
//   - AgentTask.kind: "agent" | "document" | "monitor" | "finance" | "plan"
//     (packages/domain/src/agent.ts)   mapped secondarily below.
//   - ComputerSnapshot.provider: "docker" | "e2b-desktop"   the computer
//     sidecar's business, not a Dot preset (see MODIFICATIONS.md, W3).
// The mobile app itself normalises two sections away
// (apps/mobile/App.tsx in the sidecar tree, navigate()): "today" -> "chat",
// "connections" -> "apps". The presets below follow that same normalisation.
//
// AEGIS SIDE: an Agent (src/shared/types.ts) carries exactly the
// permitted-tools knobs used here   researchAllowed, memoryAllowed,
// appsAllowed and composioToolkits[]   and WorkspaceStore.createDot()
// (src/server/workspace.ts) accepts all of them, so a preset is
// directly spreadable into a createDot() call (coordinator snippet in
// MODIFICATIONS.md, W3). composioToolkits values are Composio toolkit slugs,
// passed through verbatim by src/server/composio.ts.

import type { Dot } from '../../shared/types.js';

/** The upstream Section union, verbatim (see ./_aegis/domain.ts). */
export type AegisSection =
  | 'today'
  | 'chat'
  | 'mail'
  | 'calendar'
  | 'browser'
  | 'files'
  | 'activity'
  | 'connections'
  | 'ideas'
  | 'goals'
  | 'apps';

/** The upstream AgentTask["kind"] union, verbatim (packages/domain/src/agent.ts). */
export type AegisTaskKind = 'agent' | 'document' | 'monitor' | 'finance' | 'plan';

/** The subset of the Agent type that a preset pins down. */
export type AgentPreset = Pick<
  Dot,
  'name' | 'instructions' | 'researchAllowed' | 'memoryAllowed' | 'appsAllowed' | 'composioToolkits'
>;

export interface AegisSurfacePreset extends AgentPreset {
  /** The surface section this preset reproduces. */
  surface: AegisSection;
  /** Set when the upstream UI normalises this section onto another one. */
  aliasOf?: AegisSection;
}

export const AEGIS_SURFACE_PRESETS: readonly AegisSurfacePreset[] = [
  {
    surface: 'today',
    aliasOf: 'chat',
    name: 'Aegis   Today',
    instructions:
      'Daily brief surface ("today", which the UI folds into chat). Summarise the day from memory and connected apps; be concise.',
    researchAllowed: false,
    memoryAllowed: true,
    appsAllowed: true,
    composioToolkits: ['gmail', 'googlecalendar'],
  },
  {
    surface: 'chat',
    name: 'Aegis   Chat',
    instructions:
      'General conversational surface ("chat"). Answer normally and help the user think clearly; use research and memory when useful.',
    researchAllowed: true,
    memoryAllowed: true,
    appsAllowed: false,
    composioToolkits: [],
  },
  {
    surface: 'mail',
    name: 'Aegis   Mail',
    instructions:
      'Mail surface ("mail"). Triage, read and draft email. External sends always need the reviewed-action flow; never send silently.',
    researchAllowed: false,
    memoryAllowed: true,
    appsAllowed: true,
    composioToolkits: ['gmail'],
  },
  {
    surface: 'calendar',
    name: 'Aegis   Calendar',
    instructions:
      'Calendar surface ("calendar"). Read and prepare events; creates/updates/deletes go through review before they land.',
    researchAllowed: false,
    memoryAllowed: true,
    appsAllowed: true,
    composioToolkits: ['googlecalendar'],
  },
  {
    surface: 'browser',
    name: 'Aegis   Browser',
    instructions:
      'Browser surface ("browser"). Read public pages and report what was actually seen; distinguish search excerpts from full-page content.',
    researchAllowed: true,
    memoryAllowed: false,
    appsAllowed: false,
    composioToolkits: [],
  },
  {
    surface: 'files',
    name: 'Aegis   Files',
    instructions:
      'Files/documents surface ("files"). Inspect and fill documents (the transplanted PDF tools live in ./pdf.js); only use values the user supplied.',
    researchAllowed: false,
    memoryAllowed: true,
    appsAllowed: true,
    composioToolkits: ['googledrive'],
  },
  {
    surface: 'activity',
    name: 'Aegis   Activity',
    instructions:
      'Activity surface ("activity"). Report plans, progress, approvals and results from durable task state; never claim completion without a receipt.',
    researchAllowed: false,
    memoryAllowed: true,
    appsAllowed: false,
    composioToolkits: [],
  },
  {
    surface: 'connections',
    aliasOf: 'apps',
    name: 'Aegis   Connections',
    instructions:
      'Connections surface ("connections", which the UI folds into "apps"). Explain which apps are connected and what each unlocks; never pretend a missing connector works.',
    researchAllowed: false,
    memoryAllowed: false,
    appsAllowed: true,
    composioToolkits: [],
  },
  {
    surface: 'ideas',
    name: 'Aegis   Ideas',
    instructions:
      'Ideas surface ("ideas"). Suggest useful next steps grounded in the user\'s actual mail, calendar, files and goals   evidence first, no invented facts.',
    researchAllowed: true,
    memoryAllowed: true,
    appsAllowed: true,
    composioToolkits: ['gmail', 'googlecalendar', 'googledrive'],
  },
  {
    surface: 'goals',
    name: 'Aegis   Goals',
    instructions:
      'Goals surface ("goals"). Track longer-term outcomes and milestones; turn them into concrete delegated tasks when asked.',
    researchAllowed: true,
    memoryAllowed: true,
    appsAllowed: false,
    composioToolkits: [],
  },
  {
    surface: 'apps',
    name: 'Aegis   Apps',
    instructions:
      'Apps surface ("apps"). The full-capability surface: every connected Composio toolkit the user enabled, plus memory. This is the preset new toolkits land on.',
    researchAllowed: true,
    memoryAllowed: true,
    appsAllowed: true,
    composioToolkits: [],
  },
];

/** Look up the preset for a surface section (aliases resolve to themselves;
 *  callers wanting the canonical Agent should follow `aliasOf` when present). */
export function aegisSurfacePreset(surface: AegisSection): AegisSurfacePreset {
  const preset = AEGIS_SURFACE_PRESETS.find((p) => p.surface === surface);
  if (!preset) throw new Error(`Unknown Aegis surface: ${surface}`);
  return preset;
}

/**
 * Secondary axis: AgentTask.kind -> the surface preset a delegated
 * task of that kind should run under in Aegis.
 * ("finance" has no dedicated section; it runs on the files surface
 * because the upstream finance flow is CSV-import driven   see
 * apps/server/src/engine/finance.ts in the sidecar tree.)
 */
export const AEGIS_TASK_KIND_SURFACE: Readonly<Record<AegisTaskKind, AegisSection>> = {
  agent: 'chat',
  document: 'files',
  monitor: 'browser',
  finance: 'files',
  plan: 'goals',
};
