# TCGCSV variant cross-fill — verdict

**Question this document settles (ARCHITECTURE §8.1):** TCGdex is missing reverse-holo
variant rows for the Black & White / XY / Sun & Moon eras, which would make those sets'
Master/Grandmaster completion report **falsely high**. Can TCGCSV/TCGplayer product data
cross-fill the variant rows TCGdex lacks?

**Verdict:** **YES — partly-to-fully, and it is safe.** The gap is real and large. TCGplayer's
`subTypeName` field on the **prices** endpoint carries a `Reverse Holofoil` printing for exactly
the cards TCGdex is short, joins to TCGdex numerically at **90–100 %** on affected sets, and — the
decisive check — introduces **zero false positives** on the two control sets where TCGdex already
has reverse data (both agree 100 % in both directions). Recommended: cross-fill, count the filled
variants, and reconcile against TCGdex backfill via the existing `UNIQUE (card_id,
variant_kind_code)` key.

Every number below traces to a local command over the on-disk catalog or to one of **14 real
TCGCSV requests** (all HTTP 200), listed in §6. Projections are marked `[projected from N]`.

---

## A. The gap is real — re-measured from the catalog

Source: `generated/en/cards.json` (23,444 cards, 35,648 variant rows — matches ARCHITECTURE §5.1
to the row). Peak RSS to parse whole: 168.5 MB. Command: `scratchpad/measure.js`.

**Variants-per-card and reverse-holo rows per card, by series (chronological):**

| Series | Sets | Cards | Var rows | var/card | reverse rows | rev/card | Era dates | Reverse holos in packs? |
|---|---|---|---|---|---|---|---|---|
| base | 6 | 494 | 1114 | 2.26 | 3 | 0.006 | 1999–2000 | **No** — predate reverse holos ✅ |
| gym | 2 | 264 | 535 | 2.03 | 0 | 0.000 | 2000 | **No** ✅ |
| neo | 5 | 383 | 751 | 1.96 | 6 | 0.016 | 2000–2002 | **No** ✅ |
| **lc** | 1 | 110 | 224 | 2.04 | **111** | **1.009** | 2002-05 | **Yes — first ever** ✅ present |
| ecard | 4 | 541 | 1043 | 1.93 | 476 | 0.880 | 2002–2003 | Yes ✅ present |
| ex | 18 | 1727 | 3625 | 2.10 | 297 | 0.17 | 2003–2007 | Yes — partial (see note) |
| pop | 10 | 193 | 201 | 1.04 | 4 | 0.02 | 2003–2009 | Promo/insert — mostly no ✅ |
| tk | 20 | 406 | 406 | 1.00 | 0 | 0.00 | 2004–2017 | Fixed trainer-kit decks — no ✅ |
| dp | 8 | 900 | 2016 | 2.24 | 808 | 0.90 | 2007–2008 | Yes ✅ present |
| pl | 5 | 533 | 1129 | 2.12 | 498 | 0.93 | 2009 | Yes ✅ present |
| hgss | 5 | 439 | 936 | 2.13 | 374 | 0.85 | 2010 | Yes ✅ present |
| **col** | 1 | 106 | 106 | **1.00** | **0** | **0.00** | 2011-02 | **Yes — 🔴 GAP** |
| **bw** | 13 | 1437 | 1437 | **1.00** | **0** | **0.00** | 2011–2013 | **Yes — 🔴 GAP** |
| mc | 12 | 166 | 191 | 1.15 | 0 | 0.00 | 2011–2024 | McDonald's promo — minor |
| **xy** | 17 | 1932 | 1932 | **1.00** | **0** | **0.00** | 2013–2016 | **Yes — 🔴 GAP** |
| **sm** | 18 | 2917 | 3039 | **1.04** | **117** | **0.04** | 2017–2019 | **Yes — 🔴 GAP** (only sm3 present) |
| swsh | 26 | 3670 | 5744 | 1.57 | 2040 | 0.56 | 2019–2023 | Yes ✅ present |
| sv | 19 | 3698 | 6893 | 1.86 | 2692 | 0.73 | 2023–2025 | Yes ✅ present |
| tcgp | 15 | 2480 | 2480 | 1.00 | 0 | 0.00 | 2024–2026 | **No — digital TCG Pocket** ✅ not a gap |
| me | 8 | 1047 | 1845 | 1.76 | 679 | 0.65 | 2025–2026 | Yes ✅ present |

