import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';
import { discoverSessions } from '../src/discovery.js';
import type { DiscoveryCache } from '../src/discovery.js';
import { CaptureReader } from '../src/capture-reader.js';
import type { ConversationEvent } from '../src/contracts.js';

function fixture() {
  const parent = resolve('.innovox'); mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(join(parent, 'discovery-test-'));
  const logs = join(root, 'logs'), workspace = join(root, 'workspace'), other = join(root, 'other');
  for (const path of [logs, workspace, other]) mkdirSync(path);
  const codex = (id: string, cwd = workspace) => JSON.stringify({ type: 'session_meta', payload: { id, cwd, cli_version: 'fixture' } }) + '\n';
  const cleanup = () => { assert.ok(resolve(root).startsWith(parent + sep)); rmSync(root, { recursive: true }); };
  return { root, logs, workspace, other, codex, cleanup };
}
test('discovery finds matching Codex and Claude sessions without assuming folder names', async () => {
  const f = fixture();
  try {
    writeFileSync(join(f.logs, 'a.jsonl'), f.codex('codex-a'));
    writeFileSync(join(f.logs, 'b.jsonl'), JSON.stringify({ type: 'user', sessionId: 'claude-b', cwd: f.workspace,
      message: { role: 'user', content: 'Synthetic' } }) + '\n');
    writeFileSync(join(f.logs, 'c.jsonl'), f.codex('other-c', f.other));
    writeFileSync(join(f.logs, 'unrelated.txt'), 'not a session');
    const report = await discoverSessions([f.logs], f.workspace);
    assert.deepEqual(report.sources.map(s => s.sessionId).sort(), ['claude-b', 'codex-a']);
    assert.equal(report.inspectedFiles, 3); assert.equal(report.skippedFiles, 1);
  } finally { f.cleanup(); }
});
test('ambiguous duplicate sessions are excluded, and discovery bounds are visible', async () => {
  const f = fixture();
  try {
    writeFileSync(join(f.logs, 'one.jsonl'), f.codex('duplicate'));
    writeFileSync(join(f.logs, 'two.jsonl'), f.codex('duplicate'));
    const report = await discoverSessions([f.logs], f.workspace);
    assert.equal(report.sources.length, 0); assert.deepEqual(report.ambiguousSessions, ['codex:duplicate']);
    const bounded = await discoverSessions([f.logs], f.workspace, { maxFiles: 1 });
    assert.equal(bounded.inspectedFiles, 1); assert.equal(bounded.limitReached, true);
  } finally { f.cleanup(); }
});
test('unchanged files reuse metadata and changed files are inspected again', async () => {
  const f = fixture(), cache: DiscoveryCache = new Map();
  try {
    const file = join(f.logs, 'one.jsonl'); writeFileSync(file, f.codex('one'));
    assert.equal((await discoverSessions([f.logs], f.workspace, { cache })).metadataReads, 1);
    assert.equal((await discoverSessions([f.logs], f.workspace, { cache })).metadataReads, 0);
    appendFileSync(file, '{}\n');
    assert.equal((await discoverSessions([f.logs], f.workspace, { cache })).metadataReads, 1);
  } finally { f.cleanup(); }
});
test('a multiplexed reader preserves partial UTF-8 records and stops after uncertain send', async () => {
  const f = fixture(), file = join(f.logs, 'one.jsonl');
  const events: ConversationEvent[] = [];
  const first = JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '日本語の発言' }] } });
  writeFileSync(file, f.codex('one') + first.slice(0, 40));
  const reader = new CaptureReader(file, { projectId: 'p', adapter: 'codex', sessionId: 'one', epoch: 0 }, async e => { events.push(e); });
  try {
    assert.equal((await reader.poll()).messages, 0);
    appendFileSync(file, first.slice(40) + '\n');
    assert.equal((await reader.poll()).messages, 1);
    assert.equal(events.at(-1)?.payload.text, '日本語の発言');
    assert.equal((await reader.poll()).messages, 0);
    writeFileSync(file, '');
    await assert.rejects(reader.poll(), /rotated or truncated/);
    await assert.rejects(reader.poll(), /paused/);
  } finally { await reader.close(); f.cleanup(); }
});
