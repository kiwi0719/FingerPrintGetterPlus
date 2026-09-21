# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式与[语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 新增
- MIT 许可证、贡献指南、行为准则、安全策略
- GitHub Actions CI：语法检查、单元测试、`wrangler deploy --dry-run`
- issue / PR 模板
- `test/`：`fonts.js` 与 `risk.js` 纯函数的单元测试（`npm test`）
- 英文 README（[README.en.md](README.en.md)）

### 修复
- `db:migrate` / `db:migrate:local` 漏掉了 `0004_layered_ids.sql`，全新部署若用这两个脚本建库会缺少分层 ID 相关的列（用 `deploy.sh` 部署的不受影响）

### 变更
- `similarityScore` / `buildFlags` 从 `src/risk.js` 导出，以便测试

## [1.0.0]

首个版本。

- Cloudflare Worker + D1 + Workers Assets 的指纹采集后端
- FingerprintJS 开源版 + 70+ 项自研扩展信号
- 分层设备 ID：`hw_id`（纯硬件，跨浏览器跨网络）/ `os_id` / `cross_id`
- 字体 bitmap + 汉明距离的模糊匹配风控反查（`/api/risk`）
- bot 评分、Cloudflare Turnstile 校验
- Telegram Bot：生成采集链接、强制验证、双向中继、设备摘要推送
- Web 管理面板（`public/admin.html`）
- `deploy.sh` 一键部署，用 `_migrations` 表跟踪已应用迁移
