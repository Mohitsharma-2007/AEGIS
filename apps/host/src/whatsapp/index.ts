import { serve } from '@hono/node-server';
import { Socket } from 'node:net';
import { Hono } from 'hono';
import { timingSafeEqual } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import QRCode from 'qrcode';

// AEGIS (W-FIX 3d): WhatsApp sidecar   WhatsApp Web-style QR pairing
// via Baileys (@whiskeysockets/baileys), no browser download needed.
//
// The sidecar owns the protocol session ONLY. Auth state persists in
// the gitignored .aegis-data/whatsapp-auth directory so pairing
// survives restarts. All callers (the host server for the Connections
// UI, the Python daemon for whatsapp.* tools) go through this
// localhost HTTP API with the shared secret the start scripts
// generate into .aegis-data/whatsapp-secret   the secret never
// reaches the browser; the host proxies status/start for the UI.
//
// Status is honest by construction: state is exactly what Baileys
// reports (disconnected / qr / connecting / connected), plus the last
// disconnect reason when there is one. If WhatsApp's servers are
// unreachable, connection.update surfaces the failure here instead of
// a fake "connected".

type WaState = 'disconnected' | 'qr' | 'connecting' | 'connected';

interface CachedMessage {
  id: string;
  chat: string;
  fromMe: boolean;
  sender: string;
  text: string;
  ts: number;
}

const PORT = Number(process.env.WHATSAPP_PORT ?? 4312);
const HOST = process.env.WHATSAPP_HOST ?? '127.0.0.1';
const SECRET = process.env.WHATSAPP_SECRET ?? '';
const AUTH_DIR =
  process.env.WHATSAPP_AUTH_DIR ??
  resolve(dirname(fileURLToPath(import.meta.url)), '../../../.aegis-data/whatsapp-auth');
// Conversations survive a sidecar restart. The in-memory cache alone made an
// already-paired session look empty after every host restart, which is what
// `whatsapp_read` reported. The file sits next to the auth directory and is
// written atomically so a crash cannot leave a truncated cache behind.
const MESSAGES_FILE =
  process.env.WHATSAPP_MESSAGES_FILE?.trim() ||
  join(dirname(AUTH_DIR), 'whatsapp-messages.json');

let state: WaState = 'disconnected';
let qrDataUrl: string | null = null;
let qrRaw: string | null = null;
let me: { id: string; name?: string } | null = null;
let detail: string | null = null;
let socket: Awaited<ReturnType<typeof createSocket>> | null = null;
let starting = false;
let reconnectAttempts = 0;
const messages: CachedMessage[] = [];
const MAX_MESSAGES = 300;

/** Restore the persisted conversation cache (ignores a corrupt file). */
function loadCachedMessages() {
  if (!existsSync(MESSAGES_FILE)) return;
  try {
    const parsed = JSON.parse(readFileSync(MESSAGES_FILE, 'utf8')) as unknown;
    if (!Array.isArray(parsed)) return;
    for (const item of parsed.slice(-MAX_MESSAGES)) {
      const message = item as Partial<CachedMessage>;
      if (
        typeof message?.id !== 'string' ||
        typeof message?.chat !== 'string' ||
        typeof message?.text !== 'string'
      )
        continue;
      messages.push({
        id: message.id,
        chat: message.chat,
        fromMe: message.fromMe === true,
        sender: typeof message.sender === 'string' ? message.sender : '',
        text: message.text,
        ts: Number(message.ts) || 0,
      });
    }
  } catch {
    // A damaged cache is not fatal; new traffic repopulates it.
  }
}

let persistTimer: NodeJS.Timeout | null = null;
/** Debounced atomic write, so a burst of history does not thrash the disk. */
function persistMessages() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      mkdirSync(dirname(MESSAGES_FILE), { recursive: true });
      const temporary = `${MESSAGES_FILE}.tmp`;
      writeFileSync(temporary, JSON.stringify(messages), 'utf8');
      renameSync(temporary, MESSAGES_FILE);
    } catch {
      // Conversation persistence must never break the protocol session.
    }
  }, 500);
  persistTimer.unref?.();
}

loadCachedMessages();

