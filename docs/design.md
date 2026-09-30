# Design notes

Why the identifiers and the matching work the way they do. This is the place to
challenge a decision — open an issue that argues against one of these with
concrete data.

## Layered identifiers

FingerprintJS's `visitorId` is per-browser: it folds in userAgent, language and
font-rendering details, all of which change when the same person opens a
different browser. That makes it useless on its own for "same person, different
browser" — the exact question fraud work asks.

So the Worker derives three IDs server-side, each hashing a different band of the
signal by how stable it is:

| ID | Basis | Survives |
|---|---|---|
| `hw_id` | canonical GPU + WebGL extensions + `MAX_TEXTURE_SIZE`, WebGPU adapter, audio fingerprint + `sampleRate`/`baseLatency`, physical screen params | browser change, network change, OS reinstall |
| `os_id` | `hw_id` + exact font hash + timezone + UA-CH platform/version + language set | network change |
| `cross_id` | `os_id` + client IP | nothing (kept only for legacy compatibility) |

`hw_id` is the recommended lookup key. `cross_id` predates the layered scheme and
is retained so old queries keep returning the same shape.

### Why `cores` and `memory` are not hashed

`navigator.hardwareConcurrency` and `deviceMemory` return a handful of bucketed
values (4, 8, 16; 4, 8) shared by millions of machines. Folding them into a hash
adds almost no entropy but makes the hash brittle — a browser that clamps or
hides them would flip the whole ID. They are stored in their own columns and used
only as weak scoring signals in the fuzzy match.

### Canonicalising the GPU

WebGL's `RENDERER` string carries a driver version and a D3D shader-model tail
that change on a driver update without the hardware changing. `canonicalGpu()`
(see [../src/fonts.js](../src/fonts.js)) strips those so the same machine still
matches after an update. Change that function and you shift every future
`hw_id`; historical rows keep their old hash.

## Fuzzy matching

Exact-hash matching misses a device the moment one field drifts — a new monitor
changes `screen_res`, a font install changes the font hash. `/api/risk` therefore
also scores candidates field by field (see `similarityScore` in
[../src/risk.js](../src/risk.js)), out of 10.5:

- GPU canonical equal → 3
- audio fingerprint equal → 3
- exact font hash equal → 2, else a graded score from the **128-bit font-bitmap
  Hamming distance** (distance ≤ 4 earns partial credit)
- screen resolution → 1
- cores / memory / timezone → 0.5 each

A candidate scoring ≥ 4 is surfaced as `similar`. Null and empty fields never
score against each other — two unknowns are not evidence of a match, which the
tests pin down.

The font bitmap is why `CANONICAL_FONTS` in `src/fonts.js` must stay in lockstep
with the probe order in `public/extra-signals.js`, append-only. Reordering it
re-bins every historical bitmap and silently breaks Hamming comparisons.

## Consent stance

This tool collects data that identifies a specific device. The project's position
(see [../SECURITY.md](../SECURITY.md)) is that it may only be used on services the
operator runs, against visitors who have been informed.

That is a runtime commitment, not just a README line, so the collection page
([../public/collect.html](../public/collect.html)) discloses — in both languages —
that it is taking a device fingerprint, what it takes, and where the data goes,
and tells the visitor to close the page if they do not consent. Feature requests
that would hide collection, disguise it as an unrelated check, or defeat browser
anti-fingerprinting defences are out of scope and will be declined.

## Bot scoring

`computeBotScore` (in [../src/collect.js](../src/collect.js)) is a deliberately
small heuristic, not a classifier: `navigator.webdriver`, a `headless` UA, a
missing core count, software renderers (SwiftShader/llvmpipe), empty
plugins/languages on Chrome, and a high Cloudflare threat score each add weight,
capped at 1. It is a triage signal for the `automation_suspected` flag, nothing
more; Cloudflare's own Bot Management score is kept alongside it in the raw
signals for anyone who wants a stronger judgement.
