import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randToken, timingSafeEqual, checkAdmin } from '../src/util.js';

test('randToken has the requested length and alphabet', () => {
  for (const len of [1, 24, 100]) {
    const t = randToken(len);
    assert.equal(t.length, len);
    assert.match(t, /^[a-z0-9]+$/);
  }
});

test('randToken does not repeat', () => {
  const seen = new Set(Array.from({ length: 1000 }, () => randToken(24)));
  assert.equal(seen.size, 1000);
});

test('timingSafeEqual accepts equal and rejects different strings', async () => {
  assert.equal(await timingSafeEqual('secret', 'secret'), true);
  assert.equal(await timingSafeEqual('secret', 'secreT'), false);
  assert.equal(await timingSafeEqual('secret', 'secret-longer'), false);
});

const req = (headers = {}) => new Request('https://x/api/stats', { headers });

test('checkAdmin only accepts the x-admin-key header', async () => {
  const env = { ADMIN_KEY: 'k3y' };
  assert.equal(await checkAdmin(req({ 'x-admin-key': 'k3y' }), env), true);
  assert.equal(await checkAdmin(req({ 'x-admin-key': 'nope' }), env), false);
  assert.equal(await checkAdmin(req(), env), false);
  // a key in the query string must no longer authenticate
  assert.equal(await checkAdmin(new Request('https://x/api/stats?key=k3y'), env), false);
});

test('checkAdmin rejects everything when ADMIN_KEY is unset', async () => {
  assert.equal(await checkAdmin(req({ 'x-admin-key': '' }), {}), false);
  assert.equal(await checkAdmin(req({ 'x-admin-key': 'x' }), {}), false);
});
