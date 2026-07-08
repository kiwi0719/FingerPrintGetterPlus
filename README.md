# Fingerprint Collector — CF Worker + D1 + Telegram Bot

反欺诈用途的浏览器/设备指纹采集系统。全部跑在 Cloudflare 免费额度内。

## 架构

```
Telegram Bot ──/new──► Worker ──► D1 (sessions)
                          │
                          └─► 生成采集链接 /c/<token>
                                          │
目标浏览器打开 ──► collect.html ──► FingerprintJS + 扩展信号
                                          │
                          POST /api/collect (含 CF 边缘富化的 IP/ASN/国家)
                                          │
                                    D1 (fingerprints)
                                          │
                          ◄── Bot 自动回推结果给发起者
```

## 关键设计

- **visitorId**:FingerprintJS 开源版稳定 ID(同浏览器稳定)
- **cross_id**:服务端基于「硬件层信号」重新哈希 —— GPU renderer、物理分辨率、CPU 核数、内存、音频指纹、系统字体、时区 —— **同一台设备用不同浏览器打开链接,cross_id 一致**,这就是跨浏览器识别的关键
- **bot_score**:webdriver/headless/软件渲染/CF threatScore 综合评分
- **风控反查**:任一标识(visitor / cross / ip)反查历史 → 关联 session、IP、其它设备,识别账号复用/团伙

## 扩展信号(相比 FingerprintJS 开源版新增)

- 精细 GPU (WebGL vendor/renderer/extensions)
- Audio OfflineContext 指纹
- 系统字体探测(含 CJK)
- WebRTC 本地/公网 IP(反 VPN)
- UA-CH 高熵值(architecture / model / platform version)
- 存储配额启发式判定隐身模式
- Permissions API 状态、Battery、Sensors 可用性
- Math 精度指纹、Canvas 2D 哈希

## 部署

```bash
# 1. 装依赖
npm i

# 2. 创建 D1
npx wrangler d1 create fingerprint-db
# 把返回的 database_id 填入 wrangler.toml

# 3. 初始化表
npm run db:init

# 4. 配置密钥
npx wrangler secret put TELEGRAM_BOT_TOKEN   # 从 @BotFather 获取
npx wrangler secret put ADMIN_KEY            # 风控查询 API 密钥,自定义强随机串

# 5. 部署
npm run deploy

# 6. 更新 wrangler.toml 的 BASE_URL 为部署后的 workers.dev 域名,再 deploy 一次

# 7. 给 Bot 挂 webhook
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=<BASE_URL>/tg/webhook"
```

## 使用

在 Telegram 里:

- `/new 张三订单#123` → 收到采集链接,发给目标
- 目标打开链接 → 3 秒内完成 → Bot 自动推送结果(含 visitorId / cross_id / IP / 风险等级)
- `/risk <cross_id>` → 反查该设备历史所有采集记录、关联 IP、账号复用告警

风控 API(供业务后端调用):

```bash
curl -H "x-admin-key: $ADMIN_KEY" \
  "$BASE_URL/api/risk?cross=<cross_id>"
```

返回:命中次数、关联 session/IP/visitor 列表、风险标签(`same_device_many_sessions` / `device_ip_hopping` / `automation_suspected` / `incognito_seen`)。

## 合规提醒

采集页应向被采集方明示用途(风控/反欺诈)并遵守当地隐私法规(GDPR / PIPL 等)。仅在**你的业务场景中,对访问你自己服务的用户**采集,不要向第三方页面注入。
