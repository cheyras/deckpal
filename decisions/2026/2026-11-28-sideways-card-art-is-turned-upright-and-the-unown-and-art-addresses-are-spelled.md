---
date: "2026-11-28"
title: "Sideways card art is turned upright and the Unown ! and ? art addresses are spelled out"
decided_by: "@cheyras (2026-11-28); implemented by Claude Opus 5.5 on behalf of @cheyras"
areas: ["images", "scanner"]
supersedes: ["2026-08-26 exu-! and exu-? cannot be represented at all (SEGMENT in paths.ts; a B6 path-contract change not made then)", "2026-08-31 the Unown-! finding: two cards need a B6 path-contract change before they can carry art"]
---
## 2026-11-28 — Sideways card art is turned upright and the Unown ! and ? art addresses are spelled out
**Decided by:** @cheyras; implemented by Claude Opus 5.5 on behalf of @cheyras

**Decision:** Two card-art fixes, in the owner's words:

> "On ones where only a sideways image exists, it's OK TO rotate them to be
> vertical and have the content be sideways."

> "We don't have to use ? and ! In the image address, just use 'question' and
> 'exclamation'"

1. **A sideways source is turned upright.** The self-source fallback's encode
   (`encodeToSlot`, `apps/api/src/images/selfSource.ts`) refused every source
   outside 1.25–1.55 tall per wide. A landscape source whose TURNED shape is in
   that range is now turned a quarter turn counter-clockwise (`SIDEWAYS_TURN`,
   sharp's 270°), then encoded to the slot as usual. The content ends up sideways
   on the card, as printed. A source that is card-shaped neither way stays
   refused.
   - **Direction.** It is how the physical cards are printed and how TCGdex shows
     them in portrait: the card's top edge runs up the left side, the name reads
     bottom to top, and the HP sits in the top-left corner. All 45 BREAK and
     LEGEND cards TCGdex has in xy8–xy12 and hgss1–hgss4 (27 BREAK, 18 LEGEND
     halves) are shown that way, checked by eye on one contact sheet. Our encodes
     were compared directly with xy9-41 Greninja BREAK (the card 30th-c 009
     reprints) and hgss4-99/100 Darkrai & Cresselia LEGEND (the cards 30th-c
     019/020 reprint). Also measured: the mean grey difference between our
     encode and TCGdex's original is 14.0, 24.8 and 20.4 (of 255) for 009, 019
     and 020. A clockwise turn scores 51.5–57.0, and a mirrored turn
     50.0–51.4. The remaining difference is the 30th-anniversary stamp and the
     scan's colour.
   - **Cards.** 30th-c 009 (Greninja BREAK) and 019/020 (the two halves of
     Darkrai & Cresselia LEGEND), whose only source is 920×660. tk-sm-r-14's
     only source is 1920×1100, a placeholder picture rather than the card, and
     it stays refused.

2. **The Unown `!` and `?` (set `exu`) get art addresses.** `SEGMENT`, the B6
   path allow-list, cannot carry either character, so neither card ever had art.
   The address now spells them out, through one mapping in
   `packages/storage/src/paths.ts` (`cardImageSegment` / `localIdFromImageSegment`):
   `/deckpal/images/en/ex/exu/exclamation/low.webp` and
   `/deckpal/images/en/ex/exu/question/low.webp`, stored as
   `images/en/ex/exu/exclamation.low.webp` and `question.low.webp`. Card ids,
   local ids, `number` and the catalog are unchanged.
   - **Where `%3F` comes from.** From TCGdex, not from us. TCGdex's database
     names each card's file after its local id, and `?` is not a legal file
     name everywhere, so the file is `%3F.ts`. Its compiler takes the local id
     from the file name, so TCGdex's local id is the three characters `%3F` and
     its card id is `exu-%3F`. Our importer takes the local id verbatim, so the
     catalog stores `%3F` and the API shows the card's number as `%3F`. The
     earlier image address `…/exu/%3F/low.webp` decoded to `?` and was refused.
   - **Every place agrees.** The API's `cardImages()` builds its addresses
     through the new `cardImageAddress()`, and so does the landing page's demo
     art. `parseImagePath` maps the segment back to the catalog's local id. The
     cache key keeps the card id (`card:exu-%3F:low`). The object key and the
     disk path come from `cardRelativePath`. The scanner's art lookups
     (`scan:topup`, `scan:index`, `tools/embed-catalog`) now take the shared path
     algebra instead of rebuilding the layout. The self-host card route,
     `manifest:backfill`, `rekey:set` and `art:upgrade` map the stored segment
     back the same way.
   - **TCGdex's real path.** TCGdex serves no English art for any `exu` card
     (none of the 28, at any extension). It does serve the French Unown
     Collection (`fr/ex/ex10`), at `…/!/high.webp` and at `…/%253F/high.webp`
     but not `…/%3F/…`, so its asset store keys the `?` card by the literal
     `%3F`. `cardSourceUrl` now percent-encodes the local id once (a no-op for
     every other id), so the canonical URL is `…/exu/%253F/…` and `…/exu/!/…`.
     The fetcher's path allow-list (`UPSTREAM_PATH` in
     `packages/storage/src/upstream.ts`) admits `!` and that one literal escape,
     and nothing else containing `%`. So the tier really asks TCGdex first, and
     TCGdex art still wins the day TCGdex has it.
   - **The product check.** The self-source fallback compares a linked product's
     number with the card's PRINTED number (`printedLocalId`: `%3F` → `?`).
     The two linked records read `Unown (!)` `!/28` and `Unown (?)` `?/28`, so
     both now pass. Before this change `?` failed against `%3F`.

**Why:** Both groups of cards had a usable source and served the placeholder for
a mechanical reason: a shape check that did not know some cards are printed
sideways, and a path contract that could not spell two collector numbers. The
owner's ruling on each removes the mechanical reason without loosening either
check in general. A non-card picture is still refused, and the path allow-list
and the object-key allow-list are unchanged.

**Implications:**
- No production writes from this change. The deployed image tier fills the five
  cards on first view, and the image-warm workflow covers the rest. The next
  catalog refresh's `scan:topup` downloads and indexes their art from the new
  object keys.
- The old addresses `…/exu/!/…` and `…/exu/%3F/…` stay unservable (no alias).
  Nothing served them before, and nothing emits them now.
- A future card numbered with punctuation needs one entry in `SPELLED_OUT`
  (`paths.ts`). No card is numbered `exclamation` or `question`, so the two
  segments cannot collide with a real id.
- Security: the fetcher's path allow-list widened by exactly `!` and the literal
  `%3F`. `%` alone, `%00`, `%20` and further escape layers are still refused
  (tests in `upstream.test.ts`). SECURITY.md says so.
- Tests: rotation direction (a synthetic sideways card, pixel-checked for its
  edges and corner), both refusals, the mapping both ways, the end-to-end parse
  of the emitted address, the cache key and TCGdex URL, the product check, the
  scanner's cache paths and sources, the web object URL and `rekey:set`'s round
  trip.
- Docs: AGENTS.md B6, ARCHITECTURE.md, API.md and SECURITY.md describe the
  spelled-out segment.
