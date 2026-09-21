# 贡献指南 / Contributing

欢迎 issue 和 PR。中文英文都可以。
Issues and pull requests are welcome, in either Chinese or English.

## 开始之前

先读 [SECURITY.md](SECURITY.md) 里「关于本项目的用途」一节。不接受以扩大监视能力、规避用户知情为目的的功能请求（例如隐藏采集行为、绕过 Turnstile、对抗浏览器反指纹措施）。

Please read the "On intended use" section of [SECURITY.md](SECURITY.md) first. Feature requests aimed at hiding collection from users or defeating browser anti-fingerprinting protections will be declined.

安全漏洞走 [SECURITY.md](SECURITY.md) 的私下报告流程，不要开公开 issue。

## 本地开发

```bash
npm install
cp wrangler.toml.example wrangler.toml   # 填入你自己的 D1 database_id
npm run db:migrate:local
npm run dev
```

`wrangler dev` 会在本地起一个 Worker，用本地 D1。Telegram 相关功能需要真实 bot token，本地可跳过。

## 测试

```bash
npm test
```

测试用 Node 内置 runner（`node --test`），不需要额外依赖，只覆盖 `src/` 里的纯函数（字体 bitmap、汉明距离、GPU 规范化、相似度打分）。Worker 运行时相关的代码目前没有测试。

**改动 `src/fonts.js` 或 `src/risk.js` 的算法时请补测试。** 特别注意：`CANONICAL_FONTS` 的顺序与 `public/extra-signals.js` 中的探测顺序**必须完全一致**，否则历史数据的 bitmap 全部失效——改这个列表只能往**末尾追加**，不能插入或重排。

## 提交

- commit message 用英文祈使句，一行说清楚做了什么（参考现有历史：`tg: notify owner when...`）
- 一个 PR 做一件事
- 加了迁移就新建 `migrations/000N_xxx.sql`，**不要改已发布的迁移文件**——`deploy.sh` 用 `_migrations` 表跟踪已应用项，改旧文件不会重跑
- PR 前跑一遍 `npm test` 和 `npx wrangler deploy --dry-run`

## 代码风格

没有 linter，照着周围代码写就行：2 空格缩进、单引号、ES modules、注释用中文。
