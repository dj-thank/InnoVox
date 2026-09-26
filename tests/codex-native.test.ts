import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { AddressInfo } from 'node:net';
import { Store } from '../src/store.js';
import { StdioCodexRpc } from '../src/codex-rpc.js';
import { initializeCodex } from '../src/codex-delivery.js';
import { relayDelivery } from '../src/delivery-bridge.js';
import { CaptureReader } from '../src/capture-reader.js';
import { BrokerClient } from '../src/broker-client.js';
import { buildServer } from '../src/server.js';
import { OpenAIProvider } from '../src/provider.js';

const binary = process.env.INNOVOX_NATIVE_CODEX_BIN;
test('optional native Codex: scoped capture → answered question → persisted delivery, with no model turn',
  { skip: !binary, timeout: 30_000 }, async () => {
    const parent = resolve('.innovox'); mkdirSync(parent, { recursive: true });
    const directory = mkdtempSync(join(parent, 'native-codex-test-')), codexHome = join(directory, 'codex-home'); mkdirSync(codexHome);
    const child = spawn(binary!, ['app-server', '--stdio'], { cwd: directory, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, CODEX_HOME: codexHome, OPENAI_API_KEY: '', OPENAI_BASE_URL: '' } });
    writeFileSync(join(directory, 'owner.json'), JSON.stringify({ pid: child.pid, startedAt: new Date().toISOString(),
      owner: 'InnoVox native integration test', noModelTurnRequested: true }), 'utf8');
    child.stderr.resume(); const rpc = new StdioCodexRpc(child.stdout, child.stdin, 12_000);
    child.once('error', () => rpc.close());
    const store = new Store(':memory:');
    const project = store.createProject({ name: 'Synthetic native transport', conditions: [{ id: 'offline', text: 'Offline saves', reason: 'Travel' }] });
    const token = 'synthetic-test-token-not-for-production';
    const { server } = buildServer({ store, token, origin: 'http://127.0.0.1', root: process.cwd(), provider: new OpenAIProvider(undefined) });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const broker = new BrokerClient(new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}`), token);
    let reader: CaptureReader | undefined; let passed = false;
    try {
      await initializeCodex(rpc);
      const started = await rpc.request('thread/start', { cwd: directory, model: 'gpt-6-astra', sandbox: 'read-only', approvalPolicy: 'never' }) as { thread: { id: string; path: string } };
      const sessionId = started.thread.id, file = started.thread.path;
      await rpc.request('thread/inject_items', { threadId: sessionId, items: [{ type: 'message', role: 'assistant',
        content: [{ type: 'output_text', text: 'Synthetic plan: only save to the cloud.' }] }] });
      reader = new CaptureReader(file, { projectId: project.id, adapter: 'codex', sessionId, epoch: 0 }, e => broker.request('/api/events', e));
      let more = true; while (more) more = (await reader.poll()).remaining;
      const snapshot = store.snapshot(project.id, 'codex', sessionId);
      const plan = snapshot.events.find(e => e.payload.text === 'Synthetic plan: only save to the cloud.');
      assert.ok(plan);
      const q = store.propose(snapshot, { question: 'Keep offline?', reason: 'Important condition.', evidenceEventIds: [plan.eventId], conditionIds: ['offline'] });
      const { delivery } = store.answer(q.id, { answerId: 'synthetic-answer', text: 'Keep offline saves.', expectedVersion: 1, channel: 'typed' });
      const binding = { projectId: project.id, sessionId, epoch: 0, workspace: directory, mode: 'next-turn-context' as const };
      const receipt = await relayDelivery(broker, rpc, binding, delivery, file);
      assert.equal(receipt.status, 'delivered');
      assert.equal(store.deliveries()[0]?.status, 'delivered');
      await assert.rejects(relayDelivery(broker, rpc, binding, delivery, file), /HTTP 409/);
      const rows = readFileSync(file, 'utf8').split('\n').filter(line => line.includes(`[innovox-delivery:${delivery.id}:`));
      assert.equal(rows.length, 1);
      await reader.poll();
      assert.equal(store.snapshot(project.id, 'codex', sessionId).fingerprint, snapshot.fingerprint);
      passed = true;
    } finally {
      await reader?.close(); rpc.close();
      if (child.exitCode === null) await Promise.race([once(child, 'exit'), delay(4000)]);
      if (child.exitCode === null) { child.kill(); await once(child, 'exit'); }
      server.close(); server.closeAllConnections(); await once(server, 'close'); store.close();
      // Retain this ignored synthetic trace for readback instead of deleting
      // native-runtime files that may briefly remain locked on Windows.
      writeFileSync(join(directory, 'receipt.json'), JSON.stringify({ passed, codexExitCode: child.exitCode,
        noModelTurnRequested: true, modelActionVerified: false, humanAcceptance: false }, null, 2), 'utf8');
    }
  });
