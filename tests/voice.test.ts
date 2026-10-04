import test from 'node:test';
import assert from 'node:assert/strict';
import { Voice } from '../web/voice.js';

test('closing voice during microphone acquisition stops the late stream without creating a session', async () => {
  const previousPeer = Object.getOwnPropertyDescriptor(globalThis, 'RTCPeerConnection');
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let resolveMic!: (stream: unknown) => void, stopped = 0, closed = 0, requests = 0;
  const microphone = new Promise(resolve => { resolveMic = resolve; });
  class FakePeer extends EventTarget { close() { closed++; } }
  Object.defineProperty(globalThis, 'RTCPeerConnection', { configurable: true, value: FakePeer });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: () => microphone } } });
  const audio = { srcObject: null } as HTMLAudioElement;
  const voice = new Voice(async () => { requests++; throw new Error('unexpected provider call'); }, audio, () => {}, () => {});
  try {
    const starting = voice.start({ id: 'q', version: 1, question: 'Question', reason: 'Reason' });
    voice.cleanup(); resolveMic({ getTracks: () => [{ stop: () => { stopped++; } }] }); await starting;
    assert.equal(stopped, 1); assert.equal(closed, 1); assert.equal(requests, 0);
  } finally {
    voice.cleanup();
    if (previousPeer) Object.defineProperty(globalThis, 'RTCPeerConnection', previousPeer);
    else Reflect.deleteProperty(globalThis, 'RTCPeerConnection');
    if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator);
    else Reflect.deleteProperty(globalThis, 'navigator');
  }
});

test('late start response cannot replace the active peer dialogue binding', async () => {
  const previousPeer = Object.getOwnPropertyDescriptor(globalThis, 'RTCPeerConnection');
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const channels: FakeChannel[] = [], remote: string[] = [], turns: Array<Record<string, unknown>> = [];
  const starts: Array<(value: unknown) => void> = [];
  class FakeChannel extends EventTarget {
    readyState = 'open'; send() {} close() {}
    incoming(value: unknown) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) })); }
  }
  class FakePeer extends EventTarget {
    iceGatheringState = 'complete'; localDescription = { sdp: 'offer' }; channel = new FakeChannel();
    addTrack() {} close() {} createDataChannel() { channels.push(this.channel); return this.channel; }
    async createOffer() { return { type: 'offer', sdp: 'offer' }; } async setLocalDescription() {}
    async setRemoteDescription(value: { sdp: string }) { remote.push(value.sdp); this.channel.incoming({ type: 'session.started' }); }
  }
  Object.defineProperty(globalThis, 'RTCPeerConnection', { configurable: true, value: FakePeer });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { async getUserMedia() { return { getTracks: () => [], getAudioTracks: () => [] }; } } } });
  const voice = new Voice(async <T>(path: string, data?: unknown): Promise<T> => {
    if (path === '/api/live/session') return new Promise(resolve => starts.push(value => resolve(value as T)));
    turns.push(data as Record<string, unknown>);
    return { intent: 'clarify', reply: 'Continue', turnId: 'turn', answerText: null, resolutionId: null, expectedVersion: 1, expiresAt: new Date().toISOString() } as T;
  }, { srcObject: null, async play() {} } as unknown as HTMLAudioElement, () => {}, () => {});
  const until = async (check: () => boolean) => { for (let i = 0; i < 100 && !check(); i++) await new Promise(resolve => setTimeout(resolve, 10)); assert.ok(check()); };
  try {
    const q = { id: 'q', version: 1, question: 'Question', reason: 'Reason' };
    const old = voice.start(q); await until(() => starts.length === 1);
    const current = voice.start(q); await until(() => starts.length === 2);
    starts[1]!({ dialogueId: 'current-dialogue', consultationId: 'q', transport: { sdp: 'current' } }); await current;
    starts[0]!({ dialogueId: 'old-dialogue', consultationId: 'q', transport: { sdp: 'old' } }); await old;
    assert.deepEqual(remote, ['current']);
    channels[0]!.incoming({ type: 'session.input_transcript.delta', event_id: 'old', delta: 'Old speech' });
    channels[0]!.incoming({ type: 'session.delegation.created', delegation: { id: 'old-d' } });
    channels[1]!.incoming({ type: 'session.input_transcript.delta', event_id: 'new', delta: 'Current speech' });
    channels[1]!.incoming({ type: 'session.delegation.created', delegation: { id: 'new-d' } });
    await until(() => turns.length === 1);
    assert.equal(turns[0]!.dialogueId, 'current-dialogue'); assert.equal(turns[0]!.transcript, 'Current speech');
  } finally {
    voice.cleanup();
    if (previousPeer) Object.defineProperty(globalThis, 'RTCPeerConnection', previousPeer); else Reflect.deleteProperty(globalThis, 'RTCPeerConnection');
    if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator); else Reflect.deleteProperty(globalThis, 'navigator');
  }
});
