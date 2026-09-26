import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export function serverOrigin(value: string): URL {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Use a plain InnoVox server origin.');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
    throw new Error('Remote InnoVox connections require HTTPS.');
  }
  return url;
}
export async function brokerToken(origin: URL): Promise<string> {
  let token = process.env.INNOVOX_ACCESS_TOKEN?.trim();
  if (!token && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) {
    try { token = (await readFile(resolve('.innovox/access-token'), 'utf8')).trim(); } catch { /* explicit error below */ }
  }
  if (!token || token.length < 32) throw new Error('Configure the InnoVox access token; never pass it in command arguments.');
  return token;
}
export class BrokerClient {
  constructor(readonly origin: URL, private token: string) {}
  async request<T>(path: string, data?: unknown): Promise<T> {
    const url = new URL(path, this.origin);
    if (url.origin !== this.origin.origin) throw new Error('Unexpected broker destination.');
    const response = await fetch(url, {
      method: data === undefined ? 'GET' : 'POST', redirect: 'error',
      headers: { Authorization: `Bearer ${this.token}`, ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }), signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`InnoVox returned HTTP ${response.status}. Operation was not automatically retried.`); }
    const reader = response.body?.getReader(), chunks: Uint8Array[] = [];
    let bytes = 0;
    if (!reader) throw new Error('InnoVox returned an empty response.');
    try {
      while (true) {
        const part = await reader.read(); if (part.done) break;
        bytes += part.value.length;
        if (bytes > 2_000_000) { await reader.cancel(); throw new Error('InnoVox response exceeded the client limit.'); }
        chunks.push(part.value);
      }
    } finally { reader.releaseLock(); }
    const text = Buffer.concat(chunks, bytes).toString('utf8');
    try { return JSON.parse(text) as T; } catch { throw new Error('InnoVox returned unsupported JSON.'); }
  }
}
