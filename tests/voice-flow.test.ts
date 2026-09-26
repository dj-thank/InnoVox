import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import type { AddressInfo } from 'node:net';
import { Store } from '../src/store.js';
import { seedDemo } from '../src/demo.js';
import { OpenAIProvider } from '../src/provider.js';
import { buildServer } from '../src/server.js';
import { Voice } from '../web/voice.js';

async function until(check: () => boolean) {
  for (let i = 0; i < 400; i++) { if (check()) return; await delay(10); }
  assert.fail('Timed out waiting for the simulated voice flow.');
}
test('voice controller → HTTP → Astra adapter → readback → spoken confirmation saves one answer', async () => {
  const store = new Store(':memory:'); seedDemo(store); const q = store.consultations()[0]!;
  const modelRequests: Record<string, unknown>[] = [];
  const provider = new OpenAIProvider('synthetic-no-live-key', async (url, options) => {
    if (String(url).endsWith('/live/sessions')) return Response.json({ session: { id: 'live_test' }, transport: { type: 'webrtc', sdp: 'answer' } });
    const payload = JSON.parse(String(options?.body)); modelRequests.push(payload);
    const input = JSON.parse(payload.input);
    const result = input.candidateAnswer ? { intent: 'confirm', reply: '確認しました。', answerText: input.candidateAnswer }
      : { intent: 'draft', reply: '回答案です。', answerText: 'オフラインで保存できる条件を維持してください。' };
    return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(result) }] }] });
  });
  const token = 'synthetic-test-token-not-for-production';
  const { server } = buildServer({ store, token, root: process.cwd(), origin: 'http://127.0.0.1', provider });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const previousPeer = Object.getOwnPropertyDescriptor(globalThis, 'RTCPeerConnection');
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const sent: Array<Record<string, unknown>> = []; let channel!: FakeChannel; let saved = 0;
  class FakeChannel extends EventTarget {
    readyState = 'open';
    send(value: string) { sent.push(JSON.parse(value)); }
    close() { this.readyState = 'closed'; }
    incoming(value: unknown) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) })); }
  }
  class FakePeer extends EventTarget {
    iceGatheringState = 'complete'; localDescription = { sdp: 'offer' };
    addTrack() {} close() {}
    createDataChannel() { channel = new FakeChannel(); return channel; }
    async createOffer() { return { type: 'offer', sdp: 'offer' }; }
    async setLocalDescription() {}
    async setRemoteDescription() { channel.incoming({ type: 'session.started' }); }
  }
  Object.defineProperty(globalThis, 'RTCPeerConnection', { configurable: true, value: FakePeer });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: {
    async getUserMedia() { return { getTracks: () => [], getAudioTracks: () => [] }; },
  } } });
  const voice = new Voice(async <T>(path: string, data?: unknown): Promise<T> => {
    const response = await fetch(base + path, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const result = await response.json(); if (!response.ok) throw new Error(result.message); return result as T;
  }, { srcObject: null, async play() {} } as unknown as HTMLAudioElement, () => {}, () => {}, () => { saved++; });
  try {
    await voice.start(q);
    channel.incoming({ type: 'session.input_transcript.delta', event_id: 'u1', delta: 'オフラインの条件を維持して', start_ms: 0, end_ms: 1000 });
    channel.incoming({ type: 'session.delegation.created', delegation: { id: 'd1', target: 'client' } });
    await until(() => sent.some(e => e.delegation_id === 'd1' && e.type === 'session.commentary.append'));
    assert.equal(store.deliveries().length, 0);
    const readback = sent.filter(e => e.delegation_id === 'd1' && e.type === 'session.commentary.append');
    for (const e of readback) channel.incoming({ type: 'session.commentary.appended', client_event_id: e.event_id });
    await until(() => store.voiceState(q.id)?.candidatePresented === true);
    channel.incoming({ type: 'session.input_transcript.delta', event_id: 'u2', delta: 'はい、それでお願いします', start_ms: 1200, end_ms: 2000 });
    channel.incoming({ type: 'session.delegation.created', delegation: { id: 'd2', target: 'client' } });
    await until(() => saved === 1);
    assert.equal(modelRequests.length, 2); assert.ok(modelRequests.every(r => r.model === 'gpt-6-astra'));
    const answer = store.consultation(q.id).answer;
    assert.equal(answer?.channel, 'voice'); assert.equal(answer?.text, 'オフラインで保存できる条件を維持してください。');
    assert.equal(store.deliveries().length, 1); assert.equal(store.deliveries()[0]?.status, 'queued');
    channel.incoming({ type: 'session.delegation.created', delegation: { id: 'd2', target: 'client' } });
    await delay(20); assert.equal(store.deliveries().length, 1);
  } finally {
    voice.cleanup(); server.close(); server.closeAllConnections(); await once(server, 'close'); store.close();
    if (previousPeer) Object.defineProperty(globalThis, 'RTCPeerConnection', previousPeer); else Reflect.deleteProperty(globalThis, 'RTCPeerConnection');
    if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator); else Reflect.deleteProperty(globalThis, 'navigator');
  }
});
