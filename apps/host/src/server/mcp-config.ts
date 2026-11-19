// AEGIS MCP server registry for the native harness.
//
// This replaced the old external plugins file's mcp.servers map.
// The native engine reads the same document shape from
// <product>/.aegis-data/mcp.json. Writes are atomic (temp file + rename in the
// same directory) and preserve every other key of the document.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { aegisRootDir } from './harness.js';

const localServer = z
  .object({
    type: z.literal('local'),
    command: z.array(z.string().min(1)).min(1),
    cwd: z.string().min(1).optional(),
    environment: z.record(z.string(), z.string()).optional(),
    disabled: z.boolean().optional(),
  })
  .strict();
const remoteServer = z
  .object({
    type: z.literal('remote'),
    url: z.string().url(),
    headers: z.record(z.string(), z.string()).optional(),
    oauth: z
      .union([z.literal(false), z.record(z.string(), z.unknown())])
      .optional(),
    disabled: z.boolean().optional(),
  })
  .strict();
export const mcpServerSchema = z.union([localServer, remoteServer]);
export type McpServerConfig = z.infer<typeof mcpServerSchema>;

const serverName = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
    'Use letters, numbers, dot, dash or underscore.',
  );

export interface McpConfigFile {
  path: string;
  /** Full parsed document ({} when the file does not exist yet). */
  document: Record<string, unknown>;
  servers: Record<string, McpServerConfig>;
}

/** Where the native harness keeps its MCP server list. */
export function mcpConfigPath(
  env: Record<string, string | undefined> = process.env,
): string {
  const override = env.AEGIS_MCP_CONFIG?.trim();
  if (override) return override;
  return join(aegisRootDir(), '.aegis-data', 'mcp.json');
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function readMcpConfig(
  path: string = mcpConfigPath(),
): Promise<McpConfigFile> {
  let document: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    document = asRecord(parsed);
  } catch {
    // unreadable/invalid config: keep the empty document
  }
  const serversRaw = asRecord(asRecord(document.mcp).servers);
  const servers: Record<string, McpServerConfig> = {};
  for (const [name, value] of Object.entries(serversRaw)) {
    const parsed = mcpServerSchema.safeParse(value);
    if (parsed.success) servers[name] = parsed.data;
  }
  return { path, document, servers };
}

async function writeMcpConfig(
  file: McpConfigFile,
  servers: Record<string, McpServerConfig>,
): Promise<Record<string, McpServerConfig>> {
  const document = {
    ...file.document,
    mcp: { ...asRecord(file.document.mcp), servers },
  };
  await mkdir(dirname(file.path), { recursive: true });
  const temp = `${file.path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  await rename(temp, file.path);
  return servers;
}

export async function upsertMcpServer(
  name: string,
  config: McpServerConfig,
): Promise<Record<string, McpServerConfig>> {
  const parsedName = serverName.safeParse(name);
  if (!parsedName.success) throw new Error('Invalid MCP server name.');
  const file = await readMcpConfig();
  const servers = { ...file.servers, [parsedName.data]: config };
  return writeMcpConfig(file, servers);
}

export async function removeMcpServer(
  name: string,
): Promise<Record<string, McpServerConfig> | undefined> {
  const file = await readMcpConfig();
  if (!file.servers[name]) return undefined;
  const servers = { ...file.servers };
  delete servers[name];
  return writeMcpConfig(file, servers);
}

export async function setMcpServerDisabled(
  name: string,
  disabled: boolean,
): Promise<Record<string, McpServerConfig> | undefined> {
  const file = await readMcpConfig();
  const existing = file.servers[name];
  if (!existing) return undefined;
  const servers = { ...file.servers, [name]: { ...existing, disabled } };
  return writeMcpConfig(file, servers);
}
