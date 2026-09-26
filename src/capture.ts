import { createHash } from 'node:crypto';
import { open, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { eventSchema, id } from './contracts.js';
import type { ConversationEvent } from './contracts.js';

type CaptureContext = { projectId: string; adapter: 'codex' | 'claude'; sessionId: string; epoch: number };
function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
/** Only rendered message text, never hidden reasoning or tool arguments/results. */
export function normalizeLine(raw: string, lineNumber: number, context: CaptureContext): ConversationEvent[] {
  let parsed: unknown;
  try { parsed = JSON.parse(raw) as unknown; }
  catch { throw new Error(`Invalid JSONL record at line ${lineNumber}; source content was not logged.`); }
  const record = object(parsed); if (!record) return [];
  if (context.adapter === 'codex' && record.type === 'session_meta') {
    const sourceId = object(record.payload)?.id;
    if (typeof sourceId === 'string' && sourceId !== context.sessionId) throw new Error('Selected session id does not match Codex metadata.');
  }
  if (context.adapter === 'claude' && typeof record.sessionId === 'string' && record.sessionId !== context.sessionId) {
    throw new Error('Selected session id does not match Claude metadata.');
  }
  let message: Record<string, unknown> | undefined;
  if (context.adapter === 'codex' && record.type === 'response_item') {
    const payload = object(record.payload); if (payload?.type === 'message') message = payload;
  }
  if (context.adapter === 'claude' && ['user', 'assistant'].includes(String(record.type))) message = object(record.message);
  if (!message || !['user', 'assistant'].includes(String(message.role))) return [];
  const blocks = message.content;
  const text = typeof blocks === 'string' ? blocks : Array.isArray(blocks) ? blocks.map(b => {
    const block = object(b); return block && ['text', 'input_text', 'output_text'].includes(String(block.type)) && typeof block.text === 'string' ? block.text : '';
  }).filter(Boolean).join('\n') : '';
  if (!text.trim()) return [];
  const marker = /^\[innovox-delivery:([A-Za-z0-9_.:-]{1,128}):([a-f0-9]{64})\]\n/.exec(text);
  const relay = message.role === 'user' && marker && text.length <= 15000 &&
    createHash('sha256').update(text.slice(marker[0].length)).digest('hex') === marker[2]
    ? { deliveryId: marker[1]!, digest: marker[2]! } : undefined;
  const timestamp = typeof record.timestamp === 'string' && Number.isFinite(Date.parse(record.timestamp))
    ? new Date(record.timestamp).toISOString() : '1970-01-01T00:00:00.000Z';
  const events: ConversationEvent[] = [];
  // Chunks use deterministic identities so restarting from the start is idempotent.
  for (let offset = 0; offset < text.length; offset += 15000) {
    const part = offset / 15000;
    events.push(eventSchema.parse({ schemaVersion: 1,
      eventId: createHash('sha256').update(`${lineNumber}:${part}:${raw}`).digest('hex'),
      projectId: context.projectId, source: { adapter: context.adapter, sessionId: context.sessionId, epoch: context.epoch },
      sequence: lineNumber * 1000 + part, occurredAt: timestamp, kind: 'message',
      origin: relay ? 'innovox' : message.role === 'user' ? 'human' : 'agent',
      payload: { role: message.role, text: text.slice(offset, offset + 15000), ...(relay ? { relay } : {}) },
    }));
  }
  return events;
}

async function main() {
  const { values } = parseArgs({ options: {
    file: { type: 'string' }, project: { type: 'string' }, session: { type: 'string' }, adapter: { type: 'string' },
    epoch: { type: 'string', default: '0' }, url: { type: 'string', default: 'http://127.0.0.1:4317' }, follow: { type: 'boolean', default: false },
  } });
  if (!values.file || !values.project || !values.session || !['codex', 'claude'].includes(values.adapter ?? '')) {
    throw new Error('Required: --file <selected JSONL> --project <id> --session <id> --adapter codex|claude [--follow] [--epoch N].');
  }
  const token = process.env.INNOVOX_ACCESS_TOKEN;
  if (!token || token.length < 32) throw new Error('INNOVOX_ACCESS_TOKEN is required. Never pass it as an argument.');
  const url = new URL(values.url!);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Use a plain origin URL.');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
    throw new Error('A remote collector endpoint must use HTTPS.');
  }
  const context: CaptureContext = { projectId: id.parse(values.project), sessionId: id.parse(values.session),
    adapter: values.adapter as CaptureContext['adapter'], epoch: Number(values.epoch) };
  if (!Number.isSafeInteger(context.epoch) || context.epoch < 0) throw new Error('Invalid epoch.');
  const file = resolve(values.file), original = await stat(file);
  if (!original.isFile()) throw new Error('The selected source must be a regular file.');
  let offset = 0, lineNumber = 1, pending = Buffer.alloc(0), sent = 0, skipped = 0;
  const handle = await open(file, 'r');
  const send = async (event: unknown) => {
    const response = await fetch(new URL('/api/events', url), { method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(event), signal: AbortSignal.timeout(15_000) });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Capture rejected (HTTP ${response.status}); no automatic retry. Restart with the same source to resume by deduplication.`); }
    await response.body?.cancel();
  };
  try {
    await send({ schemaVersion: 1, eventId: 'session-start', projectId: context.projectId,
      source: { adapter: context.adapter, sessionId: context.sessionId, epoch: context.epoch }, sequence: 0,
      occurredAt: '1970-01-01T00:00:00.000Z', kind: 'session.started', origin: 'human',
      payload: { profile: context.adapter + '-message-log-v1' } });
    do {
      const current = await stat(file);
      if (current.ino !== original.ino || current.dev !== original.dev || current.size < offset) {
        throw new Error('Source rotated or truncated. Stop and select a new session epoch; old bytes will not be relabeled.');
      }
      const chunk = Buffer.alloc(65536);
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, offset);
      if (!bytesRead) {
        if (!values.follow) break;
        await delay(500); continue;
      }
      offset += bytesRead; pending = Buffer.concat([pending, chunk.subarray(0, bytesRead)]);
      let end: number;
      while ((end = pending.indexOf(10)) >= 0) {
        if (end > 1_000_000) throw new Error('Source record exceeds the 1 MB limit.');
        const raw = pending.subarray(0, end).toString('utf8').replace(/\r$/, ''); pending = pending.subarray(end + 1);
        if (raw.trim()) {
          const events = normalizeLine(raw, lineNumber, context);
          if (!events.length) skipped++;
          for (const event of events) { await send(event); sent++; }
        }
        lineNumber++;
      }
      if (pending.length > 1_000_000) throw new Error('Incomplete source record exceeds the 1 MB limit.');
    } while (true);
    console.log(JSON.stringify({ messages: sent, skippedRecords: skipped, incompleteTrailingBytes: pending.length }));
  } finally { await handle.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main().catch(error => { console.error(error instanceof Error ? error.message : 'Capture failed.'); process.exitCode = 1; });
}
