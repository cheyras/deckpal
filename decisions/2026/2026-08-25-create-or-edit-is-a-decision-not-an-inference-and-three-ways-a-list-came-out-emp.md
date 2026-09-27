---
date: "2026-08-25"
title: "Create or edit is a DECISION, not an inference; and three ways a list came out empty"
decided_by: "Claude (Opus 5), from one transcript the owner flagged — *\"it"
areas: ["operations"]
supersedes: []
---
## 2026-08-25 — Create or edit is a DECISION, not an inference; and three ways a list came out empty
**Decided by:** Claude (Opus 5), from one transcript the owner flagged — *"it
surfaced some real issues with creating lists"* — and one thing he had seen
before: *"I’ve also had it instead of creating a list, it appended to an
existing list. I’m sure the same thing could happen to a deck, so we need to
make sure it’s smart about whether it’s supposed to make a new one or edit an
existing."*

**Decision:** `edit_list` and `save_deck` take `mode: create | edit`. Omitted,
it is inferred — and the inference leans to CREATE, because the two mistakes
are not the same size:

| the model meant | it does | cost |
|---|---|---|
| create | edit | **someone’s existing list is written to.** 113 cards appended to a list nobody named |
| edit | create | a spare list. Deletable in one call |

So an ambiguous call creates, and only an explicit, resolvable target edits.
`mode: 'edit'` without an id is refused rather than quietly turned into a
create — declaring the intent and then not supplying the target is the one case
where guessing either way is wrong.

### What the transcript actually contained

Three separate faults on ONE request, each of which alone produced a bad turn:

1. `edit_list({ list_id: 'new' })`. There is no list called `new`, so it
   resolved to nothing and failed. The retry sent the NAME of the list it wanted
   to create, which is not an id either. Now `meansCreate` reads the words a
   model writes for "a new one", and an unresolvable id says, in the failure
   itself, how to create instead.
2. The silent append. Nothing in the approval card distinguished "create" from
   "add to the list you already had" — both rendered as a list of cards. The
   dry run now always names its target: `CREATE a new static list called 'X'`
   or `ADD TO your existing list 'X' (113 item(s) already in it)`, and a create
   whose name is already taken carries a heads-up that this makes a SECOND one.
   Same treatment on `save_deck`, where an unintended edit rewrites sixty cards.
3. **The list would have been empty anyway.** `add_cards: [{ name: 'Blastoise
   ex', set_id: 'sv3.5' }]` — the model’s spelling of this catalogue’s
   `sv03.5`. `resolve.ts` compared `set_id` RAW, so the set resolver reached
   `search_cards` and never reached the write path. Fixed inside `resolve.ts`,
   not at the call sites: `get_card` had been patched individually and
   `edit_list` and `log_cards` had not, which is how a fix stays half-applied.

### The bug that only a probe could find

Faults 1 and 2 were verified with dry runs against the live account. The probe
is what surfaced fault 3 — it printed `add Blastoise ex — UNRESOLVABLE` under a
plan that was otherwise perfect. Both earlier faults could have been called
fixed, shipped, and still produced an empty list.

This is the same lesson as the phantom research model, in a different costume:
**a capability that is declared but never exercised will eventually be reported
as built.** `search_cards` exercised set resolution; the write path declared it
and did not.

### And the rarity smeared into the name

From the same turn: `search_cards({ query: 'Tatsugiri Illustration Rare' })`,
which matches no printed name, returned nothing, and was read as "that card
does not exist" — after which a price was quoted from memory. The card is real
(`sv06-186`, $21.94), and so was `Wailord Illustration Rare` (`sv09-162`,
$16.15), which had been priced at a number nothing in the catalogue supports.

`peelRarity` takes a trailing rarity off and retries. Four things about it are
deliberate:

- **The vocabulary is read from `card.rarity`, not hardcoded.** Forty values
  today; new ones ship with new sets (One Shiny, Mega Hyper Rare). A constant
  would be stale within a release.
- **Suffix only.** `Rare Candy` is a real Trainer card, and peeling prefixes
  reads it as a Candy of rarity Rare. It returns 23 rows, so this path never
  runs for it in production — only a test holds that line.
- **A string that is ENTIRELY a rarity is refused.** Otherwise longest-match
  falls back to the shortest suffix that leaves two characters and reports
  `Illustration rare` as a card called `Illustration`.
- **The retry puts the rarity in the QUERY, not in a filter over the results.**
  The first attempt re-resolved the bare name and filtered the candidate list,
  which is capped: Wailord has more printings than the cap, so the one
  Illustration rare fell off the end and the tool reported it absent — while
  `search_cards`, two lines up the same probe, said "1 match". Two halves of one
  system disagreeing about a fact is worse than either being wrong alone.

A near match at the WRONG rarity is left to fail rather than substituted.
Quietly returning a different printing is how a $2.66 Double rare gets reported
as the $139.40 special.

**Implications:**
- The create-leaning default is a safety property, not a convenience. Anything
  that later makes `edit` the fallback needs to argue with the table above.
- `resolveCard`’s two tiers are now one `lookup()` closure taking a name and an
  optional rarity, with fresh params per call. That removed a positional hack
  (`${params.length - 1}`) that had tier 2’s ranking depending on how many
  params tier 1 happened to bind.
- The collision warning costs one extra read, only on the create path.

---
