import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';
import { Store } from '../src/store.js';
import { seedDemo } from '../src/demo.js';

test('v3 schema and legacy voice JSON migrate without losing decisions or replaying old readback state', () => {
  const parent = resolve('.innovox'); mkdirSync(parent, { recursive: true });
  const directory = mkdtempSync(join(parent, 'legacy-v3-test-')), path = join(directory, 'legacy.sqlite');
  const source = new Store(':memory:');
  const pendingProject = seedDemo(source), pending = source.consultations(pendingProject.id)[0]!;
  const answeredProject = source.createProject({ name: 'Synthetic durable v3 answer', conditions: [{ id: 'offline', text: 'Keep offline', reason: 'Travel' }] });
  source.ingest({ schemaVersion: 1, eventId: 'durable-plan', projectId: answeredProject.id,
    source: { adapter: 'synthetic', sessionId: 'answered-session', epoch: 0 }, sequence: 1,
    occurredAt: new Date().toISOString(), kind: 'message', origin: 'agent', payload: { role: 'assistant', text: 'Save only to cloud.' } });
  const answered = source.propose(source.snapshot(answeredProject.id, 'synthetic', 'answered-session'), {
    question: 'Keep offline?', reason: 'Synthetic legacy condition', evidenceEventIds: ['durable-plan'], conditionIds: ['offline'] });
  const delivery = source.answer(answered.id, { answerId: 'durable-answer', expectedVersion: answered.version, text: 'オフライン保存を維持します。', channel: 'typed' }).delivery;
  source.claimDelivery(delivery.id);
  const legacy = new DatabaseSync(path);
  try {
    legacy.exec(readFileSync(new URL('../../tests/fixtures/state-v3.sql', import.meta.url), 'utf8'));
    for (const table of ['projects', 'sessions', 'events', 'consultations', 'deliveries', 'journal', 'provider_usage']) {
      for (const row of source.db.prepare(`SELECT * FROM ${table}`).all()) {
        const columns = Object.keys(row);
        legacy.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...Object.values(row));
      }
    }
    const result = { turnId: 'old-confirmation', intent: 'confirm', reply: 'Synthetic legacy confirmation', answerText: 'Old draft',
      resolutionId: 'old-resolution', expectedVersion: pending.version, expiresAt: new Date(Date.now() + 60_000).toISOString() };
    legacy.prepare('INSERT INTO voice_state VALUES (?,?)').run(pending.id, JSON.stringify({ candidate: 'Old draft', candidatePresented: true,
      expectedVersion: pending.version, contextFingerprint: pending.contextFingerprint, latest: result }));
    legacy.prepare('INSERT INTO voice_turns VALUES (?,?,?,?)').run(pending.id, result.turnId, 'synthetic-legacy-digest', JSON.stringify(result));
    assert.equal(legacy.prepare("SELECT name FROM sqlite_master WHERE name='voice_dialogues'").get(), undefined);
  } finally { legacy.close(); source.close(); }
  const upgraded = new Store(path);
  try {
    assert.equal(upgraded.db.prepare('PRAGMA user_version').get()?.user_version, 4);
    assert.equal(upgraded.voiceState(pending.id), undefined);
    assert.equal(upgraded.consultation(pending.id).status, 'pending');
    assert.equal(upgraded.db.prepare('SELECT COUNT(*) AS count FROM voice_turns').get()?.count, 0);
    assert.equal(upgraded.consultation(answered.id).answer?.text, 'オフライン保存を維持します。');
    assert.equal(upgraded.deliveries()[0]?.status, 'unknown');
    assert.throws(() => upgraded.commitVoiceAnswer(pending.id, 'old-resolution'));
    assert.equal(upgraded.projects().length, 2);
  } finally { upgraded.close(); assert.ok(resolve(directory).startsWith(parent + sep)); rmSync(directory, { recursive: true }); }
});
