import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { whatsappRoutes } from '../src/server/whatsapp-routes.js';

const originalFetch = globalThis.fetch;
const envBefore = {
  secret: process.env.WHATSAPP_SECRET,
  url: process.env.AEGIS_WHATSAPP_URL,
};

beforeEach(() => {
  process.env.WHATSAPP_SECRET = 'test-sidecar-secret';
  process.env.AEGIS_WHATSAPP_URL = 'http://127.0.0.1:4312';
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (envBefore.secret === undefined) delete process.env.WHATSAPP_SECRET;
  else process.env.WHATSAPP_SECRET = envBefore.secret;
  if (envBefore.url === undefined) delete process.env.AEGIS_WHATSAPP_URL;
  else process.env.AEGIS_WHATSAPP_URL = envBefore.url;
  vi.restoreAllMocks();
});

it('sends a media attachment to a WhatsApp group through the secret server proxy', async () => {
  const fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
    expect(new Headers(init?.headers).get('x-aegis-whatsapp-secret')).toBe('test-sidecar-secret');
    expect(JSON.parse(String(init?.body))).toMatchObject({ to: '12345@g.us', filename: 'photo.png' });
    return Response.json({ ok: true, mediaType: 'image' });
  });
  globalThis.fetch = fetch as typeof globalThis.fetch;
  const app = new Hono();
  app.route('/api', whatsappRoutes());

  const response = await app.request('/api/whatsapp/send-media', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      to: '12345@g.us', data: 'aGVsbG8=', mimetype: 'image/png',
      filename: 'photo.png', caption: 'test attachment',
    }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ ok: true, mediaType: 'image' });
  expect(fetch).toHaveBeenCalledOnce();
});

it('rejects unsupported media and oversized payloads before contacting the sidecar', async () => {
  const fetch = vi.fn();
  globalThis.fetch = fetch as typeof globalThis.fetch;
  const app = new Hono();
  app.route('/api', whatsappRoutes());

  const unsupported = await app.request('/api/whatsapp/send-media', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ to: '+15551234567', data: 'aGVsbG8=', mimetype: 'text/html' }),
  });
  expect(unsupported.status).toBe(400);
  const oversized = await app.request('/api/whatsapp/send-media', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ to: '+15551234567', data: 'x'.repeat(28_000_001), mimetype: 'image/png' }),
  });
  expect(oversized.status).toBe(413);
  expect(fetch).not.toHaveBeenCalled();
});