async function createSocket() {
  const baileys = await import('@whiskeysockets/baileys');
  const makeWASocket = baileys.default;
  const { state: authState, saveCreds } = await baileys.useMultiFileAuthState(AUTH_DIR);
  const sock = makeWASocket({
    auth: authState,
    markOnlineOnConnect: false,
    // Load the existing conversations too, so the Chats list is populated on
    // first connect instead of waiting for a brand-new message to arrive.
    syncFullHistory: true,
  });
  const cacheMessage = (message: {
    key?: { id?: string | null; remoteJid?: string | null; fromMe?: boolean | null; participant?: string | null };
    pushName?: string | null;
    messageTimestamp?: unknown;
    message?: {
      conversation?: string | null;
      extendedTextMessage?: { text?: string | null } | null;
      imageMessage?: { caption?: string | null } | null;
      videoMessage?: { caption?: string | null } | null;
    } | null;
  }) => {
    const body = message.message;
    const text =
      body?.conversation ??
      body?.extendedTextMessage?.text ??
      body?.imageMessage?.caption ??
      body?.videoMessage?.caption ??
      '';
    if (!text) return;
    // Baileys timestamps are protobuf Longs; normalise to a plain number.
    const raw = message.messageTimestamp;
    const ts =
      raw && typeof raw === 'object' && typeof (raw as { toNumber?: () => number }).toNumber === 'function'
        ? (raw as { toNumber: () => number }).toNumber()
        : Number(raw ?? Date.now() / 1000);
    const id = message.key?.id ?? `${Date.now()}-${messages.length}`;
    // History sync and live upserts can replay the same message; one copy is
    // enough, and the id is what makes that safe.
    if (messages.some((existing) => existing.id === id)) return;
    messages.push({
      id,
      chat: message.key?.remoteJid ?? '',
      fromMe: !!message.key?.fromMe,
      sender: message.pushName ?? message.key?.participant ?? '',
      text,
      ts,
    });
    if (messages.length > MAX_MESSAGES) messages.splice(0, messages.length - MAX_MESSAGES);
    persistMessages();
  };
  sock.ev.on('creds.update', () => void saveCreds());
  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      state = 'qr';
      qrRaw = qr;
      void QRCode.toDataURL(qr, { margin: 1, width: 264 })
        .then((url) => {
          qrDataUrl = url;
        })
        .catch(() => {
          qrDataUrl = null;
        });
    }
    if (connection === 'connecting') state = 'connecting';
    if (connection === 'open') {
      reconnectAttempts = 0;
      state = 'connected';
      qrDataUrl = null;
      qrRaw = null;
      detail = null;
      const user = sock.user;
      me = user ? { id: user.id, name: user.name ?? undefined } : null;
    }
    if (connection === 'close') {
      const statusCode = (
        lastDisconnect?.error as { output?: { statusCode?: number } } | undefined
      )?.output?.statusCode;
      const loggedOut = statusCode === baileys.DisconnectReason.loggedOut;
      state = 'disconnected';
      detail = loggedOut
        ? 'Logged out on the phone   pair again.'
        : `Connection closed (${statusCode ?? 'unknown'}). Reconnecting is safe: call /start.`;
      if (!loggedOut) {
        // Baileys convention: reconnect on any close except logout  
        // but with backoff: an unreachable network (or a proxy that
        // breaks the TLS handshake) otherwise spins a hot reconnect
        // loop and floods the log.
        socket = null;
        reconnectAttempts += 1;
        const delay = Math.min(30_000, 2_000 * reconnectAttempts);
        setTimeout(() => void start().catch(() => {}), delay);
      }
    }
  });
  sock.ev.on('messages.upsert', (event) => {
    for (const message of event.messages) cacheMessage(message);
  });
  // History sync: the conversation backlog Baileys replays after pairing or a
  // reconnect. Caching it fills the Chats list without waiting for new traffic.
  sock.ev.on('messaging-history.set', (data) => {
    const historical = (data as { messages?: unknown[] }).messages ?? [];
    for (const message of historical) cacheMessage(message as Parameters<typeof cacheMessage>[0]);
  });
  return sock;
}

async function start() {
  if (socket || starting) return;
  starting = true;
  try {
    mkdirSync(AUTH_DIR, { recursive: true });
    state = existsSync(`${AUTH_DIR}/creds.json`) ? 'connecting' : 'qr';
    socket = await createSocket();
  } catch (error) {
    state = 'disconnected';
    detail = `WhatsApp protocol init failed: ${error instanceof Error ? error.message : String(error)}`;
    socket = null;
  } finally {
    starting = false;
  }
}

function statusPayload() {
  return {
    ok: true,
    state,
    qr: state === 'qr' ? qrRaw : null,
    qrDataUrl: state === 'qr' ? qrDataUrl : null,
    me,
    detail,
    paired: existsSync(`${AUTH_DIR}/creds.json`),
    cachedMessages: messages.length,
  };
}

