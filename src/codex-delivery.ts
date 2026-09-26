import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { posix, win32 } from 'node:path';
import { z } from 'zod';
import type { Delivery } from './contracts.js';
import type { CodexRpc } from './codex-rpc.js';

export type CodexBinding = { projectId: string; sessionId: string; epoch: number; workspace: string;
  mode: 'active-turn' | 'next-turn-context' };
export type PreparedCodexDelivery = { method: 'turn/steer' | 'thread/inject_items'; params: unknown; marker: string;
  mode: CodexBinding['mode']; expectedTurnId?: string };
const samePath = (a: string, b: string) => /^[A-Za-z]:[\\/]/.test(a)
  ? win32.normalize(a).toLowerCase() === win32.normalize(b).toLowerCase() : posix.normalize(a) === posix.normalize(b);
export async function initializeCodex(rpc: CodexRpc) {
  const result = await rpc.request('initialize', { clientInfo: { name: 'innovox', version: '0.3.0' }, capabilities: { experimentalApi: true } });
  z.object({ userAgent: z.string() }).passthrough().parse(result);
  rpc.notify('initialized');
}
export async function prepareCodexDelivery(rpc: CodexRpc, binding: CodexBinding, delivery: Delivery): Promise<PreparedCodexDelivery> {
  if (delivery.projectId !== binding.projectId || delivery.adapter !== 'codex' || delivery.sessionId !== binding.sessionId || delivery.epoch !== binding.epoch) {
    throw new Error('Delivery does not match the explicit Codex binding.');
  }
  const loaded = z.object({ data: z.array(z.string()) }).passthrough().parse(await rpc.request('thread/loaded/list'));
  if (!loaded.data.includes(binding.sessionId)) throw new Error('The target thread is not loaded. InnoVox will not resume or create a second agent.');
  const read = z.object({ thread: z.object({ id: z.string(), cwd: z.string(), status: z.object({ type: z.string() }).passthrough() }).passthrough() })
    .passthrough().parse(await rpc.request('thread/read', { threadId: binding.sessionId, includeTurns: false }));
  if (read.thread.id !== binding.sessionId || !samePath(read.thread.cwd, binding.workspace)) throw new Error('Codex thread identity or workspace does not match.');
  const marker = `[innovox-delivery:${delivery.id}:${createHash('sha256').update(delivery.text).digest('hex')}]`;
  const text = marker + '\n' + delivery.text;
  if (binding.mode === 'active-turn') {
    if (read.thread.status.type !== 'active') throw new Error('No active turn. The queued answer was not sent.');
    const turns = z.object({ data: z.array(z.object({ id: z.string(), status: z.string() }).passthrough()) }).passthrough()
      .parse(await rpc.request('thread/turns/list', { threadId: binding.sessionId, limit: 1, sortDirection: 'desc', itemsView: 'notLoaded' }));
    const active = turns.data[0]; if (!active || active.status !== 'inProgress') throw new Error('Active turn could not be verified.');
    return { method: 'turn/steer', mode: binding.mode, marker, expectedTurnId: active.id,
      params: { threadId: binding.sessionId, expectedTurnId: active.id, clientUserMessageId: delivery.id, input: [{ type: 'text', text }] } };
  }
  if (read.thread.status.type !== 'idle') throw new Error('Context-only delivery requires a loaded idle thread.');
  return { method: 'thread/inject_items', mode: binding.mode, marker,
    params: { threadId: binding.sessionId, items: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text }] }] } };
}
export async function sendPreparedCodexDelivery(rpc: CodexRpc, prepared: PreparedCodexDelivery) {
  const result = await rpc.request(prepared.method, prepared.params);
  if (prepared.method === 'turn/steer') {
    const accepted = z.object({ turnId: z.string() }).parse(result);
    if (accepted.turnId !== prepared.expectedTurnId) throw new Error('Codex returned an unexpected turn identity.');
  }
  else z.object({}).strict().parse(result);
  return { level: 'protocol-accepted', mode: prepared.mode, modelActionVerified: false } as const;
}
/** Optional local persistence readback from an explicitly selected source file. */
export async function verifyCodexPersistence(file: string, sessionId: string, marker: string): Promise<boolean> {
  const expected = /^\[innovox-delivery:[A-Za-z0-9_.:-]{1,128}:([a-f0-9]{64})\]$/.exec(marker);
  if (!expected) return false;
  const handle = await open(file, 'r');
  try {
    const first = Buffer.alloc(1024 * 1024); const read = await handle.read(first, 0, first.length, 0);
    const head = first.subarray(0, read.bytesRead).toString('utf8').split('\n')[0] ?? '';
    let metadata: { type?: string; payload?: { id?: string } };
    try { metadata = JSON.parse(head); } catch { return false; }
    if (metadata.type !== 'session_meta' || metadata.payload?.id !== sessionId) return false;
    const info = await handle.stat(); const start = Math.max(0, info.size - 2 * 1024 * 1024);
    const tail = Buffer.alloc(info.size - start); const last = await handle.read(tail, 0, tail.length, start);
    const lines = tail.subarray(0, last.bytesRead).toString('utf8').split('\n');
    if (start > 0) lines.shift();
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const item = JSON.parse(line);
        if (item.type === 'response_item' && item.payload?.type === 'message' && item.payload.role === 'user' &&
          Array.isArray(item.payload.content) && item.payload.content.some((c: { type?: string; text?: string } | null) =>
            c?.type === 'input_text' && typeof c.text === 'string' && c.text.startsWith(marker + '\n') &&
            createHash('sha256').update(c.text.slice(marker.length + 1)).digest('hex') === expected[1])) return true;
      } catch { /* incomplete tail is not a receipt */ }
    }
    return false;
  } finally { await handle.close(); }
}
