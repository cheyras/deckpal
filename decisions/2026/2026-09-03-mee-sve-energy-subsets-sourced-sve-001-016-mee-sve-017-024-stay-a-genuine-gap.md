---
date: "2026-09-03"
title: "mee/sve energy subsets: sourced sve-001..016, mee + sve-017..024 stay a genuine gap"
decided_by: "Claude Fable 5 on behalf of @cheyras, acting on the task's"
areas: ["frontend","catalog"]
supersedes: []
---
## 2026-09-03 — mee/sve energy subsets: sourced sve-001..016, mee + sve-017..024 stay a genuine gap

**Decided by:** Claude Fable 5 on behalf of @cheyras, acting on the task's
explicit "walk the approved ladder and fill what's legal" instruction; the
Bulbagarden question below was NOT decided here — it is put back to the owner.

**Decision:** filled `sve-001` through `sve-016` (both qualities, 32 assets)
from `images.pokemontcg.io` — the already-approved source (§7/§8 of
`research/CARD-ART-SOURCES.md`) — through the cloud choke point
(`packages/storage/src/put-asset.ts`, `provenance: fromUrl(...)`). Left
`sve-017..024` and all 8 `mee` cards unfilled: no currently-approved source
covers them.

**Why.** The scan-index audit (`roadmap/plans/card-scanner-redesign/p2-work/
index-audit/REPORT.md`) found `mee` and `sve` serving the placeholder for
every card — the owner's suspicion that the 2026-08-26 pkmn.gg legal removal
left this hole was directionally right (a source these energy subsets once
depended on is gone) though not literally: neither set ever had an
`image_asset` row at all, so there was never a pkmn.gg-attributed row to lose.
TCGdex's own API omits the `image` field for every card in both sets (not
just a CDN 404). pokemontcg.io covers `sve` numbers 1-16 of 24 (two of three
print-cycles) and none of `mee` (no `mee` set, zero Energy-supertype cards in
`me1`). Bulbagarden Archives DOES have verified, unambiguous scans for the
remaining 16 cards (deterministic filename
`Basic{Type}Energy{SETCODE}Energy{n}.jpg`), but adopting Bulbagarden as a
source was already decided against by the owner on 2026-08-31 ("stays
unresolved and uncommissioned" — the entry above this one, and
`CARD-ART-SOURCES.md` §8). That decision predates this narrower finding and
this task does not have standing to reverse it, so the 16 remaining cards are
reported as a gap rather than filled. Full trace, sample URLs, and the
narrower re-ask to the owner: `research/CARD-ART-SOURCES.md` §9.

**Verified:** live `GET` on all 32 filled assets returns `X-Cache: HIT`, no
`X-Placeholder`, real WebP bytes (245×342 low / 600×838 high); 4 spot-checked
visually (correct card name + number stamped on the art, e.g. SVE 001/008/
009/016). Scoped drift check: 32/32 `image_asset` rows, 32/32
`image_object(tier='object')` rows, byte sizes match, all `source_url`s on
`images.pokemontcg.io` — 0 drift. Scan index untouched (out of scope; a
separate, owner-gated rebuild per `REPORT.md`'s fix path).

**Implications.** The remaining `mee`/`sve` gap (16 cards) will keep serving
the placeholder — and keep being skipped by the scan indexer — until the
owner either approves Bulbagarden for this narrow card class or a new source
appears. `.claude/skills/add-tcg/SKILL.md` and `image-slots.md` gained three
generalizable lessons from this gap: sweep the whole catalog (not just the
prior residue list) after any source removal; a source's crosswalk can be
unresolved in general but solvable for a narrow card class; and
`images.pokemontcg.io` can answer a missing number with HTTP 404 but a full,
valid, decodable filler image body — gate on status code, not just magic
bytes. `.claude/skills/fill-missing-assets/SKILL.md` and
`.claude/skills/add-tcg/{SKILL.md,image-slots.md}` were audited for lingering
pkmn.gg references and already carried none — the 2026-08-31 cleanup was
complete; no edit was needed there.

