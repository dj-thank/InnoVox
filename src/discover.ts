import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { discoverSessions } from './discovery.js';
import type { DiscoveryCache } from './discovery.js';
import { CaptureReader } from './capture-reader.js';
import { BrokerClient, brokerToken, serverOrigin } from './broker-client.js';
import { id } from './contracts.js';

async function main() {
  const { values } = parseArgs({ options: {
    root: { type: 'string', multiple: true }, workspace: { type: 'string' }, project: { type: 'string' },
    collect: { type: 'boolean', default: false }, watch: { type: 'boolean', default: false },
    epoch: { type: 'string', default: '0' }, limit: { type: 'string', default: '1000' },
    url: { type: 'string', default: 'http://127.0.0.1:4317' },
  } });
  if (!values.root?.length || !values.workspace) throw new Error('Required: --root <session directory> --workspace <project directory>.');
  if (values.watch && !values.collect) throw new Error('--watch requires an explicit --collect selection.');
  const epoch = Number(values.epoch);
  if (!Number.isSafeInteger(epoch) || epoch < 0) throw new Error('Invalid source epoch.');
  const projectId = values.collect ? id.parse(values.project) : undefined;
  const origin = serverOrigin(values.url!);
  const client = values.collect ? new BrokerClient(origin, await brokerToken(origin)) : undefined;
  const readers = new Map<string, CaptureReader>();
  const cache: DiscoveryCache = new Map(); let previousSummary = '';
  const paused = new Set<string>(); let stopping = false;
  process.once('SIGINT', () => { stopping = true; }); process.once('SIGTERM', () => { stopping = true; });
  try {
    do {
      const report = await discoverSessions(values.root, values.workspace, { maxFiles: Number(values.limit), cache });
      let messages = 0;
      for (const source of report.sources) {
        const key = source.adapter + ':' + source.sessionId;
        if (!client || !projectId || paused.has(key)) continue;
        let reader = readers.get(key);
        if (reader && reader.file !== source.file) { paused.add(key); continue; }
        if (!reader) {
          reader = new CaptureReader(source.file, { projectId, adapter: source.adapter, sessionId: source.sessionId, epoch },
            event => client.request('/api/events', event));
          readers.set(key, reader);
        }
        try {
          // Finite collection drains each source; watch mode gives every source a
          // bounded chunk per pass so one huge file cannot monopolize the loop.
          let more = true;
          while (more && !stopping) {
            const result = await reader.poll(); messages += result.messages;
            more = result.remaining && !values.watch;
          }
        } catch { paused.add(key); }
      }
      const summary = JSON.stringify({ inspectedFiles: report.inspectedFiles, matchingSessions: report.sources.length,
        metadataReads: report.metadataReads,
        skippedFiles: report.skippedFiles, ambiguousSessions: report.ambiguousSessions,
        limitReached: report.limitReached, messagesImported: messages, pausedSessions: [...paused],
        sessions: report.sources.map(s => ({ adapter: s.adapter, sessionId: s.sessionId, version: s.version })) });
      if (summary !== previousSummary || messages > 0) { console.log(summary); previousSummary = summary; }
      if (!values.watch || stopping) break;
      await delay(2000);
    } while (!stopping);
    if (paused.size) process.exitCode = 2;
  } finally { await Promise.all([...readers.values()].map(r => r.close())); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main().catch(() => { console.error('Discovery failed. Check the explicit roots, workspace, access token and server. No source content was logged.'); process.exitCode = 1; });
}
