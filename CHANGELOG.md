# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Complete bilingual documentation: English `README.md` (primary) and
  `README.zh-CN.md`, each a full peer of the other with a language switcher.
  The old summary-only `README.en.md` is removed.
- `.github/dependabot.yml`: weekly grouped update PRs for GitHub Actions and npm.
- `docs/design.md`: the layered-ID rationale, the fuzzy-match scoring model, and
  the consent stance, so decisions have one place to live.

### Changed
- **Collection page is now consent-visible.** `public/collect.html` no longer
  presents itself as a bare "security check"; it states plainly, in Chinese and
  English, that it collects a device fingerprint, what it collects, and why, and
  tells the visitor to close the page if they do not consent. The Telegram
  prompt that hands out the link now names the device check instead of calling it
  "human verification". This aligns the runtime behaviour with the scope-of-use
  rule already stated in [SECURITY.md](SECURITY.md) and [CONTRIBUTING.md](CONTRIBUTING.md).
- MIT licence, contributing guide, code of conduct, security policy (from 1.0.0).
- GitHub Actions CI: syntax check, unit tests, `wrangler deploy --dry-run`.
- Issue / PR templates.
- `test/`: unit tests for the pure functions in `fonts.js` and `risk.js` (`npm test`).
- `similarityScore` / `buildFlags` are exported from `src/risk.js` for testing.

### Security
- **`ADMIN_KEY` no longer travels in URLs.** The Telegram "details panel" link is
  now a bare `BASE_URL/`; the admin panel reads its key from the `#key=` URL
  fragment (never sent to the server) and sends it as `x-admin-key`. The
  `?key=` query parameter is no longer accepted by `/api/*`, and CSV export no
  longer puts the key in the URL. `deploy.sh` prints the `#key=` form.
  **Upgrade note:** bookmarks or scripts using `?key=` must switch to the header.
- Admin key comparison is constant-time (`timingSafeEqual`).
- Removed the blanket `Access-Control-Allow-Origin: *`; the panel, collection
  page and API are same-origin, so no CORS is needed.
- `/api/collect` returns 429 once a session has accepted 20 reports.

### Fixed
- `randToken` (`src/util.js`) now draws each character uniformly from a 36-char
  alphabet with rejection sampling; the old `byte.toString(36)` approach mapped
  bytes only onto `"0".."73"` and discarded half the entropy on truncation.
- `computeBotScore` (`src/collect.js`) checked `cores === 0`, which real browsers
  never report; it now flags a **missing** core count (`== null`), the actual
  headless signal.
- `handleRisk` (`src/risk.js`) now dedupes the `similar` bucket against the ids
  already returned in `exact` and `same_hw`, so one record can no longer appear
  in more than one bucket.
- `db:migrate` / `db:migrate:local` skipped `0004_layered_ids.sql`; a fresh
  database built with those scripts was missing the layered-ID columns
  (deployments made with `deploy.sh` were unaffected).

## [1.0.0]

First release.

- Fingerprint collection backend on Cloudflare Worker + D1 + Workers Assets.
- FingerprintJS open-source edition + 70+ custom extra signals.
- Layered device IDs: `hw_id` (hardware-only, stable across browsers and
  networks) / `os_id` / `cross_id`.
- Fuzzy-match risk lookup with a font bitmap + Hamming distance (`/api/risk`).
- Bot scoring and Cloudflare Turnstile verification.
- Telegram bot: mint collection links, force verification, two-way relay,
  device-summary push.
- Web admin panel (`public/admin.html`).
- `deploy.sh` one-command deploy, tracking applied migrations in a
  `_migrations` table.
