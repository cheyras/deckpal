---
date: "2026-11-27"
title: "Template set logos ship and become the standard for sets without an official logo"
decided_by: "@cheyras (approval, 2026-11-27); implemented by Claude Opus 5.5 on behalf of @cheyras"
areas: ["images","frontend","catalog"]
supersedes: ["2026-08-29 Trainer Kit logos keep a text treatment (setImageFallback.ts header; image-slots.md set-logo residue)","2026-08-29 promo pools show the shared generic PROMO star (svp, swshp, smp, xyp, bwp, hgssp, dpp, np, basep)","2026-09-21 30th-c borrows the parent 30th Celebration logo"]
---
## 2026-11-27 — Template set logos ship and become the standard for sets without an official logo
**Decided by:** @cheyras (approval, 2026-11-27); implemented by Claude Opus 5.5 on behalf of @cheyras

**Decision:** The 59 set logos drawn from DeckPal's four PhotoCraft templates
(promo-stack, energy-row, subset-tag, product-plate) ship in the app, and the
template system is now the standard way a logo is made for any set that has no
official logo of its own. The owner, after reviewing the renders: *"The other
logo treatments also look great. Let's get all of it in, and yeah whatever
system you came up with let's make that our go to for those."* "All of it"
was the answer to the two open questions put with the renders: replace the
shared generic PROMO star on all nine promo pools (not only fill `mep` and
`miscp`), and give `30th-c` and `cel25cc` Classic Collection ribbons.

- **What ships:** 11 promo pools (`mep`, `svp`, `swshp`, `smp`, `xyp`, `bwp`,
  `hgssp`, `dpp`, `np`, `basep`, `miscp`), 2 energy sets (`mee`, `sve`), 11
  subsets (the four Trainer Galleries, `swsh12.5gg`, `swsh4.5sv`, `sma`,
  `cel25cc`, `30th-c`, `exu`, `xya`), and 35 product plates (20 trainer kits,
  13 McDonald's collections, `ex5.5`, `bog`).
- **Serving path:** bundled static files, `apps/web/public/set-logos/<setId>.webp`,
  mapped in `apps/web/src/lib/releasedSetAssets.ts` (`TEMPLATE_SET_LOGOS`) and
  drawn by `SetLogo`. Not the image tier.
- **Precedence:** a set's own official logo always wins. A template outranks
  the image tier only when the API's `logoUrl` for the set is `null` or is
  exactly the placeholder the template was made to replace (`replaces`: the
  generic PROMO star on TCGdex or pokemontcg.io, the generic Pokémon TCG
  wordmark, a parent set's wordmark), as the live API reported on 2026-11-27.
  Any other `logoUrl` means upstream has published the set's own logo; it wins
  and the template steps back to being the last-resort fallback.
- **The system lives in the repo:** `tools/set-logo-templates/` (templates,
  data-set CSVs, the build, the pinned source manifest, a README covering how to
  add a set). `add-tcg/image-slots.md` and `fill-missing-assets` now say a set
  with no official logo gets a template logo, never a blank.

**Why:** The owner asked for real logos on the rows that showed a set's name or
a logo shared with other sets. Bundling, not the image tier: the template logos
are DeckPal's own compositions, built from a repo tool, so git history is their
provenance record, where the image tier's `image_asset` rows exist for bytes
fetched from upstream (B1) and a template has no upstream URL to record.
Putting them in the tier would also have meant writing to production storage
and colliding with the path (`sets/<id>/logo.webp`) where the tier caches the
very placeholder being replaced. Deciding precedence in the browser from the
`logoUrl` the API already reports needs no API change and no deploy ordering,
and it encodes "official wins" as data instead of as a promise to delete rows.

**Implications:**

- **Supersedes the 2026-08-29 Trainer Kit ruling.** The kits kept a text
  treatment because the only artwork was one generic "Trainer Kit" wordmark
  shared by four sets, which "reads as a bug". Each template plate carries the
  kit's own Pokémon and era wordmark, so no two rows look alike; the owner
  approved them. The crosswalk's exclusion of the shared pokemontcg.io
  wordmark (`setImageFallback.ts`) still stands: that file is still not used.
- **Supersedes the generic-star promo treatment** for all nine promo pools, and
  the light plate those stars needed: a template logo is drawn for the dark
  slot and never takes the plate, whatever `setLogoContrast.ts` says about the
  set's placeholder.
- **`30th-c` no longer borrows the parent 30th Celebration logo**
  (2026-09-21); `30th` keeps it.
- **The frozen crosswalk is untouched.** Its `svp`, `sve`, `bog`, subset and
  `cel25cc`/`sma` logo rows still fill the image tier and still appear as
  `logoUrl`; the app simply ranks the template above them. A web test fails if
  a crosswalk logo for a template set is not in that set's `replaces`.
- **McDonald's (2026-08-10) is unchanged:** plain type over the era's TCG
  wordmark, never the Golden Arches or McDonald's artwork.
- **Delta Reign (`me06`) is out of scope.** Its official logo exists and is a
  separate owner decision (branch `fix/delta-reign-logo`); it gets no template.
- **The Pokémon Company's raw images are not committed** (2026-07-24). The
  tool fetches set logos and official artwork from the app's image tier into
  gitignored caches and checks each against `sources/tier-sources.json`
  (tier URL, upstream URL, SHA-256). Rebuilt that way from a clean checkout,
  every input and all 59 renders were pixel-identical to the approved review
  files. The committed `.pcraft` templates embed one example data set's pixels
  each, and the shipped WebPs are composites, like the bundled 30th logo.
- **Energy rows** (`mee`, `sve`) rasterise E2's traced energy glyphs, which are
  not the CC0 originals `EnergyIcon` draws. Shipping them inside two set logos
  is covered by this approval; adopting the traced glyphs as app icons is E2's
  separate licence question, and their SVGs are not committed.
- **Budgets:** 59 WebPs, ~2.4 MB in total (22-62 KB each), fitted to 870x396
  (the 290x132 set header at 3x). None is precached (`globPatterns` does not
  match `.webp`) and none is on the critical path (the 59-row table adds
  0.8 kB gzipped to it: 220.8 -> 221.6 of 230 kB); a new service-worker route
  (`deckpal-set-logos-v1`, stale-while-revalidate) caches the ones a visitor
  sees, so pages that worked offline with tier logos still do.
- `check-precache.mjs` now reads every bundled set-logo path from
  `releasedSetAssets.ts` and fails the build if one is missing from `dist/`;
  `.gitignore` and `.vercelignore` carry the `set-logos/*.webp` exception, and
  `.vercelignore` drops `tools/set-logo-templates` from the upload.
