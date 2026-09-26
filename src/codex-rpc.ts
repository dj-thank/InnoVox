import type { Readable, Writable } from 'node:stream';

export interface CodexRpc { request(method: string, params?: unknown): Promise<unknown>; notify(method: string, params?: unknown): void; }
export class StdioCodexRpc implements CodexRpc {
  private nextId = 0;
  private pending = new Map<number, { method: string; resolve: (result: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private closed = false;
  private buffer = Buffer.alloc(0);
  constructor(private input: Readable, private output: Writable, private timeoutMs = 10_000) {
    const receive = (line: string) => {
      let message: { id?: number; method?: string; result?: unknown; error?: { code?: number } };
      try { message = JSON.parse(line); } catch { this.close(); return; }
      if (!message || typeof message !== 'object' || Array.isArray(message)) { this.close(); return; }
      // Server requests/notifications are not responses, even when their ID
      // happens to equal one of ours. Never resolve another client's approvals.
      if (message.method || typeof message.id !== 'number') return;
      const call = this.pending.get(message.id); if (!call) return;
      clearTimeout(call.timer); this.pending.delete(message.id);
      if (message.error) call.reject(new Error(`Codex rejected ${call.method} (${message.error.code ?? 'unknown'}); no automatic retry.`));
      else call.resolve(message.result);
    };
    input.on('data', (chunk: Buffer | string) => {
      if (this.closed) return;
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      for (let offset = 0; offset < bytes.length && !this.closed; offset += 65536) {
        this.buffer = Buffer.concat([this.buffer, bytes.subarray(offset, offset + 65536)]);
        let newline: number;
        while ((newline = this.buffer.indexOf(10)) >= 0 && !this.closed) {
          if (newline > 2_000_000) { this.close(); return; }
          const line = this.buffer.subarray(0, newline).toString('utf8'); this.buffer = this.buffer.subarray(newline + 1);
          if (line.trim()) receive(line);
        }
        if (this.buffer.length > 2_000_000) { this.close(); return; }
      }
    });
    input.on('end', () => this.close()); input.on('error', () => this.close()); output.on('error', () => this.close());
  }
  request(method: string, params: unknown = {}): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error('Codex connection is closed.'));
    if (this.pending.size >= 32) return Promise.reject(new Error('Codex RPC queue is full.'));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Codex RPC timed out; outcome may be unknown.')); }, this.timeoutMs);
      this.pending.set(id, { method, resolve, reject, timer });
      try { this.output.write(JSON.stringify({ method, params, id }) + '\n'); }
      catch { clearTimeout(timer); this.pending.delete(id); reject(new Error('Codex RPC write failed; outcome may be unknown.')); }
    });
  }
  notify(method: string, params?: unknown) {
    if (this.closed) throw new Error('Codex connection is closed.');
    this.output.write(JSON.stringify({ method, params }) + '\n');
  }
  close() {
    if (this.closed) return; this.closed = true;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('Codex connection closed; outcome may be unknown.')); }
    this.pending.clear(); this.buffer = Buffer.alloc(0); this.input.pause(); this.output.end();
  }
}
