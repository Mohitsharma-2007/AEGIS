import { Hono } from 'hono';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

/**
 * Aegis OAuth 2.0 client   authorization-code flow against well-known
 * providers. Credentials live only on the server (SQLite). The "Connect"
 * button in the Marketplace starts a real handshake: it opens the provider's
 * authorize URL, receives the redirect back on /api/oauth/callback, exchanges
 * the code for tokens, and stores them for the Aegis agent to use.
 */

export interface OAuthProviderDef {
  id: string;
  label: string;
  authorizeUrl: string;
  tokenUrl: string;
  scope: string;
  /** Extra query params for the authorize request, if any. */
  extra?: Record<string, string>;
}

export const OAUTH_PROVIDERS: OAuthProviderDef[] = [
  {
    id: 'google',
    label: 'Google',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'openid email profile',
  },
  {
    id: 'github',
    label: 'GitHub',
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scope: 'read:user repo',
  },
  {
    id: 'microsoft',
    label: 'Microsoft',
    authorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scope: 'offline_access User.Read Mail.Read',
  },
  {
    id: 'slack',
    label: 'Slack',
    authorizeUrl: 'https://slack.com/oauth/v2/authorize',
    tokenUrl: 'https://slack.com/api/oauth.v2.access',
    scope: 'channels:read chat:write',
  },
  {
    id: 'notion',
    label: 'Notion',
    authorizeUrl: 'https://api.notion.com/v1/oauth/authorize',
    tokenUrl: 'https://api.notion.com/v1/oauth/token',
    scope: '',
  },
  {
    id: 'cloudflare',
    label: 'Cloudflare',
    authorizeUrl: 'https://dash.cloudflare.com/oauth2/auth',
    tokenUrl: 'https://dash.cloudflare.com/oauth2/token',
    scope: '',
  },
];

type OAuthRow = {
  provider: string;
  clientId: string;
  clientSecret: string;
  scope: string;
  stateNonce: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: number | null;
  me: string | null;
  updatedAt: number;
};

