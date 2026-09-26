import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Store } from '../src/store.js';
import { normalizeLine } from '../src/capture.js';
import { seedDemo } from '../src/demo.js';

test('only a matching known in-flight delivery is treated as an InnoVox echo', () => {
  const store = new Store(':memory:'); const p = seedDemo(store), q = store.consultations(p.id)[0]!;
  try {
    // Synthetic source uses the same envelope contract as a native capture.
    const d = store.answer(q.id, { answerId: 'a', text: 'Keep offline.', expectedVersion: 1, channel: 'typed' }).delivery;
    store.claimDelivery(d.id);
    const before = store.snapshot(p.id, 'synthetic', 'sample-session').fingerprint;
    const digest = createHash('sha256').update(d.text).digest('hex');
    const event = { schemaVersion: 1, eventId: 'echo', projectId: p.id,
      source: { adapter: 'synthetic', sessionId: 'sample-session', epoch: 0 }, sequence: 1,
      occurredAt: '2026-09-26T00:00:00Z', kind: 'message', origin: 'innovox',
      payload: { role: 'user', text: `[innovox-delivery:${d.id}:${digest}]\n${d.text}`, relay: { deliveryId: d.id, digest } } };
    assert.equal(store.ingest(event).event.origin, 'innovox');
    assert.equal(store.deliveries()[0]?.status, 'delivered');
    assert.equal(store.snapshot(p.id, 'synthetic', 'sample-session').fingerprint, before);
    assert.equal(store.ingest(event).duplicate, true);
    assert.equal(store.receipt(d.id, 'unknown', 'late timeout').status, 'delivered');
    const foreign = { ...event, eventId: 'foreign', sequence: 2, payload: { role: 'user', text: 'This is a real human message.' } };
    assert.equal(store.ingest(foreign).event.origin, 'human');
    assert.notEqual(store.snapshot(p.id, 'synthetic', 'sample-session').fingerprint, before);
    assert.equal(store.ingest(foreign).duplicate, true);
  } finally { store.close(); }
});
test('collector relays carry digest-bound provenance, not an arbitrary origin label', () => {
  const text = 'Question: Keep offline? Answer: Yes.';
  const digest = createHash('sha256').update(text).digest('hex');
  const raw = JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user',
    content: [{ type: 'input_text', text: `[innovox-delivery:d:${digest}]\n${text}` }] } });
  const event = normalizeLine(raw, 1, { projectId: 'p', adapter: 'codex', sessionId: 's', epoch: 0 })[0]!;
  assert.equal(event.origin, 'innovox'); assert.deepEqual(event.payload.relay, { deliveryId: 'd', digest });
  const invalid = normalizeLine(raw.replace('Answer: Yes.', 'Answer: No.'), 1, { projectId: 'p', adapter: 'codex', sessionId: 's', epoch: 0 })[0]!;
  assert.equal(invalid.origin, 'human');
});
