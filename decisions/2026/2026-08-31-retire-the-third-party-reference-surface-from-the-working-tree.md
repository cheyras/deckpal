---
date: "2026-08-31"
title: "Retire the third-party reference surface from the working tree"
decided_by: "repo owner (@cheyras); carried out by Claude (Opus 5) as Project"
areas: ["general"]
supersedes: []
---
## 2026-08-31 — Retire the third-party reference surface from the working tree

**Decided by:** repo owner (@cheyras); carried out by Claude (Opus 5) as Project
Holo subtask 2c, part 1.

**Decision:** The source ruled out on legal grounds on 2026-08-26 no longer
appears anywhere in DeckPal's working tree except as dated history. Six
categories of surface, six different removals:

1. **Runnable code — deleted.** `apps/images/src/warmFromPkmn.ts` and its
   `warm:pkmn` entry in `apps/images/package.json` are gone, so the module cannot
   be run by anyone who does not first write it again. `cloudWarm.ts`'s residue
   guidance now names the approved fallback (pokemontcg.io, per
   `research/CARD-ART-SOURCES.md`) instead of pointing operators at the retired
   warmer.
2. **Schema — migration `052_remove_pkmn_source.sql`, authored, NOT applied.**
   See the plan below.
3. **Guardrails — mechanism kept, name dropped.** `packages/storage/src/upstream.ts`
   and `SECURITY.md` used to explain at length which host was deliberately absent
   from `IMAGE_SOURCE_HOSTS`. An allow-list never has to enumerate what it blocks;
   saying so out loud was the only thing keeping the name in a security-critical
   file. The comments now explain the allow-list *default* — anything not listed
   is refused by the same code path, whether it was rejected deliberately or never
   considered — and state what approving a new upstream costs (an entry, plus a
   DECISIONS.md record of who approved it on what licensing basis). The test that
   used to assert the specific host is absent now asserts the default, against a
   neutral `assets.example`, and a second refusal case was added for a plausible
   but unapproved card-art CDN. The guarantee under test is unchanged and
   strictly better stated: the mechanism is proven, not one instance of it.
4. **Research corpus — sorted per file before a character was edited.** See below.
5. **Product-lineage comments — reworded to describe behaviour, not origin**
   across 20 files in `apps/web`, `apps/api`, `apps/sync` and `scripts`. Where a
   comment said "matches X", it now says what the rule *is* and why it is right;
   several got better in the process, because "verified against X" was doing the
   work a stated invariant should do. The `pkmnDark` root class was renamed
   `deckpalDark` (a marker, not a selector — nothing keys off it), with the
   quoting docs updated to match.
6. **Decision log and skills.** `API.md`, `DESIGN-SYSTEM-AUDIT.md` and the three
   affected skills now carry the policy without the name: the approved ladder in
   `research/CARD-ART-SOURCES.md` is the list, anything absent from it is ruled
   out, and the upstream allow-list is what enforces that rather than a warning in
   prose. **`DECISIONS.md`'s own past entries were left alone.** This file is
   append-only; rewriting what a dated entry decided would destroy the audit trail
   the file exists to be. Its ~63 mentions are history and stay history.

### The research corpus — the sort, per file

Two shapes were mixed in these documents and they get opposite treatments.

| File | Call | Reason |
|---|---|---|
| `BEHAVIOR-SPEC.md` | **deleted** | Its subject *is* the other product's interaction behaviour, reverse-specified from its help-centre articles and page captures. Nothing in it describes DeckPal. |
| `ROUTE-MAP.md` | **deleted** | The same product's URL and IA structure, extracted from the same captures. Same category. |
| `INTERACTION-CAPTURE.md` | **deleted** | A second capture pass over that product — motion, hover/focus states, breakpoints, view geometry. Same category. |
| `SCHEMA.md` | **kept, reworded** | DeckPal's own data model, and canonical documentation per AGENTS.md. Its evidence tags cited the study; they now say "the reference tracker". The analysis, the tier rules and every measurement are original. |
| `DECK-FORMATS.md` | **kept, reworded** | The legality engine's spec, grounded in the official rulebook, ban lists and rotation announcements (sources S1–S12). The comparison notes were incidental. |
| `TCGCSV-VARIANTS.md` | **kept, reworded** | DeckPal's own verdict on cross-filling reverse-holo rows from TCGCSV. Two passing mentions. |
| `CARD-ART-SOURCES.md` | **kept, ruling intact — deliberately** | This *is* the policy document. A policy that names what was evaluated and rejected is auditable; one that only says "use the approved list" invites the next agent to re-evaluate the same source and reach the same dead end. A dated update records that the code it names has since been deleted. |

The rule that produced this split: a blanket find-and-replace across all seven
would have produced documents describing a comparison with the compared thing
removed, which is worse than either keeping or deleting them.

