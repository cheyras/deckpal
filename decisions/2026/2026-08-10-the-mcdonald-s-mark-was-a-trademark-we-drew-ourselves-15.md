---
date: "2026-08-10"
title: "The McDonald's mark was a trademark we drew ourselves (#15)"
decided_by: "agent, on behalf of @cheyras (issue #15, reported from /series on iPhone)."
areas: ["general"]
supersedes: []
---
## 2026-08-10 — The McDonald's mark was a trademark we drew ourselves (#15)

**Decided by:** agent, on behalf of @cheyras (issue #15, reported from /series on iPhone).

**What was there.** `McdonaldsMark` in `apps/web/src/components/ui.tsx` — an inline
SVG tracing the McDonald's Golden Arches, stroked in `#ffbc0d` (McDonald's brand
yellow). It rendered at 48px as the McDonald's Collection card's mark on /series,
and inside every `SetSymbolTile` whose set id matched `/^20\d{2}/`. The reporter
called it "hand rolled" and asked for "the real McDonald's logo".

**Why the real one was missing.** Not a warming failure — a genuine upstream gap.
TCGdex publishes **no `logo` for any of the twelve McDonald's Collection sets**
(2011bw … 2024sv), in **any** of its fourteen languages; the API returns `logo:
null` for each, the series endpoint agrees, and the CDN 404s at both
`assets.tcgdex.net/en/mc/<set>/logo` and `/univ/mc/<set>/logo`. So
`card_set.logo_url` is empty for all twelve, `setWarmer` had nothing to fetch, and
the `rep` LATERAL in `/api/series` — which required `logo_url IS NOT NULL` — left
`repSetId` NULL. The arches were authored to fill that hole.

**Trademark reasoning (the actual decision).** Taking the request literally would
have made things worse. The Golden Arches are McDonald's corporate mark, not a
Pokémon TCG set logo, and shipping a faithful copy of it is precisely the exposure
this repo removed on 2026-08-09 when the Poké Ball / POKÉMON wordmark app icons
became original artwork (`ICONS-NOTICE.md`, `ENERGY-ICONS-NOTICE.md`). The line
this project draws is: **a set's own logo, as published by the TCG data source, is
ordinary nominative use** — it identifies the product, and it is exactly what every
other set logo in the app is. **The brand owner's corporate mark is not**, however
it is obtained. The fallback ladder was walked and both rungs were rejected on that
basis, not on availability:

- **pkmn.gg** (the documented art fallback) models sets as `{id, slug, name,
  category}` — no logo field. Nothing to take.
- **pokemontcg.io** serves `images.logo` for `mcd11` … `mcd21` — and all nine are
  **byte-identical** (sha256 `f23fc8a4…`, 1047×1024). Downloaded and looked at: it
  is the McDonald's corporate logo (arches, wordmark, red trapezoid, ™), dropped in
  as a stand-in. That is a brand asset, not a set logo. Rejected. (Its API was
  also 500ing throughout, so the bytes could not even be corroborated as the set's
  logo through the documented endpoint.)
- **Bulbagarden Archives** (the documented tertiary) has genuine per-year *product*
  logos for exactly two of twelve — `Match Battle logo.png` (2022) and
  `M24 Logo EN.png`, which is the 2024 "Dragon Discovery" logo — each carried
  on-wiki under a "may be a registered trademark" fair-use tag. Two of twelve is
  not a series mark, and a per-set logo for two years would have read as an
  inconsistency rather than a fix.

So: **no legitimately-sourced set logo exists for this series.** No bytes were
added to either tier; nothing was scraped.

**What changed instead.** TCGdex *does* publish the McDonald's Collection **set
symbol** (`univ/mc/2021swsh/symbol`) — the black double-arch "M" printed on the
cards, already warmed in both tiers with real provenance (`image_asset` +
`image_object` rows in the self-host DB and in Supabase, `source_url` =
`https://assets.tcgdex.net/univ/mc/2021swsh/symbol.webp`). That is the same class
of asset as every other set symbol the app shows, so:

1. `McdonaldsMark` is deleted and `setMarkKind` has no McDonald's branch. The two
   remaining authored marks (Black Star Promo, energy) are original artwork for
   *Pokémon TCG* families, not reproductions of anyone's brand.
2. `/api/series`' `rep` LATERAL now accepts a set with a logo **or** a symbol, with
   `(logo_url IS NOT NULL) DESC` as its leading sort key — so all 17 series that
   already had a logo-bearing rep keep byte-identical reps, and only the three
   logo-less series (McDonald's Collection, Trainer kits, Miscellaneous) change.
   A new `repHasLogo` flag tells the client which asset exists, so it never
   requests a URL known to 404.
3. The series card renders the rep set's symbol tile when there is no logo:
   McDonald's Collection → the real TCGdex "M"; Trainer kits → `tk-ex-latia`'s
   symbol; Miscellaneous has neither and stays blank, as before.
4. `deriveSetTag` returns the leading year for year-bucketed ids, so the eleven
   McDonald's sets with no symbol get a clean typographic **2011 … 2024** tag.
   Previously the name-initials branch produced "MS2" for
   "McDonald's Collection 2021"; the arches had been hiding that.

**Verification.** `manifest:check` **CLEAN, exit 0** on the disk tier (47,924
files / 47,924 rows, 0 orphans; the 1,854 honestly-unknown-provenance rows are the
historical backfill and did not grow — this change added no bytes) and
`manifest:check --object-store` **CLEAN, exit 0** on the cloud tier (2,946 objects
/ 2,946 rows, 0 etag mismatches). Browser at 1440 and 390 against a local dev
server on the real catalog DB and image service: the series card shows the real
black "M" on the off-white tile, high contrast on `#282d38`, matching POP and
Trainer kits beside it; the series page shows year tags on eleven sets and the
real symbol on 2021. **Not verified on deployed deckpal.app** — /series is behind
Supabase auth, the temporary owner password an earlier lane used had been removed,
and minting a session was refused, so the live-site render is outstanding rather
than claimed. Same gap #16 recorded an hour earlier; the QA account will close it.

**Implications.** The rule to carry forward: when a set family's mark is missing
upstream, an *authored* stand-in is only legitimate when what it depicts is the
game's own iconography. The moment the honest stand-in would be someone else's
brand, the answer is the set's real symbol if the catalog source has one, and a
typographic treatment if it does not — never a better copy of the trademark. The
`add-tcg` thoroughness list already said "prefer a UI fallback ladder over warming
a nonexistent asset"; it now also says whose artwork that fallback may depict.

_Filed by agent on behalf of @cheyras — 2026-08-10._

