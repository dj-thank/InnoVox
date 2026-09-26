import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { DomainError } from './contracts.js';

const digest = (value: string) => createHash('sha256').update(value).digest();
const same = (a: Buffer, b: Buffer) => timingSafeEqual(a, b);
/** Single-user browser pairing. Codes and browser tokens disappear on restart. */
export class BrowserPairing {
  private pending?: { digest: Buffer; expires: number; attempts: number };
  private sessions = new Map<string, number>();
  constructor(private now = () => Date.now()) {}
  create() {
    const code = String(randomInt(0, 100_000_000)).padStart(8, '0');
    const expires = this.now() + 5 * 60_000;
    this.pending = { digest: digest(code), expires, attempts: 0 };
    return { code: code.slice(0, 4) + '-' + code.slice(4), expiresAt: new Date(expires).toISOString() };
  }
  exchange(code: string) {
    const pending = this.pending;
    if (!pending || pending.expires <= this.now() || pending.attempts >= 5) {
      this.pending = undefined; throw new DomainError('pairing_expired', '接続コードが無効または期限切れです。新しいコードを発行してください。', 401);
    }
    pending.attempts++;
    const candidate = code.replace('-', '');
    if (!/^\d{8}$/.test(candidate) || !same(pending.digest, digest(candidate))) {
      throw new DomainError('pairing_invalid', '接続コードが一致しません。', 401);
    }
    this.pending = undefined; this.prune();
    if (this.sessions.size >= 16) throw new DomainError('pairing_limit', '接続端末の上限です。既存端末の接続を解除してください。', 429);
    const accessToken = randomBytes(32).toString('base64url'), expires = this.now() + 12 * 60 * 60_000;
    this.sessions.set(digest(accessToken).toString('hex'), expires);
    return { accessToken, expiresAt: new Date(expires).toISOString() };
  }
  valid(token: string) { this.prune(); return this.sessions.has(digest(token).toString('hex')); }
  revoke(token: string) { this.sessions.delete(digest(token).toString('hex')); }
  private prune() { for (const [token, expiry] of this.sessions) if (expiry <= this.now()) this.sessions.delete(token); }
}
