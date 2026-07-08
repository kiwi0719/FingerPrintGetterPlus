ALTER TABLE sessions ADD COLUMN tg_user_id TEXT;
ALTER TABLE sessions ADD COLUMN tg_username TEXT;
ALTER TABLE sessions ADD COLUMN tg_first_name TEXT;
CREATE INDEX IF NOT EXISTS idx_sessions_tg_user ON sessions(tg_user_id);
