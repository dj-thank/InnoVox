import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { installServiceFiles } from '../src/mac-service-install.js';

test('interrupted owned Mac install resumes, preserves foreign bytes and never adopts unknown plist', () => {
  const parent = resolve('.innovox'); mkdirSync(parent, { recursive: true });
  const directory = mkdtempSync(join(parent, 'mac-install-test-'));
  const plist = 'synthetic plist', manifest = join(directory, 'owner.json'), plistPath = join(directory, 'agent.plist');
  const owner = { root: '/synthetic/root', node: '/synthetic/node', label: 'synthetic', plistPath, uid: 501,
    digest: createHash('sha256').update(plist).digest('hex'), installedAt: new Date().toISOString() };
  try {
    writeFileSync(plistPath, 'foreign plist');
    assert.throws(() => installServiceFiles(plist, manifest, owner), /adopt/);
    assert.equal(readFileSync(plistPath, 'utf8'), 'foreign plist'); rmSync(plistPath);
    assert.throws(() => installServiceFiles(plist, manifest, owner, phase => { if (phase === 'plist') throw new Error('interrupted'); }), /interrupted/);
    assert.equal(readFileSync(plistPath, 'utf8'), plist); assert.ok(!existsSync(manifest));
    writeFileSync(manifest, 'foreign owner');
    assert.throws(() => installServiceFiles(plist, manifest, owner), /unowned/);
    assert.equal(readFileSync(manifest, 'utf8'), 'foreign owner'); assert.equal(readFileSync(plistPath, 'utf8'), plist);
    rmSync(manifest); installServiceFiles(plist, manifest, { ...owner, installedAt: new Date().toISOString() });
    assert.equal(JSON.parse(readFileSync(manifest, 'utf8')).digest, owner.digest);
    assert.deepEqual(readdirSync(directory).sort(), ['agent.plist', 'owner.json']);
  } finally { assert.ok(resolve(directory).startsWith(parent + sep)); rmSync(directory, { recursive: true }); }
});

test('Mac receipt and completed-file checkpoints resume and changed staged bytes remain untouched', () => {
  const parent = resolve('.innovox'); mkdirSync(parent, { recursive: true });
  const directory = mkdtempSync(join(parent, 'mac-checkpoint-test-'));
  try {
    for (const phase of ['receipt', 'manifest'] as const) {
      const prefix = join(directory, phase), plistPath = prefix + '.plist', manifest = prefix + '.json';
      const plist = 'synthetic plist ' + phase;
      const owner = { root: '/synthetic/root', node: '/synthetic/node', label: phase, plistPath, uid: 501,
        digest: createHash('sha256').update(plist).digest('hex'), installedAt: new Date().toISOString() };
      assert.throws(() => installServiceFiles(plist, manifest, owner, step => { if (step === phase) throw new Error('interrupted'); }), /interrupted/);
      assert.throws(() => installServiceFiles(plist, manifest, { ...owner, node: '/different/node' }), /different runtime/);
      installServiceFiles(plist, manifest, owner);
      assert.equal(readFileSync(plistPath, 'utf8'), plist);
    }
    const plistPath = join(directory, 'changed.plist'), manifest = join(directory, 'changed.json'), plist = 'expected';
    const owner = { root: '/synthetic/root', node: '/synthetic/node', label: 'changed', plistPath, uid: 501,
      digest: createHash('sha256').update(plist).digest('hex'), installedAt: new Date().toISOString() };
    assert.throws(() => installServiceFiles(plist, manifest, owner, phase => { if (phase === 'plist') throw new Error('interrupted'); }));
    writeFileSync(plistPath, 'changed by another writer');
    assert.throws(() => installServiceFiles(plist, manifest, owner), /changed/);
    assert.equal(readFileSync(plistPath, 'utf8'), 'changed by another writer');
    assert.ok(existsSync(manifest + '.install.json'));
  } finally { assert.ok(resolve(directory).startsWith(parent + sep)); rmSync(directory, { recursive: true }); }
});

test('Mac plist staging stays beside its target when checkout and LaunchAgents directories differ', () => {
  const parent = resolve('.innovox'); mkdirSync(parent, { recursive: true });
  const directory = mkdtempSync(join(parent, 'mac-separate-paths-'));
  const launchAgents = join(directory, 'LaunchAgents'), state = join(directory, 'checkout-state');
  mkdirSync(launchAgents); mkdirSync(state);
  const plistPath = join(launchAgents, 'service.plist'), manifest = join(state, 'owner.json'), plist = 'synthetic separate target';
  const owner = { root: '/synthetic/root', node: '/synthetic/node', label: 'separate', plistPath, uid: 501,
    digest: createHash('sha256').update(plist).digest('hex'), installedAt: new Date().toISOString() };
  try {
    assert.throws(() => installServiceFiles(plist, manifest, owner, phase => { if (phase === 'plist') throw new Error('interrupted'); }));
    assert.ok(readdirSync(launchAgents).some(name => name.endsWith('.plist.stage')));
    assert.ok(!readdirSync(state).some(name => name.endsWith('.plist.stage')));
    installServiceFiles(plist, manifest, owner);
    assert.deepEqual(readdirSync(launchAgents), ['service.plist']);
    assert.deepEqual(readdirSync(state), ['owner.json']);
  } finally { assert.ok(resolve(directory).startsWith(parent + sep)); rmSync(directory, { recursive: true }); }
});
