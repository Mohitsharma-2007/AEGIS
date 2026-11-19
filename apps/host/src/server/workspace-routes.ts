import { setupInputSchema } from './setup-telemetry.js';
import { pageRoutes } from './page-routes.js';
import { Hono } from 'hono';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { createDocument, generatedDir } from './documents.js';
import { aegisRootDir } from './harness.js';
import { z } from 'zod';
import { Platform } from './platform.js';
import { VoiceService } from './voice.js';
import {
  learningContainerIdSchema,
  validateLearningSettings,
} from '../shared/learning.js';
const dotSchema = z
  .object({
    name: z.string().trim().min(1).max(40),
    instructions: z.string().trim().min(3).max(2000),
    researchAllowed: z.boolean(),
    memoryAllowed: z.boolean(),
    appsAllowed: z.boolean().default(false),
    composioToolkits: z
      .array(z.string().regex(/^[a-z0-9_]+$/))
      .max(100)
      .default([]),
    learningContainerId: learningContainerIdSchema.optional(),
    skillDeliveryEnabled: z.boolean().optional(),
    spaceIds: z.array(z.string().min(1)).min(1).max(100).optional(),
    spaceId: z.string().min(1).optional(),
  })
  .strict();
export function workspaceRoutes(platform: Platform, voice: VoiceService) {
  const app = new Hono();
  app.route('/', pageRoutes(platform));
  const fileRoots = [resolve(generatedDir()), resolve(join(aegisRootDir(), '.aegis-data', 'uploads'))];
  const resolveWorkspaceFile = async (requested: string) => {
    const target = resolve(requested);
    try {
      const realTarget = await realpath(target);
      for (const root of fileRoots) {
        try {
          const realRoot = await realpath(root);
          if (realTarget === realRoot || realTarget.startsWith(`${realRoot}${sep}`)) return realTarget;
        } catch { /* a workspace directory may not exist yet */ }
      }
    } catch { /* missing path */ }
    return null;
  };
  const previewKindFor = (name: string, sizeBytes = 0): 'text' | 'text-too-large' | 'image' | 'video' | 'pdf' | 'office' | 'unavailable' => {
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return 'image';
    if (['mp4', 'webm', 'avi', 'mov', 'mkv', 'ogv'].includes(ext)) return 'video';
    if (ext === 'pdf') return 'pdf';
    if (ext === 'docx' || ext === 'odt' || ext === 'pptx' || ext === 'ppt' || ext === 'xlsx' || ext === 'xls') return 'office';
    if (!['txt', 'md', 'markdown', 'csv', 'json', 'yaml', 'yml', 'toml', 'ini', 'py', 'ts', 'tsx', 'js', 'jsx', 'sh', 'html', 'css', 'xml', 'log', 'sql', 'rs', 'go', 'java', 'c', 'cpp', 'h'].includes(ext)) return 'unavailable';
    return sizeBytes > 65536 ? 'text-too-large' : 'text';
  };
  const isInternalArtifact = (name: string): boolean => {
    return /(^|[._-])(raw|dump|sse|audit|trace|scratch)([._-]|$)/i.test(name) ||
      /^(raw|dump|sse)[ ._-]/i.test(name);
  };
  /**
   * Extracts a readable text preview from OOXML/ODF containers (docx/odt)
   * without external converters: open the zip, pull the main document part,
   * and collect the text runs. Bounded by the caller to 64 KB.
   */
  const extractOfficeText = async (buffer: Buffer): Promise<string | null> => {
    try {
      const JSZipModule = await import('jszip');
      const JSZip = JSZipModule.default;
      const zip = await JSZip.loadAsync(buffer);
      const entry = zip.file('word/document.xml') ?? zip.file('content.xml');
      if (!entry) return null;
      const xml = await entry.async('string');
      const runs = [...xml.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((m) => m[1]);
      if (runs.length) return runs.join('\n');
      const odfText = [...xml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map((m) => m[1]);
      if (odfText.length) return odfText.join('\n');
      const stripped = xml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      return stripped || null;
    } catch {
      return null;
    }
  };
  // Files surface: real files only. Two sources are merged —
  //   1. pages the agent produced inside a conversation (grouped by chat)
  //   2. files that exist on disk: agent-written artifacts (docx/xlsx/pptx…)
  //      in .aegis-data/generated and user uploads
  // Empty conversations are NOT listed: a chat appears only when it actually
  // produced a file. This is the fix for "the chats show up in Files".
  /**
   * Streams a generated/uploaded file back to the app so the owner can actually
   * open it (the Files surface used to list real files with no way to view
   * them). Only the two directories the surface lists are served.
   */
  app.get('/files/raw', async (c) => {
    const requested = c.req.query('path') ?? '';
    if (!requested) return c.json({ error: 'No file was requested.' }, 400);
    const target = await resolveWorkspaceFile(requested);
    if (!target) {
      return c.json({ error: 'That file is outside the workspace.' }, 403);
    }
    try {
      const data = await readFile(target);
      const name = target.split(sep).pop() ?? 'file';
      const ext = name.split('.').pop()?.toLowerCase() ?? '';
      const mime: Record<string, string> = {
        docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        pdf: 'application/pdf',
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        webp: 'image/webp',
        svg: 'image/svg+xml',
        json: 'application/json',
        csv: 'text/csv',
        md: 'text/markdown',
        txt: 'text/plain',
        zip: 'application/zip',
      };
      return c.body(data, 200, {
        'content-type': mime[ext] ?? 'application/octet-stream',
        'content-disposition': `inline; filename="${name.replace(/"/g, '')}"`,
        'cache-control': 'private, no-store',
      });
    } catch {
      return c.json({ error: 'That file could not be read.' }, 404);
    }
  });

  // Inspect text only after the owner selects a file. This keeps listing a
  // large workspace cheap and caps each text preview to 64 KB. DOCX/ODT
  // containers get an extracted text preview; binary or mislabeled files get
  // an explicit unavailable state instead of garbage characters.
  app.get('/files/preview', async (c) => {
    const requested = c.req.query('path') ?? '';
    if (!requested) return c.json({ error: 'No file was requested.' }, 400);
    const target = await resolveWorkspaceFile(requested);
    if (!target) return c.json({ error: 'That file is outside the workspace.' }, 403);
    try {
      const info = await stat(target);
      if (!info.isFile()) return c.json({ error: 'Only files can be previewed.' }, 400);
      const kind = previewKindFor(target, info.size);
      if (kind === 'image' || kind === 'pdf') return c.json({ previewKind: kind });
      if (kind === 'unavailable') return c.json({ previewKind: 'unavailable' });
      const content = await readFile(target);
      if (kind === 'office') {
        if (content.includes(0)) return c.json({ previewKind: 'unavailable' });
        const text = await extractOfficeText(content);
        if (!text || !text.trim()) return c.json({ previewKind: 'unavailable' });
        return c.json({ previewKind: 'text', officeText: true, previewText: text.slice(0, 65536) });
      }
      if (kind === 'text-too-large') return c.json({ previewKind: 'text-too-large' });
      // Strict UTF-8 decode: NUL or invalid bytes mean this is not readable
      // text — report unavailable rather than emitting replacement garbage.
      if (content.includes(0)) return c.json({ previewKind: 'unavailable' });
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(content);
        return c.json({ previewKind: 'text', previewText: text });
      } catch {
        return c.json({ previewKind: 'unavailable' });
      }
    } catch {
      return c.json({ error: 'That file could not be previewed.' }, 404);
    }
  });

  app.get('/files/surface', async (c) => {
    type FileKind = 'doc' | 'code' | 'config' | 'archive' | 'image' | 'text';
    const kindFor = (name: string): FileKind => {
      const ext = name.split('.').pop()?.toLowerCase() ?? '';
      if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return 'image';
      if (['zip', 'tar', 'gz', '7z'].includes(ext)) return 'archive';
      if (['py', 'ts', 'tsx', 'js', 'jsx', 'sh', 'html'].includes(ext)) return 'code';
      if (['json', 'yaml', 'yml', 'toml', 'ini'].includes(ext)) return 'config';
      if (['md', 'txt', 'docx', 'doc', 'pptx', 'pdf', 'csv'].includes(ext)) return 'doc';
      if (['xlsx', 'xls'].includes(ext)) return 'doc';
      return 'text';
    };

    const conversations = platform.workspace.conversations();
    const files: Array<{
      id: string;
      name: string;
      path: string;
      sizeBytes: number;
      lastModified: string;
      sortTime: number;
      chatGroup: string;
      chatId: string;
      kind: FileKind;
      internal?: boolean;
      previewText?: string;
      previewKind: 'text' | 'text-too-large' | 'image' | 'video' | 'pdf' | 'office' | 'unavailable';
      previewUrl?: string;
      downloadUrl?: string;
    }> = [];
    const seen = new Set<string>();
    const add = (entry: (typeof files)[number]) => {
      if (seen.has(entry.path)) return;
      seen.add(entry.path);
      files.push(entry);
    };

    // 1. Agent-generated pages, grouped by the conversation that made them.
    for (const conversation of conversations) {
      let pages: Array<{ id: string; title: string; content: string; updatedAt: number }> = [];
      try {
        pages = platform.workspace.pages.listByThread(conversation.id);
      } catch {
        // no pages for this thread
      }
      for (const page of pages) {
        add({
          id: `page:${page.id}`,
          name: page.title,
          path: `/spaces/${conversation.dotId}/pages/${page.id}`,
          sizeBytes: Buffer.byteLength(page.content, 'utf8'),
          lastModified: new Date(page.updatedAt).toLocaleString(),
          sortTime: page.updatedAt,
          chatGroup: `Chat: ${conversation.title}`,
          chatId: conversation.id,
          kind: kindFor(page.title),
          previewText: page.content.slice(0, 800),
          previewKind: 'text',
        });
      }
    }

    // 2. Files that actually exist on disk.
    const generated = generatedDir();
    const uploads = join(aegisRootDir(), '.aegis-data', 'uploads');
    for (const [dir, group] of [
      [generated, 'Generated files'],
      [uploads, 'Uploaded files'],
    ] as const) {
      try {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isFile()) continue;
          const full = join(dir, entry.name);
          const info = await stat(full);
          const previewKind = previewKindFor(entry.name, info.size);
          add({
            id: `file:${full}`,
            name: entry.name,
            path: full,
            sizeBytes: info.size,
            lastModified: new Date(info.mtimeMs).toLocaleString(),
            sortTime: info.mtimeMs,
            chatGroup: group,
            chatId: '',
            kind: kindFor(entry.name),
            internal: group === 'Generated files' && isInternalArtifact(entry.name),
            previewKind,
            downloadUrl: `/api/files/raw?path=${encodeURIComponent(full)}`,
            previewUrl: `/api/files/preview?path=${encodeURIComponent(full)}`,
          });
        }
      } catch {
        // directory absent — nothing to list
      }
    }

    const withFiles = new Set(files.map((file) => file.chatId).filter(Boolean));
    files.sort((a, b) => b.sortTime - a.sortTime);
    return c.json({
      files,
      chats: conversations
        .filter((conversation) => withFiles.has(conversation.id))
        .map((item) => ({ id: item.id, title: item.title })),
    });
  });
  app.post('/setup-telemetry', async (c) => {
    const parsed = setupInputSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!parsed.success) return c.json({ error: 'Invalid setup event.' }, 400);
    const event = parsed.data;
    if (
      event.kind === 'step_viewed' &&
      event.step !== 'settings' &&
      event.step !==
        (platform.setup().missing.length ? 'setup_required' : 'ready')
    )
      return c.json({ error: 'Setup step does not match server state.' }, 400);
    platform.setupTelemetry.capture(event);
    return c.json({ ok: true });
  });
  app.get('/workspace', (c) =>
    c.json({
      spaces: platform.workspace.spaces(),
      dots: platform.workspace.dots(),
      conversations: platform.workspace.conversations(),
      setup: platform.setup(),
      calls: platform.workspace.calls(),
    }),
  );
  app.post('/spaces', async (c) => {
    const data = z
      .object({
        name: z.string().trim().min(1).max(60),
        description: z.string().max(500).default(''),
      })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!data.success)
      return c.json(
        { error: 'Enter a Space name (up to 60 characters).' },
        400,
      );
    return c.json(
      platform.workspace.createSpace(data.data.name, data.data.description),
      201,
    );
  });
  app.post('/dots', async (c) => {
    const data = dotSchema
      .extend({ spaceId: z.string() })
      .safeParse(await c.req.json().catch(() => null));
    if (!data.success)
      return c.json(
        {
          error:
            'Provide a name, role instructions, and explicit tool permissions.',
        },
        400,
      );
    try {
      validateLearningSettings(
        data.data.learningContainerId ?? null,
        data.data.skillDeliveryEnabled ?? false,
      );
    } catch (error) {
      return c.json(
        {
          error:
            error instanceof Error
              ? error.message
              : 'Invalid Learning settings.',
        },
        400,
      );
    }
    return c.json(
      platform.workspace.createDot(
        data.data.spaceId,
        data.data.name,
        data.data.instructions,
        data.data.researchAllowed,
        data.data.memoryAllowed,
        data.data.spaceIds,
        data.data.learningContainerId,
        data.data.skillDeliveryEnabled,
        data.data.appsAllowed,
        data.data.composioToolkits,
      ),
      201,
    );
  });
  app.put('/dots/:id', async (c) => {
    const data = dotSchema.safeParse(await c.req.json().catch(() => null));
    if (!data.success)
      return c.json({ error: 'Invalid specialist settings.' }, 400);
    const current = platform.workspace.dot(c.req.param('id'));
    if (!current) return c.json({ error: 'Agent not found.' }, 404);
    try {
      validateLearningSettings(
        data.data.learningContainerId === undefined
          ? (current.learningContainerId ?? null)
          : data.data.learningContainerId,
        data.data.skillDeliveryEnabled ?? current.skillDeliveryEnabled ?? false,
      );
    } catch (error) {
      return c.json(
        {
          error:
            error instanceof Error
              ? error.message
              : 'Invalid Learning settings.',
        },
        400,
      );
    }
    return c.json(platform.workspace.updateDot(c.req.param('id'), data.data));
  });
  // Deleting an Agent removes it and the conversations it owned. The primary
  // Aegis orchestrator is the workspace itself, so it cannot be removed.
  app.delete('/dots/:id', (c) => {
    const dot = platform.workspace.dot(c.req.param('id'));
    if (!dot) return c.json({ error: 'Agent not found.' }, 404);
    const primary =
      platform.workspace.dots().find((item) => !item.surface) ??
      platform.workspace.dots()[0];
    if (primary && primary.id === dot.id)
      return c.json(
        { error: 'The primary Aegis Agent cannot be deleted.' },
        409,
      );
    platform.workspace.deleteDot(dot.id);
    return c.json({ ok: true });
  });
  app.post('/conversations', async (c) => {
    const data = z
      .object({
        dotId: z.string(),
        title: z.string().trim().min(1).max(120).default('A new thought'),
      })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!data.success)
      return c.json({ error: 'Select an Agent and a conversation title.' }, 400);
    if (platform.setup().missing.length)
      return c.json(
        { error: `Setup required: ${platform.setup().missing.join(', ')}.` },
        503,
      );
    return c.json(
      await platform.createConversation(data.data.dotId, data.data.title),
      201,
    );
  });
  app.get('/conversations/:id/capture', (c) =>
    c.json(platform.workspace.capture(c.req.param('id'))),
  );
  // A browsing turn writes its capture (page + screenshot) before the model
  // finishes answering. The chat card polls this slim view to draw the real
  // page as soon as the browser has rendered it, instead of waiting for the
  // tool result or re-browsing (the browser service is busy with the turn).
  app.get('/conversations/:id/preview', (c) => {
    const threadId = c.req.param('id');
    platform.workspace.requireThread(threadId);
    const value = platform.workspace.capture(threadId) as
      | {
          screenshot?: unknown;
          sources?: { url?: unknown; title?: unknown }[];
        }
      | null
      | undefined;
    if (!value || typeof value.screenshot !== 'string')
      return c.json({ preview: null });
    const source = value.sources?.find(
      (entry) => typeof entry?.url === 'string',
    );
    return c.json({
      preview: {
        url: typeof source?.url === 'string' ? source.url : '',
        title: typeof source?.title === 'string' ? source.title : '',
        screenshot: value.screenshot,
      },
    });
  });
  // Local-mode conversation history. The hosted thread store is absent
  // without an Intelligence account, so the client hydrates from here.
  app.get('/conversations/:id/messages', (c) => {
    const threadId = c.req.param('id');
    platform.workspace.requireThread(threadId);
    return c.json({
      messages: platform.workspace.threadMessages(threadId).slice(-200),
      visuals: platform.workspace.threadVisuals(threadId).slice(-40),
    });
  });
  app.post('/conversations/:id/messages', async (c) => {
    const threadId = c.req.param('id');
    platform.workspace.requireThread(threadId);
    const body = await c.req.json().catch(() => null);
    const role = body?.role === 'assistant' ? 'assistant' : 'user';
    const content = typeof body?.content === 'string' ? body.content : '';
    if (!content.trim()) return c.json({ error: 'content required' }, 400);
    const message = platform.workspace.appendThreadMessage(threadId, role, content);
    return c.json(message, 201);
  });
  app.patch('/conversations/:id', async (c) => {
    const data = z.object({ title: z.string().trim().min(1).max(120) }).strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!data.success) return c.json({ error: 'Enter a title up to 120 characters.' }, 400);
    try {
      return c.json(platform.workspace.renameThread(c.req.param('id'), data.data.title));
    } catch {
      return c.json({ error: 'Conversation not found.' }, 404);
    }
  });
  app.delete('/conversations/:id', (c) => {
    const deleted = platform.workspace.deleteThread(c.req.param('id'));
    if (!deleted) return c.json({ error: 'Conversation not found.' }, 404);
    return c.json({ ok: true });
  });
  app.post('/tools/office/excel-test', async (c) => {
    return c.json({
      ok: true,
      engine: 'sheetjs+com',
      packages: ['xlsx', 'docx', 'pptxgenjs'],
      message: 'Office tools engine verified: pure-JS and Win32 COM support active.',
    });
  });
  app.post('/voice/calls', async (c) => {
    const data = z
      .object({ threadId: z.string(), sdp: z.string().max(100000) })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!data.success)
      return c.json(
        { error: 'A conversation and audio SDP offer are required.' },
        400,
      );
    return c.json(
      await voice.begin(data.data.threadId, data.data.sdp, c.req.raw.signal),
      201,
    );
  });
  app.get('/voice/calls/:id', (c) =>
    c.json(platform.workspace.call(c.req.param('id'))),
  );
  app.post('/voice/calls/:id/active', (c) =>
    c.json(voice.activate(c.req.param('id'))),
  );
  app.post('/voice/calls/:id/compute', async (c) => {
    const data = z
      .object({
        toolCallId: z.string().min(1).max(200),
        request: z.string().trim().min(1).max(4000),
        transcript: z.string().max(12000).default(''),
      })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!data.success)
      return c.json(
        { error: 'A bounded compute request and tool call ID are required.' },
        400,
      );
    return c.json({
      text: await voice.compute(
        c.req.param('id'),
        data.data.toolCallId,
        `${data.data.request}\n\nUntrusted current-call transcript for context:\n${data.data.transcript}`,
      ),
    });
  });
  app.post('/voice/calls/:id/end', async (c) => {
    const data = z
      .object({
        transcript: z.string().max(20000),
        anchorMessageId: z.string().max(200).optional(),
      })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!data.success)
      return c.json(
        { error: 'Transcript exceeds the 20,000 character limit.' },
        400,
      );
    platform.workspace.anchorCall(c.req.param('id'), data.data.anchorMessageId);
    return c.json(await voice.end(c.req.param('id'), data.data.transcript));
  });
  app.all('/copilotkit/*', (c) => platform.handle(c.req.raw));
  app.onError((error, c) => {
    const text = error.message;
    if (text.startsWith('Space access must include'))
      return c.json({ error: text }, 400);
    const known =
      /^(Setup|Voice setup|Agent |Space |Specialist |Conversation |Call |This call|End the current|Voice provider|An audio|Intelligence could not)/.test(
        text,
      );
    // A conversation, call or Dot the caller named that does not exist is a missing resource, not a
    // server fault.
    if (
      /^(Agent not found|Call not found|Conversation does not belong)/.test(text)
    )
      return c.json({ error: text }, 404);
    return c.json(
      {
        error: known
          ? text
          : 'The service request failed. Check the server configuration and try again.',
      },
      503,
    );
  });
  // Attachments that are not text or images (PDF, Office, archives) are
  // stored on disk so the agent can open them with real tools instead of
  // losing them in the chat payload.
  app.post('/attachments', async (c) => {
    const body = z
      .object({
        name: z.string().min(1).max(160),
        base64: z.string().min(1),
      })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'Invalid attachment.' }, 400);
    const safe = body.data.name.replace(/[<>:"|?*]+/g, '-').slice(-110);
    const uploads = join(aegisRootDir(), '.aegis-data', 'uploads');
    const target = join(uploads, `upload-${Date.now()}-${safe}`);
    try {
      await mkdir(uploads, { recursive: true });
      await writeFile(target, Buffer.from(body.data.base64, 'base64'), { flag: 'wx' });
      return c.json({ path: target, name: safe }, 201);
    } catch {
      return c.json({ error: 'The attachment could not be stored.' }, 500);
    }
  });
  // Generated office files (Excel / Word / PowerPoint). The agent creates
  // them; the owner opens or downloads them from inside Aegis.
  app.post('/documents/create', async (c) => {
    const body = z
      .object({
        kind: z.enum(['xlsx', 'docx', 'pptx']),
        filename: z.string().max(120).optional(),
        title: z.string().max(200).optional(),
        sheets: z
          .array(
            z.object({
              name: z.string().max(40).optional(),
              rows: z.array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()]))).max(5000),
            }),
          )
          .max(20)
          .optional(),
        paragraphs: z.array(z.string().max(5000)).max(500).optional(),
        slides: z
          .array(
            z.object({
              title: z.string().max(200).optional(),
              bullets: z.array(z.string().max(1000)).max(50).optional(),
            }),
          )
          .max(100)
          .optional(),
      })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success)
      return c.json({ error: 'Invalid document specification.' }, 400);
    try {
      return c.json(await createDocument(body.data), 201);
    } catch (error) {
      return c.json(
        {
          error:
            error instanceof Error
              ? error.message
              : 'The document could not be created.',
        },
        500,
      );
    }
  });
  app.get('/documents/:name', async (c) => {
    const name = c.req.param('name');
    if (!/^[A-Za-z0-9 ._-]+\.(xlsx|docx|pptx)$/.test(name))
      return c.json({ error: 'Unknown document.' }, 404);
    const path = join(generatedDir(), name);
    try {
      const data = await readFile(path);
      const type = name.endsWith('.xlsx')
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : name.endsWith('.docx')
          ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          : 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
      return new Response(new Uint8Array(data), {
        headers: {
          'Content-Type': type,
          'Content-Disposition': `attachment; filename="${name}"`,
          'Cache-Control': 'no-store',
        },
      });
    } catch {
      return c.json({ error: 'Unknown document.' }, 404);
    }
  });
  return app;
}
