import type { Store } from './store.js';

/** Explicit synthetic fixture; never an alternative to a failed provider request. */
export function seedDemo(store: Store) {
  const previous = store.projects().find(p => p.name === 'サンプル：オフラインノート');
  if (previous) return previous;
  const p = store.createProject({ name: 'サンプル：オフラインノート', autoAnalyze: false,
    conditions: [{ id: 'offline', text: 'ネット接続がなくてもメモを保存できる。',
      reason: '移動中でも書いた内容を失わないことを大切にしている。' }] });
  const event = { schemaVersion: 1, eventId: 'sample-message-1', projectId: p.id,
    source: { adapter: 'synthetic', sessionId: 'sample-session', epoch: 0 }, sequence: 0,
    occurredAt: new Date().toISOString(), kind: 'message', origin: 'agent',
    payload: { role: 'assistant', text: '保存ボタンから直接クラウドAPIを呼び、成功したら保存済みと表示する設計にします。' } };
  store.ingest(event);
  store.propose(store.snapshot(p.id, 'synthetic', 'sample-session'), {
    question: 'オフラインでも保存できる条件を、今の設計にも残しますか？',
    reason: 'サンプルの確認です。クラウドAPIだけに保存すると、移動中にメモを残せない可能性があります。',
    evidenceEventIds: ['sample-message-1'], conditionIds: ['offline'],
  });
  return p;
}
