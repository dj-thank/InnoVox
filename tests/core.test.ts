import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { Store } from '../src/store.js';
import { DomainError } from '../src/contracts.js';
import { DatabaseSync } from 'node:sqlite';

function setup(path = ':memory:', clock?: () => Date) {
  const store = new Store(path, clock);
  const project = store.createProject({ name: 'Test', conditions: [{ id: 'offline', text: 'Keep offline saves.', reason: 'Travel.' }] });
  const event = { schemaVersion: 1, eventId: 'e1', projectId: project.id,
    source: { adapter: 'test', sessionId: 's1', epoch: 0 }, sequence: 1,
    occurredAt: '2026-09-26T00:00:00Z', kind: 'message', origin: 'agent',
    payload: { role: 'assistant', text: 'Save only to the server.' } };
  store.ingest(event);
  const proposal = { question: 'Keep offline?', reason: 'Server only conflicts.', evidenceEventIds: ['e1'], conditionIds: ['offline'] };
  const snapshot = () => store.snapshot(project.id, 'test', 's1');
  return { store, project, event, proposal, snapshot };
}
const hasCode = (code: string) => (e: unknown) => e instanceof DomainError && e.code === code;
test('ingestion deduplicates identical events and rejects conflicting ids/sequences', () => {
  const { store, event } = setup();
  try {
    assert.equal(store.ingest(event).duplicate, true);
    assert.throws(() => store.ingest({ ...event, payload: { role: 'assistant', text: 'Different' } }), hasCode('event_conflict'));
    assert.throws(() => store.ingest({ ...event, eventId: 'e2' }), hasCode('sequence_conflict'));
  } finally { store.close(); }
});
test('late events order correctly and unknown events remain preserved', () => {
  const { store, event, snapshot } = setup();
  try {
    store.ingest({ ...event, eventId: 'e0', sequence: 0 });
    store.ingest({ ...event, eventId: 'future', sequence: 2, kind: 'vendor.future', payload: { extra: true } });
    assert.deepEqual(snapshot().events.map(e => e.eventId), ['e0', 'e1']);
    assert.equal(store.events(event.projectId, 'test', 's1', 0).at(-1)?.kind, 'vendor.future');
  } finally { store.close(); }
});
test('proactive proposals need evidence and do not require AskUser', () => {
  const { store, proposal, snapshot } = setup();
  try {
    assert.throws(() => store.propose(snapshot(), { ...proposal, evidenceEventIds: ['invented'] }), hasCode('invalid_evidence'));
    const c = store.propose(snapshot(), proposal);
    assert.equal(c.status, 'pending'); assert.equal(store.propose(snapshot(), proposal).id, c.id);
    assert.equal(store.consultations().length, 1);
  } finally { store.close(); }
});
test('analysis is rejected when the input changes in flight', () => {
  const { store, proposal, snapshot, event } = setup();
  try {
    const old = snapshot(); store.ingest({ ...event, eventId: 'e2', sequence: 2 });
    assert.throws(() => store.propose(old, proposal), hasCode('stale_analysis'));
  } finally { store.close(); }
});
test('answers bind to their question, are idempotent, and are not marked delivered', () => {
  const { store, proposal, snapshot } = setup();
  try {
    const q = store.propose(snapshot(), proposal);
    const answer = { answerId: 'answer1', text: 'Keep local saves.', channel: 'voice', expectedVersion: q.version };
    const result = store.answer(q.id, answer);
    assert.equal(result.delivery.status, 'queued'); assert.equal(result.delivery.sessionId, 's1');
    assert.equal(store.answer(q.id, answer).delivery.id, result.delivery.id);
    assert.throws(() => store.answer(q.id, { ...answer, text: 'Different' }), hasCode('answer_conflict'));
    assert.throws(() => store.answer(q.id, { ...answer, answerId: 'answer2' }), hasCode('stale_question'));
  } finally { store.close(); }
});
test('project revisions supersede questions and cancel queued deliveries', () => {
  const { store, project, proposal, snapshot } = setup();
  try {
    const q = store.propose(snapshot(), proposal);
    store.answer(q.id, { answerId: 'a', text: 'Yes', channel: 'typed', expectedVersion: 1 });
    store.updateProject(project.id, { name: 'Updated', conditions: project.conditions, autoAnalyze: false }, 1);
    assert.equal(store.deliveries()[0]?.status, 'cancelled');
    assert.throws(() => store.claimDelivery(store.deliveries()[0]!.id), hasCode('delivery_not_queued'));
  } finally { store.close(); }
});
test('new epochs invalidate old questions; late old-epoch events cannot reactivate them', () => {
  const { store, event, proposal, snapshot } = setup();
  try {
    const q = store.propose(snapshot(), proposal);
    store.ingest({ ...event, eventId: 'reset', source: { ...event.source, epoch: 1 }, sequence: 0, kind: 'session.started', payload: {} });
    assert.equal(store.consultation(q.id).status, 'superseded');
    assert.throws(() => store.ingest({ ...event, eventId: 'late', sequence: 2 }), hasCode('stale_epoch'));
  } finally { store.close(); }
});
test('unanswered questions expire and silence is never treated as approval', () => {
  let now = new Date('2026-09-26T00:00:00Z');
  const { store, proposal, snapshot } = setup(':memory:', () => now);
  try {
    const q = store.propose(snapshot(), proposal); now = new Date(now.getTime() + 16 * 60_000);
    assert.equal(store.consultation(q.id).status, 'expired'); assert.equal(store.deliveries().length, 0);
    assert.throws(() => store.answer(q.id, { answerId: 'late', text: 'Yes', channel: 'typed', expectedVersion: 1 }), hasCode('stale_question'));
  } finally { store.close(); }
});
test('crash recovery retains answers and changes in-flight delivery to unknown', () => {
  const scratch = resolve('.innovox'); mkdirSync(scratch, { recursive: true });
  const dir = mkdtempSync(join(scratch, 'test-')), path = join(dir, 'state.sqlite');
  const { store, proposal, snapshot } = setup(path);
  const q = store.propose(snapshot(), proposal);
  const d = store.answer(q.id, { answerId: 'a1', text: 'Yes', channel: 'typed', expectedVersion: 1 }).delivery;
  store.claimDelivery(d.id); store.close();
  const restored = new Store(path);
  try {
    assert.equal(restored.consultation(q.id).answer?.text, 'Yes');
    assert.equal(restored.deliveries()[0]?.status, 'unknown');
    assert.throws(() => restored.claimDelivery(d.id), hasCode('delivery_not_queued'));
    assert.equal(restored.receipt(d.id, 'delivered', 'adapter-receipt-1').status, 'delivered');
    assert.ok(restored.journal(0).length > 0);
  } finally { restored.close(); assert.ok(resolve(dir).startsWith(scratch + sep)); rmSync(dir, { recursive: true }); }
});
test('provider admission limits survive the store and expire by time', () => {
  let now = new Date('2026-09-26T00:00:00Z'); const store = new Store(':memory:', () => now);
  try {
    store.consumeBudget('analysis', 1);
    assert.throws(() => store.consumeBudget('analysis', 1), hasCode('rate_limit'));
    now = new Date(now.getTime() + 3600_001); store.consumeBudget('analysis', 1);
  } finally { store.close(); }
});
test('an orphaned delivery claim becomes unknown without restarting or resending', () => {
  let now = new Date('2026-09-26T00:00:00Z');
  const { store, proposal, snapshot } = setup(':memory:', () => now);
  try {
    const q = store.propose(snapshot(), proposal);
    const d = store.answer(q.id, { answerId: 'timeout', text: 'Yes', channel: 'typed', expectedVersion: 1 }).delivery;
    store.claimDelivery(d.id); now = new Date(now.getTime() + 61_000);
    assert.equal(store.deliveries()[0]?.status, 'unknown');
    assert.throws(() => store.claimDelivery(d.id), hasCode('delivery_not_queued'));
  } finally { store.close(); }
});

