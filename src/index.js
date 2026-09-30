/**
 * 反欺诈指纹采集 — Cloudflare Worker 入口
 *
 * 路由:
 *   GET  /c/:token        采集页(静态 collect.html 由 ASSETS 提供,这里注入 token)
 *   POST /api/collect     前端上报指纹
 *   GET  /api/session/:id 查询某次采集结果(需 x-admin-key 头)
 *   GET  /api/risk        风控查询:按 visitorId / cross_id / ip 反查历史(需 x-admin-key 头)
 *   POST /tg/webhook      Telegram Bot webhook
 */

import { handleCollect } from './collect.js';
import { handleRisk, handleSession, handleAll, handleSessions, handleStats } from './risk.js';
import { handleTelegram } from './telegram.js';
import { json, notFound } from './util.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;

    // 采集页:注入 token 后返回静态 HTML
    if (pathname.startsWith('/c/')) {
      const token = pathname.slice(3);
      return servePage(token, env);
    }

    if (pathname === '/api/collect' && request.method === 'POST') {
      return await handleCollect(request, env);
    }

    if (pathname.startsWith('/api/session/') && request.method === 'GET') {
      return await handleSession(request, env, pathname.slice('/api/session/'.length));
    }

    if (pathname === '/api/risk' && request.method === 'GET') {
      return await handleRisk(request, env, url);
    }

    if (pathname === '/api/all' && request.method === 'GET') {
      return await handleAll(request, env, url);
    }

    if (pathname === '/api/sessions' && request.method === 'GET') {
      return await handleSessions(request, env, url);
    }

    if (pathname === '/api/stats' && request.method === 'GET') {
      return await handleStats(request, env, url);
    }

    // 根路径 = 管理后台(带 #key= 片段直接进)
    if ((pathname === '/' || pathname === '/admin') && request.method === 'GET') {
      const asset = await env.ASSETS.fetch(new URL('https://assets/admin.html'));
      return new Response(asset.body, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }

    if (pathname === '/tg/webhook' && request.method === 'POST') {
      return handleTelegram(request, env, ctx);
    }

    if (pathname === '/health') return json({ ok: true });

    // 其它路径回落到静态资源(extra-signals.js 等)
    if (request.method === 'GET') {
      const asset = await env.ASSETS.fetch(request);
      if (asset.status !== 404) return asset;
    }
    return notFound();
  },
};

async function servePage(token, env) {
  // 校验 session 存在,避免任意 token 生成页面
  const row = await env.DB.prepare('SELECT id FROM sessions WHERE id = ?').bind(token).first();
  if (!row) return new Response('Invalid or expired link', { status: 404 });

  const asset = await env.ASSETS.fetch(new URL('https://assets/collect.html'));
  let html = await asset.text();
  // 注入 token 供前端上报使用
  html = html.replace('__SESSION_TOKEN__', token)
             .replace('__TURNSTILE_SITEKEY__', env.TURNSTILE_SITEKEY || '');
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}
