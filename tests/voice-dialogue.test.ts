import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { seedDemo } from '../src/demo.js';
import { VoiceConversations } from '../src/voice-conversations.js';

test('dialogue reset rejects old in-flight results and cached confirmations', async () => {
  const store = new Store(':memory:'); seedDemo(store); const q = store.consultations()[0]!;
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const service = new VoiceConversations(store, { available: true, async respondToVoice() {
    await gate; return { intent: 'draft', reply: 'Draft', answerText: 'Option A' };
  } });
  try {
    const pending = service.interpret(q.id, { turnId: 'old', expectedVersion: q.version, transcript: 'Option A' });
    store.resetVoiceDialogue(q.id); release();
    await assert.rejects(pending, (e: unknown) => (e as { code: string }).code === 'stale_dialogue');
    assert.equal(store.voiceState(q.id), undefined);
    const turn = { turnId: 'cached', expectedVersion: q.version, transcript: 'Option B' };
    store.recordVoiceResult(q.id, turn, { intent: 'draft', reply: 'Draft', answerText: 'Option B' });
    assert.ok(store.voiceResult(q.id, turn));
    store.resetVoiceDialogue(q.id); assert.equal(store.voiceResult(q.id, turn), undefined);
    assert.equal(store.deliveries().length, 0);
  } finally { release(); store.close(); }
});

test('unacknowledged draft remains correction reference but cannot confirm, and history is bounded', async () => {
  const store = new Store(':memory:'); seedDemo(store); const q = store.consultations()[0]!;
  const save = (turnId: string, intent: 'draft' | 'clarify' | 'confirm', answerText: string | null) =>
    store.recordVoiceResult(q.id, { turnId, expectedVersion: q.version, transcript: 'Speech' }, { intent, reply: 'Reply', answerText });
  try {
    save('draft', 'draft', 'Option A'); save('clarify', 'clarify', null);
    assert.equal(store.voiceState(q.id)?.history.draftAnswer, 'Option A');
    assert.equal(store.voiceState(q.id)?.candidatePresented, false);
    assert.throws(() => save('early', 'confirm', null), (e: unknown) => (e as { code: string }).code === 'voice_confirmation');
    for (let i = 0; i < 10; i++) save(`clarify-${i}`, 'clarify', null);
    assert.equal(store.voiceState(q.id)?.history.turns.length, 8);
    assert.equal(store.voiceState(q.id)?.history.omittedTurns, 4);
    assert.equal(store.deliveries().length, 0);
  } finally { store.close(); }
});


test('legacy and wrong-context cached turns never bypass current voice interpretation', () => {
  const store = new Store(':memory:'); seedDemo(store); const q = store.consultations()[0]!;
  const turn = { turnId: 'cached', expectedVersion: q.version, transcript: 'Option A' };
  try {
    const result = store.recordVoiceResult(q.id, turn, { intent: 'draft', reply: 'Draft', answerText: 'Option A' });
    const row = store.db.prepare('SELECT json FROM voice_turns WHERE consultation=? AND turn_id=?').get(q.id, turn.turnId)!;
    const envelope = JSON.parse(String(row.json));
    store.db.prepare('UPDATE voice_turns SET json=? WHERE consultation=?').run(JSON.stringify(result), q.id);
    assert.equal(store.voiceResult(q.id, turn), undefined);
    envelope.fingerprint = 'old-fingerprint';
    store.db.prepare('UPDATE voice_turns SET json=? WHERE consultation=?').run(JSON.stringify(envelope), q.id);
    assert.equal(store.voiceResult(q.id, turn), undefined);
    envelope.fingerprint = q.contextFingerprint; envelope.result.expectedVersion = q.version + 1;
    store.db.prepare('UPDATE voice_turns SET json=? WHERE consultation=?').run(JSON.stringify(envelope), q.id);
    assert.equal(store.voiceResult(q.id, turn), undefined);
  } finally { store.close(); }
});
