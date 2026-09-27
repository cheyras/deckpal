---
date: "2026-09-19"
title: "Reuse bundled 30th Celebration logo for the released set"
decided_by: "release-ui worker (Claude Opus 4.6) on behalf of @cheyras"
areas: ["images","catalog"]
supersedes: []
---
## 2026-09-19 — Reuse bundled 30th Celebration logo for the released set
**Decided by:** release-ui worker (Claude Opus 4.6) on behalf of @cheyras
**Decision:** Remove the 30th Celebration entry from `UPCOMING_SETS` (now that TCGdex has published the set as `30th`, 158 cards, street date 2026-09-16) and preserve the approved bundled logo (`apps/web/public/brand/pokemon-30th-celebration-logo.webp`) for the released catalog set via a new `releasedSetAssets.ts` mapping consumed by `SetLogo` as a final fallback after the image tier.
**Why:** TCGdex published the 30th set with empty `logo` and `symbol` fields, so the normal image pipeline (`/deckpal/images/sets/30th/logo.webp`) returns nothing. Without intervention the logo would silently disappear once the upcoming placeholder is removed and the catalog set renders through `SetLogo`. The same approved logo already ships in the bundle — reusing it avoids fetching or drawing a new asset, adding image-source hosts, or pretending the main logo is a distinct Classic Collection mark.
**Implications:** `SetLogo` now checks `bundledSetLogo(setId)` after the image-tier sources are exhausted. If a match exists the bundled asset is rendered with `import.meta.env.BASE_URL` so it works under both the cloud root (`/`) and self-host (`/deckpal/`) builds. When upstream eventually populates the logo field and the next catalog refresh lands it, the image tier wins and the fallback is never reached — stale entries in `BUNDLED_SET_LOGOS` are harmless. The `upcoming-route.test.ts` expected sort order was updated to remove the now-absent placeholder; all fixture-based tests are unaffected because they inject their own table.