test('delivery-state upgrade preserves existing answers and rejects a newer database', () => {
  const parent = resolve('.innovox'); mkdirSync(parent, { recursive: true });
  const directory = mkdtempSync(join(parent, 'upgrade-test-')), path = join(directory, 'state.sqlite');
  const { store, proposal, snapshot } = setup(path);
  const question = store.propose(snapshot(), proposal);
  const delivery = store.answer(question.id, { answerId: 'legacy', text: 'Keep offline.', channel: 'typed', expectedVersion: 1 }).delivery;
  store.db.exec('PRAGMA user_version=2'); store.close();
  const upgraded = new Store(path);
  try {
    assert.equal(upgraded.consultation(question.id).answer?.text, 'Keep offline.');
    upgraded.claimDelivery(delivery.id);
    upgraded.receipt(delivery.id, 'accepted', 'Synthetic protocol receipt');
    assert.equal(upgraded.db.prepare('PRAGMA user_version').get()?.user_version, 3);
  } finally { upgraded.close(); }
  const restarted = new Store(path);
  try { assert.equal(restarted.deliveries()[0]?.status, 'accepted'); } finally { restarted.close(); }
  const future = new DatabaseSync(path); future.exec('PRAGMA user_version=4'); future.close();
  try { assert.throws(() => new Store(path), hasCode('schema_version')); }
  finally { assert.ok(resolve(directory).startsWith(parent + sep)); rmSync(directory, { recursive: true }); }
});
