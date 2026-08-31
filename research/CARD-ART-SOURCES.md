# CARD-ART-SOURCES.md — where the last 592 cards' art could come from

**Author:** Claude Opus 5 on behalf of @cheyras · **Date:** 2026-08-26
**Status:** RESEARCH ONLY. **Nothing was fetched into the image store.**
**Revised 2026-08-26b** with the TCGplayer terms research the owner asked for
(section 2.3): that source is **ruled out**, which moves the closable gap from
415 cards to 88 and the documented residue from 177 to 504. Every
figure below comes from read-only probes that measured a response and discarded
the bytes. No source has been adopted; §7 lists the decisions this note exists
to inform.

**Why this exists.** After the 2026-08-26 catalog warm (DECISIONS.md), 20,474 of
21,066 cards have art in both resolutions. **592 do not**, because TCGdex — the
project's primary image source — serves nothing for them at any extension. The
owner's requirement is that *every* card have art. The owner has also **ruled
pkmn.gg out entirely, on legal grounds**, which retires `warm:pkmn`
(`apps/images/src/warmFromPkmn.ts`) as the answer here and for future gaps.

> **Update, 2026-08-31.** That ruling has now been carried through the codebase:
> the warmer and its npm script are deleted, the upstream allow-list denies the
> host by simply not listing it, and the name has been removed everywhere else it
> appeared. **This paragraph deliberately keeps it.** A policy that names what was
> evaluated and rejected is auditable; one that only says "use the approved list"
> invites a future agent to re-evaluate the same source and reach the same dead
> end. Treat this, and §2.3's TCGplayer rejection, as the two worked examples of
> what a licensing check has to conclude before any bytes are fetched. The image
> re-sourcing itself — the ~1,912 out-of-policy `image_asset` rows — is tracked
> separately; see `card-art-residue.json` and DECISIONS.md 2026-08-31.

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
every residue row against the public bucket. **The per-card list is committed as
[`card-art-residue.json`](card-art-residue.json)** — every one of the 592, with
which resolutions are missing, whether an approved source covers it, and the
measured heights behind that judgement. It is the durable record; the working
files under `.cache/` are gitignored scratch.

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

**Posture — RULED OUT on their own published terms. [measured, with a caveat]**

Researched 2026-08-26 at the owner's request. Read the caveat first: **both
TCGplayer help-centre pages answer HTTP 403 to automated fetching**, so the
findings below come from search-engine summaries of those pages and from the
developer documentation, *not* from the primary text. I did not scrape past the
403 - doing so to read a document about not scraping would be indefensible, and
it is the exact conduct the terms prohibit. **Read the primary sources before
relying on this; I am not a lawyer.**

Three things converge, and any one of them would be enough:

1. **Automated collection outside the API is prohibited.** The Terms of Service
   forbid collecting content or information from the Site by crawlers, scrapers,
   bots, scripts, devices or browser add-ons - expressly *other than through API
   access*. A warmer walking `product-images.tcgplayer.com/{productId}.jpg` for
   575 cards is precisely that.
2. **Redistribution to end users is restricted.** The API Terms bar distributing
   "TCG Content" or making it available to end users or third parties for
   commercial or competitive purposes, and bar rebranding it. DeckPal is a live
   multi-user product that would be re-hosting those bytes from our own bucket
   and serving them under our own UI. Rights not expressly granted are reserved.
3. **The one sanctioned channel is closed.** TCGplayer is not granting new API
   access; multiple independent 2025-2026 developer write-ups describe the public
   application process as effectively shut since the eBay acquisition, with access
   limited to existing key holders and approved partners.

So there is no compliant route: the API path is unavailable to us, and the
non-API path is explicitly prohibited. **TCGplayer is not an approved source for
images and this note does not plan around it.** Its measured heights are retained
in section 3 and in `card-art-residue.json` as evidence only - so that if the
licensing position ever changes, the coverage work does not have to be redone.

**One adjacent thing the owner should look at separately, flagged because this
research surfaced it and not because it is in scope here:** the project already
ingests TCGplayer **pricing** via TCGCSV, a third-party bulk mirror rather than
TCGplayer's own API. That is a different artefact (prices, not images) reached by
a different route, and this note makes no finding about it - but the clause in
(1) is about collecting *information* from the Site generally, so it is worth a
deliberate look rather than an assumption.

**Sources consulted:** TCGplayer Terms of Service and API Terms & Conditions
(help.tcgplayer.com, both 403 to automated fetch - read them directly), and
docs.tcgplayer.com.

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

**Approved sources only** - i.e. pokemontcg.io, TCGdex being exhausted and
TCGplayer ruled out by section 2.3:

| Outcome | Cards | Share |
|---|---|---|
| **Full quality** - fills `low` and `high` honestly (>=825 tall) | **88** | 15% |
| **No approved source** | **504** | 85% |

There is no middle tier: pokemontcg.io either has a card at 825+ or does not have
it at all. Everything it covers, it covers well.

*Had TCGplayer been usable*, the same merge would have given 208 full / 17
`low`-only / 190 below-slot / 177 none. That comparison is kept because it is the
entire cost of the section 2.3 finding - **it is the difference between 88 and 415
cards fixed** - and because the measurements need not be redone if the position
changes.

Per-card detail, including the recorded-for-evidence TCGplayer heights, is in
[`card-art-residue.json`](card-art-residue.json). The shape of the residue:
`tk-*` (17 kits, 385 cards), `mfb` (34), and the tail of `cel25cc`/`ecard2`
that pokemontcg.io numbers differently.

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
| Adopt pokemontcg.io for the full-quality 88 | 88 | source approval (section 7) |
| Solve the Bulbagarden crosswalk (section 2.4) | up to 504 | unresolved research + weakest posture |
| `exu-!` / `exu-?` | 2 | B6 path-contract change |

**100% is not reachable.** With TCGplayer ruled out, 504 cards (85% of the gap)
have no approved source at all, and the only remaining candidate is the one with
the weakest licensing posture and an unsolved crosswalk. The residue is documented
in [`card-art-residue.json`](card-art-residue.json) rather than chased.

Two notes on why the `low`-only question from section 4 is now largely moot:
pokemontcg.io has no card below our `high` slot, so nothing it supplies needs a
`low`-only fill. Section 4 remains a real latent bug - the app cannot express
"no high-res art exists" - but it no longer blocks any planned work.

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

1. **May pokemontcg.io be adopted?** It is the only approved-shaped candidate
   left: public, unauthenticated, 600x825 or better, and it closes 88 cards.
2. **Is the 504-card residue accepted as documented** (`card-art-residue.json`),
   or is the Bulbagarden crosswalk (section 2.4) worth commissioning despite the
   posture?

Decisions 2 and 3 from the first draft of this note are withdrawn: with TCGplayer
out, no approved source supplies art below our `high` slot, so neither the
`high: null` API change nor the upscale question has anything left to decide.

---

_Last updated by Claude Opus 5 on behalf of @cheyras — 2026-08-26_
