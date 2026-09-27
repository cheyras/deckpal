---
date: "2026-09-21"
title: "30th Celebration Classic Collection card art: source found, adoption pending Scrydex permission"
decided_by: "art-doc worker (Claude Sonnet 4.6) on behalf of @cheyras"
areas: ["security","images","catalog"]
supersedes: []
---
## 2026-09-21 — 30th Celebration Classic Collection card art: source found, adoption pending Scrydex permission

**Decided by:** art-doc worker (Claude Sonnet 4.6) on behalf of @cheyras

**Decision:** Record that all 30 Classic Collection (`me55c`) card images are available at `https://images.scrydex.com/pokemon/{me55c-id}/large` (PNG 654×914, HTTP 200, 30/30), sourced via the public pokemontcg.io API (`https://api.pokemontcg.io/v2/cards?q=set.id:me55c&pageSize=250`). The CDN has migrated from `images.pokemontcg.io` to `images.scrydex.com`; this is the same project under a new domain (pokemontcg.io: *"The Pokémon TCG API is now part of Scrydex"*; Scrydex FAQ: *"Scrydex is the official successor to pokemontcg.io"*). However, `https://scrydex.com/terms` prohibits redistribution/mirroring without prior written authorization. Whether DeckPal's August 2026 pokemontcg.io caching posture automatically extends to `images.scrydex.com` is unconfirmed; Root has asked @cheyras asynchronously. **adoptionStatus: pending-permission.** No scans have been published; no source allowlist has been changed; no card art has been deployed to production.

**Why:** The 60 Classic card asset paths were upstream 404 at both TCGdex and the prior approved pokemontcg.io CDN domain. Source research located the actual images at `images.scrydex.com` (the official CDN successor). Research downloaded all 30 large images to isolated evidence in the taskdir; none were published. DeckPal's catalog has 30 Classic cards (`30th-c`); the pokemontcg.io API also returns exactly 30 cards for `me55c`. The collector-number crosswalk is non-trivial: the API uses original source-set collector numbers with letter suffixes where the same number appears more than once (`me55c-11` vs `me55c-11g`; `me55c-106`, `me55c-106p`, `me55c-106m`), not sequential 001–030. The full crosswalk is in `research/30th-classic-image-crosswalk.json`.

**CDN host migration:** `images.pokemontcg.io` and `images.scrydex.com` are the same project. The August 2026 allowlist entry for `images.pokemontcg.io` in `packages/storage/src/upstream.ts` does NOT automatically cover `images.scrydex.com` — an explicit one-line addition is required after Root confirms the permission posture.

**Branding:** No Classic-specific logo was provided by any confirmed source. The `me55c-logo` at `images.scrydex.com` is the parent 30th Celebration wordmark (253×140 PNG), visually identical to `me55`; the `me55c-symbol` is a near-blank JPEG (38×21, 691 bytes), unusable at any display size. The bundled logo fallback now covers both `30th` and `30th-c` via `BUNDLED_SET_LOGOS` in `releasedSetAssets.ts`, reusing the existing approved 448×247 WebP (Bulbagarden Archives, 2026-09-11). No Classic-specific symbol has been verified. The `30th-c` logo mapping reuses the approved parent-set asset (visual match; no independent Classic-specific source found).

**Verified assets (production):** The set-fill operator filled `sets/30th/logo.webp`, `sets/30th/symbol.webp`, and `sets/30th-c/logo.webp` from approved TCGdex URLs (`https://assets.tcgdex.net/en/me/30th/logo.png` 735×401, `https://assets.tcgdex.net/en/me/30th/symbol.png` 40×40). `result.json` is present and passed: three objects verified, zero scoped drift, source URLs persisted in manifest (projectId: jbdfhbmspaqpfzylnlze). Pre-existing 10,532-object global drift is unrelated and out of scope.

**Visual stamp:** Root visually confirmed the 30th anniversary stamp on Charizard and the LEGEND top half; Arceus VSTAR and LEGEND bottom are in the contact sheet. The remaining 26 cards were not individually reviewed by root; catalog identity is strong. Terminal cannot confirm stamps.

**What was NOT done:** No Scrydex card scans published. No new image source approved. No allowlist changes and no new accounts or purchases. The three separately approved TCGdex set branding assets (sets/30th/logo.webp, sets/30th/symbol.webp, sets/30th-c/logo.webp) were published and verified as recorded above.

**Root actions needed:** (1) Permission required — confirm or obtain Scrydex written permission for caching 30 Classic WebPs. (2) Implement a bounded 30-card mapping from DeckPal `30th-c` IDs to actual `me55c` image URLs, flowing through the existing provenance choke point; permit `images.scrydex.com` in both `IMAGE_SOURCE_HOSTS` and `originFor`, preserving SSRF checks unchanged. Verify all 60 WebP outputs and confirm in real browser before marking complete. The existing `storage:backfill` mirrors a disk cache and will NOT source this crosswalk on its own. Root already reviewed all four contact-sheet samples; do not ask again.
