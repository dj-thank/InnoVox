import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { Store } from '../src/store.js';
import { backupState, restoreState } from '../src/backup.js';

test('online backup includes committed WAL state and restores without replacing or mutating the live database', async () => {
  const parent = resolve('.innovox'); await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, 'backup-test-'));
  const source = join(directory, 'live.sqlite'), output = join(directory, 'backup.sqlite'), restoredPath = join(directory, 'restored.sqlite');
  const store = new Store(source);
  try {
    const project = store.createProject({ name: 'Synthetic backup fixture', conditions: [{ id: 'offline', text: 'Keep offline', reason: 'Travel' }] });
    store.ingest({ schemaVersion: 1, eventId: 'plan', projectId: project.id,
      source: { adapter: 'synthetic', sessionId: 'backup-session', epoch: 0 }, sequence: 1,
      occurredAt: new Date().toISOString(), kind: 'message', origin: 'agent', payload: { role: 'assistant', text: 'Save only to cloud.' } });
    const question = store.propose(store.snapshot(project.id, 'synthetic', 'backup-session'), {
      question: 'Keep offline?', reason: 'Project condition', evidenceEventIds: ['plan'], conditionIds: ['offline'] });
    const delivery = store.answer(question.id, { answerId: 'answer', expectedVersion: 1, text: 'Keep offline.', channel: 'typed' }).delivery;
    store.claimDelivery(delivery.id);
    const before = store.journal(0).length;
    const manifest = await backupState(source, output); assert.equal(manifest.schemaVersion, 3);
    assert.equal(store.journal(0).length, before);
    assert.equal(store.deliveries()[0]?.status, 'claimed');
    assert.equal((await restoreState(output, restoredPath)).activated, false);
    const restored = new Store(restoredPath);
    try {
      assert.equal(restored.project(project.id).name, project.name); assert.equal(restored.journal(0).length, before);
      assert.equal(restored.consultation(question.id).answer?.text, 'Keep offline.');
      assert.equal(restored.deliveries()[0]?.status, 'unknown');
    }
    finally { restored.close(); }
    await assert.rejects(restoreState(output, source));
    await assert.rejects(backupState(source, output));
    const bytes = await readFile(output); bytes[bytes.length - 1] = (bytes.at(-1) ?? 0) ^ 1; await writeFile(output, bytes);
    await assert.rejects(restoreState(output, join(directory, 'changed.sqlite')), /fingerprint/);
    assert.equal(store.project(project.id).name, project.name);
  } finally { store.close(); assert.ok(resolve(directory).startsWith(parent + sep)); await rm(directory, { recursive: true }); }
});