export class OAuthStore {
  constructor(private db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS oauth_connections(
      provider TEXT PRIMARY KEY,
      clientId TEXT NOT NULL,
      clientSecret TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT '',
      stateNonce TEXT,
      accessToken TEXT,
      refreshToken TEXT,
      expiresAt INTEGER,
      me TEXT,
      updatedAt INTEGER NOT NULL)`);
  }

  row(provider: string): OAuthRow | undefined {
    const row = this.db
      .prepare('SELECT * FROM oauth_connections WHERE provider=?')
      .get(provider);
    if (!row) return undefined;
    return {
      provider: String(row.provider),
      clientId: String(row.clientId),
      clientSecret: String(row.clientSecret),
      scope: String(row.scope ?? ''),
      stateNonce: row.stateNonce === null ? null : String(row.stateNonce),
      accessToken: row.accessToken === null ? null : String(row.accessToken),
      refreshToken: row.refreshToken === null ? null : String(row.refreshToken),
      expiresAt: row.expiresAt === null ? null : Number(row.expiresAt),
      me: row.me === null ? null : String(row.me),
      updatedAt: Number(row.updatedAt),
    };
  }

  upsertCredentials(
    provider: string,
    clientId: string,
    clientSecret: string,
    scope: string,
  ) {
    this.db
      .prepare(
        `INSERT INTO oauth_connections (provider, clientId, clientSecret, scope, updatedAt)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(provider) DO UPDATE SET clientId=excluded.clientId,
           clientSecret=excluded.clientSecret, scope=excluded.scope, updatedAt=excluded.updatedAt`,
      )
      .run(provider, clientId, clientSecret, scope, Date.now());
    return this.row(provider)!;
  }

  setNonce(provider: string, nonce: string) {
    this.db
      .prepare('UPDATE oauth_connections SET stateNonce=? WHERE provider=?')
      .run(nonce, provider);
  }

  consumeNonce(provider: string): string | null {
    const row = this.row(provider);
    if (!row?.stateNonce) return null;
    this.db
      .prepare('UPDATE oauth_connections SET stateNonce=NULL WHERE provider=?')
      .run(provider);
    return row.stateNonce;
  }

  saveTokens(
    provider: string,
    tokens: { accessToken: string; refreshToken?: string; expiresIn?: number },
    me: string | null = null,
  ) {
    this.db
      .prepare(
        `UPDATE oauth_connections
         SET accessToken=?, refreshToken=?, expiresAt=?, me=?, updatedAt=?
         WHERE provider=?`,
      )
      .run(
        tokens.accessToken,
        tokens.refreshToken ?? null,
        tokens.expiresIn ? Date.now() + tokens.expiresIn * 1000 : null,
        me,
        Date.now(),
        provider,
      );
  }

  disconnect(provider: string) {
    this.db
      .prepare(
        `UPDATE oauth_connections
         SET accessToken=NULL, refreshToken=NULL, expiresAt=NULL, me=NULL, updatedAt=?
         WHERE provider=?`,
      )
      .run(Date.now(), provider);
  }

  list(): Array<{
    provider: string;
    label: string;
    configured: boolean;
    connected: boolean;
    me: string | null;
    expiresAt: number | null;
  }> {
    const defs = new Map(OAUTH_PROVIDERS.map((def) => [def.id, def]));
    const rows = this.db
      .prepare('SELECT * FROM oauth_connections ORDER BY provider')
      .all() as unknown as OAuthRow[];
    return rows.map((row) => {
      const def = defs.get(row.provider);
      return {
        provider: row.provider,
        label: def?.label ?? row.provider,
        configured: !!row.clientId && !!row.clientSecret,
        connected: !!row.accessToken,
        me: row.me,
        expiresAt: row.expiresAt,
      };
    });
  }
}

export function oauthRoutes(store: OAuthStore, origin: string) {
  const app = new Hono();
  const redirectUri = `${origin}/api/oauth/callback`;

  app.get('/providers', (c) => c.json({ providers: store.list() }));

  app.put('/credentials', async (c) => {
    const body = z
      .object({
        provider: z.string().min(1).max(40),
        clientId: z.string().trim().min(1).max(512),
        clientSecret: z.string().trim().min(1).max(1024),
        scope: z.string().trim().max(2048).optional(),
      })
      .strict()
      .parse(await c.req.json());
    const def = OAUTH_PROVIDERS.find((item) => item.id === body.provider);
    if (!def) throw new Error('Unknown OAuth provider.');
    store.upsertCredentials(
      body.provider,
      body.clientId,
      body.clientSecret,
      body.scope ?? def.scope,
    );
    return c.json({ ok: true, provider: body.provider });
  });

  app.post('/start', async (c) => {
    const body = z
      .object({ provider: z.string().min(1).max(40) })
      .strict()
      .parse(await c.req.json());
    const row = store.row(body.provider);
    if (!row || !row.clientId || !row.clientSecret)
      throw new Error('This provider has no credentials yet. Add them in Settings   OAuth.');
    const def = OAUTH_PROVIDERS.find((item) => item.id === body.provider);
    if (!def) throw new Error('Unknown OAuth provider.');
    const state = randomUUID();
    store.setNonce(body.provider, state);
    const params = new URLSearchParams({
      client_id: row.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: row.scope || def.scope,
      state: `${body.provider}:${state}`,
      ...def.extra,
    });
    return c.json({ url: `${def.authorizeUrl}?${params.toString()}` });
  });

  app.get('/callback', async (c) => {
    const provider = c.req.query('provider') ?? '';
    const code = c.req.query('code') ?? '';
    const state = c.req.query('state') ?? '';
    const expected = store.consumeNonce(provider);
    if (!expected || state !== `${provider}:${expected}`)
      return c.text('OAuth state mismatch. Start the connection again.', 400);
    if (!code) return c.text('OAuth authorization was cancelled or failed.', 400);
    const row = store.row(provider);
    if (!row) return c.text('OAuth provider is not configured.', 400);
    const def = OAUTH_PROVIDERS.find((item) => item.id === provider);
    if (!def) return c.text('Unknown OAuth provider.', 400);

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: row.clientId,
      client_secret: row.clientSecret,
    });
    const response = await fetch(def.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(20_000),
    });
    const data = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const accessToken = data.access_token;
    if (typeof accessToken !== 'string' || !accessToken)
      throw new Error(
        `Token exchange failed (${response.status}): ${String(data.error_description ?? data.error ?? 'unknown')}`,
      );
    store.saveTokens(
      provider,
      {
        accessToken,
        refreshToken:
          typeof data.refresh_token === 'string' ? data.refresh_token : undefined,
        expiresIn:
          typeof data.expires_in === 'number' ? data.expires_in : undefined,
      },
      null,
    );
    return c.redirect(`${origin}/#/connections?oauth=connected`);
  });

  app.post('/disconnect', async (c) => {
    const body = z
      .object({ provider: z.string().min(1).max(40) })
      .strict()
      .parse(await c.req.json());
    store.disconnect(body.provider);
    return c.json({ ok: true, provider: body.provider });
  });

  return app;
}
