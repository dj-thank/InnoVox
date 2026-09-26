import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenAIProvider } from '../src/provider.js';
import { normalizeLine } from '../src/capture.js';
import { Store } from '../src/store.js';
import { seedDemo } from '../src/demo.js';
import { DomainError } from '../src/contracts.js';

const context = { projectId: 'p1', adapter: 'codex' as const, sessionId: 's1', epoch: 0 };
test('Codex collector extracts public message text with deterministic ids', () => {
  const raw = JSON.stringify({ type: 'response_item', timestamp: '2026-09-26T00:00:00Z',
    payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '共有できる発言' }] } });
  assert.equal(normalizeLine(raw, 1, context)[0]?.payload.text, '共有できる発言');
  assert.deepEqual(normalizeLine(raw, 1, context), normalizeLine(raw, 1, context));
  assert.deepEqual(normalizeLine(JSON.stringify({ type: 'response_item', payload: { type: 'reasoning', text: 'private' } }), 2, context), []);
});
test('Claude collector excludes reasoning and tool blocks and preserves Unicode', () => {
  const raw = JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [
    { type: 'thinking', thinking: 'hidden' }, { type: 'tool_use', input: { secret: 'private' } }, { type: 'text', text: '日本語の返答 🎙️' },
  ] } });
  const events = normalizeLine(raw, 1, { ...context, adapter: 'claude' });
  assert.equal(events[0]?.payload.text, '日本語の返答 🎙️');
  assert.equal(events[0]?.occurredAt, '1970-01-01T00:00:00.000Z');
});
test('collector detects session mismatches and sanitizes malformed records', () => {
  assert.throws(() => normalizeLine(JSON.stringify({ type: 'session_meta', payload: { id: 'other' } }), 1, context), /does not match/);
  assert.throws(() => normalizeLine('{"private":secret', 3, context), (e: unknown) =>
    e instanceof Error && e.message.includes('line 3') && !e.message.includes('secret'));
});
test('provider refuses missing credentials without a network call', async () => {
  let called = false;
  const provider = new OpenAIProvider(undefined, async () => { called = true; throw Error('must not run'); });
  const store = new Store(':memory:'); const p = seedDemo(store);
  try {
    await assert.rejects(provider.analyze(store.snapshot(p.id, 'synthetic', 'sample-session')), (e: unknown) => e instanceof DomainError && e.code === 'provider_not_configured');
    assert.equal(called, false);
  } finally { store.close(); }
});
test('Astra request keeps observations in data and validates structured output', async () => {
  const store = new Store(':memory:'); const p = seedDemo(store);
  let sent: Record<string, unknown> = {};
  const provider = new OpenAIProvider('synthetic-test-key', async (_url, options) => {
    sent = JSON.parse(String(options?.body)) as Record<string, unknown>;
    return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text',
      text: JSON.stringify({ proposal: null }) }] }] });
  });
  try {
    assert.equal(await provider.analyze(store.snapshot(p.id, 'synthetic', 'sample-session')), null);
    assert.equal(sent.model, 'gpt-6-astra'); assert.equal(sent.store, false);
    assert.ok(String(sent.instructions).includes('untrusted'));
  } finally { store.close(); }
});
test('provider errors never expose response bodies or credentials', async () => {
  const store = new Store(':memory:'); const p = seedDemo(store);
  const provider = new OpenAIProvider('synthetic-test-key', async () => new Response('private request with credential', { status: 401 }));
  try {
    await assert.rejects(provider.analyze(store.snapshot(p.id, 'synthetic', 'sample-session')), (e: unknown) =>
      e instanceof DomainError && e.code === 'provider_auth' && !e.message.includes('credential'));
  } finally { store.close(); }
});
test('Live adapter uses documented WebRTC session creation and strips extra response fields', async () => {
  const store = new Store(':memory:'); seedDemo(store);
  const provider = new OpenAIProvider('synthetic-test-key', async (url, options) => {
    assert.equal(String(url), 'https://api.openai.com/v1/live/sessions');
    const body = JSON.parse(String(options?.body)); assert.equal(body.session.model, 'gpt-live-1');
    assert.equal(body.session.delegation.type, 'client'); assert.equal(body.transport.type, 'webrtc');
    return Response.json({ session: { id: 'live_test', unexpected: 'private' }, transport: { type: 'webrtc', sdp: 'answer' }, secret: 'private' });
  });
  try {
    const result = await provider.createLive('offer', store.consultations()[0]!);
    assert.equal(result.transport.sdp, 'answer'); assert.ok(!JSON.stringify(result).includes('private'));
  } finally { store.close(); }
});
test('provider stops an oversized response before buffering an unbounded body', async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) { controller.enqueue(new Uint8Array(1_100_000)); },
    cancel() { cancelled = true; },
  });
  const provider = new OpenAIProvider('synthetic-test-key', async () => new Response(stream));
  const store = new Store(':memory:'); const p = seedDemo(store);
  try {
    await assert.rejects(provider.analyze(store.snapshot(p.id, 'synthetic', 'sample-session')), (e: unknown) =>
      e instanceof DomainError && e.code === 'provider_response');
    assert.equal(cancelled, true);
  } finally { store.close(); }
});
