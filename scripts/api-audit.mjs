// Aegis API surface audit.
//
// Exercises the real registered routes (derived from apps/host/src/server/*)
// against a running host and reports status, latency and payload size.
//
//   node scripts/api-audit.mjs            # read-only probes
//   node scripts/api-audit.mjs --write    # also create/update/delete round trips
const HOST = process.env.AEGIS_HOST || 'http://127.0.0.1:4310';
const WRITE = process.argv.includes('--write');
const results = [];

async function probe(name, method, path, body, timeoutMs = 8000, expectStatus) {
  const started = Date.now();
  const url = path.startsWith('http') ? path : `${HOST}${path}`;
  try {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    const expected = expectStatus === undefined ? res.ok : [].concat(expectStatus).includes(res.status);
    results.push({
      name,
      method,
      path,
      status: res.status,
      ok: expected,
      ms: Date.now() - started,
      bytes: text.length,
      note: text.slice(0, 110).replace(/\s+/g, ' '),
    });
    return { res, text };
  } catch (error) {
    const timedOut = error?.name === 'TimeoutError' || /timeout|abort/i.test(String(error?.message));
    results.push({
      name,
      method,
      path,
      status: timedOut ? 'OPEN' : 0,
      ok: timedOut, // a stream that stays open is the expected result
      ms: Date.now() - started,
      bytes: 0,
      note: timedOut ? 'stream open (timed out on purpose)' : String(error?.message || error),
    });
    return { res: null, text: '' };
  }
}

const ws = await (await fetch(`${HOST}/api/workspace`)).json();
const dot = ws.dots?.[0]?.id ?? '';
const space = ws.spaces?.[0]?.id ?? '';

/* ---------- core state & agents ---------- */
await probe('health', 'GET', '/api/health');
await probe('state', 'GET', '/api/state');
await probe('workspace', 'GET', '/api/workspace');
await probe('providers', 'GET', '/api/providers');
await probe('provider models (local)', 'GET', '/api/providers/local/models');
await probe('env (redacted)', 'GET', '/api/env');
await probe('agents', 'GET', '/api/agents');
await probe('agent tasks', 'GET', '/api/agents/tasks');
await probe('widgets', 'GET', '/api/widgets');
await probe('harness status', 'GET', '/api/harness/status');
await probe('harness plugins', 'GET', '/api/harness/plugins');
await probe('harness sessions', 'GET', '/api/harness/sessions');
await probe('harness daemon-activity', 'GET', '/api/harness/daemon-activity');
await probe('harness daemon-mcp', 'GET', '/api/harness/daemon-mcp');

/* ---------- memory engine ---------- */
await probe('personal memories', 'GET', '/api/memories');
await probe('memory health', 'GET', '/api/memory/health');
await probe('memory documents', 'GET', '/api/memory/documents');
await probe('memory search', 'GET', '/api/memory/search?q=notch');
await probe('aegis memory state', 'GET', '/api/aegis-memory/state');
await probe('aegis memory tree', 'GET', '/api/aegis-memory/tree');
await probe('aegis memory graph', 'GET', '/api/aegis-memory/graph');
await probe('aegis memory captures', 'GET', '/api/aegis-memory/captures?limit=5');
await probe('aegis memory search', 'GET', '/api/aegis-memory/search?q=notch');
await probe('aegis tree address', 'GET', '/api/aegis-memory/tree/address');

/* ---------- capability layer (hooks / sandbox / shortcuts) ---------- */
await probe('hooks', 'GET', '/api/hooks');
await probe('hooks audit', 'GET', '/api/hooks/audit');
await probe('sandbox', 'GET', '/api/sandbox');
await probe('shortcuts', 'GET', '/api/shortcuts');
await probe('shortcuts audit', 'GET', '/api/shortcuts/audit');

/* ---------- computer / browser ---------- */
await probe('computer status', 'GET', `/api/dots/${dot}/computer`);
await probe('computer action kinds', 'GET', '/api/computer/action-kinds');
await probe('dot connections', 'GET', `/api/dots/${dot}/connections`);
await probe('annotation stream (no session)', 'GET', '/api/computer/desktop/annotations/stream', undefined, 2500);