**Reverse-holo history verified against the data itself:** reverse holos begin at **Legendary
Collection (`lc`, 2002-05-24)** — the earliest series with rev/card ≈ 1.0 (111 reverse rows over
110 cards). Everything before it (`base`, `gym`, `neo`) legitimately has ~0 and is **not** a gap.
This confirms the "began 2002" premise. `tk` (trainer kits) and `tcgp` (Pokémon TCG Pocket, a
digital-only game) sit at 1.00 legitimately and must **not** be flagged.

**The confirmed gap is `col` + `bw` + `xy` + `sm`.** A structural detail strengthens the
diagnosis: TCGdex's own **set-level** `cardCount.reverse` is **also 0** for every bw/xy/sm set
(e.g. `bw1` `cardCount.reverse = 0`), and the card-level boolean `variants.reverse` is `false` on
every one of these cards (measured: **0** cards in the whole corpus have `variants.reverse=true`
without a matching detailed row). So this is not a detailed-vs-boolean mismatch — the reverse-holo
concept is **entirely absent** from TCGdex for these eras, at every level. The one exception inside
`sm` is **`sm3` Burning Shadows** (117 reverse rows), which is why `sm` reads 1.04 not 1.00.

**Size of the gap.** Cards in `col/bw/xy/sm` with no reverse row = **~6,275** (matches the
ARCHITECTURE §8.1 "~6,300" claim). Not all of those *should* get a reverse — secret rares, full
arts, ultra rares, promos and basic energies never had reverse-holo pack printings. The number
that genuinely warrants a reverse fill, projected from the measured fill rate below, is
**~4,660** `[projected from 539 cards across 4 base sets]`. The difference (~1,600) is exactly the
cards that correctly stay at one variant — which is the behaviour we want.

**Per-set breakdown** for the affected eras is in `scratchpad/perset.js` output; every bw/xy/sm
main set reads `var/card = 1.00`, `cc.reverse = 0`.

**Note on `ex` (2003–2007):** rev/card 0.17 is *not* a clean gap. Early `ex` sets (`ex1`, `ex2`,
`ex4`) carry reverse rows; from `ex6` onward TCGdex appears to model the parallel foil as extra
`holo` rows instead (e.g. `ex6`: 138 holo rows for 116 cards). That is a *representation*
difference, not a missing-printing problem, and is out of scope for the §8.1 risk. Flagged, not
resolved here.

---

## B. Can TCGCSV fill it? — measured

### B.1 Where `subTypeName` lives, and its vocabulary

- **`subTypeName` is on the `prices` endpoint only.** Measured: **0 / 1,118** product rows across
  the 6 fetched sets carry a `subTypeName` field; every price row does. The printing distinction is
  a property of the **price** row, keyed `productId + subTypeName` (one product → many price rows).
  This matches `SCHEMA.md`'s `card_variant.tcgplayer_printing` note.
- **One `productId` per card; the printing split is purely in the prices.** Example — `bw1`
  Alomomola (38), `productId 83505`: one product row, two price rows: `subTypeName:"Normal"` and
  `subTypeName:"Reverse Holofoil"`. TCGdex has only a single `normal` variant for this card.
- **Distinct `subTypeName` values observed across all 6 fetched sets (1,774 price rows):**

  | value | count | notes |
  |---|---|---|
  | `Normal` | 770 | |
  | `Reverse Holofoil` | 719 | the row we cross-fill |
  | `Holofoil` | 285 | |

  Three values, **consistently spelled**, exact case, no whitespace variants, no nulls. (Vintage
  Base-era groups also carry `1st Edition` / `Unlimited` etc.; those were outside the fetched
  affected-era sets and are not relied on here.)

### B.2 The join — TCGdex `localId` ↔ TCGplayer `extendedData[Number]`, numeric

Join key: TCGdex `card.localId` numerator vs the leading integer of TCGplayer
`extendedData[name="Number"].value` (`"38/114"` → `38`), **numerically** (padding is inconsistent,
per ARCHITECTURE §7). Set → `groupId` comes straight from TCGdex `set.thirdParty.tcgplayer`
(`bw1`→1400, `xy1`→1387, `sm1`→1863, `col1`→1415). Command: `scratchpad/join.js`.

