import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { id } from './contracts.js';
import type { Delivery } from './contracts.js';
import { BrokerClient, brokerToken, serverOrigin } from './broker-client.js';
import { StdioCodexRpc } from './codex-rpc.js';
import type { CodexRpc } from './codex-rpc.js';
import { initializeCodex, prepareCodexDelivery, sendPreparedCodexDelivery, verifyCodexPersistence } from './codex-delivery.js';
import type { CodexBinding } from './codex-delivery.js';

export interface DeliveryBroker {
  request<T>(path: string, data?: unknown): Promise<T>;
}
export async function relayDelivery(broker: DeliveryBroker, rpc: CodexRpc, binding: CodexBinding, delivery: Delivery, receiptFile?: string) {
  // No claim or write until the exact target has passed preflight.
  const prepared = await prepareCodexDelivery(rpc, binding, delivery);
  const claimed = await broker.request<Delivery>(`/api/deliveries/${delivery.id}/claim`, {});
  if (claimed.id !== delivery.id || claimed.text !== delivery.text || claimed.status !== 'claimed') throw new Error('Unexpected claim result; delivery outcome requires reconciliation.');
  let receipt;
  try { receipt = await sendPreparedCodexDelivery(rpc, prepared); }
  catch {
    const outcome = await broker.request<Delivery>(`/api/deliveries/${delivery.id}/receipt`, { status: 'unknown', receipt: 'Codex mutation had no verified acknowledgment; automatic resend disabled.' });
    return { id: delivery.id, status: outcome.status === 'delivered' ? 'delivered' as const : 'unknown' as const };
  }
  const accepted = await broker.request<Delivery>(`/api/deliveries/${delivery.id}/receipt`, { status: 'accepted', receipt: JSON.stringify(receipt) });
  if (accepted.status === 'delivered') return { id: delivery.id, status: 'delivered' as const };
  if (receiptFile) {
    let persisted = false;
    try { persisted = await verifyCodexPersistence(receiptFile, binding.sessionId, prepared.marker); } catch { /* protocol acceptance remains valid */ }
    if (persisted) {
      await broker.request(`/api/deliveries/${delivery.id}/receipt`, { status: 'delivered',
        receipt: JSON.stringify({ level: 'local-persistence-readback', mode: prepared.mode, modelActionVerified: false }) });
      return { id: delivery.id, status: 'delivered' as const };
    }
  }
  return { id: delivery.id, status: 'accepted' as const };
}

async function main() {
  const { values } = parseArgs({ options: {
    project: { type: 'string' }, session: { type: 'string' }, workspace: { type: 'string' },
    epoch: { type: 'string', default: '0' }, mode: { type: 'string', default: 'active-turn' },
    'codex-bin': { type: 'string' }, 'receipt-file': { type: 'string' }, watch: { type: 'boolean', default: false },
    url: { type: 'string', default: 'http://127.0.0.1:4317' },
  } });
  const projectId = id.parse(values.project), sessionId = id.parse(values.session);
  if (!values.workspace || !values['codex-bin'] || !['active-turn', 'next-turn-context'].includes(values.mode!)) throw new Error('An explicit workspace, Codex executable and supported mode are required.');
  const epoch = Number(values.epoch); if (!Number.isSafeInteger(epoch) || epoch < 0) throw new Error('Invalid epoch.');
  if (process.platform === 'win32' && !values['codex-bin'].toLowerCase().endsWith('.exe')) throw new Error('On Windows select the actual codex.exe, not a shell wrapper.');
  const origin = serverOrigin(values.url!), broker = new BrokerClient(origin, await brokerToken(origin));
  const binding: CodexBinding = { projectId, sessionId, epoch, workspace: resolve(values.workspace), mode: values.mode as CodexBinding['mode'] };
  // proxy attaches to the configured local daemon. Never start/resume a target
  // thread or start a model turn as an implicit delivery fallback.
  const child = spawn(values['codex-bin'], ['app-server', 'proxy'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stderr.resume();
  const rpc = new StdioCodexRpc(child.stdout, child.stdin);
  let stopping = false;
  child.on('error', () => { stopping = true; rpc.close(); });
  process.once('SIGINT', () => { stopping = true; }); process.once('SIGTERM', () => { stopping = true; });
  try {
    await initializeCodex(rpc);
    do {
      const path = `/api/deliveries?projectId=${encodeURIComponent(projectId)}&adapter=codex&sessionId=${encodeURIComponent(sessionId)}`;
      const result = await broker.request<{ deliveries: Delivery[] }>(path);
      for (const delivery of result.deliveries.filter(d => d.status === 'queued' && d.epoch === epoch && d.contextCurrent !== false)) {
        if (stopping) break;
        try { console.log(JSON.stringify(await relayDelivery(broker, rpc, binding, delivery, values['receipt-file']))); }
        catch { console.error(JSON.stringify({ id: delivery.id, status: 'deferred_or_unknown', message: 'Inspect broker state before any retry; no target was resumed.' })); }
      }
      if (!values.watch || stopping) break;
      await delay(2000);
    } while (!stopping);
  } finally {
    rpc.close();
    if (child.exitCode === null) await Promise.race([new Promise(resolveExit => child.once('exit', resolveExit)), delay(3000)]);
    if (child.exitCode === null) child.kill(); // this exact owned proxy, never the target daemon
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main().catch(() => { console.error('Codex relay failed. Check the explicit local daemon binding and broker state. No session was automatically resumed.'); process.exitCode = 1; });
}
