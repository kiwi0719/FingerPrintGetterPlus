import { json, checkAdmin, unauthorized } from './util.js';
import { hammingHex } from './fonts.js';

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
  stats.unique_hw         = (await env.DB.prepare('SELECT COUNT(DISTINCT hw_id) n FROM fingerprints WHERE hw_id IS NOT NULL').first()).n;
  stats.unique_os         = (await env.DB.prepare('SELECT COUNT(DISTINCT os_id) n FROM fingerprints WHERE os_id IS NOT NULL').first()).n;
  stats.unique_ips        = (await env.DB.prepare('SELECT COUNT(DISTINCT ip) n FROM fingerprints').first()).n;
  stats.high_risk_bots    = (await env.DB.prepare('SELECT COUNT(*) n FROM fingerprints WHERE bot_score>=0.6').first()).n;
  const { results: top } = await env.DB.prepare(
    `SELECT cross_id, COUNT(*) hits, COUNT(DISTINCT session_id) sessions
       FROM fingerprints WHERE cross_id IS NOT NULL
       GROUP BY cross_id ORDER BY hits DESC LIMIT 10`
  ).all();
  stats.top_devices = top;
  const { results: topHw } = await env.DB.prepare(
    `SELECT hw_id, COUNT(*) hits, COUNT(DISTINCT session_id) sessions,
            COUNT(DISTINCT ip) ips, COUNT(DISTINCT visitor_id) visitors
       FROM fingerprints WHERE hw_id IS NOT NULL
       GROUP BY hw_id ORDER BY hits DESC LIMIT 10`
  ).all();
  stats.top_hw = topHw;
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
 * 风控反查:GET /api/risk?key=..&visitorId=..|cross=..|hw=..|os=..|ip=..
 * 三层返回:
 *   exact       — 与所查标识精确一致的历史命中
 *   same_hw     — 同一物理设备(跨浏览器 + 跨网络),按 hw_id 精确匹配
 *   similar     — 硬件字段 + 字体 bitmap 汉明距离 相似度打分(容忍单字段漂移)
 */
export async function handleRisk(request, env, url) {
  if (!checkAdmin(request, env, url)) return unauthorized();

  const p = url.searchParams;
  const q = {
    visitorId: p.get('visitorId'),
    cross: p.get('cross'),
    hw: p.get('hw'),
    os: p.get('os'),
    ip: p.get('ip'),
  };

  let where, val;
  if (q.visitorId) { where = 'visitor_id = ?'; val = q.visitorId; }
  else if (q.cross) { where = 'cross_id = ?'; val = q.cross; }
  else if (q.hw)    { where = 'hw_id = ?';    val = q.hw; }
  else if (q.os)    { where = 'os_id = ?';    val = q.os; }
  else if (q.ip)    { where = 'ip = ?';       val = q.ip; }
  else return json({ error: 'need visitorId|cross|hw|os|ip' }, 400);

  const { results: exact } = await env.DB.prepare(
    `SELECT * FROM fingerprints WHERE ${where} ORDER BY created_at DESC LIMIT 200`
  ).bind(val).all();

  const seed = exact[0]; // 最新一条作为特征种子
  let sameHw = [], similar = [];

  if (seed) {
    // 同 hw_id — 跨网络同物理机
    if (seed.hw_id) {
      const { results } = await env.DB.prepare(
        'SELECT * FROM fingerprints WHERE hw_id = ? AND id != ? ORDER BY created_at DESC LIMIT 100'
      ).bind(seed.hw_id, seed.id).all();
      sameHw = results;
    }

    // 相似候选:任一强字段命中即拉进来,再打分
    const candidates = await pullCandidates(env, seed);
    similar = candidates
      .filter((r) => r.id !== seed.id && r.hw_id !== seed.hw_id) // 已经在 same_hw 里的不再重复
      .map((r) => ({ row: r, score: similarityScore(seed, r) }))
      .filter((x) => x.score.total >= 4)  // 阈值:总分至少 4/10
      .sort((a, b) => b.score.total - a.score.total)
      .slice(0, 30);
  }

  // 关联标识聚合(用 exact + same_hw 综合)
  const merged = [...exact, ...sameHw];
  const sessions = new Set(), ips = new Set(), visitors = new Set(), crosses = new Set();
  for (const r of merged) {
    sessions.add(r.session_id);
    if (r.ip) ips.add(r.ip);
    if (r.visitor_id) visitors.add(r.visitor_id);
    if (r.cross_id) crosses.add(r.cross_id);
  }

  return json({
    query: q,
    exact: {
      hits: exact.length,
      records: exact.slice(0, 20).map(parseRow),
    },
    same_hw: {
      hits: sameHw.length,
      records: sameHw.slice(0, 20).map(parseRow),
    },
    similar: {
      hits: similar.length,
      records: similar.map(({ row, score }) => ({ ...parseRow(row), _match: score })),
    },
    distinct_sessions: sessions.size,
    distinct_ips: [...ips],
    distinct_visitors: [...visitors],
    distinct_cross_ids: [...crosses],
    risk_flags: buildFlags(merged, sessions, ips),
  });
}

