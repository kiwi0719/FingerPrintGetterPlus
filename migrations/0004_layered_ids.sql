-- 分层设备 ID:hw_id(纯硬件,跨浏览器+跨网络稳)、os_id(硬件+系统,跨网络稳)
-- 保留 cross_id 语义不变(现在等于 net_id,含 IP),向后兼容
ALTER TABLE fingerprints ADD COLUMN hw_id TEXT;
ALTER TABLE fingerprints ADD COLUMN os_id TEXT;

-- 关键字段单列存储,支持相似度打分而不用只依赖哈希
ALTER TABLE fingerprints ADD COLUMN gpu_canon TEXT;    -- canonical 化后的 GPU 字符串
ALTER TABLE fingerprints ADD COLUMN audio_fp TEXT;
ALTER TABLE fingerprints ADD COLUMN screen_res TEXT;
ALTER TABLE fingerprints ADD COLUMN cores INTEGER;
ALTER TABLE fingerprints ADD COLUMN memory INTEGER;
ALTER TABLE fingerprints ADD COLUMN timezone TEXT;
ALTER TABLE fingerprints ADD COLUMN fonts_bitmap TEXT; -- 128-bit bitmap,hex 编码(32 字符)
ALTER TABLE fingerprints ADD COLUMN fonts_hash TEXT;   -- 字体集精确哈希

CREATE INDEX IF NOT EXISTS idx_fp_hw       ON fingerprints(hw_id);
CREATE INDEX IF NOT EXISTS idx_fp_os       ON fingerprints(os_id);
CREATE INDEX IF NOT EXISTS idx_fp_gpu      ON fingerprints(gpu_canon);
CREATE INDEX IF NOT EXISTS idx_fp_audio    ON fingerprints(audio_fp);
CREATE INDEX IF NOT EXISTS idx_fp_scr      ON fingerprints(screen_res);
