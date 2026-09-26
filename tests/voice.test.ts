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
