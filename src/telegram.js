import { randToken } from './util.js';

/**
 * Telegram Bot webhook。任何消息都返回一条新采集链接;/start 亦然。
 */
export async function handleTelegram(request, env, ctx) {
  const update = await request.json().catch(() => null);
  if (!update) return new Response('ok');

  const msg = update.message || update.edited_message;
  if (!msg || !msg.text) return new Response('ok');

  const chatId = msg.chat.id;
  const from = msg.from || {};
  const text = msg.text.trim();
  const [cmd, ...rest] = text.split(/\s+/);
  const label = cmd.startsWith('/') ? rest.join(' ') : text;

  ctx.waitUntil(cmdNew(env, chatId, from, label));
  return new Response('ok');
}

async function cmdNew(env, chatId, from, label) {
  try {
    const token = randToken(24);
    const firstName = [from.first_name, from.last_name].filter(Boolean).join(' ') || null;
    await env.DB.prepare(
      `INSERT INTO sessions
         (id, label, tg_chat_id, tg_user_id, tg_username, tg_first_name, created_at, status)
       VALUES (?,?,?,?,?,?,?,?)`
    ).bind(
      token, label || null, String(chatId),
      from.id ? String(from.id) : null,
      from.username || null,
      firstName,
      Date.now(), 'pending'
    ).run();
    await sendMessage(env, chatId, `${env.BASE_URL}/c/${token}`);
  } catch (e) {
    await sendMessage(env, chatId, `❌ ${e.message}`);
  }
}

async function sendMessage(env, chatId, text) {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });
}
