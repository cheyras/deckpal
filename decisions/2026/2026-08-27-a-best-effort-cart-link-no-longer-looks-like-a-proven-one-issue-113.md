---
date: "2026-08-27"
title: "A best-effort cart link no longer looks like a proven one (issue #113)"
decided_by: "Claude Opus 5 on behalf of @cheyras"
areas: ["commerce"]
supersedes: []
---
## 2026-08-27 — A best-effort cart link no longer looks like a proven one (issue #113)

**Decided by:** Claude Opus 5 on behalf of @cheyras

**Decision:** `PurchaseSetMenu` renders `exactUrls` and `bestEffortUrls`
separately, with the name-matched links visually secondary and labelled.

**Why.** `buildCart` deliberately keeps two kinds of line apart. `exact` lines
are `<qty>-<productId>` and resolve against TCGplayer's catalog
deterministically. `bestEffort` lines are curated name tokens — a guess that can
miss. The builder's own comment says why they get their own urls: *"Mass Entry
is all-or-nothing, so a guess that misses must not be able to void the exact
cart."* The API carries both fields. The UI then concatenated them into one
`urls` array and rendered every entry as an identical `part i of N`, which threw
away the distinction the builder exists to preserve: **a link that added nothing
looked exactly like a link that worked.**

That is the second half of issue #113. The first half — the `/deckpal/api` base
path returning the SPA's HTML — is why the feature failed outright on cloud. This
is why it was *"spotty and unreliable in general"* even when it did work, and it
is the same symptom closed issue #37 reported from the TCGplayer side.

**Implications.**
- Render from `exactUrls` / `bestEffortUrls`. `urls` remains in the payload for
  compatibility and is no longer what the UI reads.
- A name-matched cart is an offer, not a promise. It says so on the button.
