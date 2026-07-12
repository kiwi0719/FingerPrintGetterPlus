-- 注:tg_chat_id/tg_user_id/tg_username/tg_first_name 已在 0001_init.sql 的
-- CREATE TABLE sessions 里定义,历史上曾用 ALTER TABLE 补列,现在只保留索引创建。
-- SQLite 的 ALTER TABLE ADD COLUMN 不支持 IF NOT EXISTS,重复添加会 SQLITE_ERROR。
CREATE INDEX IF NOT EXISTS idx_sessions_tg_user ON sessions(tg_user_id);
