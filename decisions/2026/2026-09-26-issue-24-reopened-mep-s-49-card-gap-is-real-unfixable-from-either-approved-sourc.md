---
date: "2026-09-26"
title: "Issue #24 reopened: MEP's 49-card gap is real, unfixable from either approved source today, and the process gap that let it grow is fixed"
decided_by: "Claude Sonnet 5 on behalf of @cheyras, investigating the"
areas: ["catalog"]
supersedes: []
---
## 2026-09-26 — Issue #24 reopened: MEP's 49-card gap is real, unfixable from either approved source today, and the process gap that let it grow is fixed

**Decided by:** Claude Sonnet 5 on behalf of @cheyras, investigating the
2026-09-26 reopen of issue #24 (`/series/mega-evolution/mep`).

**Root cause, measured.** 49 of 89 `mep` cards answer the placeholder today —
`#032–#036` (5) and `#046–#088` plus `Museum` (44) — all `X-Image-Reason:
upstream 404: HTTP 404`. This is NOT the 2026-08-10 fix regressing by itself:
that fix closed a 29-card gap (`046–063, 072, 073, 081–088, Museum`) by warming
from `assets.pkmn.gg`. Two things happened after it:

1. **pkmn.gg was ruled out on 2026-08-26** because it is an app much like
   DeckPal, and Chey wants no friction with a competitor (Chey's stated reason,
   2026-09-26; earlier entries called it a legal call). Its warmer
   (`apps/images/src/warmFromPkmn.ts`) was retired. The SSRF-hardening allow-list
   added the same day (`packages/storage/src/upstream.ts`) correctly does not
   list it — that is the ruling enforced in code, not a regression. The 58
   `image_asset` rows it had written were then **deleted** in the 2026-08-31
   provenance cleanup ("Card-art re-sourcing executed") because they carried no
   approved-source attribution. Confirmed today: the raw Supabase object for
   `mep-087/low.webp` answers `400 NoSuchKey` — the bytes are gone, not merely
   unreachable through the proxy.
2. **`mep` grew from 60 to 89 cards** (`catalog-refresh.yml`'s own header cites
   exactly this set as its motivating example) and **nothing re-warmed the new
   cards against an approved source.** `warm:cloud` has existed since
   2026-08-26 with its own header saying to run it "after a set releases and
   after any catalog import" — nobody automated that, so it never ran for
   MEP's growth.

**Checked, read-only, whether either currently-approved source has caught up:
neither has.** `assets.tcgdex.net` (primary) still 404s all 49 — confirmed
directly against TCGdex, not just through our proxy. `images.pokemontcg.io`
(the approved fallback, `DECISIONS.md` 2026-08-31) does not carry this promo
pool at all: `GET /v2/sets/mep` → 404, and its "Mega Evolution" series lists
only the eight main sets (`me1`…`me5`, `me55`, `me55c`), no promo id. Name
searches for several `mep` cards returned nothing. **0 of 49 are fillable from
an approved source today.** Full write-up: `research/CARD-ART-SOURCES.md` §9.

**Also checked: is this systemic?** Sampled every other growing "Black Star
Promos" pool (the same shape as MEP — a promo set that keeps gaining cards
after release) plus a spot check of recent non-promo sets. `svp` (SVP Black
Star Promos, 226 cards) has the same failure mode at smaller scale: **14
placeholders, clustered at its newest numbers (`208–223`) plus three scattered
older ones (`102`, `175`, `176`)** — verified none of those 14 exist at
`images.pokemontcg.io` either. `bwp`, `hgssp` and `miscp` each carry one or two
placeholders matching residue already documented in `CARD-ART-SOURCES.md` §1
(numbering gaps, not new). `xyp`, `smp`, `dpp`, `basep`, `swshp` sampled clean.
Separately, and NOT part of this fix: `30th-c` (30th Classic Collection) is
100% placeholder, but that is the **already-flagged, pending-Scrydex-permission**
gap from the 2026-09-21 entries — a different, already-tracked decision, left
untouched here.

**Decision — do not re-open the pkmn.gg question, and do not force a code fix
where no source exists.** With 0 of 49 fillable, the right PR is not a
sourcing fix (there is nothing to point at) — it is (a) writing the gap down
properly, since a prior citation to this exact figure (a 2026-09-04
`DECISIONS.md` entry, the CLIP-embedding bakeoff) pointed at
`research/CARD-ART-SOURCES.md` describing it and the file never actually said
so, and (b) closing the process gap that let it grow unnoticed for three weeks,
which is generalizable and already caught a second instance (`svp`).

**Fix — `.github/workflows/image-warm.yml`.** Runs `warm:cloud` automatically
after every successful `Catalog refresh` run, plus `workflow_dispatch` (with an
optional `set` input) for on demand. Needs no secrets — `warm:cloud` only talks
to public endpoints. Reports the residue via a new companion,
`apps/images/src/cloudWarmSummary.ts` (`warm:cloud:summary`), which diffs the
current sweep against the previous run's residue (cached across runs with
`actions/cache`, keyed so a scoped `--set` dispatch never overwrites the
full-catalog baseline) and calls out NEW gaps by set in the job summary,
separately from the residue that is already known and documented. This is the
piece that would have surfaced MEP's growth as a number in Actions the week it
happened, instead of as a reopened bug report three weeks later.

**Implications.**
- The 49-card mep gap and the 14-card svp gap remain open — this PR makes them
  visible and reproducible on demand, it does not source them. `mep`'s 49 join
  the residue documented in `CARD-ART-SOURCES.md`; `svp`'s 14 are noted here as
  evidence for the systemic check and are not separately added to that file
  (same shape, smaller set, not re-litigated card-by-card).
- Nothing in `packages/storage/src/upstream.ts` changed. pkmn.gg is not
  reconsidered here; if the owner wants to revisit that specific tradeoff
  (the only historical source for these 49), that is a decision for a future
  dated entry, not something inferred from an allow-list PR.
- `research/CARD-ART-SOURCES.md` §9 corrects a stale citation: the 2026-09-04
  entry above described work from a since-retired scratch workspace
  (`p2-work/art-sweep/`, part of the Project Holo line `#185` retired) that
  never actually landed in this file. It has now landed.
- Going forward, a set that grows past what an approved source covers shows up
  in the `Image warm` workflow's job summary within the week (or immediately,
  via `workflow_dispatch`), not only when a customer reports it.
