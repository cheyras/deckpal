# Deck-E — the ideation menu (Phase G)

Not built. Nothing here is committed to. This is R8 §8's 22 use cases turned
into something you can actually pick from in ten minutes — verified against
the 34 tools Deck-E actually has, not the tools a survey of TCGplayer/Collectr/
Dex assumed he might have.

**How this differs from R8 §8.** R8 wrote the ideas from a competitive survey.
I opened every tool it would need — `apps/api/src/decke/tools.ts`,
`packages/agent-tools/src/tools/*.ts`, the screen schema, and the DB migrations
behind them — and checked which of the 22 are true today, which are one small
thing away, and which are a different product. Three results changed the
picture enough to matter:

- **Two ideas R8 filed as expensive are nearly free**, because the data or the
  mechanism already exists and nothing surfaces it (rotation legality, trade
  fairness without a second account).
- **One idea R8 called "near-zero-net-new-data" is wrong.** Cost basis (#15)
  assumes DeckPal stores a purchase price. It does not — `collection_item` has
  `quantity`, `condition`, and two timestamps, nothing else
  (`packages/db/src/migrations/009_collection.sql:4-13`). That's a schema
  change, not a query.
- **One capability is already built and simply not wired to Deck-E**:
  `apps/api/src/export/pdf.ts` renders real print-friendly PDF checklists for a
  deck, a list, or a set (`GET /decks/:id/pdf`, `/lists/:id/pdf`,
  `/sets/:setId/checklist.pdf`), live today, and no tool exposes it.

Where the owner said something in `BRIEF.md` that bears on an idea, I've said
so and sided with him over the research when they disagree (C43 on confidence
indicators is the clearest case — see the Corrections section).

---

## Top five

Ranked by (value the owner would actually feel) × (how little of it is new
engineering). Not the same ranking R8 would produce — R8 ranked by ambition.

**1. Master-set completion, as a real widget — #2.** `set_progress` already
computes exactly this: per-goal owned/total, the missing list with cheapest
price each, cost to finish. Today that's a wall of text. `showScreen`'s
`progress` block (a real `role="progressbar"`) plus a captioned `cardGrid` of
the missing cards is the whole build. **Composes:** `set_progress`,
`showScreen`. **Needs nothing new.** This is the single most-asked collector
question ("how close am I") and DeckPal already has the exact numbers.

**2. Species-first cross-set view — #3.** "Every Umbreon I own or need."
`search_cards(query: 'Umbreon')` returns every printing across every set with
owned quantity and price in one call — the Pokédex-style grouping Dex and TCG
Collector treat as a distinct mental model from set-browsing is just a
`showScreen` arrangement of what that call already returns. **Composes:**
`search_cards`, `showScreen`. **Needs nothing new.**

**3. Trade fairness, scoped correctly — #10, rewritten.** R8 files this next to
#9 (matching against a friend's real DeckPal account) and implies it needs the
same thing. It doesn't. DeckPal has no cross-account read path — every query in
`packages/agent-tools` is scoped to `ctx.userId`, and there is no
public-profile or friend concept anywhere in the schema. But "is this trade
fair" doesn't require a second account: the user types or pastes what's on
each side, Deck-E prices both sides with `get_card`/`search_cards`, and shows
them in `showScreen`'s two-column `group` block — literally built for "two
things side by side." **Composes:** `get_card`, `search_cards`, `showScreen`.
**Needs nothing new**, once you drop the friend's-account framing. Mirrors
Collectr's validated "trade meter," and keeping the line items visible (not a
single score) avoids the confidence-indicator trap in R8 §4.

