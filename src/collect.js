import { json, sha256 } from './util.js';

/**
 * 接收前端上报的指纹信号,做服务端富化(IP/ASN/国家、bot 评分、cross_id),写入 D1。
 */
export async function handleCollect(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad_json' }, 400);
  }

  const { token, visitorId, confidence, signals, turnstileToken } = body || {};
  if (!token || !signals) return json({ error: 'missing_fields' }, 400);

  const session = await env.DB.prepare('SELECT * FROM sessions WHERE id = ?').bind(token).first();
  if (!session) return json({ error: 'invalid_session' }, 404);

  // 服务端信号:Cloudflare 边缘富化
  const cf = request.cf || {};
  const ip = request.headers.get('cf-connecting-ip') || '';
  const ua = request.headers.get('user-agent') || '';

  // 全部相关请求头(含 Client Hints / Sec-Fetch / Accept-*),对齐企业级采集
  const wantHeaders = [
    'user-agent','accept','accept-language','accept-encoding','referer','origin',
    'sec-ch-ua','sec-ch-ua-mobile','sec-ch-ua-platform','sec-ch-ua-platform-version',
    'sec-ch-ua-arch','sec-ch-ua-bitness','sec-ch-ua-model','sec-ch-ua-full-version-list',
    'sec-ch-ua-wow64','sec-ch-ua-form-factor','sec-ch-prefers-color-scheme','sec-ch-prefers-reduced-motion',
    'sec-fetch-site','sec-fetch-mode','sec-fetch-dest','sec-fetch-user','sec-gpc','dnt',
    'cdn-loop','via','x-forwarded-for','x-real-ip',
  ];
  const headers = {};
  for (const h of wantHeaders) {
    const v = request.headers.get(h);
    if (v) headers[h] = v;
  }

  // 富化 signals:把服务端补齐的信息一并塞进 signals_json
  // Turnstile 服务端校验(独立,不影响指纹保存)
  let turnstileResult = { present: !!turnstileToken };
  if (turnstileToken && env.TURNSTILE_SECRET) {
    try {
      const form = new FormData();
      form.append('secret', env.TURNSTILE_SECRET);
      form.append('response', turnstileToken);
      form.append('remoteip', ip);
      const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST', body: form,
      });
      const j = await r.json();
      turnstileResult = {
        present: true,
        success: j.success,
        errorCodes: j['error-codes'],
        challengeTs: j.challenge_ts,
        hostname: j.hostname,
        action: j.action,
        cdata: j.cdata,
      };
    } catch (e) {
      turnstileResult = { present: true, success: false, error: String(e) };
    }
  }

  signals.server = {
    headers,
    turnstile: turnstileResult,
    cf: {
      country: cf.country, city: cf.city, region: cf.region, continent: cf.continent,
      postalCode: cf.postalCode, latitude: cf.latitude, longitude: cf.longitude,
      timezone: cf.timezone, colo: cf.colo,
      asn: cf.asn, asOrganization: cf.asOrganization,
      httpProtocol: cf.httpProtocol, tlsVersion: cf.tlsVersion, tlsCipher: cf.tlsCipher,
      tlsClientAuth: cf.tlsClientAuth, tlsExportedAuthenticator: cf.tlsExportedAuthenticator,
      clientTcpRtt: cf.clientTcpRtt, edgeRequestKeepAliveStatus: cf.edgeRequestKeepAliveStatus,
      requestPriority: cf.requestPriority,
      botManagement: cf.botManagement, threatScore: cf.threatScore, verifiedBotCategory: cf.verifiedBotCategory,
    },
  };

  // 跨浏览器 ID:仅取与浏览器无关的硬件/系统层信号,做稳定哈希
  const crossBasis = [
    signals.gpu?.renderer,       // 显卡型号(WebGL)
    signals.screen?.resolution,  // 物理分辨率
    signals.screen?.colorDepth,
    signals.hardware?.cores,
    signals.hardware?.memory,
    signals.timezone,
    signals.audio?.fingerprint,  // 音频栈指纹(硬件相关)
    signals.fonts?.hash,         // 系统字体集(跨浏览器较稳定)
    ip,                          // 同网络加权
  ].join('|');
  const crossId = await sha256(crossBasis);

  const botScore = computeBotScore(signals, ua, cf);
  const incognito = signals.incognito ? 1 : 0;

  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO fingerprints
       (session_id, visitor_id, cross_id, confidence, ip, ip_country, ip_asn,
        user_agent, incognito, bot_score, signals_json, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    token, visitorId || null, crossId, confidence ?? null,
    ip, cf.country || null, String(cf.asn || ''),
    ua, incognito, botScore, JSON.stringify(signals), now
  ).run();

  await env.DB.prepare(
    "UPDATE sessions SET status='collected', hits = hits + 1 WHERE id = ?"
  ).bind(token).run();

  return json({ ok: true, visitorId, crossId });
}

/**
 * 简单机器人/自动化启发式评分 0(真人)~1(高度可疑)。
 */
function computeBotScore(s, ua, cf) {
  let score = 0;
  if (s.webdriver) score += 0.4;                              // navigator.webdriver
  if (s.hardware?.cores === 0) score += 0.1;
  if (!s.gpu?.renderer || /swiftshader|llvmpipe/i.test(s.gpu?.renderer || '')) score += 0.2; // 软件渲染
  if (s.plugins?.length === 0 && /chrome/i.test(ua)) score += 0.1;
  if (/headless/i.test(ua)) score += 0.4;
  if (s.languages?.length === 0) score += 0.1;
  if (cf.threatScore && cf.threatScore > 30) score += 0.2;    // CF 威胁分
  return Math.min(1, score);
}