async function pullCandidates(env, seed) {
  // 先按任一强字段做 OR 过滤,尽量少全表扫,再在 JS 侧打分
  const clauses = [], binds = [];
  if (seed.gpu_canon) { clauses.push('gpu_canon = ?'); binds.push(seed.gpu_canon); }
  if (seed.audio_fp)  { clauses.push('audio_fp = ?');  binds.push(seed.audio_fp); }
  if (seed.screen_res){ clauses.push('screen_res = ?'); binds.push(seed.screen_res); }
  if (seed.fonts_hash){ clauses.push('fonts_hash = ?'); binds.push(seed.fonts_hash); }
  if (!clauses.length) return [];
  const sql = `SELECT * FROM fingerprints WHERE (${clauses.join(' OR ')}) LIMIT 500`;
  const { results } = await env.DB.prepare(sql).bind(...binds).all();
  return results;
}

/**
 * 相似度打分(总分 10 分):
 *   GPU canon 完全一致       +3
 *   Audio fingerprint 一致    +3
 *   屏幕分辨率一致            +1
 *   CPU 核数一致              +0.5
 *   内存一致                  +0.5
 *   时区一致                  +0.5
 *   字体精确一致              +2   否则按 bitmap 汉明距离折算(距离 ≤ 4 给分)
 */
function similarityScore(a, b) {
  const parts = {};
  let total = 0;
  parts.gpu    = a.gpu_canon && a.gpu_canon === b.gpu_canon ? 3 : 0;
  parts.audio  = a.audio_fp  && a.audio_fp  === b.audio_fp  ? 3 : 0;
  parts.screen = a.screen_res && a.screen_res === b.screen_res ? 1 : 0;
  parts.cores  = a.cores != null && a.cores === b.cores ? 0.5 : 0;
  parts.memory = a.memory != null && a.memory === b.memory ? 0.5 : 0;
  parts.tz     = a.timezone && a.timezone === b.timezone ? 0.5 : 0;

  if (a.fonts_hash && a.fonts_hash === b.fonts_hash) {
    parts.fonts = 2;
  } else if (a.fonts_bitmap && b.fonts_bitmap) {
    const d = hammingHex(a.fonts_bitmap, b.fonts_bitmap);
    parts.fonts = d <= 4 ? Math.max(0, 2 - d * 0.5) : 0;
    parts.fonts_hamming = d;
  } else {
    parts.fonts = 0;
  }

  total = parts.gpu + parts.audio + parts.screen + parts.cores + parts.memory + parts.tz + parts.fonts;
  return { total: +total.toFixed(2), parts };
}

function buildFlags(rows, sessions, ips) {
  const flags = [];
  if (sessions.size > 3) flags.push('same_device_many_sessions'); // 同设备多次采集 → 可疑复用
  if (ips.size > 3) flags.push('device_ip_hopping');              // 同设备频繁换 IP
  if (rows.some((r) => r.bot_score >= 0.6)) flags.push('automation_suspected');
  if (rows.some((r) => r.incognito)) flags.push('incognito_seen');
  const asns = new Set(rows.map((r) => r.ip_asn).filter(Boolean));
  if (asns.size >= 3) flags.push('cross_asn_device');             // 同设备跨 ASN → 频繁换网络
  return flags;
}

function parseRow(r) {
  return { ...r, signals_json: undefined, signals: safeParse(r.signals_json) };
}
function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }
