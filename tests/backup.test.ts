import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { Store } from '../src/store.js';
import { backupState, restoreState } from '../src/backup.js';
import { DatabaseSync } from 'node:sqlite';

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
    const manifest = await backupState(source, output); assert.ok(manifest.schemaVersion >= 1 && manifest.schemaVersion <= 4);
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

test('invalid source and preexisting manifest leave output free for retry and preserve foreign bytes', async () => {
  const parent = resolve('.innovox'); await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, 'backup-recovery-test-'));
  const source = join(directory, 'live.sqlite'), output = join(directory, 'backup.sqlite');
  try {
    await writeFile(source, 'not a database');
    await assert.rejects(backupState(source, output));
    assert.ok(!(await readdir(directory)).includes('backup.sqlite'));
    await rm(source); const store = new Store(source); store.close();
    await writeFile(output + '.manifest.json', 'foreign manifest');
    await assert.rejects(backupState(source, output));
    assert.equal(await readFile(output + '.manifest.json', 'utf8'), 'foreign manifest');
    assert.ok(!(await readdir(directory)).includes('backup.sqlite'));
    await rm(output + '.manifest.json');
    await writeFile(output, 'foreign database');
    await assert.rejects(backupState(source, output));
    assert.equal(await readFile(output, 'utf8'), 'foreign database');
    assert.ok(!(await readdir(directory)).includes('backup.sqlite.manifest.json'));
    await rm(output);
    await backupState(source, output);
    assert.equal((await restoreState(output, join(directory, 'restored.sqlite'))).verified, true);
    assert.ok(!(await readdir(directory)).some(name => name.includes('.pending-')));
  } finally { assert.ok(resolve(directory).startsWith(parent + sep)); await rm(directory, { recursive: true }); }
});

test('backup and restore accept legacy versions through v4 and reject newer versions before reserving output', async () => {
  const parent = resolve('.innovox'); await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, 'backup-version-test-'));
  const source = join(directory, 'live.sqlite');
  try {
    new Store(source).close();
    for (const version of [1, 2, 3, 4, 5]) {
      const database = new DatabaseSync(source);
      try { database.exec(`PRAGMA user_version=${version}`); } finally { database.close(); }
      const output = join(directory, `v${version}.sqlite`);
      if (version === 5) {
        await assert.rejects(backupState(source, output), /Unsupported/);
        assert.ok(!(await readdir(directory)).includes('v5.sqlite'));
      } else {
        assert.equal((await backupState(source, output)).schemaVersion, version);
        assert.equal((await restoreState(output, join(directory, `restored-v${version}.sqlite`))).schemaVersion, version);
      }
    }
  } finally { assert.ok(resolve(directory).startsWith(parent + sep)); await rm(directory, { recursive: true }); }
});
