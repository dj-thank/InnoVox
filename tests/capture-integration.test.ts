import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, mkdtempSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';
import type { AddressInfo } from 'node:net';
import { Store } from '../src/store.js';
import { OpenAIProvider } from '../src/provider.js';
import { buildServer } from '../src/server.js';

test('real collector process handles incomplete tails and idempotent re-import', async () => {
  const scratch = resolve('.innovox'); mkdirSync(scratch, { recursive: true });
  const dir = mkdtempSync(join(scratch, 'capture-test-')), file = join(dir, 'synthetic.jsonl');
  const store = new Store(':memory:');
  const project = store.createProject({ name: 'Integration', conditions: [{ id: 'local', text: 'Local first', reason: 'Offline' }] });
  const token = 'synthetic-test-token-not-for-production';
  const { server } = buildServer({ store, token, root: process.cwd(), origin: 'http://127.0.0.1', provider: new OpenAIProvider(undefined) });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const first = JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '日本語の会話' }] } });
  const second = JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'ローカル保存を維持してください' }] } });
  writeFileSync(file, first + '\n' + second.slice(0, 20), 'utf8');
  const run = () => promisify(execFile)(process.execPath, ['dist/src/capture.js', '--file', file,
    '--project', project.id, '--session', 'source', '--adapter', 'codex', '--url', url],
    { env: { ...process.env, INNOVOX_ACCESS_TOKEN: token }, timeout: 15_000, encoding: 'utf8' });
  try {
    const result = JSON.parse((await run()).stdout);
    assert.ok(result.incompleteTrailingBytes > 0);
    assert.equal(store.snapshot(project.id, 'codex', 'source').events.length, 1);
    appendFileSync(file, second.slice(20) + '\n', 'utf8');
    await run(); await run();
    const snapshot = store.snapshot(project.id, 'codex', 'source');
    assert.equal(snapshot.events.length, 2);
    assert.equal(snapshot.events[1]?.payload.text, 'ローカル保存を維持してください');
  } finally {
    server.close(); server.closeAllConnections(); await once(server, 'close'); store.close();
    assert.ok(resolve(dir).startsWith(scratch + sep)); rmSync(dir, { recursive: true });
  }
});
