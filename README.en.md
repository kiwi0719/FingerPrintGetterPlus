# FingerPrintGetterPlus

[![CI](https://github.com/kiwi0719/FingerPrintGetterPlus/actions/workflows/ci.yml/badge.svg)](https://github.com/kiwi0719/FingerPrintGetterPlus/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Browser and device fingerprint collection for anti-fraud. Runs entirely within Cloudflare's free tier.

*[中文文档](README.md) — the Chinese README is the complete reference; this page is a summary.*

- **Backend**: Cloudflare Worker (edge, no cold starts)
- **Storage**: Cloudflare D1 (SQLite)
- **Frontend**: FingerprintJS open-source edition + 70 extra signals
- **Entry points**: a Telegram bot that mints collection links, plus a web admin panel

> ### ⚠️ Scope of use
>
> This project collects personal data that identifies a specific device. **Use it only on services you operate, against visitors who have been informed**, for risk control and fraud prevention.
>
> Do not use it to track or surveil people without authorization, do not inject it into third-party pages, and do not collect without disclosure. Comply with your local privacy law (GDPR, PIPL, etc.). The tool does not judge the legality of your use — **operators bear full responsibility**.
>
> See [SECURITY.md](SECURITY.md).

## Core concepts

| Field | Meaning | Stability |
|---|---|---|
| `visitorId` | FingerprintJS browser identity | Stable per browser; changes across browsers |
| `hw_id` | **Hardware-only** hash: canonical GPU, WebGPU adapter, audio hardware params, physical screen params | Same across browsers *and* networks on one physical machine |
| `os_id` | `hw_id` + system font set + timezone + system language + platform version | Survives network changes; changes on OS reinstall |
| `cross_id` | `os_id` + client IP | Legacy behaviour; changes with the network |
| `bot_score` | Automation likelihood, 0 (human) to 1 (highly suspicious) | Evaluated per collection |
| `session_id` | Token for one collection link; a link may be visited more than once | — |

To identify one person across browsers, or across both browsers and networks, query by `hw_id`. Beyond exact matching, `/api/risk` also does fuzzy matching via per-field similarity scoring plus font-bitmap Hamming distance, tolerating one or two fields drifting (a new monitor changing `screen_res`, for example).

## Signals collected

- **Hardware** — detailed GPU (WebGL vendor/renderer/extensions/depth/viewport), WebGPU adapter info, AudioContext fingerprint plus sampleRate/baseLatency, physical screen params, presence of 6 sensor APIs, battery, storage quota
- **System** — 60+ font probes (full CJK coverage), timezone, Intl locale/numberingSystem/calendar, language chain, keyboard layout map, full UA-CH high-entropy values
- **Browser capabilities** — video and audio codec support, EME/DRM (Widevine/PlayReady/FairPlay/ClearKey), speech synthesis voice list, presence of 17 APIs
- **Rendering** — Canvas 2D hash, Canvas emoji hash, text metrics, 15 CSS media-query features
- **Network** — WebRTC local/public IP and SDP codecs, Connection API
- **Server-side enrichment** — IP, ASN, country (Cloudflare edge), full request headers including Client Hints

## Quick start

```bash
git clone https://github.com/kiwi0719/FingerPrintGetterPlus.git
cd FingerPrintGetterPlus
npm install
./deploy.sh          # creates the D1 database, applies migrations, prompts for secrets, deploys
```

You will need a Cloudflare account, `wrangler` (installed as a dev dependency), and a Telegram bot token from [@BotFather](https://t.me/BotFather). Secrets (`TELEGRAM_BOT_TOKEN`, `ADMIN_KEY`, `TURNSTILE_SECRET`) are injected via `wrangler secret put` and never committed — `wrangler.toml` is gitignored.

See the [Chinese README](README.md#部署) for the full deployment walkthrough, HTTP API reference, admin panel usage, risk flags and maintenance commands.

## Development

```bash
cp wrangler.toml.example wrangler.toml   # fill in your own D1 database_id
npm run db:migrate:local
npm run dev                              # local Worker against local D1
npm test                                 # Node's built-in test runner, no extra deps
```

Tests cover the pure functions in `src/fonts.js` and `src/risk.js`. Worker-runtime code is not covered.

> **Careful with `CANONICAL_FONTS`**: its order must match the probe order in `public/extra-signals.js` exactly, and entries may only be appended. Inserting or reordering invalidates **every historical bitmap**.

## Contributing

Issues and pull requests welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md). Chinese or English are both fine.

Report vulnerabilities privately per [SECURITY.md](SECURITY.md) — **not** through public issues.

## License

[MIT](LICENSE) © kiwi0719

Uses [FingerprintJS](https://github.com/fingerprintjs/fingerprintjs) open-source edition (BSD-3-Clause).
