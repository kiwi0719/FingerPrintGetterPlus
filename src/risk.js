import { json, checkAdmin, unauthorized } from './util.js';

/** 全量导出 / 分页浏览。GET /api/all?key=..&limit=100&offset=0&format=json|csv */
export async function handleAll(request, env, url) {
  if (!checkAdmin(request, env, url)) return unauthorized();
  const limit = Math.min(1000, +url.searchParams.get('limit') || 100);
  const offset = +url.searchParams.get('offset') || 0;
  const format = url.searchParams.get('format') || 'json';

  const { results } = await env.DB.prepare(
    `SELECT f.*, s.label, s.tg_chat_id
       FROM fingerprints f LEFT JOIN sessions s ON s.id = f.session_id
       ORDER BY f.created_at DESC LIMIT ? OFFSET ?`
  ).bind(limit, offset).all();

  const total = (await env.DB.prepare('SELECT COUNT(*) AS n FROM fingerprints').first()).n;

  if (format === 'csv') {
    const cols = ['id','session_id','label','visitor_id','cross_id','confidence',
      'ip','ip_country','ip_asn','user_agent','incognito','bot_score','created_at'];
    const esc = (v) => v == null ? '' : `"${String(v).replace(/"/g,'""')}"`;
    const csv = [cols.join(','),
      ...results.map(r => cols.map(c => esc(r[c])).join(','))].join('\n');
    return new Response(csv, { headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="fingerprints-${Date.now()}.csv"`,
    }});
  }

  return json({
    total, limit, offset, count: results.length,
    records: results.map((r) => ({ ...r, signals: safeParse(r.signals_json), signals_json: undefined })),
  });
}

/** 会话列表(不含具体信号,轻量)。GET /api/sessions?key=..&limit=50 */
export async function handleSessions(request, env, url) {
  if (!checkAdmin(request, env, url)) return unauthorized();
  const limit = Math.min(500, +url.searchParams.get('limit') || 50);
  const status = url.searchParams.get('status'); // pending|collected

  const q = status
    ? env.DB.prepare('SELECT * FROM sessions WHERE status=? ORDER BY created_at DESC LIMIT ?').bind(status, limit)
    : env.DB.prepare('SELECT * FROM sessions ORDER BY created_at DESC LIMIT ?').bind(limit);
  const { results } = await q.all();
  return json({ count: results.length, sessions: results });
}

/** 汇总统计。GET /api/stats?key=.. */
export async function handleStats(request, env, url) {
  if (!checkAdmin(request, env, url)) return unauthorized();
  const stats = {};
  stats.sessions_total    = (await env.DB.prepare('SELECT COUNT(*) n FROM sessions').first()).n;
  stats.sessions_pending  = (await env.DB.prepare("SELECT COUNT(*) n FROM sessions WHERE status='pending'").first()).n;
  stats.fingerprints      = (await env.DB.prepare('SELECT COUNT(*) n FROM fingerprints').first()).n;
  stats.unique_visitors   = (await env.DB.prepare('SELECT COUNT(DISTINCT visitor_id) n FROM fingerprints').first()).n;
  stats.unique_devices    = (await env.DB.prepare('SELECT COUNT(DISTINCT cross_id) n FROM fingerprints').first()).n;
  stats.unique_ips        = (await env.DB.prepare('SELECT COUNT(DISTINCT ip) n FROM fingerprints').first()).n;
  stats.high_risk_bots    = (await env.DB.prepare('SELECT COUNT(*) n FROM fingerprints WHERE bot_score>=0.6').first()).n;
  const { results: top } = await env.DB.prepare(
    `SELECT cross_id, COUNT(*) hits, COUNT(DISTINCT session_id) sessions
       FROM fingerprints WHERE cross_id IS NOT NULL
       GROUP BY cross_id ORDER BY hits DESC LIMIT 10`
  ).all();
  stats.top_devices = top;
  return json(stats);
}

/** 查询单次采集会话的全部上报记录 */
export async function handleSession(request, env, id) {
  const url = new URL(request.url);
  if (!checkAdmin(request, env, url)) return unauthorized();

  const session = await env.DB.prepare('SELECT * FROM sessions WHERE id = ?').bind(id).first();
  if (!session) return json({ error: 'not_found' }, 404);

  const { results } = await env.DB.prepare(
    'SELECT * FROM fingerprints WHERE session_id = ? ORDER BY created_at DESC'
  ).bind(id).all();

  return json({ session, records: results.map(parseRow) });
}

/**
 * 风控反查:GET /api/risk?key=..&visitorId=..|cross=..|ip=..
 * 返回该标识的历史命中,以及关联的其它标识(设备聚合 / 团伙识别)。
 */
export async function handleRisk(request, env, url) {
  if (!checkAdmin(request, env, url)) return unauthorized();

  const p = url.searchParams;
  const visitorId = p.get('visitorId');
  const cross = p.get('cross');
  const ip = p.get('ip');

  let where, val;
  if (visitorId) { where = 'visitor_id = ?'; val = visitorId; }
  else if (cross) { where = 'cross_id = ?'; val = cross; }
  else if (ip) { where = 'ip = ?'; val = ip; }
  else return json({ error: 'need visitorId|cross|ip' }, 400);

  const { results } = await env.DB.prepare(
    `SELECT * FROM fingerprints WHERE ${where} ORDER BY created_at DESC LIMIT 200`
  ).bind(val).all();

  // 关联分析:同一设备/网络下出现过的其它 session、IP、visitorId
  const sessions = new Set(), ips = new Set(), visitors = new Set(), crosses = new Set();
  for (const r of results) {
    sessions.add(r.session_id);
    if (r.ip) ips.add(r.ip);
    if (r.visitor_id) visitors.add(r.visitor_id);
    if (r.cross_id) crosses.add(r.cross_id);
  }

  return json({
    query: { visitorId, cross, ip },
    total_hits: results.length,
    distinct_sessions: sessions.size,
    distinct_ips: [...ips],
    distinct_visitors: [...visitors],
    distinct_cross_ids: [...crosses],
    risk_flags: buildFlags(results, sessions, ips),
    records: results.slice(0, 50).map(parseRow),
  });
}

function buildFlags(rows, sessions, ips) {
  const flags = [];
  if (sessions.size > 3) flags.push('same_device_many_sessions'); // 同设备多次采集 → 可疑复用
  if (ips.size > 3) flags.push('device_ip_hopping');              // 同设备频繁换 IP
  if (rows.some((r) => r.bot_score >= 0.6)) flags.push('automation_suspected');
  if (rows.some((r) => r.incognito)) flags.push('incognito_seen');
  return flags;
}

function parseRow(r) {
  return { ...r, signals_json: undefined, signals: safeParse(r.signals_json) };
}
function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }
