import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserPairing } from '../src/pairing.js';
import { DomainError } from '../src/contracts.js';

test('pairing codes are one-use, short-lived and cannot survive a restart', () => {
  let now = Date.now(); const pairing = new BrowserPairing(() => now);
  const first = pairing.create(), browser = pairing.exchange(first.code);
  assert.equal(pairing.valid(browser.accessToken), true);
  assert.throws(() => pairing.exchange(first.code), DomainError);
  assert.equal(new BrowserPairing().valid(browser.accessToken), false);
  pairing.revoke(browser.accessToken); assert.equal(pairing.valid(browser.accessToken), false);
  const second = pairing.create(); now += 5 * 60_000 + 1;
  assert.throws(() => pairing.exchange(second.code), DomainError);
});
test('five wrong attempts invalidate a code and browser credentials expire', () => {
  let now = Date.now(); const pairing = new BrowserPairing(() => now), first = pairing.create();
  for (let i = 0; i < 5; i++) assert.throws(() => pairing.exchange('not-a-code'), DomainError);
  assert.throws(() => pairing.exchange(first.code), DomainError);
  const second = pairing.create(), browser = pairing.exchange(second.code);
  now += 12 * 60 * 60_000 + 1; assert.equal(pairing.valid(browser.accessToken), false);
});

test('full browser slots preserve a valid code for explicit owner recovery', () => {
  const pairing = new BrowserPairing();
  const tokens = Array.from({ length: 16 }, () => pairing.exchange(pairing.create().code).accessToken);
  const code = pairing.create().code;
  assert.throws(() => pairing.exchange(code), (error: unknown) => error instanceof DomainError && error.code === 'pairing_limit');
  pairing.revoke(tokens[0]!);
  assert.ok(pairing.valid(pairing.exchange(code).accessToken));
});
