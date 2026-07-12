# FingerPrintGetterPlus

浏览器/设备指纹采集系统,反欺诈用途。全部跑在 Cloudflare 免费额度内。

- **后端**: Cloudflare Worker(边缘计算,无冷启动)
- **存储**: Cloudflare D1(SQLite,每天 500 万次读 / 10 万次写免费)
- **前端**: FingerprintJS 开源版 + 70+ 项自研扩展信号
- **入口**: Telegram Bot(生成采集链接)+ Web 管理面板

## 目录

- [核心概念](#核心概念)
- [采集的信号](#采集的信号)
- [部署](#部署)
  - [前置准备](#前置准备)
  - [一键部署](#一键部署)
  - [部署脚本参数](#部署脚本参数)
- [使用](#使用)
  - [Telegram Bot](#telegram-bot)
  - [Web 管理面板](#web-管理面板)
  - [HTTP API](#http-api)
  - [直接查 D1 数据库](#直接查-d1-数据库)
- [跨浏览器识别原理](#跨浏览器识别原理)
- [风控标签](#风控标签)
- [维护](#维护)
- [目录结构](#目录结构)
- [合规提醒](#合规提醒)

---

## 核心概念

| 字段 | 含义 | 稳定性 |
|---|---|---|
| `visitorId` | FingerprintJS 生成的浏览器身份 ID | 同浏览器稳定,换浏览器变化 |
| `hw_id` | **纯硬件层**哈希:GPU(canonical)/WebGPU adapter/音频硬件参数/屏幕物理参数 | **同物理机跨浏览器 + 跨网络都一致** |
| `os_id` | `hw_id` + 系统字体集 + 时区 + 系统语言 + platform version | 换网络仍一致,重装系统会变 |
| `cross_id` | `os_id` + 客户端 IP | 与旧版一致,换网络会变(保留兼容) |
| `bot_score` | 自动化/机器人可疑度 0(真人)~1(高度可疑) | 每次采集独立评估 |
| `session_id` | 一次采集链接的 token,一个链接可被多次访问 | — |

**用哪个查**:
- 想识别「同人换浏览器」→ `hw_id`(推荐)
- 想识别「同人换网络 + 换浏览器」→ `hw_id`
- 想识别「重装系统前后同一台机」→ `hw_id`(纯硬件不会变)
- 严格匹配旧行为 → `cross_id`

除了精确匹配,`/api/risk` 还会用 **单字段相似度打分 + 字体 bitmap 汉明距离** 做模糊匹配,允许 1-2 个字段漂移(比如换显示器只改了 `screen_res`)。

## 采集的信号

**硬件层**:精细 GPU(WebGL vendor/renderer/extensions/位深/视口)、WebGPU adapter info、AudioContext 指纹 + sampleRate/baseLatency、屏幕物理参数、6 类传感器 API 存在性、电池状态、存储配额

**系统层**:60+ 字体检测(含 CJK 完整覆盖)、时区、Intl locale/numberingSystem/calendar、语言链、键盘布局映射(高熵)、UA-CH 全套高熵值(architecture/bitness/model/platformVersion/fullVersionList)

**浏览器能力**:视频编解码(H.264/HEVC/AV1/VP8/VP9)、音频编解码(AAC/AC-3/MP3/Opus/FLAC)、EME/DRM 支持(Widevine/PlayReady/FairPlay/ClearKey)、Speech Synthesis 语音列表、17 种 API 存在性

**渲染层**:Canvas 2D 哈希、Canvas emoji 哈希、Text Metrics(fontBoundingBox 等 10+ 度量)、CSS 媒体查询(prefers-* / color-gamut / dynamic-range / hover / pointer / forced-colors 等 15 项)

**网络**:WebRTC 本地/公网 IP + SDP 编解码、Connection API(effectiveType/downlink/rtt)

**反自动化**:webdriver / headless 多维检测、原生函数完整性(fetch/canvas/toDataURL 是否被 monkey-patch)、时钟抖动(performance.now 最小步进)、Error stack 引擎识别(V8/SpiderMonkey/JSC)、15+ 自动化框架 hook 探测(Selenium/Puppeteer/Nightmare/PhantomJS)

**服务端(CF 边缘富化)**:全部 Sec-CH-* / Sec-Fetch-* / Accept-* 头、Referer、Origin、GPC、DNT、TLS 版本+密码套件、HTTP 协议版本、TCP RTT、边缘节点(colo)、精确地理(经纬度/邮编)、ASN 组织、Bot Management 分数、威胁分

---

## 部署

### 前置准备

**1. Node.js 18+ 和 npm**
```bash
node --version   # >= 18
```

**2. Cloudflare API Token**

访问 https://dash.cloudflare.com/profile/api-tokens → Create Token → Custom token,勾选权限:
- `Account` → `Workers Scripts` → Edit
- `Account` → `D1` → Edit
- `Account` → `Workers KV Storage` → Edit(assets 需要)

保存生成的 token(只显示一次)。

**3. Cloudflare Account ID**

登录 https://dash.cloudflare.com → URL 里 `dash.cloudflare.com/<account_id>/...` 那段,或右侧栏的 Account ID。

**4. Telegram Bot Token**

Telegram 里搜 `@BotFather` → `/newbot` → 起名 → 获得形如 `123456789:ABC-DEF...` 的 token。

### 一键部署

```bash
git clone https://github.com/kiwi0719/FingerPrintGetterPlus.git
cd FingerPrintGetterPlus

# 命令行传参(最直接)
./deploy.sh \
  --cf-token=<你的 CF API Token> \
  --cf-account=<你的 CF Account ID> \
  --tg-token=<你的 Telegram Bot Token>

# 或短参数
./deploy.sh -t <cf_token> -a <cf_account> -b <tg_token>

# 或直接跑,脚本会交互式问你(token 输入会隐藏)
./deploy.sh
```

脚本自动完成:
1. `npm install`
2. 创建 D1 数据库(如已存在则复用),初始化表结构
3. 通过 Cloudflare API 注入 `TELEGRAM_BOT_TOKEN` 和 `ADMIN_KEY`(secrets,不入代码库)
4. 首次部署 Worker 拿到 `workers.dev` 域名
5. 回填 `BASE_URL` 后再次部署
6. 给 Bot 设置 webhook 指向 `/tg/webhook`
7. 打印带 `?key=` 的一键管理后台 URL(macOS 会自动打开浏览器)

输出示例:
```
✅ 部署完成!

🔗 管理后台(点开即用,key 已内嵌):
   https://fingerprint-collector.<你的subdomain>.workers.dev/?key=<random>

🤖 Telegram Bot:  https://t.me/<你的bot用户名>
🎯 采集链接前缀:  https://fingerprint-collector.<你的subdomain>.workers.dev/c/<token>

管理密钥 (保存好,勿泄露):
  ADMIN_KEY=xxxxxx
```

### 部署脚本参数

| 参数 | 简写 | 默认值 | 说明 |
|---|---|---|---|
| `--cf-token` | `-t` | — | Cloudflare API Token(必需) |
| `--cf-account` | `-a` | — | Cloudflare Account ID(必需) |
| `--tg-token` | `-b` | — | Telegram Bot Token(必需) |
| `--admin-key` | `-k` | 随机 32 字节 hex | Web 管理后台 / 风控 API 密钥 |
| `--turnstile-secret` | — | (不设) | Turnstile 服务端 secret;不设则跳过服务端二次校验,前端 widget 仍会显示 |
| `--worker` | `-w` | `fingerprint-collector` | Worker 名字(决定 workers.dev 前缀) |
| `--db` | `-d` | `fingerprint-db` | D1 数据库名 |

环境变量也支持(同名):`CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` / `TELEGRAM_BOT_TOKEN` / `ADMIN_KEY` / `TURNSTILE_SECRET` / `WORKER_NAME` / `DB_NAME`。命令行参数优先。

> 脚本用 `_migrations` 表跟踪已应用的迁移,`deploy.sh` **可以安全重复执行**(重跑时已应用的迁移会跳过);代码小改动直接 `npx wrangler deploy` 也行。

`./deploy.sh --help` 查看内置帮助。

---

## 使用

### Telegram Bot

给 bot 发**任何消息**都会返回一条新的采集链接,消息内容作为备注:

```
你: /start
Bot: https://fingerprint-collector.xxx.workers.dev/c/abc123...

你: 张三订单#42
Bot: https://fingerprint-collector.xxx.workers.dev/c/def456...
```

把链接发给目标,对方浏览器打开约 1~3 秒即完成采集(页面显示"验证完成"),数据静默进 D1,**不会给你发通知** —— 详情去管理面板看。

### Web 管理面板

**入口**:`https://<你的域名>/?key=<ADMIN_KEY>`

首次带 key 打开后,key 存在 localStorage,以后访问根域名(不带 `?key=`)自动登录。URL 里的 `?key=` 会立即从地址栏抹掉,防止刷新/截图/分享泄露。

**面板功能**:
- 顶部统计卡片:总会话数、待采集数、指纹总数、独立浏览器数、**独立设备数**(基于 cross_id)、独立 IP、高风险机器人数
- 明细表:时间 / 备注 / visitorId / cross_id / IP / 国家 / 风险等级 / 展开看完整信号 JSON
- 点表格里的 cross_id 弹出该设备的关联分析(命中次数 / 关联 IP / 风险标签)
- 「导出 CSV」按钮下载最近 1000 条

### HTTP API

供你自己的业务后端调用。所有接口都要 `x-admin-key` header 或 `?key=` 参数。

```bash
KEY=<你的 ADMIN_KEY>
BASE=https://<你的 workers.dev 域名>

# 汇总统计(总数、独立设备数、top 10 设备等)
curl -H "x-admin-key: $KEY" "$BASE/api/stats"

# 全量指纹(分页,含完整信号 JSON)
curl -H "x-admin-key: $KEY" "$BASE/api/all?limit=100&offset=0"

# 导出 CSV
curl -H "x-admin-key: $KEY" "$BASE/api/all?format=csv&limit=1000" > all.csv

# 会话列表(轻量,不含 signals)
curl -H "x-admin-key: $KEY" "$BASE/api/sessions?limit=50&status=collected"

# 单个会话的所有上报(同一链接被多浏览器打开时会有多条)
curl -H "x-admin-key: $KEY" "$BASE/api/session/<token>"

# 风控反查(五种维度,任选其一)
curl -H "x-admin-key: $KEY" "$BASE/api/risk?hw=<hw_id>"          # 推荐:跨浏览器+跨网络同物理机
curl -H "x-admin-key: $KEY" "$BASE/api/risk?os=<os_id>"          # 硬件+系统匹配(跨网络)
curl -H "x-admin-key: $KEY" "$BASE/api/risk?cross=<cross_id>"    # 严格匹配(含 IP)
curl -H "x-admin-key: $KEY" "$BASE/api/risk?visitorId=<visitorId>"
curl -H "x-admin-key: $KEY" "$BASE/api/risk?ip=1.2.3.4"
```

反查返回三段:
- `exact` —— 与所查标识精确一致的历史命中
- `same_hw` —— 同 `hw_id`(跨浏览器/跨网络同物理机)
- `similar` —— 硬件字段 + 字体 bitmap 汉明距离打分(总分 ≥ 4/10),每条带 `_match.parts` 展示各分项得分

以及关联的 session/IP/visitor 列表和**风险标签**。

### 直接查 D1 数据库

需要更复杂的分析时,直接跑 SQL:

```bash
export CLOUDFLARE_API_TOKEN=<...>
export CLOUDFLARE_ACCOUNT_ID=<...>

# 看最近 50 条
npx wrangler d1 execute fingerprint-db --remote \
  --command "SELECT * FROM fingerprints ORDER BY created_at DESC LIMIT 50"

# 设备聚合:哪些设备被采集次数最多、关联了哪些 IP
npx wrangler d1 execute fingerprint-db --remote --command "
  SELECT cross_id, COUNT(*) hits, COUNT(DISTINCT session_id) sessions,
         GROUP_CONCAT(DISTINCT ip) ips
  FROM fingerprints
  GROUP BY cross_id ORDER BY hits DESC LIMIT 20"

# 找出可能的机器人流量
npx wrangler d1 execute fingerprint-db --remote --command "
  SELECT * FROM fingerprints WHERE bot_score >= 0.6 ORDER BY created_at DESC"

# 导出全部为 JSON 到本地
npx wrangler d1 execute fingerprint-db --remote --json \
  --command "SELECT * FROM fingerprints" > dump.json
```

也可以在 Cloudflare Dashboard 网页里查:
`https://dash.cloudflare.com/<account_id>/workers/d1/fingerprint-db` → Console 标签跑 SQL。

---

## 跨浏览器识别原理

**`visitorId`** 由 FingerprintJS 生成,基于大量浏览器可观察信号(Canvas、字体列表、userAgent、语言、时区、屏幕、插件等)。同一设备切换浏览器后,userAgent、语言、字体渲染细节都会变,所以 `visitorId` 会**不同**。

**分层 ID(hw_id / os_id / cross_id)** 由本项目在服务端生成,分别用不同稳定性的字段:

`hw_id` —— 纯硬件层,SHA-256:
- GPU canonical(去掉驱动版本/D3D shader model 尾巴)+ vendor + WebGL extensions 排序集合 + `MAX_TEXTURE_SIZE`
- WebGPU adapter info(vendor/architecture)—— Safari 打码 GPU 时的兜底
- Audio fingerprint + `sampleRate` + `baseLatency`
- 屏幕物理分辨率 + colorDepth

`os_id = SHA-256(hw_id | 字体精确哈希 | 时区 | UA-CH platform+version | 语言集)`

`cross_id = SHA-256(os_id | ip)` —— 与旧版行为一致。

**注意点**:
- `hardware.cores` 和 `hardware.memory` **不进哈希**(现代浏览器只返回几档固定值,熵极低)。单独存列供打分参考。
- GPU renderer 用 `canonicalGpu()` 规范化(见 [src/fonts.js](FingerPrintGetterPlus/src/fonts.js))去掉版本号 —— 同机不同驱动版本才能匹配上。
- 字体除了原有精确 hash,还编码成 **128-bit bitmap**(`fonts_bitmap`),`/api/risk` 用**汉明距离**做模糊匹配 —— 允许 1-2 个字体差异不算掉链。

若要验证:同一台电脑用两个不同浏览器打开同一采集链接 → `visitorId` 不同,但 `hw_id` / `os_id` / `cross_id` 全一致;换 WiFi 再打开 → `cross_id` 变了,`hw_id` / `os_id` 仍一致。

---

## 风控标签

反查返回的 `risk_flags` 数组:

| 标签 | 含义 |
|---|---|
| `same_device_many_sessions` | 同一设备被采集了 3+ 次 → 可能账号复用 / 多开 |
| `device_ip_hopping` | 同一设备用过 3+ 个不同 IP → VPN/代理频繁切换 |
| `cross_asn_device` | 同设备用过 3+ 个不同 ASN → 跨机房/跨运营商代理 |
| `automation_suspected` | 出现过 bot_score ≥ 0.6 的记录 → 疑似自动化 |
| `incognito_seen` | 出现过隐身模式访问 → 规避 cookie 追踪嫌疑 |

---

## 维护

**更新代码**
```bash
git pull
npx wrangler deploy
```
不用重跑 `deploy.sh`(secrets 和 D1 不动)。

**查看 Worker 实时日志**
```bash
npx wrangler tail
```

**滚动 ADMIN_KEY**(担心泄露时)
```bash
NEW_KEY=$(openssl rand -hex 32)
echo -n "$NEW_KEY" | npx wrangler secret put ADMIN_KEY
echo "新 key: $NEW_KEY"
# 然后重新访问 /?key=<新key>,localStorage 会更新
```

**滚动 Bot Token**(BotFather `/revoke` 后)
```bash
echo -n "<新token>" | npx wrangler secret put TELEGRAM_BOT_TOKEN
curl "https://api.telegram.org/bot<新token>/setWebhook?url=<BASE_URL>/tg/webhook"
```

**清库**(慎用)
```bash
npx wrangler d1 execute fingerprint-db --remote \
  --command "DELETE FROM fingerprints; DELETE FROM sessions;"
```

**销毁部署**
```bash
npx wrangler delete                                  # 删 Worker
npx wrangler d1 delete fingerprint-db                # 删 D1(数据不可恢复)
```

---

## 目录结构

```
FingerPrintGetterPlus/
├── deploy.sh                  一键部署脚本
├── wrangler.toml.example      配置模板(deploy.sh 会复制成本地 wrangler.toml)
├── package.json
├── migrations/                D1 迁移(deploy.sh 用 _migrations 表跟踪已应用项)
│   ├── 0001_init.sql          sessions + fingerprints
│   ├── 0002_tg_user.sql       sessions 补 tg_user_id/username/first_name
│   ├── 0003_relay.sql         users + config + relay_map(双向中继)
│   └── 0004_layered_ids.sql   hw_id / os_id + 关键字段单列 + 字体 bitmap
├── src/                       Worker 后端
│   ├── index.js               路由入口 + 静态资源 fallback
│   ├── util.js                JSON / CORS / 随机 token / SHA256 / 鉴权
│   ├── fonts.js               canonical 字体列表 + bitmap + 汉明距离 + GPU canonical 化
│   ├── collect.js             接收上报 + 服务端富化 + 生成 hw_id/os_id/cross_id + bot_score
│   ├── risk.js                风控反查(精确 + 同 hw_id + 相似度) + 全量导出 + 汇总统计
│   └── telegram.js            TG Bot(任何消息都返回采集链接)
└── public/                    Cloudflare Workers Assets
    ├── collect.html           采集页(伪装"安全验证中")
    ├── extra-signals.js       70+ 项扩展信号采集
    └── admin.html             Web 管理面板
```

## 合规提醒

采集页应向被采集方明示用途(风控/反欺诈),并遵守当地隐私法规(GDPR / PIPL 等)。仅在**你自己的业务场景中,对访问你服务的用户**采集,不要向第三方页面注入,不要用于监视非授权对象。工具本身不判定用途合法性,责任由部署者承担。
