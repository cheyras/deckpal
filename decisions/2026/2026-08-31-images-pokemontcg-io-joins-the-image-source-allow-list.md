---
date: "2026-08-31"
title: "images.pokemontcg.io joins the image-source allow-list"
decided_by: "Not recorded"
areas: ["images","catalog"]
supersedes: []
---
## 2026-08-31 -- images.pokemontcg.io joins the image-source allow-list

**Decision (owner, in chat, 2026-08-31):** add `images.pokemontcg.io` to
`IMAGE_SOURCE_HOSTS` in `packages/storage/src/upstream.ts`.

**Why now.** The card-art re-sourcing (same date, earlier entry) attributed
~1,417 assets to `images.pokemontcg.io` URLs. Without the allow-list entry those
rows could serve their existing bytes but could never *refill* -- a lost object
would degrade to the placeholder while carrying a perfectly good recorded
source. The entry closes that gap; the refill path now covers every recorded
provenance in the store.

**Licensing basis:** pokemontcg.io is the approved card-art fallback per
`research/CARD-ART-SOURCES.md` section 7 (owner decision, same date). The
allow-list comment and `SECURITY.md` carry the one-line justification; the test
pins the list at exactly three hosts.