| Set (groupId) | Cards | Matched | Match % | Misses — what they are | **Fillable reverse rows** |
|---|---|---|---|---|---|
| `bw1` Black & White (1400) | 115 | 115 | **100 %** | — | **104** |
| `xy1` XY (1387) | 146 | 146 | **100 %** | — | **123** |
| `sm1` Sun & Moon (1863) | 172 | 163 | **94.8 %** | 9 = basic energies 164–172 (TCGplayer doesn't number them) | **126** |
| `col1` Call of Legends (1415) | 106 | 95 | **89.6 %** | 11 = `SL1`–`SL11` shiny-legendary secret rares (alpha `localId`, numeric join can't reach) | **87** |
| `sm3` Burning Shadows (1957) — **control, dex HAS reverse** | 169 | 169 | 100 % | — | **0** ✅ |
| `sv03.5` 151 (23237) — **control, dex HAS reverse** | 207 | 207 | 100 % | — | **0** ✅ |

**Match rate on the affected sets: 89.6 %–100 %.** Misses are systematic and benign: unnumbered
basic energies and alpha-prefixed secret rares — both categories that largely don't have (or don't
matter for) a reverse-holo Master requirement. A `cleanName`-within-group fallback (DATA-LAYER §4.5
step 2) would recover most `SL` misses if wanted, at lower confidence.

### B.3 Does TCGCSV reveal reverse printings TCGdex lacks? — yes, quantified

`Fillable` above = cards where **TCGdex has no `reverse` variant** but **TCGplayer prices carry
`Reverse Holofoil`**. On the four affected sets: **104 + 123 + 126 + 87 = 440 reverse rows** that
TCGdex is missing and TCGCSV supplies, over 539 matched cards — an **81.6 % fill rate**.

**The controls are the proof it isn't hallucinating.** On `sm3` and `sv03.5`, where TCGdex already
carries reverse rows, `Fillable = 0` — TCGCSV never invents a reverse where TCGdex has curated one.
And the agreement is **bidirectional**: on `sm3`, all **116/116** cards that TCGdex marks reverse
also show `Reverse Holofoil` in TCGplayer. So `Reverse Holofoil` is a faithful proxy for TCGdex's
`reverse` variant — no systematic over- or under-count.

**Worked example — `bw1` Black & White, first 15 cards (`scratchpad/join.js`):**

| localId | Name | Rarity | TCGdex variants | TCGplayer subtypes | Action |
|---|---|---|---|---|---|
| 1 | Snivy | Common | `[normal]` | `Normal, Reverse Holofoil` | **FILL reverse** |
| 2 | Snivy | Common | `[normal]` | `Normal, Reverse Holofoil` | **FILL reverse** |
| 3 | Servine | Uncommon | `[normal]` | `Normal, Reverse Holofoil` | **FILL reverse** |
| 4 | Servine | Uncommon | `[normal]` | `Normal, Reverse Holofoil` | **FILL reverse** |
| 5 | Serperior | Rare | `[normal]` | `Holofoil, Reverse Holofoil` | **FILL reverse** |
| 6 | Serperior | Rare | `[normal]` | `Holofoil, Reverse Holofoil` | **FILL reverse** |
| 7 | Pansage | Common | `[normal]` | `Normal, Reverse Holofoil` | **FILL reverse** |
| … | … | … | `[normal]` | `Normal, Reverse Holofoil` | **FILL reverse** |
| 15 | Tepig | Common | `[normal]` | `Normal, Reverse Holofoil` | **FILL reverse** |

Every one of `bw1`'s first 15 cards gains a reverse-holo variant that TCGdex lacks. (Aside: rows
5–6 also show TCGplayer disagreeing with TCGdex on the *base* finish — `Holofoil` vs TCGdex
`normal`. Real but a separate data-quality question; the reverse fill is unaffected.)

**Total impact `[projected from 539 cards over 4 base sets]`:** ~**4,660** reverse variant rows
recoverable across `col/bw/xy/sm`, lifting those sets from a false 1.00 var/card toward the ~1.8–2.0
that the same-era `swsh`/`sv` sets actually show.

