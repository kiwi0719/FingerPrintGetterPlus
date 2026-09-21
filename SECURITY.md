# 安全策略 / Security Policy

## 报告漏洞 / Reporting a Vulnerability

**请不要在公开 issue 中报告安全漏洞。**
**Please do not report security vulnerabilities through public issues.**

请通过 GitHub 的 [Private vulnerability reporting](https://github.com/kiwi0719/FingerPrintGetterPlus/security/advisories/new) 提交，或直接私信仓库所有者。

Use GitHub's [private vulnerability reporting](https://github.com/kiwi0719/FingerPrintGetterPlus/security/advisories/new), or contact the repository owner directly.

报告时请尽量包含 / Please include when possible:

- 受影响的文件或接口（如 `src/risk.js`、`GET /api/risk`）
- 复现步骤或 PoC
- 你认为的影响范围

我会在 **7 天内**确认收到，并在修复后于 release notes 中致谢（如你愿意署名）。
I aim to acknowledge reports within **7 days** and will credit you in the release notes unless you prefer otherwise.

## 支持的版本 / Supported Versions

本项目只维护 `main` 分支的最新提交。请先 `git pull` 到最新版再报告问题。
Only the latest commit on `main` is supported. Please update before reporting.

## 部署方需要自己负责的部分 / Operator responsibilities

本项目是一个自托管的 Cloudflare Worker，以下几点属于**部署者**的安全责任，不构成本仓库的漏洞：

- `ADMIN_KEY`、`TELEGRAM_BOT_TOKEN`、`TURNSTILE_SECRET` 必须用 `wrangler secret put` 注入，**不要**写进 `wrangler.toml` 或提交到仓库。
- `wrangler.toml` 已在 `.gitignore` 中，请勿强制添加。
- `/api/*` 管理接口依赖 `ADMIN_KEY`。未设置 `ADMIN_KEY` 时 `checkAdmin()` 返回 false，接口会拒绝所有请求——这是预期行为，不要为了方便而关闭鉴权。
- D1 中存储的是可识别到个人设备的数据，请自行设定保留期限并定期清理（见 README「维护」）。

## 关于本项目的用途 / On intended use

本项目采集浏览器与设备指纹。它只应被用于**你自己运营的服务**、对**知情的访问者**做风控与反欺诈。用于监视、追踪未授权对象，或注入到第三方站点，既违反本项目的使用意图，也可能违反当地法律。相关责任由部署者承担。

This project collects browser and device fingerprints. It is intended solely for anti-fraud use on services you operate, against visitors who have been informed. Using it to track or surveil people without authorization, or injecting it into third-party sites, is out of scope and may be illegal. Operators bear full responsibility.