// Set in the entry block; lets an authenticated request hand ownership of this
// sidecar to a newer host process (dev watch restarts) without a reconnect.
let adoptOwner: (pid: number) => void = () => {};

const app = new Hono();
app.use(async (c, next) => {
  if (c.req.path === '/health') return next();
  const provided = c.req.header('x-aegis-whatsapp-secret') ?? '';
  const a = Buffer.from(provided);
  const b = Buffer.from(SECRET);
  if (!SECRET || a.length !== b.length || !timingSafeEqual(a, b)) {
    return c.json({ ok: false, error: 'unauthorized' }, 401);
  }
  const ownerPidHeader = Number(c.req.header('x-aegis-owner-pid') ?? 0);
  if (ownerPidHeader > 0) adoptOwner(ownerPidHeader);
  return next();
});
app.get('/health', (c) =>
  c.json({ ok: true, service: 'aegis-whatsapp', pid: process.pid }),
);
app.get('/status', (c) => c.json(statusPayload()));
app.post('/start', async (c) => {
  await start();
  return c.json(statusPayload());
});
app.get('/messages', (c) => {
  const limit = Math.min(Number(c.req.query('limit') ?? 20) || 20, 100);
  const chat = c.req.query('chat') ?? '';
  const filtered = chat
    ? messages.filter(
        (message) =>
          message.chat === chat ||
          message.chat.includes(chat) ||
          message.sender.toLowerCase().includes(chat.toLowerCase()),
      )
    : messages;
  return c.json({ ok: true, messages: filtered.slice(-limit).reverse() });
});
app.post('/send', async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    to?: string;
    text?: string;
  } | null;
  if (!body?.to || !body?.text)
    return c.json({ ok: false, error: 'to and text are required' }, 400);
  if (state !== 'connected' || !socket)
    return c.json(
      { ok: false, error: `whatsapp_not_connected (state: ${state})` },
      409,
    );
  const jid = body.to.includes('@')
    ? body.to
    : `${body.to.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
  try {
    const sent = await socket.sendMessage(jid, { text: body.text });
    return c.json({ ok: true, id: sent?.key?.id ?? null, to: jid });
  } catch (error) {
    return c.json(
      {
        ok: false,
        error: `send_failed: ${error instanceof Error ? error.message : String(error)}`,
      },
      502,
    );
  }
});
app.post('/send-media', async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
    to?: string; data?: string; mimetype?: string; filename?: string; caption?: string;
  } | null;
  if (!body?.to || !body.data || !body.mimetype)
    return c.json({ ok: false, error: 'Recipient, file data, and media type are required.' }, 400);
  if (body.data.length > 28_000_000)
    return c.json({ ok: false, error: 'Attachments must be 20 MB or smaller.' }, 413);
  if (state !== 'connected' || !socket)
    return c.json({ ok: false, error: `whatsapp_not_connected (state: ${state})` }, 409);
  if (!/^(image|video|application)\/[\w.+-]+$/.test(body.mimetype))
    return c.json({ ok: false, error: 'Unsupported attachment type.' }, 400);
  const jid = body.to.includes('@')
    ? body.to
    : `${body.to.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
  try {
    const data = Buffer.from(body.data, 'base64');
    if (!data.length || data.length > 20 * 1024 * 1024)
      return c.json({ ok: false, error: 'Attachments must be between 1 byte and 20 MB.' }, 413);
    const filename = (body.filename || 'attachment').replace(/[\\/:*?"<>|\r\n]/g, '_').slice(0, 120);
    const kind = body.mimetype.split('/')[0];
    const message = kind === 'image'
      ? { image: data, mimetype: body.mimetype, caption: body.caption?.slice(0, 1000) }
      : kind === 'video'
        ? { video: data, mimetype: body.mimetype, caption: body.caption?.slice(0, 1000) }
        : { document: data, mimetype: body.mimetype, fileName: filename, caption: body.caption?.slice(0, 1000) };
    const sent = await socket.sendMessage(jid, message);
    return c.json({ ok: true, id: sent?.key?.id ?? null, to: jid, mediaType: kind });
  } catch (error) {
    return c.json({ ok: false, error: `send_failed: ${error instanceof Error ? error.message : String(error)}` }, 502);
  }
});
app.post('/logout', async (c) => {
  try {
    await socket?.logout();
  } catch {
    // A failed logout still drops the local socket below.
  }
  socket = null;
  state = 'disconnected';
  me = null;
  return c.json(statusPayload());
});

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  const server = serve({ fetch: app.fetch, port: PORT, hostname: HOST }, (info) => {
    console.log(`[aegis] whatsapp sidecar listening on http://${HOST}:${info.port}`);
  });
  // Ownership: the lazy host launch passes an extra pipe plus its own PID. If
  // that owner disappears (clean exit, crash, forced kill, test-worker
  // teardown) this sidecar must not keep the port, so it stops as soon as the
  // pipe closes, with a PID poll as the backstop.
  //
  // Dev watch: `node --watch` restarts the host on every file save. Killing and
  // respawning this sidecar on each restart would reconnect to WhatsApp every
  // time, so a non-zero WHATSAPP_OWNER_GRACE_MS keeps it alive briefly and lets
  // the new host adopt it (see adoptOwner below). Default 0: app runs and test
  // runs stop immediately, as they must.
  let stopping = false;
  let handoffTimer: NodeJS.Timeout | null = null;
  let ownerPid = Number(process.env.WHATSAPP_PARENT_PID ?? 0);
  const graceMs = Math.max(0, Number(process.env.WHATSAPP_OWNER_GRACE_MS ?? 0));

  const stop = (reason: string) => {
    if (stopping) return;
    stopping = true;
    if (handoffTimer) {
      clearTimeout(handoffTimer);
      handoffTimer = null;
    }
    console.log(`[aegis] whatsapp sidecar stopping (${reason})`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1_500).unref();
  };

  const ownerGone = (reason: string) => {
    if (stopping) return;
    if (graceMs <= 0) {
      stop(reason);
      return;
    }
    if (handoffTimer) return;
    console.log(
      `[aegis] whatsapp sidecar owner gone (${reason}); handoff window ${graceMs}ms`,
    );
    handoffTimer = setTimeout(
      () => stop(`no host adopted the sidecar within ${graceMs}ms`),
      graceMs,
    );
    handoffTimer.unref();
  };
  const ownerPipe = (() => {
    try {
      const stdio = (process as unknown as { stdio?: Array<NodeJS.EventEmitter | null> })
        .stdio;
      if (stdio?.[3]) return stdio[3];
    } catch {
      // process.stdio is not exposed on every Node version
    }
    try {
      // The host passes the owner pipe as an extra stdio fd.
      const socket = new Socket({ fd: 3, readable: true, writable: false });
      socket.unref();
      return socket as unknown as NodeJS.EventEmitter;
    } catch {
      return null;
    }
  })();
  if (ownerPipe) {
    ownerPipe.once('end', () => ownerGone('owner pipe closed'));
    ownerPipe.once('close', () => ownerGone('owner pipe closed'));
    ownerPipe.once('error', () => ownerGone('owner pipe closed'));
  }

  let ownerWatch: NodeJS.Timeout | null = null;
  const watchOwner = () => {
    if (ownerWatch) {
      clearInterval(ownerWatch);
      ownerWatch = null;
    }
    if (!Number.isInteger(ownerPid) || ownerPid <= 0) return;
    const watched = ownerPid;
    ownerWatch = setInterval(() => {
      let alive = true;
      try {
        process.kill(watched, 0);
      } catch (error) {
        alive = (error as NodeJS.ErrnoException).code === 'EPERM';
      }
      if (alive) return;
      if (ownerWatch) {
        clearInterval(ownerWatch);
        ownerWatch = null;
      }
      ownerGone('owning host process exited');
    }, 1_000);
    ownerWatch.unref();
  };

  adoptOwner = (pid: number) => {
    if (!Number.isInteger(pid) || pid <= 0) return;
    if (pid === ownerPid && !handoffTimer) return;
    const previous = ownerPid;
    ownerPid = pid;
    if (handoffTimer) {
      clearTimeout(handoffTimer);
      handoffTimer = null;
    }
    console.log(
      `[aegis] whatsapp sidecar adopted by host pid ${pid}` +
        (previous && previous !== pid ? ` (was ${previous})` : ''),
    );
    watchOwner();
  };

  watchOwner();
  // Restore a paired session (or become QR-ready) without waiting for
  // the first UI poll. WHATSAPP_AUTO_CONNECT=0 keeps the HTTP surface up with
  // no WhatsApp connection (headless tests, offline setups).
  if (process.env.WHATSAPP_AUTO_CONNECT !== '0') void start();
  else console.log('[aegis] whatsapp sidecar started without connecting (WHATSAPP_AUTO_CONNECT=0)');
}
