import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { Analyzer } from '../src/analysis.js';
import { VoiceConversations } from '../src/voice-conversations.js';
import { reasoningContext, evidenceRef } from '../src/context.js';
import { DomainError } from '../src/contracts.js';
import { voiceChunks } from '../web/voice.js';
import type { VoiceDecision } from '../src/contracts.js';

function fixture(clock?: () => Date) {
  const store = new Store(':memory:', clock);
  const project = store.createProject({ name: 'Requirements', conditions: [{ id: 'offline', text: 'Keep offline saves', reason: 'Travel' }] });
  const event = (sessionId: string, sequence: number, text: string, role = 'assistant') => ({
    schemaVersion: 1, eventId: `e${sequence}`, projectId: project.id, source: { adapter: 'test', sessionId, epoch: 0 },
    sequence, occurredAt: '2026-09-26T00:00:00Z', kind: 'message', origin: role === 'user' ? 'human' : 'agent', payload: { role, text },
  });
  store.ingest(event('a', 1, 'Save only to the server.'));
  const snapshot = () => store.snapshot(project.id, 'test', 'a');
  const propose = () => store.propose(snapshot(), { question: 'Keep offline saves?', reason: 'Cloud-only conflicts.', evidenceEventIds: ['e1'], conditionIds: ['offline'] });
  return { store, project, event, snapshot, propose };
}
const code = (value: string) => (e: unknown) => e instanceof DomainError && e.code === value;
test('a human correction blocks the old answer and triggers fresh reasoning', async () => {
  const { store, project, event, propose } = fixture(); let calls = 0;
  const q = propose(); store.ingest(event('a', 2, 'Withdraw cloud-only; keep offline saves.', 'user'));
  const analyzer = new Analyzer(store, { available: true, async analyze() { calls++; return null; } });
  try {
    assert.throws(() => store.answer(q.id, { answerId: 'a', text: 'Yes', channel: 'voice', expectedVersion: 1 }), code('stale_context'));
    await analyzer.run({ projectId: project.id, adapter: 'test', sessionId: 'a' });
    assert.equal(calls, 1); assert.equal(store.consultation(q.id).status, 'superseded');
  } finally { analyzer.close(); store.close(); }
});
test('complete long statements and other project sessions reach reasoning with unique references', () => {
  const { store, project, event, snapshot } = fixture();
  try {
    const tail = 'ESSENTIAL_CONDITION_AT_THE_END';
    store.ingest(event('a', 2, 'x'.repeat(3100) + tail));
    store.ingest(event('b', 1, 'The existing offline implementation is here.'));
    const otherProject = store.createProject({ name: 'Other', conditions: project.conditions });
    store.ingest({ ...event('private-other-project', 1, 'Must not cross projects'), projectId: otherProject.id });
    const s = snapshot(), context = reasoningContext(s);
    assert.ok(context.observations.some(o => o.text.endsWith(tail)));
    assert.ok(context.observations.some(o => o.source.sessionId === 'b'));
    assert.ok(!context.observations.some(o => o.source.sessionId === 'private-other-project'));
    assert.equal(new Set(context.observations.map(o => o.id)).size, context.observations.length);
    const peer = s.relatedEvents[0]!;
    const q = store.propose(s, { question: 'Reuse the offline path?', reason: 'Another session has it.', evidenceEventIds: [evidenceRef(peer)], conditionIds: ['offline'] });
    assert.equal(q.sessionId, 'a');
  } finally { store.close(); }
});
test('budgeting omits whole records explicitly and unrelated events do not evict message context', () => {
  const { store, event, snapshot } = fixture();
  try {
    const original = snapshot();
    for (let i = 2; i < 55; i++) store.ingest({ ...event('a', i, ''), kind: 'vendor.progress', payload: {} });
    assert.equal(snapshot().fingerprint, original.fingerprint);
    const limited = reasoningContext(snapshot(), 5);
    assert.equal(limited.observations.length, 0); assert.equal(limited.coverage.omitted.length, 1);
    assert.ok(limited.coverage.omitted[0]!.characters > 5);
  } finally { store.close(); }
});
test('delivery includes the broker question and blocks changed conversation context', () => {
  const { store, event, propose } = fixture();
  try {
    const q = propose(); const { delivery } = store.answer(q.id, { answerId: 'a', text: 'Yes', channel: 'typed', expectedVersion: 1 });
    assert.ok(delivery.text.includes(q.question)); assert.ok(delivery.text.includes('Answer: Yes'));
    store.ingest(event('a', 2, 'Actually, pause this change.', 'user'));
    assert.throws(() => store.claimDelivery(delivery.id), code('stale_context'));
  } finally { store.close(); }
});
test('voice drafts require read-back, explicit confirmation and an idempotent commit', async () => {
  const { store, propose } = fixture(); const q = propose();
  const seen: Array<string | null> = [];
  const service = new VoiceConversations(store, { available: true, async respondToVoice(_s, question, speech, candidate): Promise<VoiceDecision> {
    assert.equal(question.id, q.id); seen.push(candidate);
    return speech === 'Yes' ? { intent: 'confirm', reply: 'Confirming.', answerText: 'A model must not rewrite the candidate.' }
      : { intent: 'draft', reply: 'Draft.', answerText: 'Keep offline saves.' };
  } });
  try {
    const draft = await service.interpret(q.id, { turnId: 'v1', expectedVersion: 1, transcript: 'Keep offline saves.' });
    assert.equal(draft.intent, 'draft'); assert.equal(store.deliveries().length, 0);
    await assert.rejects(service.interpret(q.id, { turnId: 'too-early', expectedVersion: 1, transcript: 'Yes' }), code('voice_confirmation'));
    store.markVoiceReadback(q.id, 'v1');
    const confirmed = await service.interpret(q.id, { turnId: 'v2', expectedVersion: 1, transcript: 'Yes' });
    assert.equal(seen.at(-1), 'Keep offline saves.'); assert.equal(store.deliveries().length, 0);
    const result = store.commitVoiceAnswer(q.id, confirmed.resolutionId!);
    assert.equal(result.consultation.answer?.text, 'Keep offline saves.');
    assert.equal(result.consultation.answer?.channel, 'voice');
    assert.equal(store.commitVoiceAnswer(q.id, confirmed.resolutionId!).delivery.id, result.delivery.id);
    assert.equal(store.deliveries().length, 1);
  } finally { store.close(); }
});
test('a corrected voice draft replaces the old confirmation and expires', async () => {
  let now = new Date('2026-09-26T00:00:00Z');
  const { store, propose } = fixture(() => now); const q = propose();
  const save = (turnId: string, transcript: string, intent: VoiceDecision['intent'], answerText: string | null) =>
    store.recordVoiceResult(q.id, { turnId, transcript, expectedVersion: 1 }, { intent, answerText, reply: 'Reply.' });
  try {
    save('d1', 'Option A', 'draft', 'Option A'); store.markVoiceReadback(q.id, 'd1');
    const old = save('c1', 'Yes', 'confirm', null);
    save('d2', 'No, option B', 'draft', 'Option B');
    assert.throws(() => store.commitVoiceAnswer(q.id, old.resolutionId!), code('voice_confirmation'));
    store.markVoiceReadback(q.id, 'd2'); const next = save('c2', 'Yes', 'confirm', null);
    now = new Date(now.getTime() + 61_000);
    assert.throws(() => store.commitVoiceAnswer(q.id, next.resolutionId!), code('voice_expired'));
    assert.equal(store.deliveries().length, 0);
  } finally { store.close(); }
});
test('late reasoning cannot confirm a question changed during the voice request', async () => {
  const { store, event, propose } = fixture(); const q = propose();
  const service = new VoiceConversations(store, { available: true, async respondToVoice() {
    store.ingest(event('a', 2, 'Stop this plan.', 'user'));
    return { intent: 'draft', reply: 'Old reply.', answerText: 'Old answer.' };
  } });
  try {
    await assert.rejects(service.interpret(q.id, { turnId: 'late', expectedVersion: 1, transcript: 'Yes' }), code('stale_context'));
    assert.equal(store.deliveries().length, 0);
  } finally { store.close(); }
});
test('voice framing preserves every character including the end of long Japanese questions', () => {
  const text = '長い質問の条件を保持します。'.repeat(70) + '\n末尾の条件も必須です。🎙️';
  const chunks = voiceChunks(text);
  assert.equal(chunks.join(''), text);
  assert.ok(chunks.every(c => new TextEncoder().encode(c).length <= 320));
});
test('a new utterance invalidates an earlier confirmation before slow interpretation finishes', async () => {
  const { store, propose } = fixture(); const q = propose();
  store.recordVoiceResult(q.id, { turnId: 'draft', transcript: 'Option A', expectedVersion: 1 },
    { intent: 'draft', answerText: 'Option A', reply: 'Draft' });
  store.markVoiceReadback(q.id, 'draft');
  const old = store.recordVoiceResult(q.id, { turnId: 'confirmed', transcript: 'Yes', expectedVersion: 1 },
    { intent: 'confirm', answerText: null, reply: 'Confirmed' });
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const service = new VoiceConversations(store, { available: true, async respondToVoice() {
    await gate; return { intent: 'draft', answerText: 'Option B', reply: 'New draft' };
  } });
  try {
    const interpreting = service.interpret(q.id, { turnId: 'correction', transcript: 'No, option B', expectedVersion: 1 });
    assert.throws(() => store.commitVoiceAnswer(q.id, old.resolutionId!), code('voice_confirmation'));
    release(); await interpreting; assert.equal(store.deliveries().length, 0);
  } finally { release(); store.close(); }
});
test('a new voice dialogue cannot confirm a read-back from the previous connection', () => {
  const { store, propose } = fixture(); const q = propose();
  try {
    store.recordVoiceResult(q.id, { turnId: 'old-draft', transcript: 'Option A', expectedVersion: 1 },
      { intent: 'draft', answerText: 'Option A', reply: 'Draft' });
    store.markVoiceReadback(q.id, 'old-draft');
    const old = store.recordVoiceResult(q.id, { turnId: 'old-confirm', transcript: 'Yes', expectedVersion: 1 },
      { intent: 'confirm', answerText: null, reply: 'Confirm' });
    store.resetVoiceDialogue(q.id);
    assert.throws(() => store.commitVoiceAnswer(q.id, old.resolutionId!), code('voice_confirmation'));
    assert.equal(store.voiceState(q.id), undefined); assert.equal(store.deliveries().length, 0);
  } finally { store.close(); }
});
