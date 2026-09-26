import { open, stat } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import type { ConversationEvent } from './contracts.js';
import { normalizeLine } from './capture.js';

export type CaptureBinding = { projectId: string; adapter: 'codex' | 'claude'; sessionId: string; epoch: number };
export class CaptureReader {
  private handle?: FileHandle;
  private identity?: { ino: number; dev: number };
  private offset = 0;
  private pending = Buffer.alloc(0);
  private lineNumber = 1;
  private started = false;
  private failed = false;
  constructor(readonly file: string, readonly binding: CaptureBinding, private send: (event: ConversationEvent) => Promise<unknown>) {}
  async poll(maxBytes = 256 * 1024): Promise<{ messages: number; skipped: number; remaining: boolean; partialBytes: number }> {
    if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 1024 * 1024) throw new Error('Invalid capture chunk budget.');
    if (this.failed) throw new Error('Capture was paused after an uncertain operation. Reopen the same source to replay by identity.');
    let messages = 0, skipped = 0, read = 0;
    try {
      const current = await stat(this.file);
      if (!current.isFile()) throw new Error('Capture source is no longer a regular file.');
      if (!this.handle) { this.handle = await open(this.file, 'r'); this.identity ??= { ino: current.ino, dev: current.dev }; }
      const opened = await this.handle.stat();
      if (current.ino !== this.identity?.ino || current.dev !== this.identity.dev || current.size < this.offset) {
        throw new Error('Source rotated or truncated. Select a new epoch before continuing.');
      }
      if (opened.ino !== current.ino || opened.dev !== current.dev) throw new Error('Source changed while opening it.');
      if (!this.started) {
        await this.send({ schemaVersion: 1, eventId: 'session-start', projectId: this.binding.projectId,
          source: { adapter: this.binding.adapter, sessionId: this.binding.sessionId, epoch: this.binding.epoch },
          sequence: 0, occurredAt: '1970-01-01T00:00:00.000Z', kind: 'session.started', origin: 'human',
          payload: { profile: this.binding.adapter + '-message-log-v1' } });
        this.started = true;
      }
      while (read < maxBytes) {
        const buffer = Buffer.alloc(Math.min(65536, maxBytes - read));
        const part = await this.handle.read(buffer, 0, buffer.length, this.offset);
        if (!part.bytesRead) break;
        this.offset += part.bytesRead; read += part.bytesRead;
        this.pending = Buffer.concat([this.pending, buffer.subarray(0, part.bytesRead)]);
        let end: number;
        while ((end = this.pending.indexOf(10)) >= 0) {
          if (end > 1_000_000) throw new Error('Source record exceeds the 1 MB limit.');
          const raw = this.pending.subarray(0, end).toString('utf8').replace(/\r$/, '');
          if (raw.trim()) {
            const events = normalizeLine(raw, this.lineNumber, this.binding);
            for (const event of events) { await this.send(event); messages++; }
            if (!events.length) skipped++;
          }
          this.pending = this.pending.subarray(end + 1); this.lineNumber++;
        }
        if (this.pending.length > 1_000_000) throw new Error('Incomplete source record exceeds the 1 MB limit.');
      }
      return { messages, skipped, remaining: this.offset < current.size, partialBytes: this.pending.length };
    } catch (error) { this.failed = true; throw error; }
    finally { await this.close(); }
  }
  async close() { await this.handle?.close(); this.handle = undefined; }
}