Deleting three documents left section pointers dangling in `SCHEMA.md`,
`DECK-FORMATS.md`, `ARCHITECTURE.md`'s document map (row replaced with the
tombstone), three code comments, and migrations `003` and `013` (checksummed
and immutable per B4 — they could not have been edited even if it were
desirable). `research/REMOVED-RESEARCH.md` is the tombstone: it names what went,
why, and says to read the surviving pointers as dated provenance marks rather than
links. Rewriting ~120 citations instead would have destroyed the traceability the
tags exist to provide, to fix a problem a single note fixes better.

### Migration 052 — the plan, and why re-label rather than delete

**Measured against production, read-only, 2026-08-31: NINE `card_variant` rows,
not the 103 migration 024's header claims.** That number is from 2026-08-22 and is
stale — the catalog has been re-imported since, and the importer promotes a row in
place when TCGdex starts listing the facet, so most of the original hundred
resolved themselves.

All nine are **re-labelled to `source = 'tcgdex'`**, not deleted. Both halves of
that came out of the data:

- **Nothing duplicates anything.** `card_variant` carries
  `UNIQUE (card_id, variant_kind_code)`, so a retired-source row and an
  approved-source row can never describe the same printing of the same card. Every
  one of the nine is the only row of its kind for its card, and the
  "fold the duplicate" case is empty by construction.
- **All nine carry user data.** Eight have a `collection_item` row (one with
  quantity 2) and a `collection_event`; one also has a `price_current` row. Every
  FK into `card_variant` from those tables is `ON DELETE CASCADE`, so deleting the
  variants would silently destroy the owner's records for nine printings they
  actually hold.
- **`tcgdex` is the honest label.** These are not scraped catalog rows. All nine
  have `is_synthesized = true` and were created locally to model a printing the
  owner holds but TCGdex does not list. Every one of their `variant_kind_code`s is
  composed from TCGdex's own facet vocabulary, and TCGdex already lists several of
  those exact kinds on sibling cards. It is also the label that makes them
  **re-verifiable**: the catalog importer upserts on
  `(card_id, variant_kind_code)` writing `source='tcgdex'`, so the moment TCGdex
  publishes one of these facets the row is promoted in place, keeping its id and
  therefore its collection rows. Until then `is_synthesized` is the standing,
  queryable statement that the row was inferred locally — which is what the retired
  value was carrying, minus the name. `tcgcsv` would have been wrong: it means
  "cross-filled from TCGplayer product data", and eight of the nine have no
  TCGplayer product id at all.

The migration also scrubs `source_note`, where the name had also landed as free
text, guards with a `RAISE EXCEPTION` if any row outside the two approved values
survives the re-label, and only then narrows the CHECK back to
`('tcgdex','tcgcsv')` — the state migration 014 shipped and 024 widened.

**Verified before shipping, not after:** the migration was executed against PGlite
on a replay of the relevant DDL, seeded with the nine real (card, kind) pairs plus
approved-source siblings and a dependent `collection_item` per row. It applies,
leaves every dependent row intact, rejects the retired value afterwards, still
accepts both approved values, is a no-op on a second run, and aborts loudly on a
planted straggler.

### Implications

- **Migration 052 is authored but NOT applied.** Production still accepts the
  third value and still holds the nine rows. Applying it is a separate, approved
  step (see the prod-migration path — `tsx` on the runner, not `pnpm migrate`).
- **The image bytes are a separate job.** ~1,912 `image_asset` rows are still
  out of policy: 58 with the host in `source_url`, 1,854 with the honest-blank
  `NULL` the 2026-08-07 backfill established. `research/card-art-residue.json`
  tracks the replacement effort. Order of operations is unchanged and matters:
  re-source first, delete second, because 120 swsh-TG cards exist only as those
  bytes (DECISIONS.md 2026-08-10) and deleting them removes card art with nothing
  behind it. A counted list of cards with no art is an honest state; silently
  serving out-of-policy bytes is not.
- **On history.** This change adds nothing that would justify a rewrite of its
  own. Every removal here is text at the tip. If already-public history is
  rewritten, it rides subtask 2a's single `git-filter-repo` pass as a blob
  callback — two rewrites means two rounds of stale commit links, two support
  tickets and two re-clones. If 2a decides against, a clean tip is a real
  improvement on its own and 2c is complete either way. Recorded here so the item
  is not left open a third time on 2c's account.
- **Wiki sync is outstanding.** Per AGENTS.md gate 6 this change touches
  `Decision-Log`, `Data-Layer` (SCHEMA.md), `UI-Spec` (the renamed root class) and
  `Contribution-Record`. The wiki is a separate repository and was not written to
  from this branch; it is a named follow-up, not a silent skip.


