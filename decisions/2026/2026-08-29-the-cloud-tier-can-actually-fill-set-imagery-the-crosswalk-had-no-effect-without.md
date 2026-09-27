---
date: "2026-08-29"
title: "The cloud tier can actually fill set imagery (the crosswalk had no effect without this)"
decided_by: "@cheyras, implemented by Claude Opus 5 via a Ringer swarm"
areas: ["images","catalog"]
supersedes: []
---
## 2026-08-29 — The cloud tier can actually fill set imagery (the crosswalk had no effect without this)

**Decided by:** @cheyras, implemented by Claude Opus 5 via a Ringer swarm
**Decision:** `resolveSourceUrl()` in `apps/api/src/images/handler.ts` now
consults `setImageFallbackUrl()` when a set logo/symbol has no recorded source,
and `cloudWarm` gained `--assets sets|cards|both` (default both) so set imagery
has a bulk fill path at all.

**Why:** Two gaps meant the 43-entry crosswalk shipped earlier the same day could
never have reached deckpal.app, and both failed silently:

- The cloud handler's set branch ended `return null` under a comment reading
  "Set imagery has no derivable URL — the upstream path lives in card_set, and
  every recorded set row carries it. A NULL here is a real dead end." That was
  true when written and stopped being true when the crosswalk landed; nothing
  told the handler. Every one of those 43 assets would have kept answering the
  placeholder forever, no matter how many times the page was viewed.
- `cloudWarm` built its work-list purely from `card.images.low/high`. Set logos
  and symbols were left entirely to per-page-view lazy fill, so there was no bulk
  command to run even once the handler could resolve them.

**Implications:**

- Resolution ORDER is load-bearing and tested: a recorded `source_url` still
  wins; the crosswalk is consulted only when there is none; a (setId, kind) the
  crosswalk does not know still resolves to `null`, which is the honest dead end.
  Card behaviour is untouched.
- The provenance written is the URL ACTUALLY FETCHED, never the assumed crosswalk
  entry, and the write still goes through `putStorageAsset` — contract B1 is
  unchanged. Nothing is written unless a fetch succeeded; a miss still answers
  the placeholder with the existing short TTL so it self-heals.
- The comment above `resolveSourceUrl` was extended rather than replaced. It
  documents a real past bug in detail and is worth keeping; it now also records
  that set imagery has exactly one more thing to try and what governs it.
- The fill itself is an operator action, not a deploy-time one:
  `pnpm --filter deckpal-images warm:cloud -- --assets sets`. It needs no
  credentials because it drives the DEPLOYED tier's own lazy fill rather than
  uploading anything itself — deliberately, so there is only one implementation
  of the provenance rules. It therefore only works once this code is live.
- Dry run against production on 2026-08-29: 398 set assets in the work-list
  (2 per set across 199 sets). Most already exist and answer a cheap `302 HIT`.

