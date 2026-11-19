import type { SwarmAgentId } from './api';

/**
 * Slash commands, shared by both composers.
 *
 * The conversation composer (Chat.tsx) and the new-thread composer (App.tsx)
 * used to disagree: the second one sent `/settings` to the model as a chat
 * message. One table here means a command means the same thing wherever it is
 * typed, and the `/` menu can never advertise something the handler ignores.
 */

export interface SlashCommand {
  name: string;
  /** Argument hint shown in the menu; absent for commands that run at once. */
  args?: string;
  description: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: 'help', description: 'Show every command' },
  { name: 'summary', description: 'Summarise this conversation' },
  { name: 'agent', args: '<agent> <task>', description: 'Delegate a task to an agent' },
  { name: 'rate', args: '<agent> <task>', description: 'Call a runtime agent from chat' },
  { name: 'call', args: '<widget>', description: 'Run a desktop widget' },
  { name: 'draw', args: '<topic>', description: 'Draw a diagram' },
  { name: 'whiteboard', args: '<topic>', description: 'Sketch on the whiteboard' },
  { name: 'voice', description: 'Open the voice surface' },
  { name: 'agents', description: 'Open the Agents workspace' },
  { name: 'harness', description: 'Open the Harness' },
  { name: 'finance', description: 'Open Finance' },
  { name: 'research', description: 'Open Research' },
  { name: 'memory', description: 'Open Memory' },
  { name: 'files', description: 'Open Files' },
  { name: 'computer', description: 'Open computer control' },
  { name: 'terminal', description: 'Open the terminal' },
  { name: 'integrations', description: 'Open Integrations' },
  { name: 'tools', description: 'Open the tools tab' },
  { name: 'settings', description: 'Open Settings' },
  { name: 'whatsapp', description: 'Open WhatsApp' },
];

/**
 * Commands that only navigate. Anything in here can be handled by a composer
 * that has no chat context yet (the new-thread one), by dispatching
 * `aegis:nav` with the mapped view.
 */
export const NAV_COMMANDS: Record<string, string> = {
  settings: 'settings',
  browser: 'computer',
  files: 'files',
  research: 'research',
  tools: 'integrations',
  whatsapp: 'whatsapp',
  marketplace: 'integrations',
  integrations: 'integrations',
  connections: 'integrations',
  computer: 'computer',
  terminal: 'terminal',
  memory: 'memories',
  memories: 'memories',
  swarm: 'agents',
  agents: 'agents',
  agent: 'agents',
  activity: 'tasks',
  tasks: 'tasks',
  harness: 'harness',
  finance: 'finance',
  ops: 'tasks',
};

/**
 * The token under the caret, split at the last space or newline. Used for both
 * menus so `/` and `@` are recognised anywhere in the draft, not just at
 * position 0 (which is what made the menu vanish mid-message).
 */
export function tokenBeforeCaret(value: string, caret: number) {
  const upto = value.slice(0, caret);
  const start = Math.max(upto.lastIndexOf(' '), upto.lastIndexOf('\n')) + 1;
  return { token: upto.slice(start), start };
}

/** Aliases accepted by `@mention` and by `/agent <alias>`. */
export const AGENT_ALIASES: Record<string, SwarmAgentId> = {

  aegis: 'aegis',

  rfi: 'rfi',

  research: 'rfi',

  finance: 'rfi',

  market: 'rfi',

  security: 'security',

  sentinel: 'security',

  files: 'files',

  filo: 'files',

  documents: 'files',

  memory: 'memory',

  memo: 'memory',

  computer: 'computer',

  operator: 'computer',

  browser: 'computer',

};

/** Display names for the runtime agents. */
export const AGENT_LABELS: Record<SwarmAgentId, string> = {

  aegis: 'Aegis',

  rfi: 'RFI',

  security: 'Sentinel',

  files: 'Filo',

  memory: 'Memo',

  computer: 'Operator',

};
