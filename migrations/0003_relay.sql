-- 已验证用户表
CREATE TABLE IF NOT EXISTS users (
  tg_user_id       TEXT PRIMARY KEY,
  tg_chat_id       TEXT,
  tg_username      TEXT,
  tg_first_name    TEXT,
  verified_at      INTEGER,          -- 完成指纹采集的时间
  first_session_id TEXT,             -- 首次验证的 session token
  created_at       INTEGER
);

-- Bot 全局配置(owner_id / owner_chat_id 等)
CREATE TABLE IF NOT EXISTS config (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- Owner 侧消息 -> 目标用户 chat 的映射,支持回复关联
CREATE TABLE IF NOT EXISTS relay_map (
  owner_msg_id   TEXT PRIMARY KEY,
  target_chat_id TEXT NOT NULL,
  created_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_relay_created ON relay_map(created_at);
