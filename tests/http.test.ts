import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/store.js';
import { OpenAIProvider } from '../src/provider.js';
import { buildServer } from '../src/server.js';
import type { AddressInfo } from 'node:net';

test('HTTP slice: auth, explicit demo, persisted reply, rejection of cross-origin writes', async () => {
  const store = new Store(':memory:'); const token = 'synthetic-test-token-not-for-production';
  const { server } = buildServer({ store, token, origin: 'http://127.0.0.1:4317',
    root: fileURLToPath(new URL('../../', import.meta.url)), provider: new OpenAIProvider(undefined) });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  try {
    const page = await fetch(base + '/'); assert.equal(page.status, 200);
    assert.ok((await page.text()).includes('InnoVox'));
    for (const path of ['/app.js', '/voice.js', '/style.css']) assert.equal((await fetch(base + path)).status, 200);
    assert.equal((await fetch(base + '/api/state')).status, 401);
    assert.equal((await fetch(base + '/api/pairing', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
    const pairing = await (await fetch(base + '/api/pairing', { method: 'POST', headers, body: '{}' })).json();
    assert.equal((await fetch(base + '/api/pairing/exchange', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://foreign.example' },
      body: JSON.stringify({ code: pairing.code }) })).status, 403);
    const paired = await (await fetch(base + '/api/pairing/exchange', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: pairing.code }) })).json();
    const browserHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${paired.accessToken}` };
    assert.notEqual(paired.accessToken, token);
    assert.equal((await fetch(base + '/api/state', { headers: browserHeaders })).status, 200);
    assert.equal((await fetch(base + '/api/pairing', { method: 'POST', headers: browserHeaders, body: '{}' })).status, 403);
    assert.equal((await fetch(base + '/api/pairing/exchange', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: pairing.code }) })).status, 401);
    assert.equal((await fetch(base + '/api/logout', { method: 'POST', headers: browserHeaders, body: '{}' })).status, 200);
    assert.equal((await fetch(base + '/api/state', { headers: browserHeaders })).status, 401);
    assert.equal((await fetch(base + '/api/demo', { method: 'POST', headers: { ...headers, Origin: 'https://foreign.example' }, body: '{}' })).status, 403);
    const p = await (await fetch(base + '/api/demo', { method: 'POST', headers, body: '{}' })).json();
    const state = await (await fetch(base + '/api/state?projectId=' + p.id, { headers })).json();
    assert.equal(state.capabilities.providerConfigured, false); assert.equal(state.consultations.length, 1);
    const q = state.consultations[0];
    const answer = await fetch(base + '/api/consultations/' + q.id + '/answer', { method: 'POST', headers,
      body: JSON.stringify({ answerId: 'a1', text: '保持してください。', channel: 'typed', expectedVersion: q.version }) });
    assert.equal(answer.status, 200); assert.equal((await answer.json()).delivery.status, 'queued');
    const analysis = await fetch(base + '/api/analyze', { method: 'POST', headers,
      body: JSON.stringify({ projectId: p.id, adapter: 'synthetic', sessionId: 'sample-session' }) });
    assert.equal(analysis.status, 503);
    assert.equal((await fetch(base + '/api/projects', { method: 'POST', headers, body: '{' })).status, 400);
    const journal = await (await fetch(base + '/api/journal?after=0', { headers })).json();
    assert.ok(journal.events.some((e: { kind: string }) => e.kind === 'consultation.answered'));
  } finally { server.close(); server.closeAllConnections(); await once(server, 'close'); store.close(); }
});