---

## C. Model for a cross-filled variant

A cross-filled row has **no `tcgdex_variant_id`** — so it cannot use the sync idempotency key
(`SCHEMA.md`: `tcgdex_variant_id TEXT UNIQUE`, nullable). The model below keys, flags, and — the
part that matters — **reconciles** it when TCGdex later backfills the real row, without duplicating.

**1. Provenance flag.** Add to `card_variant`:
```sql
ALTER TABLE card_variant
  ADD COLUMN source TEXT NOT NULL DEFAULT 'tcgdex'   -- 'tcgdex' | 'tcgcsv'
    CHECK (source IN ('tcgdex','tcgcsv')),
  ADD COLUMN fill_confidence SMALLINT;               -- 100 numeric-join, <100 cleanName fallback
```
A cross-filled reverse holo is written as: `source='tcgcsv'`, `tcgdex_variant_id = NULL`,
`variant_kind_code = <the reverse-standard kind>`, `tcgplayer_printing = 'Reverse Holofoil'`,
`tcgplayer_product_id` from the join. Postgres allows many `NULL`s in a `UNIQUE` column, so the
null `tcgdex_variant_id` is fine.

**2. Key it on the natural key that already exists.** `card_variant` already has
`UNIQUE (card_id, variant_kind_code)`. A reverse-holo's `variant_kind_code` is **deterministic**
(the `reverse` finish + standard facets), so the cross-filled row and the future TCGdex row map to
the **same** `(card_id, variant_kind_code)`. This is the idempotency key for TCGCSV-sourced rows,
in place of the missing `tcgdex_variant_id`.

**3. Reconciliation when TCGdex backfills (the critical case).** The catalog sync upserts on the
natural key and *upgrades in place*:
```sql
INSERT INTO card_variant (card_id, variant_kind_code, tcgdex_variant_id, source, sort_order, …)
VALUES (:card, :kind, :tcgdexVariantId, 'tcgdex', …)
ON CONFLICT (card_id, variant_kind_code) DO UPDATE
  SET tcgdex_variant_id = EXCLUDED.tcgdex_variant_id,
      source            = 'tcgdex',        -- promote provenance
      fill_confidence   = NULL,
      last_synced_at    = now();
```
The pre-existing `source='tcgcsv'` row is **updated**, not duplicated: it acquires the real
`variantId` and flips to `source='tcgdex'`. User ownership attached to that `card_variant.id`
survives untouched (the row's identity is its `id`, which doesn't change). **No merge step, no
orphan, no double-count.** This is why keying on `variant_kind_code` — not on a synthesized
`tcgdex_variant_id` — is the right choice: TCGdex's eventual row lands on the same slot by
construction.

The **TCGCSV** sync must be symmetric: it may only *insert* a `source='tcgcsv'` reverse row when
no row for `(card_id, 'reverse-kind')` exists — never touch a `source='tcgdex'` row. So the two
syncs converge on one row from either direction.

**4. Do filled variants count toward Master/Grandmaster?** **Yes, immediately, for
`fill_confidence = 100` (numeric-join) rows.** The controls show the fill is accurate where
verifiable (0 false positives, 116/116 bidirectional agreement), and a Reverse Holofoil that trades
on TCGplayer is a real printing the collector must own — excluding it *reintroduces* the very
false-high bug we're fixing. Extend the existing `set_variant_coverage` view (SCHEMA §, already
present) with a provenance split so the UI can footnote honestly:
```sql
-- add to set_variant_coverage:
COUNT(cv.id) FILTER (WHERE cv.source='tcgcsv') AS filled_variants
```
A set with `filled_variants > 0` renders Master/Grandmaster with a small "reverse-holo data
supplemented from TCGplayer" footnote — accurate, not "provisional/unknown". Reserve a genuine
**provisional** flag only for the residual **cleanName-fallback** fills (`fill_confidence < 100`)
and for the unmatched misses (basic energies, `SL` secret rares), which stay at their TCGdex count
and should surface in the data-quality view.

---

## D. If it did not work — recommendation (it does, so this is the fallback ladder)

