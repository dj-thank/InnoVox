import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { seedDemo } from '../src/demo.js';
import { VoiceConversations } from '../src/voice-conversations.js';

test('cached voice replies cannot bypass an expired consultation', async () => {
  let now = new Date('2026-10-04T00:00:00Z');
  const store = new Store(':memory:', () => now); seedDemo(store); const q = store.consultations()[0]!;
  const turn = { dialogueId: store.resetVoiceDialogue(q.id), turnId: 'expiring-reply', expectedVersion: q.version, transcript: 'Synthetic answer' };
  store.recordVoiceResult(q.id, turn, { intent: 'draft', reply: 'Draft', answerText: 'Keep offline.' });
  let calls = 0;
  const service = new VoiceConversations(store, { available: true, async respondToVoice() {
    calls++; return { intent: 'draft', reply: 'Draft', answerText: 'Unexpected' };
  } });
  try {
    now = new Date(now.getTime() + 16 * 60_000);
    await assert.rejects(service.interpret(q.id, turn), (e: unknown) => (e as { code: string }).code === 'stale_context');
    assert.equal(calls, 0); assert.equal(store.deliveries().length, 0);
    assert.equal(store.voiceState(q.id)?.history.turns.length, 1);
  } finally { store.close(); }
});

test('dialogue reset rejects old in-flight results and cached confirmations', async () => {
  const store = new Store(':memory:'); seedDemo(store); const q = store.consultations()[0]!;
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const service = new VoiceConversations(store, { available: true, async respondToVoice() {
    await gate; return { intent: 'draft', reply: 'Draft', answerText: 'Option A' };
  } });
  try {
    const pending = service.interpret(q.id, { dialogueId: store.voiceDialogueId(q.id), turnId: 'old', expectedVersion: q.version, transcript: 'Option A' });
    store.resetVoiceDialogue(q.id); release();
    await assert.rejects(pending, (e: unknown) => (e as { code: string }).code === 'stale_dialogue');
    assert.equal(store.voiceState(q.id), undefined);
    const turn = { dialogueId: store.voiceDialogueId(q.id), turnId: 'cached', expectedVersion: q.version, transcript: 'Option B' };
    store.recordVoiceResult(q.id, turn, { intent: 'draft', reply: 'Draft', answerText: 'Option B' });
    assert.ok(store.voiceResult(q.id, turn));
    store.resetVoiceDialogue(q.id); assert.throws(() => store.voiceResult(q.id, turn), (e: unknown) => (e as { code: string }).code === 'stale_dialogue');
    assert.equal(store.deliveries().length, 0);
  } finally { release(); store.close(); }
});

test('unacknowledged draft remains correction reference but cannot confirm, and history is bounded', async () => {
  const store = new Store(':memory:'); seedDemo(store); const q = store.consultations()[0]!;
  const save = (turnId: string, intent: 'draft' | 'clarify' | 'confirm', answerText: string | null) =>
    store.recordVoiceResult(q.id, { dialogueId: store.voiceDialogueId(q.id), turnId, expectedVersion: q.version, transcript: 'Speech' }, { intent, reply: 'Reply', answerText });
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
  const turn = { dialogueId: store.voiceDialogueId(q.id), turnId: 'cached', expectedVersion: q.version, transcript: 'Option A' };
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
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { OpenAIProvider } from '../src/provider.js';
import { buildServer } from '../src/server.js';

test('HTTP reconnect rejects missing and old connection turns before provider, history, budget or outbox effects', async () => {
  const store = new Store(':memory:'); seedDemo(store); const q = store.consultations()[0]!;
  let calls = 0;
  const provider = new OpenAIProvider('synthetic-test-key', async url => {
    if (String(url).endsWith('/live/sessions')) return Response.json({ session: { id: 'synthetic' }, transport: { type: 'webrtc', sdp: 'answer' } });
    calls++; return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ intent: 'draft', reply: 'Draft', answerText: 'Current speech' }) }] }] });
  });
  const { server } = buildServer({ store, token: 'synthetic-token-with-at-least-32-characters', root: process.cwd(), origin: 'http://127.0.0.1', provider });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, data: unknown) => fetch(base + path, { method: 'POST', headers: { Authorization: 'Bearer synthetic-token-with-at-least-32-characters', 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  try {
    const start = { consultationId: q.id, expectedVersion: q.version, sdp: 'offer' };
    const old = await (await post('/api/live/session', start)).json();
    const current = await (await post('/api/live/session', start)).json();
    assert.notEqual(old.dialogueId, current.dialogueId);
    const path = `/api/consultations/${q.id}/voice/interpret`;
    const turn = { turnId: 'late-old', expectedVersion: q.version, transcript: 'Old speech' };
    const budgetBefore = store.db.prepare("SELECT count(*) AS n FROM provider_usage WHERE kind='analysis'").get()?.n;
    assert.equal((await post(path, turn)).status, 400);
    const stale = await post(path, { ...turn, dialogueId: old.dialogueId });
    assert.equal(stale.status, 409); assert.equal((await stale.json()).error, 'stale_dialogue');
    assert.equal(calls, 0); assert.equal(store.voiceState(q.id), undefined);
    assert.equal(store.deliveries().length, 0);
    assert.equal(store.db.prepare("SELECT count(*) AS n FROM provider_usage WHERE kind='analysis'").get()?.n, budgetBefore);
    assert.equal((await post(path, { ...turn, turnId: 'current', dialogueId: current.dialogueId })).status, 200);
    assert.equal(calls, 1); assert.equal(store.voiceState(q.id)?.dialogueId, current.dialogueId);
    assert.equal(store.voiceState(q.id)?.history.turns.length, 1);
  } finally { server.close(); server.closeAllConnections(); await once(server, 'close'); store.close(); }
});
