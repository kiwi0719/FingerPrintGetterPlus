<!-- 一个 PR 做一件事,见 CONTRIBUTING.md / One change per PR, see CONTRIBUTING.md -->

## 做了什么 / What and why



Closes #

## 检查项 / Checklist

- [ ] `npm test` 通过 / green
- [ ] `npx wrangler deploy --dry-run` 通过 / green
- [ ] 改了 `src/fonts.js` / `src/risk.js` 的算法 → 已补测试 / tests added
- [ ] 改了 `CANONICAL_FONTS` → 只在**末尾追加** / append-only (reordering invalidates every stored bitmap)
- [ ] 加了数据库改动 → 新建 `migrations/000N_xxx.sql`,没改已发布的迁移 / new migration, none edited
- [ ] 没有隐藏或弱化采集告知(`public/collect.html`)/ collection disclosure is not hidden or weakened
- [ ] 没有把密钥放进 URL、日志或响应 / no secret in a URL, log or response
- [ ] 没有提交 `wrangler.toml`、token、密钥或真实采集数据 / no `wrangler.toml`, tokens, keys or real collected data
- [ ] `CHANGELOG.md` 的 Unreleased 下有一行 / line added under Unreleased
- [ ] 文档改动同时更新了 `README.md` 与 `README.zh-CN.md` / both READMEs updated
