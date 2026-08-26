# CARD-ART-SOURCES.md — where the last 592 cards' art could come from

**Author:** Claude Opus 5 on behalf of @cheyras · **Date:** 2026-08-26
**Status:** RESEARCH ONLY. **Nothing was fetched into the image store.** Every
figure below comes from read-only probes that measured a response and discarded
the bytes. No source has been adopted; §7 lists the decisions this note exists
to inform.

**Why this exists.** After the 2026-08-26 catalog warm (DECISIONS.md), 20,474 of
21,066 cards have art in both resolutions. **592 do not**, because TCGdex — the
project's primary image source — serves nothing for them at any extension. The
owner's requirement is that *every* card have art. The owner has also **ruled
pkmn.gg out entirely, on legal grounds**, which retires `warm:pkmn`
(`apps/images/src/warmFromPkmn.ts`) as the answer here and for future gaps.

## Evidence tags

| Tag | Meaning |
|---|---|
| **[measured]** | Probed directly on the date above; the number is an observation. |
| **[derived]** | Computed from measured data. |
| **[inferred]** | Reasoned from code or documentation, not observed end to end. |
| **[unresolved]** | Tried and failed; states what is actually blocking. |

---

## 1. The gap: 592 cards, 32 sets **[measured]**

Derived by driving `warm:cloud` across all 42,132 card assets and re-probing
every residue row against the public bucket. The per-card list is written to
`.cache/missing-art.json` (gitignored).

| Class | Sets | Cards |
|---|---|---|
| Trainer kits | `tk-xy-*` (8), `tk-hs-*` (2), `tk-bw-*` (2), `tk-dp-*` (2), `tk-ex-*` (4), `tk-sm-*` (2) | **385** |
| Modern product | `mfb` (My First Battle) | 34 |
| Celebrations | `cel25cc` | 25 |
| e-Card era | `ecard2`, `ecard3`, `bog` | 34 |
| Odds and ends | `dc1`, `xya`, `ex5.5`, `exu` | 18 |
| Promos | `swshp`, `bwp`, `svp` | 6 |

**Two cards cannot be represented at all**, independent of sourcing: `exu-!` and
`exu-?` ("Unseen Forces Unown Collection") have `!` and `?` as their collector
numbers, and `SEGMENT` in `packages/storage/src/paths.ts` rejects both by design —
the allow-list is the traversal defence. Fixing them is a B6 path-contract change,
not a sourcing problem. **[measured]**

## 2. Sources evaluated

### 2.1 TCGdex — exhausted **[measured]**

0 of 592. Probed `low` and `high`, and `.webp`/`.png`/`.jpg`, for a sample across
every affected set: all 404. This is not a crosswalk failure — our API emits the
ids TCGdex itself uses (verified: `/en/sm/sm3/1/low.webp` is a 200, the padded
`001` form is a 404 and was my own error early in the investigation).

**Posture:** already the project's primary source; no change.

### 2.2 pokemontcg.io **[measured]**

A free, public, unauthenticated API. Images are served from
`images.pokemontcg.io/{setId}/{number}_hires.png`.

- **Resolution is 600×825 or better** — an exact match for our `high` slot, and
  several sets are 990–1024 tall.
- **Coverage is limited by its set list**: 174 sets against our 199. It carries
  the four **EX-era** trainer kits (`tk1a`, `tk1b`, `tk2a`, `tk2b`) but **none** of
  the XY, HS, BW, DP or SM kits, and no `mfb` or `xya`.
- **Numbering needs a per-set crosswalk.** Three real cases found: `cel25cc-CC001`
  maps to `cel25c/1_A` (an `_A`/`_B` suffix, not a bare number); `bwp` uses
  `BW01`-style numbers but genuinely lacks our `BW04`/`BW05`; `ecard2` has a
  single `50` where TCGdex splits `50a`/`50b`, so mapping either of ours onto it
  would be **guessing at which art it is** — exactly the trap the
  `fill-missing-assets` skill warns about.

**Posture (observation, not legal advice):** the closest of the candidates to
TCGdex, which this project already depends on — public, documented, no
authentication, no scraping, no account. Adopting it does not change the shape of
the project's existing exposure.

### 2.3 TCGplayer **[measured]**

**No crosswalk needed** — we already hold a TCGplayer `productId` for **575 of
592** cards (97%), via the existing TCGCSV variant ingest. Images at
`product-images.tcgplayer.com/{productId}.jpg`.

Coverage and quality are both uneven:

| | cards |
|---|---|
| Native image present | **415 / 592** |
| No image behind a valid product id | 160 |
| No product id at all | 17 |

Native heights by set range from **1042×1425** (`mfb`) down to **200×278**
(most XY/HS/DP kits). Median across sampled sets: 585.

**The larger URLs are upscales, not better scans.** `fit-in/1000x1000` returns
717×1000 for a product whose native image is 220×307 — but compared against a
Lanczos upscale of that native image the mean absolute difference is **3.15/255**
and 1:1 crops are visually indistinguishable. Any pipeline that requested a big
`fit-in` size and stored the result would be **storing an upscale while recording
it as a 717×1000 asset**. Use `product-images.tcgplayer.com/{id}.jpg` (the native
object) and measure it. **[measured]**

**Posture (observation, not legal advice):** a commercial marketplace CDN. Unlike
TCGdex and pokemontcg.io it is not a catalog project distributing card imagery for
that purpose, and hotlinking or re-hosting its product photography is not
obviously covered by anything we have agreed to. Higher risk than 2.2. Note the
project *already* consumes TCGplayer **pricing** via TCGCSV, which is a different
question from re-hosting their images.

### 2.4 Bulbagarden Archives — **crosswalk unresolved** **[unresolved]**

