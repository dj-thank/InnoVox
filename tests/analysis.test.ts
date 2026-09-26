import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { Analyzer } from '../src/analysis.js';
import { Store } from '../src/store.js';
import { seedDemo } from '../src/demo.js';

test('queued automatic analysis resumes after a concurrent manual call', async () => {
  const store = new Store(':memory:');
  const p = store.createProject({ name: 'Queue', autoAnalyze: true, conditions: [{ id: 'c', text: 'Offline', reason: 'Travel' }] });
  for (const sessionId of ['s1', 's2']) store.ingest({ schemaVersion: 1, eventId: 'e', projectId: p.id,
    source: { adapter: 'test', sessionId, epoch: 0 }, sequence: 0, occurredAt: '2026-09-26T00:00:00Z',
    kind: 'message', origin: 'agent', payload: { role: 'assistant', text: 'Cloud only.' } });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const calls: string[] = [];
  const analyzer = new Analyzer(store, { available: true, async analyze(snapshot) {
    calls.push(snapshot.session.sessionId); if (snapshot.session.sessionId === 's1') await gate; return null;
  } }, 5, 5);
  try {
    const first = analyzer.run({ projectId: p.id, adapter: 'test', sessionId: 's1' });
    analyzer.schedule(store.session(p.id, 'test', 's2'));
    await delay(20); release(); await first;
    for (let i = 0; i < 50 && calls.length < 2; i++) await delay(5);
    assert.deepEqual(calls, ['s1', 's2']);
  } finally { analyzer.close(); store.close(); }
});
test('an existing pending question prevents unnecessary repeated model calls', async () => {
  const store = new Store(':memory:'); const p = seedDemo(store); let calls = 0;
  const analyzer = new Analyzer(store, { available: true, async analyze() { calls++; return null; } });
  try {
    const result = await analyzer.run({ projectId: p.id, adapter: 'synthetic', sessionId: 'sample-session' });
    assert.equal(result?.status, 'pending'); assert.equal(calls, 0);
  } finally { analyzer.close(); store.close(); }
});
