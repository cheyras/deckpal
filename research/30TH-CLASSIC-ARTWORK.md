# 30th Celebration Classic Collection — Card Art Sources

**Author:** art-doc worker (Claude Sonnet 4.6) on behalf of @cheyras
**Date:** 2026-09-21
**Status:** RESEARCH ONLY. adoptionStatus: **pending-permission**.
**Companion:** [`30th-classic-image-crosswalk.json`](30th-classic-image-crosswalk.json)

---

## Summary

All 30 Classic Collection cards (`me55c`, `30th-c` in DeckPal catalog) have verified large images at `https://images.scrydex.com/pokemon/{me55c-id}/large` — PNG 654×914, HTTP 200, 30/30. The pokemontcg.io API (`https://api.pokemontcg.io/v2/cards?q=set.id:me55c&pageSize=250`) returns exactly 30 cards matching the DeckPal worklist. Images exceed the 825 px height threshold. None have been published; no allowlist has been changed.

**Adoption is blocked pending written permission from Scrydex.** The Scrydex ToS prohibits redistribution/mirroring without prior written authorization. Whether DeckPal's existing August 2026 pokemontcg.io caching posture extends to the renamed CDN domain is unconfirmed. Root has asked @cheyras asynchronously; no answer yet.

---

## CDN host migration

`images.pokemontcg.io` has migrated to `images.scrydex.com`. This is the same project:

- pokemontcg.io homepage: *"The Pokémon TCG API is now part of Scrydex."*
- Scrydex FAQ: *"Scrydex is the official successor to pokemontcg.io."*
- Scrydex docs: *"Scrydex is the natural evolution of the Pokémon TCG API (previously hosted at pokemontcg.io)."*

pokemontcg.io API keys continue to work through 2027-03-01; the image CDN domain has already changed. **This is one project, one ownership, one migration — not a new third-party source.** However, CDN identity alone does not prove prior permission carries, and Scrydex ToS must be read independently (see Policy below).

---

## Card crosswalk

DeckPal uses sequential IDs `30th-c-001`–`30th-c-030`. The pokemontcg.io API uses original collector numbers from each card's source set, with letter suffixes where the same original number appears more than once in `me55c`:

| DeckPal ID | Name | pokemontcg.io ID |
|---|---|---|
| 30th-c-001 | Charizard | me55c-4 |
| 30th-c-002 | Delcatty | me55c-5 |
| 30th-c-003 | Metagross | me55c-11 |
| 30th-c-004 | Genesect EX | me55c-11g |
| 30th-c-005 | Misty | me55c-18 |
| 30th-c-006 | Dark Tyranitar | me55c-19 |
| 30th-c-007 | Sneasel | me55c-25 |
| 30th-c-008 | Pikachu & Zekrom GX | me55c-33 |
| 30th-c-009 | Greninja BREAK | me55c-41 |
| 30th-c-010 | Uxie | me55c-43 |
| 30th-c-011 | Crobat G | me55c-47 |
| 30th-c-012 | Raikou | me55c-50 |
| 30th-c-013 | Buzzwole GX | me55c-57 |
| 30th-c-014 | Pikachu | me55c-58 |
| 30th-c-015 | Erika's Jigglypuff | me55c-69 |
| 30th-c-016 | Rayquaza EX | me55c-85 |
| 30th-c-017 | Solgaleo GX | me55c-89 |
| 30th-c-018 | Gengar | me55c-94 |
| 30th-c-019 | Darkrai & Cresselia LEGEND (top) | me55c-99 |
| 30th-c-020 | Darkrai & Cresselia LEGEND (bottom) | me55c-100 |
| 30th-c-021 | N | me55c-101 |
| 30th-c-022 | Palkia | me55c-106p |
| 30th-c-023 | M Gardevoir EX | me55c-106m |
| 30th-c-024 | Shining Celebi | me55c-106 |
| 30th-c-025 | Scizor ex | me55c-108 |
| 30th-c-026 | Mew VMAX | me55c-114 |
| 30th-c-027 | Arceus VSTAR | me55c-123 |
| 30th-c-028 | Zacian V | me55c-138 |
| 30th-c-029 | Lugia | me55c-149 |
| 30th-c-030 | Magikarp | me55c-203 |

**Duplicate original numbers:** `11` (me55c-11 Metagross / me55c-11g Genesect EX) and `106` (me55c-106 Shining Celebi / me55c-106p Palkia / me55c-106m M Gardevoir-EX). Do NOT use sequential 1–30 when building the import mapping; use the actual pokemontcg.io card IDs from this crosswalk.

---

## Native dimensions

All 30 large images are PNG 654×914. Height 914 px ≥ 825 px threshold. Byte range 596,352–1,531,914 bytes, consistent with real source scans (not upscaled). Dimensions verified by PNG header read from downloaded evidence files.

---

## Visual evidence

Research downloaded all 30 images to isolated evidence; none published. Four cards have named visual files:

