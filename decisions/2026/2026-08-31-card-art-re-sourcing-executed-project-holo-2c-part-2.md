---
date: "2026-08-31"
title: "Card-art re-sourcing executed (Project Holo 2c, part 2)"
decided_by: "repo owner (@cheyras); carried out by Claude (Fable 5)."
areas: ["catalog","operations"]
supersedes: []
---
## 2026-08-31 — Card-art re-sourcing executed (Project Holo 2c, part 2)

**Decided by:** repo owner (@cheyras); carried out by Claude (Fable 5).

**Decision:** §7 of `research/CARD-ART-SOURCES.md` is resolved. The owner
approved **pokemontcg.io** as the card-art fallback source, and separately
approved deleting the objects left with no approved source to attribute them
to. Both are now executed, not just decided.

**Numbers:** the dump (`tools/card-art/dump-affected.sql`) measured **1,912**
affected `image_asset` rows (1,854 `source_url IS NULL` + 58 on the retired
host) across **914** distinct cards. The crosswalk
(`tools/card-art/crosswalk.json`, built by `tools/card-art/build-crosswalk.mts`
from TCGdex + pokemontcg.io) mapped 173 of 218 sets, recovering all 120
`swsh-TG` cards. The pipeline (`tools/card-art/resource-assets.mts`)
re-sourced **1,417** assets from `images.pokemontcg.io`, re-encoded to webp
(83.27 MB), and uploaded them through the shipped `storage:backfill --prefix
images --force` choke point (B1) with **0 failures** (46 flagged undersized).
The remaining **495** rows had no approved source (230 set-unmapped, 103
persistent upstream 404s, 84 orphan rows, 78 per-number refusals).
`out/apply-source-urls.sql` attributed the 1,417 re-sourced rows; the closing
SELECT confirmed exactly 495 still unattributed, matching the delete set.

**Finding, not a fix (Unown `!` sanitizer gap):** of the 495 owner-approved
deletions, 493 went through the shipped `deleteObject`; the other 2 needed a
direct storage API call because the card's `localId` is literally `!` (Unown
`!` in `exu`), which the shipped key sanitizer refuses outright. This is the
same character §1 of `CARD-ART-SOURCES.md` already flagged as unrepresentable
under the `SEGMENT` allow-list in `packages/storage/src/paths.ts` (a B6
path-contract issue). Not changed today — logged here so the sanitizer gap
isn't rediscovered from scratch. `out/apply-unavailable.sql` then deleted the
495 manifest rows in one `BEGIN`/`DELETE`/`COMMIT`.

**Verification, all clean:** rows without an approved source = 0; rows on an
unapproved host = 0; unexpected pokemontcg.io `source_url`s outside the
approved set = 0; orphan `image_object` rows = 0; etag spot-check 10/10
matched (no CDN staleness). `research/card-art-unavailable.json` is now
published as the live no-art list: **952 cards** (the 495 just deleted, plus a
485-card residue that never had art — the 2026-08-26 `card-art-residue.json`
measurement of 504 rederived under the new crosswalk; coverage rose 88 → 107,
almost entirely `cel25cc`'s `_A`/`_B` numbering the original probe couldn't
decode). See `research/card-art-residue.json`'s `rederivations` entry and
`research/CARD-ART-SOURCES.md` §8 for the full write-up.

**Outstanding (named, not done):**

1. `storage:backfill --reconcile` has not been run — 60 uploaded objects lack
   an `image_object` per-tier row, so `manifest:check` reports DRIFT until it
   runs. On the manager.
2. **Open decision:** whether to add `images.pokemontcg.io` to
   `IMAGE_SOURCE_HOSTS` (`packages/storage/src/upstream.ts`) so re-sourced
   assets self-heal through the normal warm path. Not decided — put to the
   owner, per B9.
3. A visual in-app spot check of the re-sourced art has not been done.

**Implications:** the image store's provenance ledger is honest again for
this population — every remaining gap is either attributed to an approved
source or listed in `card-art-unavailable.json`, never silently missing. The
Unown-`!` finding means two cards will need a B6 path-contract change before
they can ever carry art, independent of sourcing.