**4. Variant disambiguation — ask, don't guess — #20.** The mechanism already
exists server-side: `pickVariant` (`packages/agent-tools/src/resolve.ts`)
already distinguishes stated/omitted/ambiguous, and every write tool
(`log_cards`, `edit_list`'s `add_cards`) already returns an `ambiguous` status
with the full candidate list rather than guessing, when it's genuinely
ambiguous. What's missing is Deck-E *asking* instead of quietly defaulting to
primary when a name alone is given. **Composes:** whichever write tool was
called (its own `ambiguous` branch), spoken as a question. **Needs nothing new
for the text version.** The R8-pitched version — "both variant thumbnails side
by side" — is blocked on a real gap: `cardSource.ts`'s `CardArt` doesn't carry
variant, so a reverse holo and a non-holo of the same card currently render the
*same* image (Phase C4's own gap, R8 didn't know about it). Text-only ships
free; thumbnails wait on C4.

**5. Rotation legality by regulation mark — #7.** Every card already carries
`regulation_mark`, `legal_standard`, `legal_expanded`
(`get_card`'s `CardCoreRow`), and the *actual rotation schedule* is already
data, not something to fetch: `format_regulation_mark(format_code, mark,
legal_from, legal_until)` (`packages/db/migrations/011_formats_decks.sql:23-28`),
plus `apps/api/src/deck/data/_provenance.json` already states the next one
by name ("Next rotation ~2027-04-09 (H drops, K enters)"). No tool reads
`format_regulation_mark` today. **Composes:** a new small tool joining owned
cards' `regulation_mark` against that table (or an extension to `decks`'
`validate` include). **Needs:** one new tool — an afternoon, not a project,
because every fact it needs is already sitting in a table nobody queries.

**Honorable mention — #16, export.** Not in the top five only because it's
less a "feature" than a "did you know this already works" finding: real,
print-ready PDF checklists for a deck/list/set already render at
`/decks/:id/pdf`, `/lists/:id/pdf`, `/sets/:setId/checklist.pdf`
(`apps/api/src/export/router.ts`) and no tool hands Deck-E the URL. TCGplayer
cart links already prove Deck-E can paste a URL into a plain-text reply
(`decks.ts`'s `pricingLines`) — the same pattern applies here. One small tool,
an afternoon.

---

## The menu, grouped by what it costs

### Group A — nearly free (compose existing tools, no new data, no new tool)

| # | Idea | Composes | Surface |
|---|---|---|---|
| 2 | Master-set completion | `set_progress`, `showScreen` | inline widget (progress + cardGrid) |
| 3 | Species-first cross-set view | `search_cards`, `showScreen` | ad-hoc screen |
| 10 | Trade fairness (both sides typed) | `get_card`, `search_cards`, `showScreen` | inline widget (group block) |
| 20 | Variant disambiguation (text) | any write tool's `ambiguous` branch | speech bubble question |
| 1 | Box break, described in words | `log_cards` (dry run → approval) | approval card |
| 16 | Print-friendly export | new thin wrapper over `/decks/:id/pdf` etc. | link in reply text |

Item 1 needs a caveat: the *photo* half of "I just opened this box, add
everything" is OR5 (add-photo in the composer), which the plan explicitly
defers — his call, not this pass's to relitigate. But if he *tells* Deck-E what
he pulled — "two Charizard ex, a Pikachu VMAX, three commons I didn't catch
the names of" — `log_cards`'s existing dry-run-then-approve batch path already
handles that end to end. Nobody has to build anything for the words path; only
the photo path is blocked, and it's blocked on purpose.

### Group B — one new tool or one new data source (an afternoon to a week)

| # | Idea | What exists | What's missing |
|---|---|---|---|
| 7 | Rotation legality | `format_regulation_mark`, `card.regulation_mark` | one tool joining them |
| 5 | Duplicates as bulk | `collection_item.quantity` per variant | one tool: "owned ≥ N copies" filter (no existing tool filters on quantity threshold) |
| 11 | Price + volatility, one card | `price_observation` — a real per-variant historical table, ~2 months of data, partitioned monthly (`packages/db/migrations/007_pricing.sql:45-70`) — collected and unused | a tool reading it (text trend line is cheap; an actual sparkline needs a new `showScreen` block, since none draws a series today) |
| 14 | Insurance valuation snapshot | the PDF pipeline (Group A honorable mention) and `collection_summary`'s pricing | a new document format — "replacement cost, dated, condition-assumption language" is not what the existing checklist PDF says |
| 16 (CSV/JSON) | Full data export as CSV/JSON | every read tool, paged | no CSV/JSON endpoint exists at all — the PDF checklists are print-formatted text, not structured data |
| 18 | Packs needed to complete | `set_progress`'s missing-list + prices | published pull-rate data for physical product isn't in the catalog; `research_meta` (a live-web deep tool) could plausibly fetch it per request, unverified whether results would be reliable enough to hedge honestly |
| 15 | Cost basis vs current value | `collection_summary`/`collection_value`'s current-value math | a purchase-price field does not exist on `collection_item` today (see Corrections below) — this is a schema change plus a place to enter the price, not a query |

### Group C — a different product (needs infrastructure DeckPal doesn't have)

| # | Idea | Why it's bigger |
|---|---|---|
| 9 | Want-list ↔ friend's collection | needs a cross-account read path; every query in `agent-tools` is scoped to `ctx.userId`, no public-profile or sharing concept exists anywhere in the schema |
| 12 | Price alerts | needs a standing background job plus a way to notify the user outside an open chat session — no cron/queue/notification infra exists in `apps/api/src` (checked) |
| 8 | Release-calendar digest | same delivery-infra gap as #12, plus the catalog is populated from released-set data (TCGdex/tcgcsv) — there is no structural "upcoming set" row to cross-reference against |
| 4 | Grading ROI | needs PSA/CGC/BGS population and graded-comp price data; DeckPal's pricing is raw-card market data only (tcgcsv/tcgdex), no graded tier anywhere in the schema |
| 6 | Counterfeit pre-screen | no image-analysis tool exists for Deck-E at all; the `/scan` pipeline does phash matching against catalog art for *identification*, not print-line/border forensics for *authenticity* — a different algorithm, not a reuse |
| 13 | Binder page-layout planning | plausible from owned-card data, but a draggable virtual-binder UI is a real screen, not a chat panel — closer to a new app feature than a Deck-E composition |
| 19 | Local league/tournament pointer | DeckPal holds zero location or event data; the only honest version is "here's the link to Pokémon's own store locator," which needs none of DeckPal's data and isn't really a Deck-E feature |
| 21 | Personalized chase list | the personalization inputs R8 names (species affinity, rarity preference, archetype pattern) aren't tracked anywhere — this is new inference work, not a query |
| 22 | Sell/hold framing | the data (`collection_value`'s movers/trend) is real and already computed, but this is the highest trust-risk item on the list and directly collides with the still-open confidence-signal question (BRIEF.md Q7) — build after that's settled, not before |
| 17 | Kid-mode supervised adding | no evidence anywhere in the brief that a child uses this account — see rejection below |

---

## What I would not build, and why

**#17 — kid-mode.** This is a good idea for a multi-tenant commercial product.
It is not this owner's idea, and nothing in 2,944 lines of transcript suggests
a child uses this account. Building it now is designing for a hypothetical
user instead of the one who is actually here. Shelve it unless he says
otherwise.

**#19 — local league/tournament pointer.** The "why" R8 gives is "even a
non-authoritative pointer is more than most trackers offer" — that's a low
bar, and the feature as scoped is a link to Pokémon's own store locator that
uses none of DeckPal's data. It isn't a Deck-E capability; it's a bookmark
wearing a costume.

**#9 — want-list ↔ friend's collection.** Not rejected as a bad idea — rejected
as out of size for this pass. It requires a cross-account read path that does
not exist in any form, and building one has privacy/RLS implications this
document shouldn't wave through. If he wants this, it deserves its own design
pass, not a line item here.

**#6 — counterfeit pre-screen, deprioritized rather than rejected.** The
domain research is honest about the limits (every real authentication tool
says photo analysis can't certify), but there's no image-analysis capability
in Deck-E's toolset at all to build it on — the phash matching in `/scan` does
identification, not forgery detection. Combined with it being the single
highest-liability answer Deck-E could give ("is my $400 card real"), this
should be last on the list if it's built at all.

**#12 and #8 — deprioritized together, not rejected**, because they share the
same missing piece: neither works without a way to notify the user when the
chat isn't open, and that infrastructure doesn't exist. Building one justifies
building the other; building neither costs nothing today.

R8 §8 itself contains no ideas I'd call flatly bad — the weakest ones (#19,
and #17 for this owner specifically) are weak because they're generic, not
because they're wrong. The research is competent; it just wasn't told this is
a product built by and for one person.

---

## Corrections to R8, found while verifying

1. **#15 (cost basis) is not "near-zero-net-new-data."** R8: *"DeckPal already
   has purchase-price fields if the user logs them."* Checked
   `packages/db/migrations/009_collection.sql:4-13` — `collection_item` has
   `id, user_id, card_variant_id, quantity, condition, first_added_at,
   updated_at`. No price field, logged or otherwise. This is a schema change
   plus a UI for entering it, not a query against data that's already there.
2. **#20's visual half is blocked on an existing, documented gap.** Showing
   "both variant thumbnails side by side" assumes variant-aware card art.
   `cardSource.ts`'s `CardArt` type carries no variant field (Phase C4's own
   gap, independently identified) — today a reverse holo and its non-holo
   counterpart resolve to the same image. The text-only disambiguation ships
   regardless; the picture doesn't, yet.
3. **#7 (rotation legality) is cheaper than R8's framing implies.** R8 treats
   it as needing external tracking of "the announced rotation date." The
   rotation schedule is already first-class data in `format_regulation_mark`,
   and the next date is already written down in
   `apps/api/src/deck/data/_provenance.json`. Nothing needs fetching.
4. **#10 (trade fairness) doesn't need what #9 needs.** R8 lists them
   adjacently and #10's own "why" cites Collectr's trade meter, which values
   two *named* sides, not two *accounts*. Scoped that way it's Group A, not
   Group B.

---

## Reference — what Deck-E can already do (34 tools)

For cross-checking any future pick against reality rather than memory.

**Read (14):** `health`, `collection_summary`, `collection_log`,
`collection_value`, `search_cards`, `get_card`, `set_progress`, `decks`,
`battle_logs`, `deck_history`, `lists`, `mutation_history`, `set_cart`,
`deck_strategy` (read mode).

**Write, approval-gated, dry-run-by-default (9):** `save_deck`, `delete_deck`,
`deck_strategy` (write mode), `add_battle_log`, `edit_battle_log`,
`delete_battle_log`, `edit_list`, `delete_list`, `log_cards`, `revert`.
(That's 10 — `deck_strategy` counts once above, so 9 distinct write tools
beyond it.)

**Deep / multi-step (4):** `plan_deck`, `analyze_collection`, `research_meta`
(live web, no DeckPal data access — useful for #18's pull-rate research and
#21's meta angle), `write_strategy_guide`.

**Movement and presentation (7):** `express`, `flyTo`, `highlight`, `goTo`,
`scrollToMe`, `click`, `showScreen`.

**`showScreen`'s block palette:** `heading`, `text`, `cardGrid`, `statTile`,
`progress`, `status`, `empty`, `table`, `group` (2-column, one level of
nesting only). Max 12 blocks per screen, max 60 card ids across all grids in
one screen. No chart/sparkline block exists — anything needing a time-series
line (idea #11's visual half) is new front-end work, not just a new tool.