- `evidence/visual_charizard.png` — Charizard (001), 654×914 PNG. Root confirmed 30th stamp visible.
- `evidence/visual_arceus_vstar.png` — Arceus VSTAR (027), 654×914 PNG. Root confirmed in contact sheet.
- `evidence/visual_darkrai_legend_top.png` — LEGEND top (019), 654×914 PNG. Root reviewed.
- `evidence/visual_darkrai_legend_bot.png` — LEGEND bottom (020), 654×914 PNG. Root reviewed.
- `evidence/contact-sheet.png` — 2×2 thumbnail composite of the above four.

Anniversary stamp presence confirmed by root for these four cards only. The remaining 26 cards were not individually visually reviewed by root; catalog identity (distinct me55c set ID, released 2026-09-16, separate from original set records) is strong but terminal confirmation of stamp is not available for them.

---

## Branding

**Logo:** `me55c-logo` at the Scrydex CDN is the parent **30th Celebration wordmark** (253×140 PNG), identical to me55. No Classic Collection-specific logo is provided by any confirmed source. The existing approved bundled asset `pokemon-30th-celebration-logo.webp` (448×247 WebP, Bulbagarden Archives, approved 2026-09-11) is reused as a display fallback for `30th-c` via `BUNDLED_SET_LOGOS` in `releasedSetAssets.ts`. The `30th-c` entry in `BUNDLED_SET_LOGOS` reuses the approved parent-set asset, confirmed by visual match; no independent Classic-specific logo source was found.

**Symbol:** `me55c-symbol` at the Scrydex CDN is a near-blank JPEG (38×21, 691 bytes). Not usable at any display size. No Classic-specific symbol has been verified.

**TCGdex (`30th-c`):** `logo: null`, `symbol: null` (metadata fields remain null; set logo is confirmed 735×401 WebP in object tier). The set-fill operator (`set-fill/approved-set-art/`) filled `sets/30th/logo.webp`, `sets/30th/symbol.webp`, and `sets/30th-c/logo.webp` from approved TCGdex URLs. `result.json` is present and passed: three objects verified, zero scoped drift, source URLs persisted in manifest.

---

## Policy review (not legal advice)

**Scrydex ToS** (`https://scrydex.com/terms`) prohibits:
> *"Resell, sublicense, redistribute, mirror, or commercially exploit the Services without prior written authorization from Scrydex."*

"Services" is defined broadly in the ToS. No historical comparison to prior pokemontcg.io terms is available. Written authorization from Scrydex is required before caching or serving these images.

**Third-party IP:** Scrydex explicitly disclaims ownership: *"Any third-party card data, metadata, trademarks, or related content accessible through the Services remains the property of its respective owners or licensors."* The upstream IP question (Nintendo/TPCi) is unchanged.

**Prior approval:** pokemontcg.io was approved as a card-art fallback source per `CARD-ART-SOURCES.md §8`, Root decision 2026-08-31. Scrydex is that same project. However, CDN domain identity does not automatically extend the prior approval: written permission from Scrydex may be required, and the allowlist entry in `packages/storage/src/upstream.ts` needs an explicit `images.scrydex.com` addition regardless.

**Current posture:** `adoptionStatus: pending-permission`. Root has asked @cheyras whether DeckPal already has or can obtain Scrydex written permission for caching these 30 Classic scan WebPs. No answer recorded at time of authoring.

---

## Root actions needed before adoption

1. **Permission:** Confirm whether DeckPal already has written permission from Scrydex, or initiate the permission request. (See `docs/source-record/permission-request.md` for a draft never-send template.)
2. **Visual stamp:** Root reviewed all four contact-sheet cards (Charizard, LEGEND top, LEGEND bottom, Arceus VSTAR). 26 of 30 cards were not individually root-reviewed; catalog identity (distinct me55c set ID, released 2026-09-16) is accepted as sufficient.
3. **Allowlist:** Add `images.scrydex.com` to `IMAGE_SOURCE_HOSTS` in `packages/storage/src/upstream.ts` (one-line change, analog to the existing `images.pokemontcg.io` entry).
4. **Adoption implementation:** After permission confirmed: implement a bounded 30-card mapping from DeckPal `30th-c` IDs to the pokemontcg.io card IDs in this crosswalk, flowing through the existing provenance choke point with actual source URLs. Both `IMAGE_SOURCE_HOSTS` and `originFor` must allow `images.scrydex.com` under unchanged SSRF protections. Validate all 60 WebP outputs and verify in browser before marking complete.

---

_Authored by art-doc worker (Claude Sonnet 4.6) on behalf of @cheyras — 2026-09-21_
_This source-research documentation made no production card-scan changes; approved set branding fill is documented above. Evidence in `followup/current-card-cdn/evidence/`. Check: `python3 /mnt/c/Users/cheyr/deckpal-classic-art/check-docs.py`_
