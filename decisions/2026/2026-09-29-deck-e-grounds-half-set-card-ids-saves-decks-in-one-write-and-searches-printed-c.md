---
date: "2026-09-29"
title: "Deck-E grounds half-set card ids, saves decks in one write, and searches printed card text"
decided_by: "owner"
areas: ["Deck-E", "decks", "search", "MCP"]
supersedes: []
---
## 2026-09-29 — Deck-E grounds half-set card ids, saves decks in one write, and searches printed card text
**Decided by:** owner

**Decision:** This pass fixes the defects the owner hit on build #267, the first
build on Claude Sonnet 5.5. They called the build "a night and day difference",
then listed what still broke.

- **Card ids with a dot now count as real.** Ids like `sv08.5-071` come from half
  sets. The id pattern Deck-E uses to decide which card ids a tool really returned
  now accepts them. (Tool results replayed from earlier replies already counted.)
- **Deck saves are one write.** `save_deck` saves through a new `POST /decks/save`,
  which checks every card and then writes the deck, its cards and its first
  version in a single transaction.
  - An edit changes only the cards that changed, so printings the owner chose and
    pinned survive.
  - A retried save returns the deck already made, not a copy, while that deck is
    alive and unchanged. Once it has been deleted or edited, the same save makes a
    new one, and a retry of that save replays it.
  - `/decks/import` refuses the whole deck when any line fails to resolve,
    instead of silently leaving lines out.
- **`search_cards` searches printed card text.** It takes a `text` filter over
  attack and Ability wording and a `damage` filter (`x`, `+`, `-`). Reprints with
  the same text collapse into one row, and a text search returns up to 200 rows
  in one call.
  - Claude over MCP gets the same search, because both load the same tool
    definitions.
- **Deck-E's instructions changed.**
  - `save_deck` is always available.
  - He offers a strategy guide once a deck is finished.
  - He answers card-text questions from DeckPal, not the web.
  - "List", "every" and "all" mean the complete list.
  - He never ends a reply announcing something he did not do.
- **Approval cards match the call.** The headline names what the call actually
  does. Deck and list writes show a strip of card thumbnails that expands to the
  full list or a diff, and a strategy guide shows its text.
- **Thumbs up and down.** They are real thumb icons, readable at rest, and appear
  in History too.
- **Poses while working.** Deck-E cycles through poses that fit the work instead
  of freezing after his first gesture. A gesture he ends a reply on is still left
  standing.

**Why:** The owner planned a deck and Deck-E could not save it. Their message
"Save it as a deck, yeah" failed three times with "some cards weren't verified",
and Deck-E then said "I also don't have a working save tool in this chat". The
owner pasted the list into Claude to save it.

- **The deck failure.** The id pattern found nothing in `sv08.5-071` or
  `me02.5-160`, and matched only the fragment `5w-029` in `sv10.5w-029`. Almost
  every card in that deck came from a half set, so no amount of checking could
  make them count. Four parallel workers, each shown the transcript and asked
  why the existing checks had missed it, did not find this. The orchestrator
  found it by running the pattern on real ids.
- **The list failure.** Asked for every card whose coin flips multiply damage,
  Deck-E said "DeckPal's search only matches card names. It can't search attack
  text." He guessed names from web research and got 7, then 10, then 16 cards.
- **Thumbs.** The owner could not see them. They were drawn as grey arrows, and
  both chats ran on a build from before thumbs shipped.

**Implications:**
- Any other code that reads card ids out of text should use the same dotted-set
  pattern (`grounding.ts`, `turnGuards.ts`).
- Retried saves share a content key (for an edit, including the deck's state
  beforehand). A key is honoured only while its deck is alive and unchanged, and
  then moves to a next generation derived from the spent batch. So switching a deck
  from list A to B and back to A applies every step, and no clock can split one
  retry into two decks.
- Compacted lookup records of old replies do NOT ground card ids. They travel as
  ordinary text the model could imitate (Astra's review), so only real tool
  results count.
- Web research is kept for the metagame, tournament results and news.
- Using Jev to pre-filter large result sets was considered and deferred. Deck-E
  reads up to 200 compact rows for about a cent, and is more reliable than a
  classifier on rules wording.
- Not done: grounding ids from replies older than the replay window. Decks don't
  need it (the deck check grounds its own resolved cards), but a card grid built
  from a much older reply may need a fresh search.
