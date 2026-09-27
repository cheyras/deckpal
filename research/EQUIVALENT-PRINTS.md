# Equivalent prints in the deck builder: design memo

Status: implementation in PR #232, 2026-09-26. The catalogue comparisons below
record the original design research. Chey's later product decision supersedes
the artwork, rarity and illustrator restrictions proposed in that research.
Branch `feat/deck-equivalent-prints`; migration 076.

## Final product decision (2026-09-26)

- Ordinary prints with the same complete gameplay fingerprint count across
  sets and artwork when the owned print is legal in the deck's format.
- Any ordinary basic Energy of the same type counts, regardless of set or art.
- A deck row can be pinned to its exact variant; only that variant then counts.
- Promo-set and stamped variants remain distinct. A regular card does not count
  as its promo or stamped version, or vice versa.
- Exact copies are reserved first. Remaining owned copies are allocated once
  across matching deck rows. The shared result drives deck ownership, buying
  suggestions, assistant output and the PDF checklist.

The sections below are historical evidence and the earlier proposal. In
particular, the proposed artwork-window hashing and "Use mine" swap are not
part of the final rule.

## The rule, in one sentence

A card you own counts toward a deck slot when it is the same card printed in a
different set: same name and game text, same rarity, same illustrator, the same
artwork, the same finish (normal, reverse holo...), and legal in the deck's
format. Anything that differs in a way you can see stays yours to choose: the
deck tells you that you own it, but does not count it for you.

## Why (plain language)

Chey owns 3 Rellor from Destined Rivals (DRI 024). The Slowking deck lists
Rellor from Surging Sparks (SSP 013). The two cards are the same card: same
art, same rarity, same attacks, same illustrator. Only the set code, the
number and the copyright year differ. Today the deck says "0/3 owned" because
it only counts the exact printing named in the deck (a rule introduced on
purpose in migration 051 so that "2 normal + 1 reverse holo" stays honest).

The fix must not overreach. Many prints share a name and text but look
different (a gold hyper rare, a new illustration, a different trainer
portrait). Counting those would quietly swap a card the collector did not
choose.

## Evidence

Crawled the public catalogue (SV, Mega Evolution and SWSH series, 8,640
cards). Grouped prints by name + illustrator + rarity + HP: 286 groups span
more than one set (609 cards, 345 cross-set pairs). Downloaded each card's
art and compared two image signals:

- `d64`: the scanner's existing 64-bit whole-card hash (`dhash8v3`, the value
  already stored in `card_image_phash`).
- `art256`: a 256-bit difference hash of the ARTWORK WINDOW only (x 8-92 %,
  y 10-50 % of the card), computed the same way at 17x16.

Ground truth checked by eye on contact sheets.

### Identical reprints (should count)

| Card | Prints | Rarity | d64 | art256 |
|---|---|---|---|---|
| Rellor (Chey's case) | SSP 013 (sv08-013) / DRI 024 (sv10-024) | Common | 3 | 14 |
| Rare Candy | SVI 191 (G mark) / MEG 125 (I mark) | Common | 4 | 10 |
| Nest Ball | SVI 181 / PAF 084 | Uncommon | 0 | 14 |
| Ultra Ball | SVI 196 / PAF 091 | Uncommon | 1 | 4 |
| Charizard ex | OBF 125 / PAF 054 | Double rare | 3 | 3 |
| Professor's Research (Turo) | SVI 190 / PAF 088 | Rare | 2 | 8 |
| Poochyena | TEF 105 / me02.5-128 | Common | 2 | 21 (worst identical pair) |

Across all 239 identical non-Energy pairs: d64 max 6, art256 max 21.

### Same name and text, NOT the same card to a collector (must not count)

| Card | Prints | Why different | d64 | art256 |
|---|---|---|---|---|
| Professor's Research | SVI 189 (Sada) / PAF 088 (Turo) | different portrait; same illustrator, rarity, text | **5** | 57 |
| Black Belt's Training | JTG 143 / PRE 097 | different art, same illustrator (GOSSAN) and rarity | 15 | 113 |
| Teal Mask Ogerpon ex | TWM 025 / PRE 012 | new art, both "5ban Graphics", Double rare | 20 | 119 |
| Iron Leaves ex | TEF 213 / PRE 176 | gold hyper rares with different treatment | 3 | 74 |
| Grass Energy | SVE 001 / MEE 001 | different background design; no illustrator | 6 | 24 |
| Rellor | PAF 108 shiny | different art AND rarity (Shiny rare) | n/a | n/a |

Across all 82 clearly different-art pairs: d64 min **5**, art256 min 57.

### What the evidence decides

1. **Illustrator is not enough.** Sada and Turo share name, text, rarity and
   illustrator (kirisAki). Studios like 5ban Graphics sign many different arts.
2. **The scanner's stored hash is not enough.** Different art can sit 5 bits
   apart while true reprints reach 6. No threshold separates them.
3. **An artwork-window hash separates cleanly:** identical <= 21, different
   >= 57. A threshold of 32 leaves a wide margin both ways.
4. **Basic Energy is a special case.** SVE and MEE energies are different
   designs with the same layout (art256 21-24, too close to call) and carry
   no illustrator, so the rule never groups them. Product question below.

### Legality (primary sources, fetched 2026-09-26)

- Play! Pokemon Tournament Handbook, last revision September 1, 2026, section
  4.1.3: any version of a reprinted card may be played if the name is
  identical and all text is functionally identical.
- 2026 Standard rotation announcement: H, I and J are legal from April 10,
  2026; older versions "can still be used if the card is currently legal for
  play" (their example is Sun and Moon Rare Candy, legal through the I-mark
  Mega Evolution print).