Card scans exist at **734×1024**, and the MediaWiki API is open and documented.
But nothing I tried maps *our* card to *their* file:

- Free-text search returns confidently wrong cards — `"Glameow XY Trainer Kit"`
  returns `File:GlameowRageBrokenHeavens69.jpg`, a different printing entirely.
- All four category guesses (`Category:XY Trainer Kit (Pikachu Libre) cards`
  and variants) came back **empty**.
- Bulbapedia set pages list set symbols and coins, **not** the card scans.
- Per-card page titles in the obvious form —
  `Glameow (XY Trainer Kit: Pikachu Libre & Suicune 1)` — are **missing**.

So this source is *plausible but unproven*. Making it usable means first
discovering how Bulbapedia actually titles trainer-kit card pages (they may be
documented under the original set a kit reprints, which would need per-card
reprint mapping, not a set-level one). **That research is not done**, and I
stopped rather than guess — a wrong file here is a wrong card's art, silently.

**Posture (observation, not legal advice):** a fan wiki hosting scans under its
own fair-use rationale. That rationale is the wiki's, and does not obviously
transfer to a third party re-hosting the files. The weakest of the three.

## 3. Best available source, per card **[derived]**

Merging §2.2 and §2.3, taking the taller native image for each card, against our
slots (`low` 245×337, `high` 600×825):

| Outcome | Cards | Share |
|---|---|---|
| **Full quality** — fills `low` and `high` honestly (≥825 tall) | **208** | 35% |
| **`low` slot only** (337–824 tall) | 17 | 3% |
| **Below even the `low` slot** (<337 tall) | 190 | 32% |
| **No source found in either** | 177 | 30% |

Per-set detail is in `.cache/source-synthesis.json`. The shape of it: `tk-bw-*`,
`cel25cc`, `tk-ex-*`, `ecard2/3`, `bog`, `dc1`, `mfb` come out **whole**; the
`tk-xy-*`, `tk-hs-*`, `tk-dp-*` and `tk-sm-*` kits are where the 367 problem
cards live.

**So the two lowest-risk sources together reach 38% of the gap at usable quality.**
Closing the rest requires either accepting ~200px art or solving §2.4.

## 4. A blocking finding: "fill `low` only" does not work today **[measured]**

The owner's stated preference is to store real bytes in `low` where a source is
too small for `high`, and leave `high` unset. **That does not currently render.**

`CardImage` emits `srcSet="{low} 245w, {high} 600w"` with `sizes` resolving to a
208px slot. On a 2× display the browser needs 416px and therefore selects the
**600w** candidate. When `high` is absent the image tier does not fail — it answers

```
HTTP/1.1 200 OK
Content-Type: image/webp
Content-Length: 1044
X-Placeholder: 1
```

— a **valid 245×337 WebP**. The browser treats that as a successful load, so
`onError` never fires, the fallback ladder never advances, and the tile renders
the placeholder **even though real `low` art exists and was fetched**. Verified by
fetching `/deckpal/images/en/tk/tk-xy-p/1/high.webp` directly.

**Therefore a `low`-only fill is only safe once the client knows which qualities
exist.** The honest fix is for the API to stop advertising a `high` that is not
there — `cardImages()` in `apps/api/src/db.ts` would return `high: null` when the
object is absent, and `CardImage` would omit the 600w candidate. That needs a
per-card presence lookup the set endpoint does not do today; `image_object`
(migration 025) already holds the fact, so it is a join, not new data.

**Not implemented.** It is a real API-shape change and was outside "research
first, don't fetch yet".

## 5. What reaching 100% would actually take

| Step | Cards addressed | Blocked on |
|---|---|---|
| Adopt pokemontcg.io + TCGplayer for the full-quality 208 | 208 | source approval (§7) |
| Fix the `high: null` API shape (§4) | prerequisite for any `low`-only fill | approval to change the API |
| Fill the 17 `low`-only cards | 17 | §4 |
| Accept ~200px upscales, or solve §2.4 | 190 | quality decision, or Bulbapedia research |
| Find any source for the 177 with none | 177 | genuinely open |
| `exu-!` / `exu-?` | 2 | B6 path-contract change |

**100% is not reachable from the sources evaluated here.** 177 cards (30% of the
gap) have no candidate at all yet, and a further 190 only have art below our
smallest slot.

## 6. Method, so this can be re-run

All probes are read-only and stored nothing. Scripts used are throwaway and live
under `.cache/` (gitignored); the reusable part is the work-list:

1. `pnpm --filter deckpal-images warm:cloud` → residue file naming every asset
   the tier could not serve.
2. Re-probe each residue row against the public bucket to separate "absent" from
   "throttled" — Supabase answers a missing object with **HTTP 400** and a JSON
   `NoSuchKey` body, *not* 404, so a status-only check both miscounts and
   needlessly retries.
3. For each card, read its `productId` out of the variant `buyUrl` on
   `GET /api/cards/:id` (note: `variants` is a **top-level** key, not `card.variants`).
4. Measure the *native* object at each source and never a resized derivative.

## 7. Decisions this note is asking for

1. **Which sources may be used?** pokemontcg.io alone (lowest risk, 208 cards at
   full quality between it and nothing else), or pokemontcg.io + TCGplayer, or
   also Bulbagarden once §2.4 is solved.
2. **May the API advertise `high: null`?** Without it (§4), no `low`-only fill is
   viable, and 17 cards stay blank that need not.
3. **What happens to the 190 cards whose only art is below the `low` slot?**
   Store an upscale, or keep the placeholder and report them.
4. **Is the 177-card remainder worth further research** (Bulbapedia reprint
   mapping), or is a documented residue acceptable?

---

_Last updated by Claude Opus 5 on behalf of @cheyras — 2026-08-26_
