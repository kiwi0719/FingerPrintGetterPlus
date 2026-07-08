-- 采集会话:一次链接对应一次采集任务(可绑定 Telegram 用户/标签)
CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,        -- 随机 token,进采集链接
  label        TEXT,                    -- 备注(如订单号、用户名)
  tg_chat_id   TEXT,                    -- 发起采集的 TG chat,用于回推结果
  created_at   INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending', -- pending | collected
  hits         INTEGER NOT NULL DEFAULT 0
);

-- 每次实际上报的指纹记录(同一 session 可能被多浏览器/多次访问 → 跨浏览器对比)
CREATE TABLE IF NOT EXISTS fingerprints (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id    TEXT NOT NULL,
  visitor_id    TEXT,                   -- FingerprintJS 稳定 visitorId
  cross_id      TEXT,                   -- 跨浏览器信号哈希(硬件层,忽略浏览器差异)
  confidence    REAL,
  ip            TEXT,
  ip_country    TEXT,
  ip_asn        TEXT,
  user_agent    TEXT,
  incognito     INTEGER,                -- 是否隐身模式(启发式)
  bot_score     REAL,                   -- 自动化/机器人可疑度 0-1
  signals_json  TEXT,                   -- 全量原始信号 JSON
  created_at    INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_fp_session ON fingerprints(session_id);
CREATE INDEX IF NOT EXISTS idx_fp_visitor ON fingerprints(visitor_id);
CREATE INDEX IF NOT EXISTS idx_fp_cross   ON fingerprints(cross_id);
CREATE INDEX IF NOT EXISTS idx_fp_ip      ON fingerprints(ip);
