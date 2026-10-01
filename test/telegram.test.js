import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, webhookSecret, handleTelegram } from '../src/telegram.js';

test('escapeHtml escapes quotes so values are safe inside attributes', () => {
  assert.equal(escapeHtml(`a"b'c<d>&`), 'a&quot;b&#39;c&lt;d&gt;&amp;');
  const attr = `<a href="https://t.me/${escapeHtml('x" onmouseover="alert(1)')}">`;
  assert.ok(!/href="[^"]*"[^>]*onmouseover/.test(attr), 'attribute must not break out');
});

test('webhookSecret is stable, hex, and depends on the bot token', async () => {
  const a = await webhookSecret({ TELEGRAM_BOT_TOKEN: 't1' });
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(a, await webhookSecret({ TELEGRAM_BOT_TOKEN: 't1' }));
  assert.notEqual(a, await webhookSecret({ TELEGRAM_BOT_TOKEN: 't2' }));
});

const post = (headers) => new Request('https://x/tg/webhook', { method: 'POST', headers, body: '{}' });

test('webhook rejects a missing or wrong secret', async () => {
  const env = { TELEGRAM_BOT_TOKEN: 't1' };
  assert.equal((await handleTelegram(post({}), env, {})).status, 403);
  assert.equal((await handleTelegram(post({ 'x-telegram-bot-api-secret-token': 'nope' }), env, {})).status, 403);
  assert.equal((await handleTelegram(post({ 'x-telegram-bot-api-secret-token': 'x' }), {}, {})).status, 403);
});

test('webhook accepts the right secret', async () => {
  const env = { TELEGRAM_BOT_TOKEN: 't1' };
  const secret = await webhookSecret(env);
  const r = await handleTelegram(post({ 'x-telegram-bot-api-secret-token': secret }), env, {});
  assert.equal(r.status, 200);
});
