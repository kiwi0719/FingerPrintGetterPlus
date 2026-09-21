## 做了什么

<!-- 一两句话。关联 issue 用 Closes #123 -->

## 检查项

- [ ] `npm test` 通过
- [ ] `npx wrangler deploy --dry-run` 通过
- [ ] 改了 `src/fonts.js` / `src/risk.js` 的算法 → 已补测试
- [ ] 改了 `CANONICAL_FONTS` → 只在**末尾追加**，没有插入或重排（否则历史 bitmap 失效）
- [ ] 加了数据库改动 → 新建 `migrations/000N_xxx.sql`，没有修改已发布的迁移文件
- [ ] 没有提交 `wrangler.toml`、token、密钥或真实采集数据
