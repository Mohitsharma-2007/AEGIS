import { Hono } from 'hono';
import { z } from 'zod';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { removeMcpServer, upsertMcpServer } from './mcp-config.js';

/**
 * Marketplace installs are real files, not a local boolean. Adding a
 * connector writes a manifest, a standard MCP configuration and setup notes
 * into data/connectors/<slug>/ and hands the same files back so the client
 * can download them. Removing it deletes that directory.
 *
 * Nothing here claims a package was fetched or executed: the manifest records
 * the exact command the connector needs so the owner (or Connections) can run
 * it with their own credentials.
 */

const itemSchema = z
  .object({
    id: z.string().trim().min(1).max(160),
    name: z.string().trim().min(1).max(160),
    kind: z.enum(['mcp', 'plugin', 'skill', 'connector', 'tool']),
    category: z.string().max(160).default(''),
    publisher: z.string().max(160).default(''),
    description: z.string().max(4000).default(''),
    command: z.string().max(1000).default(''),
    githubUrl: z.string().max(1000).default(''),
    oauth: z.boolean().default(false),
    oauthProvider: z.string().max(160).optional(),
  });

type ConnectorItem = z.infer<typeof itemSchema>;

export interface InstalledConnector {
  slug: string;
  path: string;
  item: ConnectorItem;
  installedAt: string;
  files: string[];
}

const root = () =>
  resolve(process.env.AEGIS_CONNECTORS_DIR ?? join('data', 'connectors'));

const slugFor = (id: string) =>
  id
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'connector';

/** Split a shell-ish command into argv without executing anything. */
function argv(command: string): { command: string; args: string[] } {
  const parts = command.trim().match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  const clean = parts.map((part) => part.replace(/^['"]|['"]$/g, ''));
  const [bin = '', ...args] = clean;
  return { command: bin, args };
}

function connectorFiles(item: ConnectorItem) {
  const parsed = argv(item.command);
  const serverKey = slugFor(item.name);
  const manifest = {
    schema: 'aegis.connector/1',
    ...item,
    serverKey,
    createdAt: new Date().toISOString(),
  };
  const mcp = {
    mcpServers: {
      [serverKey]: {
        command: parsed.command || 'npx',
        args: parsed.args,
        ...(item.oauth ? { env: {} } : {}),
      },
    },
  };
  const readme = [
    `# ${item.name}`,
    '',
    item.description || 'A connector downloaded from the Aegis marketplace.',
    '',
    `- Kind: ${item.kind}`,
    `- Publisher: ${item.publisher || 'unknown'}`,
    `- Category: ${item.category || 'uncategorised'}`,
    item.githubUrl ? `- Source: ${item.githubUrl}` : '',
    item.oauth ? `- Auth: OAuth${item.oauthProvider ? ` (${item.oauthProvider})` : ''}` : '',
    '',
    '## Run it',
    '',
    '```sh',
    item.command || '# no command recorded for this item',
    '```',
    '',
    '## Use it in Aegis',
    '',
    'Open **Integrations → Connections & Sidecars**, add an MCP server, and',
    'paste the command above (or import `mcp.json`). Then enable the tools you',
    'want on the Agent. Tools that change something ask you in chat first.',
    '',
    'These files were generated locally. No package was downloaded or run by',
    'Aegis when you added this connector.',
    '',
  ]
    .filter((line) => line !== '')
    .join('\n');

  const files: Array<{ name: string; content: string }> = [
    { name: 'connector.json', content: `${JSON.stringify(manifest, null, 2)}\n` },
    { name: 'mcp.json', content: `${JSON.stringify(mcp, null, 2)}\n` },
    { name: 'README.md', content: `${readme}\n` },
  ];
  if (item.kind === 'skill') {
    files.push({
      name: 'SKILL.md',
      content: `# ${item.name}\n\n${item.description}\n\n## How to use\n\nAsk the Agent to use ${item.name}. The Agent will load this skill from the connector folder when the task matches it.\n`,
    });
  }
  return files;
}

async function installed(): Promise<InstalledConnector[]> {
  let entries;
  try {
    entries = await readdir(root(), { withFileTypes: true });
  } catch {
    return [];
  }
  const list: InstalledConnector[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = join(root(), entry.name);
    try {
      const manifest = JSON.parse(
        await readFile(join(dir, 'connector.json'), 'utf8'),
      ) as ConnectorItem & { createdAt?: string };
      const { createdAt, ...item } = manifest;
      const files = await readdir(dir);
      list.push({
        slug: entry.name,
        path: dir,
        item: item as ConnectorItem,
        installedAt: createdAt ?? '',
        files,
      });
    } catch {
      // A directory without a readable manifest is not an installed connector.
    }
  }
  return list.sort((a, b) => b.installedAt.localeCompare(a.installedAt));
}

export function marketplaceRoutes() {
  const app = new Hono();

  app.onError((error, c) =>
    c.json(
      {
        error:
          error instanceof z.ZodError
            ? (error.issues[0]?.message ?? 'Invalid connector.')
            : error.message,
      },
      400,
    ),
  );

  app.get('/installed', async (c) => c.json(await installed()));

  app.post('/installed', async (c) => {
    const item = itemSchema.parse(await c.req.json());
    const slug = slugFor(item.id || item.name);
    const dir = join(root(), slug);
    const files = connectorFiles(item);
    await mkdir(dir, { recursive: true });
    await Promise.all(
      files.map((file) => writeFile(join(dir, file.name), file.content, 'utf8')),
    );
    // Register the connector with the native harness so the AI can actually
    // reach it. The harness starts the server lazily; Aegis never runs an
    // install command from the marketplace by itself.
    let harness: 'registered' | 'folder' = 'folder';
    const parsed = argv(item.command);
    if (parsed.command && !item.oauth) {
      try {
        await upsertMcpServer(slug, {
          type: 'local',
          command: [parsed.command, ...parsed.args],
        });
        harness = 'registered';
      } catch {
        harness = 'folder';
      }
    }
    return c.json(
      {
        ok: true,
        slug,
        path: dir,
        item,
        files,
        harness,
      },
      201,
    );
  });

  app.delete('/installed/:slug', async (c) => {
    const slug = slugFor(c.req.param('slug'));
    if (!slug) return c.json({ error: 'Invalid connector.' }, 400);
    await rm(join(root(), slug), { recursive: true, force: true });
    await removeMcpServer(slug).catch(() => undefined);
    return c.json({ ok: true });
  });

  return app;
}
