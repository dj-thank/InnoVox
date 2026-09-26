import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { once } from 'node:events';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { StdioCodexRpc } from '../src/codex-rpc.js';
import type { CodexRpc } from '../src/codex-rpc.js';
import { prepareCodexDelivery, verifyCodexPersistence } from '../src/codex-delivery.js';
import { relayDelivery } from '../src/delivery-bridge.js';
import type { Delivery } from '../src/contracts.js';

const delivery: Delivery = { id: 'd', consultationId: 'q', projectId: 'p', adapter: 'codex', sessionId: 's', epoch: 0,
  text: 'Question: Keep offline? Answer: Yes.', status: 'queued', receipt: null };
const binding = { projectId: 'p', sessionId: 's', epoch: 0, workspace: '/workspace', mode: 'active-turn' as const };
function rpcFixture(active = true, failMutation = false) {
  const calls: Array<{ method: string; params: unknown }> = [];
  const rpc: CodexRpc = { notify() {}, async request(method, params) {
    calls.push({ method, params });
    if (method === 'thread/loaded/list') return { data: ['s'] };
    if (method === 'thread/read') return { thread: { id: 's', cwd: '/workspace', status: { type: active ? 'active' : 'idle' } } };
    if (method === 'thread/turns/list') return { data: [{ id: 't', status: 'inProgress' }] };
    if (failMutation) throw new Error('lost response');
    if (method === 'turn/steer') return { turnId: 't' };
    if (method === 'thread/inject_items') return {};
    throw new Error('unexpected method');
  } }; return { rpc, calls };
}
test('active-turn delivery pins thread, workspace, epoch and expected turn', async () => {
  const { rpc, calls } = rpcFixture(); const prepared = await prepareCodexDelivery(rpc, binding, delivery);
  assert.equal(prepared.method, 'turn/steer'); assert.equal(prepared.expectedTurnId, 't');
  assert.ok(JSON.stringify(prepared.params).includes('Question: Keep offline?'));
  assert.ok(!calls.some(c => ['thread/resume', 'thread/start', 'turn/start'].includes(c.method)));
  await assert.rejects(prepareCodexDelivery(rpc, { ...binding, epoch: 1 }, delivery), /binding/);
  await assert.rejects(prepareCodexDelivery(rpc, { ...binding, workspace: '/another' }, delivery), /workspace/);
});
test('idle threads are never implicitly resumed; context delivery is an explicit mode', async () => {
  const { rpc } = rpcFixture(false);
  await assert.rejects(prepareCodexDelivery(rpc, binding, delivery), /No active turn/);
  assert.equal((await prepareCodexDelivery(rpc, { ...binding, mode: 'next-turn-context' }, delivery)).method, 'thread/inject_items');
});
test('protocol acceptance is not persisted delivery, and a lost acknowledgment becomes unknown', async () => {
  for (const fail of [false, true]) {
    const { rpc, calls } = rpcFixture(true, fail); const receipts: string[] = [];
    const broker = { async request<T>(path: string, data?: unknown): Promise<T> {
      if (path.endsWith('/claim')) return { ...delivery, status: 'claimed' } as T;
      receipts.push((data as { status: string }).status); return {} as T;
    } };
    const result = await relayDelivery(broker, rpc, binding, delivery);
    assert.equal(result.status, fail ? 'unknown' : 'accepted');
    assert.deepEqual(receipts, [fail ? 'unknown' : 'accepted']);
    assert.equal(calls.filter(c => c.method === 'turn/steer').length, 1);
  }
});
test('bidirectional server requests do not resolve a client request or approve anything', async () => {
  const input = new PassThrough(), output = new PassThrough();
  const rpc = new StdioCodexRpc(input, output, 1000);
  const firstWrite = once(output, 'data'); const result = rpc.request('thread/read', { threadId: 's' });
  const request = JSON.parse(String((await firstWrite)[0]));
  input.write(JSON.stringify({ id: request.id, method: 'item/permissions/requestApproval', params: {} }) + '\n');
  input.write(JSON.stringify({ id: request.id, result: { thread: 'correct-response' } }) + '\n');
  assert.deepEqual(await result, { thread: 'correct-response' }); rpc.close();
});
test('RPC framing rejects an oversized unterminated message', async () => {
  const input = new PassThrough(), output = new PassThrough();
  const rpc = new StdioCodexRpc(input, output, 1000);
  const result = rpc.request('thread/read');
  const assertion = assert.rejects(result, /closed/);
  input.write('x'.repeat(2_100_000)); await assertion; rpc.close();
});

test('RPC framing closes unsupported JSON values without an uncaught event error', async () => {
  const input = new PassThrough(), output = new PassThrough();
  const rpc = new StdioCodexRpc(input, output, 1000);
  const assertion = assert.rejects(rpc.request('thread/read'), /closed/);
  input.write('null\n'); await assertion; rpc.close();
});

test('persistence readback requires the correct session and complete digest-bound answer', async () => {
  const parent = resolve('.innovox'); await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, 'receipt-test-')), file = join(directory, 'synthetic.jsonl');
  const { marker } = await prepareCodexDelivery(rpcFixture().rpc, binding, delivery);
  const record = (text: string) => JSON.stringify({ type: 'session_meta', payload: { id: 's' } }) + '\n' +
    JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } }) + '\n';
  try {
    await writeFile(file, record(marker + '\n' + delivery.text), 'utf8');
    assert.equal(await verifyCodexPersistence(file, 's', marker), true);
    assert.equal(await verifyCodexPersistence(file, 'wrong-session', marker), false);
    await writeFile(file, record(marker + '\n' + delivery.text.slice(0, -1)), 'utf8');
    assert.equal(await verifyCodexPersistence(file, 's', marker), false);
  } finally { assert.ok(resolve(directory).startsWith(parent + sep)); await rm(directory, { recursive: true }); }
});