/* ---------- voice ---------- */
await probe('voice pipeline', 'GET', '/api/voice/pipeline');
await probe('voice windows', 'GET', '/api/voice/windows');
await probe('voice windows commands', 'GET', '/api/voice/windows/commands');
await probe('voice service health', 'GET', 'http://127.0.0.1:8766/health');

/* ---------- keyless free APIs (onboarding) ---------- */
await probe('free api weather', 'GET', '/api/weather?lat=28.61&lon=77.20');
await probe('free api weather place', 'GET', '/api/weather/place?name=Delhi');
await probe('free api geo cities', 'GET', '/api/geo/cities?country=IN&state=Delhi');
await probe('free api geo countries', 'GET', '/api/geo/countries');
await probe('free api geo states (iso2)', 'GET', '/api/geo/states?country=IN');
await probe('free api geo states (name)', 'GET', '/api/geo/states?country=India');
await probe('free api geo reverse', 'GET', '/api/geo/reverse?lat=28.61&lon=77.20');
await probe('free api air quality', 'GET', '/api/air?lat=28.61&lon=77.20');
await probe('free api holidays', 'GET', '/api/holidays?country=IN');
await probe('free api finance rates', 'GET', '/api/finance/rates?base=USD');
await probe('free api crypto', 'GET', '/api/finance/crypto');
await probe('free api knowledge summary', 'GET', '/api/knowledge/summary?title=Artificial%20intelligence');
await probe('research finance (symbol)', 'GET', '/api/research/finance?symbol=AAPL');
await probe('research finance (missing symbol)', 'GET', '/api/research/finance?q=markets', undefined, 8000, 400);

/* ---------- channels & misc ---------- */
await probe('whatsapp status', 'GET', '/api/whatsapp/status');
await probe('whatsapp messages', 'GET', '/api/whatsapp/messages?limit=5');
await probe('oauth providers', 'GET', '/api/oauth/providers');
await probe('research news', 'GET', '/api/research/news?q=ai');
await probe('spaces pages', 'GET', `/api/spaces/${space}/pages`);
await probe('files surface', 'GET', '/api/files/surface');

if (WRITE) {
  const docRes = await probe('memory document create', 'POST', '/api/memory/documents', {
    title: `audit-${Date.now()}`,
    content: '# Audit round trip\nCreated by scripts/api-audit.mjs.',
    tags: ['audit'],
  });
  const doc = docRes.text ? JSON.parse(docRes.text) : null;
  if (doc?.id) {
    await probe('memory document get', 'GET', `/api/memory/documents/${doc.id}`);
    await probe('memory document update', 'PATCH', `/api/memory/documents/${doc.id}`, {
      content: '# Audit round trip\nUpdated.',
    });
    await probe('memory document reindex', 'POST', `/api/memory/documents/${doc.id}/reindex`);
    await probe('memory document delete', 'DELETE', `/api/memory/documents/${doc.id}`);
  }
  const hookRes = await probe('hook create', 'POST', '/api/hooks', {
    name: `audit-hook-${Date.now()}`,
    event: 'run_end',
    command: 'echo aegis-audit-hook',
    timeoutMs: 5000,
  });
  const hook = hookRes.text ? JSON.parse(hookRes.text) : null;
  if (hook?.id) await probe('hook delete', 'DELETE', `/api/hooks/${hook.id}`);
  const scRes = await probe('shortcut create', 'POST', '/api/shortcuts', {
    name: `audit-${Date.now()}`,
    type: 'url',
    target: 'https://example.com',
  });
  const sc = scRes.text ? JSON.parse(scRes.text) : null;
  if (sc?.id) await probe('shortcut delete', 'DELETE', `/api/shortcuts/${sc.id}`);
  await probe('sandbox patch (read-only policy)', 'PATCH', '/api/sandbox', { mode: 'workspace' });
}

for (const r of results) {
  console.log(
    `${r.ok ? 'PASS' : 'FAIL'} ${String(r.status).padEnd(3)} ${r.method.padEnd(6)} ${r.path.padEnd(52)} ${String(r.ms).padStart(5)}ms ${String(r.bytes).padStart(7)}b  ${r.note.slice(0, 80)}`,
  );
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} endpoints passed; ${failed.length} failed`);
if (failed.length) {
  console.log('FAILED:');
  for (const f of failed) console.log(`  ${f.method} ${f.path} -> ${f.status} ${f.note.slice(0, 70)}`);
}