Cross-fill **works**, so the primary recommendation is **§C: cross-fill from TCGCSV and count the
filled variants.** For completeness, the honest fallback for the **residue** that TCGCSV cannot
reach (the ~10 % misses — basic energies, alpha-numbered secret rares, and any set with no
`groupId`):

**Recommended residual policy:** mark the *unmatched cards only* as provisional in
`set_variant_coverage`, and render their set's Master/Grandmaster with a footnote — do **not**
derive reverse existence from era+rarity heuristics for them. The heuristic ("every
common/uncommon/rare in a 2002-2019 main set has a reverse") is ~80–90 % accurate but its error
rate is unquantified here and it would silently re-create false denominators for the exceptions
(secret rares, energies) — the exact failure mode we're eliminating. A visible "N cards
unverified" beats an invisible wrong number. Using a different catalog source (e.g. TCGplayer's own
category tree) for these eras is unnecessary given the 90–100 % TCGCSV coverage.

---

## E. Other direction — `1999-2000-copyright` (secondary)

`SCHEMA.md` §5.4.2 flags 150 TCGdex `1999-2000-copyright` rows that pkmn.gg appears **not** to
render, which would *inflate* Base-era Grandmaster denominators. **Not directly fetched** (Base
groups were outside the affected-era budget), so this is inference, marked as such:

TCGplayer's printing vocabulary for Base-era groups is known to be `1st Edition` / `Unlimited` /
`Holofoil` / `Reverse Holofoil` — there is **no `subTypeName` distinguishing a "1999–2000
copyright" print run**. TCGplayer does not trade it as a separate SKU. That is consistent with
pkmn.gg collapsing it and supports **not counting `1999-2000-copyright` as its own
Master/Grandmaster variant**. **Confidence: low — this needs one fetched Base-set (`base1`,
groupId in `set.thirdParty.tcgplayer`) `prices` payload to confirm the subtype list before acting.**
Recommend that as a one-request follow-up.

---

## What I could not verify

- **The ~4,660 total fill count is projected**, not exhaustively fetched — from a measured 81.6 %
  fill rate over 4 base sets (539 cards). The 4 measured sets are 100 %/100 %/94.8 %/89.6 % matched;
  the projection assumes similar composition across the other ~42 affected main sets. Promo sets
  (`bwp`, `xyp`, `smp`, 565 cards) were excluded from the projection (Black Star promos generally
  have no reverse holo) but not individually fetched.
- **`1999-2000-copyright` (§E)** is inference from TCGplayer's known Base-era subtype vocabulary,
  not a fetched `base1` payload. One request would settle it.
- **The `Holofoil` vs TCGdex `normal` base-finish discrepancy** seen on `bw1` Serperior (rows 5–6)
  is real but unquantified — it's a separate data-quality question from the reverse-holo gap and
  was not chased.
- **cleanName fallback recovery rate** for the alpha-numbered misses (`SL1`–`SL11`) is asserted as
  "most", not measured.

---

## 6. Fetch log — TCGCSV, 14 requests, all HTTP 200

User-Agent `pokedex/1.0 (+cheyras@gmail.com)`, ~120 ms between requests, gated on
`last-updated.txt`. No 429/403. Well under the 100-request budget (and the service's 10,000/day
ceiling). Script: `scratchpad/fetch.js`.

```
last-updated.txt                     200  2026-07-23T20:05:33+0000  (gate; unchanged since DATA-LAYER §4.2)
/tcgplayer/3/groups                  200  42,338 B
/tcgplayer/3/1415/{products,prices}  200  col1  Call of Legends   109 prod / 201 price
/tcgplayer/3/1400/{products,prices}  200  bw1   Black & White     133 prod / 224 price
/tcgplayer/3/1387/{products,prices}  200  xy1   XY                197 prod / 286 price
/tcgplayer/3/1863/{products,prices}  200  sm1   Sun & Moon        216 prod / 339 price
/tcgplayer/3/1957/{products,prices}  200  sm3   Burning Shadows   214 prod / 323 price   (control)
/tcgplayer/3/23237/{products,prices} 200  sv03.5 151             249 prod / 401 price   (control)
```

Reproduction scripts in scratchpad: `measure.js` (catalog gap), `perset.js` (per-set),
`fetch.js` (TCGCSV pull), `join.js` (join + fill measurement).