So an identical print is legal whenever the deck's print is, with the
exceptions the engine already models (GLC's Classic Collection carve-out).
The rule still checks the owned print with the existing single-card legality
engine (`cardLegality.ts`) rather than assuming it.

## Design

### Data: one catalogue column, one pass

- Migration 076: `card.identical_print_group BIGINT`, partial index on non-null.
  Rows sharing a value are the same physical card printed in more than one
  set. NULL means "no twin found, or not evaluated": never "same as other
  NULLs". Fail closed: with the column empty, behaviour is exactly today's.
- `apps/api/src/deck/identicalPrints.ts`: the pure rule (`artDistance`,
  `isIdenticalPrint`) and the pass `indexIdenticalPrints(pool)`, CLI
  `pnpm --filter deckpal-api prints:index`, run from `refresh-catalog.sh`
  after `fingerprint:index`. It buckets cards by (playable_fingerprint,
  rarity, illustrator), skips single-member buckets and TCG Pocket, hashes
  the art window of each candidate from the same image cache the scanner
  indexer reads (`IMAGE_CACHE_ROOT`), and groups with COMPLETE linkage (a
  card joins a group only if it matches every member), so a chain of
  near-misses can never merge two different arts. Group value = lowest card
  id in the group.
- Why a precomputed group rather than comparing at request time: every surface
  then agrees by joining one column; equivalence is transitive, which makes
  the ownership allocation simple; the image work happens once per import,
  not per page view.

### Ownership: one shared computation

Every surface that says "owned" for a deck must read the same numbers:
`GET /decks/:id` (deck page, card sheet, agent `decks` tool, Deck-E),
`/decks/:id/pricing` and `/decks/:id/massentry` (Buy Missing), and the PDF
checklist (`export/router.ts`, which today uses a different whole-card
rollup). Plan: one SQL fragment / loader in `routes/decks.ts` used by all of
them, allocating copies within a deck so one owned card is never counted
twice:

1. Exact printing first (today's behaviour, unchanged).
2. Then leftover copies of identical prints (same group, same finish,
   legal in the format), each copy used once per deck.

Copies are still shared across decks, as today.

### Variants (finish) within one print

Today a Normal slot does not count a Reverse Holo you own of the same card.
Keep that. A reverse holo is a different object to a collector (and often
pricier), and the 051 decision was made precisely so the deck can say
"2 normal + 1 reverse". The equivalence works along the SET axis only:
DRI Normal counts for SSP Normal, DRI Reverse for SSP Reverse. Finish codes
match by exact `variant_kind_code`.

### The reverse case: the deck names the fancy print, you own the plain one

Symmetric by construction: identical means same rarity and same art, so a
plain print can never satisfy an illustration rare slot, and vice versa.

### Non-identical prints: no "any print is fine" switch

I recommend against a per-slot "any printing" flag. It adds a hidden state that
makes "owned" mean different things on different rows, and it makes the
deck's price and Buy Missing lie (the deck would be priced off a print you
are not using). The honest fix already exists: swap the deck's printing to
the one you own ("In this deck" tab, "Add another printing"). The UI should
make that one tap: when you own the same card in a different-looking print,
the row says "You have 2 in another printing" and offers "Use mine", which
swaps the slot to your print. Nothing is substituted without a tap.

### UX copy (calm, consistent with the deck row today)

- Deck row, satisfied by an identical print: "3/3 owned" in the usual green,
  plus a quiet muted line "3 from Destined Rivals, identical card".
- Card sheet "In this deck" tab: same sentence under the printing row.
- Different-looking print owned: muted "You have 2 in another printing ·
  Use mine" (not counted).
- Buy Missing: a slot covered by an identical print is not listed. A slot
  where you own a different-looking print is listed, with "you have 2 in
  another printing" so you can decide.
- Deck-E / agent `decks` tool: `own 3/3 (3 via identical DRI 024)`, and
  `own 0/3 MISSING (owns 2 in another printing: PAF 108)`.
- Export (PTCG Live text): unchanged; it names the deck's printing. PDF
  checklist: uses the shared owned numbers.

## Product questions for Chey

1. **Basic Energy.** SVE and MEE Grass Energy look different (swirl vs
   sparkle background). Under the strict rule they never count for each
   other. Most players do not care which basic Energy design they sleeve.
   Should basic Energy be the one exception ("any design counts")?
2. **"Use mine" swap.** Is a one-tap swap to your own printing the right
   answer for different-looking prints, or do you want a per-card "any
   printing is fine" setting after all?
3. **Stamped and promo versions.** Same art with a stamp (for example a
   prerelease stamp) usually carries a different rarity or is a separate
   finish, so the rule does not count it. Agree?
