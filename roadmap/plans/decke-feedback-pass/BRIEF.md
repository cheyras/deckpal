# Deck-E feedback pass — brief (2026-09-29)

The owner planned a deck with Deck-E and asked him for a card list, on build
#267 (Claude Sonnet 5.5, the chat overhaul). They said the experience was "a
night and day difference", and then listed what is still broken. This pass
fixes those problems. Every lane reads this file first.

## The owner's feedback (verbatim, trimmed)

> he ended up not being able to save the deck, so I ended up having to paste
> the list he came up with into claude to have claude save the deck. So this is
> a pretty big failure.

> We also need to make sure Deck-E is writing a decent strategy guide when he
> creates a deck - or at least offering to write one - he's done the research,
> let's make sure he creates the strategy guide from his information.

> On the animation front, he still mostly sits there in idle pose while
> working. I'd like him to vary up [his poses while he works].

> I asked him to make me a list of cards that do multiplied damage based on
> coin flips. He went straight to online research even though I think this is a
> question he could have answered from DeckPal's data. He also only added 7
> cards to the list ... I asked him to add more and he only added 3 more ... in
> my mind it was implied that it should be fairly comprehensive.

> The approval cards' text still seems too deterministic in not great ways.
> After I had asked him to create a list, the card that came up said "Can I
> change this list?" - Changing an existing list wasn't what we were doing.

> it would be nice if when what the permission card is asking is whether he can
> create a deck, or create a list, or edit an existing deck or list, that there
> is some actual small designed visual in there to give a quick sense of what
> he's adding. No need to make it full screen but to at least show a few of the
> cards he's adding with the ability to make it bigger and show the whole list
> with small thumbnails visually (if a new deck or list) or to see the whole
> diff (if editing existing).

> After he made the list, he brought up a nice chat widget which is a good
> thing. Following up on a permission block by showing the same list but bigger
> is not a bad thing.

> I am still not seeing the thumbs-up/thumbs-down ratings on responses.

> Perhaps we need a tool to more rapidly look at many cards or have many cards
> return at once in a list to him in the db? ... better matching based on any
> number of searches - where he can get a large list and then quickly run jev
> on it to rule out any of the returned cards that don't match.

## What the transcripts show

### Chat 1: "Let's plan a fun new deck" (7 turns, build #267)

- **Turn 3.** He built a legal 60 ("Hide & Seek Dragapult"). `showDeck` failed
  with "Couldn't show that deck — some cards weren't verified", so he printed
  the list as text.
- **Turn 4.** The owner said "Save it as a deck, yeah". `showDeck` then failed
  twice more with the same summary, even though `check_deck` passed ("Checked
  60 cards (standard): LEGAL").
  - He replied: "I couldn't save it, sorry. The deck card refused to render
    three times ... **I also don't have a working save tool in this chat**, so
    nothing has been written to your decks."
  - `save_deck` exists. He never tried it.
- **Turn 5.** The owner had Claude (over MCP) save it. He browsed decks, said
  "Two could be it, so I'll open them and compare." — and the turn ended without
  opening anything.
- **Turns 6–7.** Still unresolved. The mutation log reported "No operations
  match".

### Chat 2: "Build me a list of standard legal cards that have multiplier moves where a run of coin flips multiplies damage" (3 turns)

- He researched the web, then called `search_cards` by NAME for Pokémon he
  guessed (Hoothoot, Pikachu, Vespiquen, Simisear, Chespin, ...) and
  `get_card` one card at a time.
- He created a list of 7, then 10, then 16 cards, and still said "I can't
  honestly call it complete". In his own words: "DeckPal's search only matches
  card names. It can't search attack text. So I can't ask it for every card
  that flips coins for damage per heads. I had to guess candidate names."
- Both times he drew a panel, it dropped cards: "The grid shows six of them" (of
  7), and "The panel only drew 10 of the 16 (the display dropped six IDs)".

## Root causes, from the code (main at c37f57ac)

1. **Card grounding is per turn.** `showDeck` (`apps/api/src/decke/tools.ts`
   ~938–1021) and `sanitizeScreen` (`screens.ts` ~418) only accept card ids "a
   tool actually returned THIS turn" (`grounding.ts`). The owner's "Save it"
   started a new turn, so ids from the previous turn failed.
   - `showDeck` also rejects an id when `check_deck` resolved that line to a
     different printing (e.g. the one the reader owns), because it compares the
     ids the model passed with the ids check_deck returned.
   - If `opts.checkDeck` throws, every id is "unverified" and the summary lies.
   - The same rule dropped 6 of 16 cards from the list panel.
2. **Saving is steered to the widget only.** The prompt (`prompt.ts` ~691)
   prefers the widget's Save button, so when the widget will not draw he
   concludes he cannot save. `save_deck` (`packages/agent-tools/src/tools/decks.ts`
   478–747) is not atomic: it does `POST /decks`, then one `POST /decks/:id/cards`
   per card, each in its own transaction. A mid-way failure leaves a partial
   deck, and a retry creates a duplicate. It does not check legality on create.
3. **No text search.** `search_cards` (`catalog.ts` 127–254) filters
   `unaccent(c.name) ILIKE` only. Attack and ability text live in `card_attack`
   (`card_id, ord, cost, name, damage, effect`) and `card_ability`
   (`card_id, ord, name, kind, effect`) (migration 049) and are read only by
   `get_card`, one card per call.
   - Every tool result is clamped to 6,000 characters (`adapters/aisdk.ts` ~448).
   - An empty search tells him to "Research that question first".
4. **Approval headline is a fixed per-tool phrase.** `edit_list` creates and
   edits, and the headline comes from `APPROVAL_PHRASE.edit_list = 'change this
   list'` or the server preview's `def.title` ("Create or edit a card list").
   Neither looks at `mode`/`list_id` (`approvalCardState.ts` 185–228;
   `useDeckeChat.ts` ~2176, 2392, 2430; `aisdk.ts` ~938).
   - The body already knows ("CREATE a new … list called 'X'", `lists.ts` 499,
     509).
   - List previews render as plain text with no art: the `add <label>` lines
     don't match the `dryRun.ts` pattern.
   - `deck_strategy` shows no preview at all.
5. **Thumbs render as grey arrows.** `Feedback.tsx` uses `arrow-up`/`arrow-down`
   icons (Icon.tsx has no thumb), 27px, muted, with no label. They are hidden on
   the latest reply while busy, and they never appear in History
   (`TranscriptView.tsx` prints static text only when a vote exists).
6. **Strategy guides are never offered.** The prompt says "Save a strategy
   guide only when they ask you to save one" (`prompt.ts` ~689). No
   deck-building step offers one.
7. **Work poses get switched off.** `useDeckeChat.ts` ~539 returns early once
   `express` has moved him (`movedRef.current`), so every later work pose is
   suppressed. A long reply is just `thinking` plus the talk mouth.
   - The playbook has 27 states (curious, loading, card_show, card_stash,
     card_present, point, travel_point, nod_yes, alert_star, alert_money, ...),
     driven by `host/activityAnimation.ts`.

## Design decisions for this pass

- **Search** (the orchestrator's recommendation; the owner agreed to build it):
  - `search_cards` gains a `text` filter over attack name and effect, and
    ability name and effect.
  - It returns compact rows: name, set, id, the matching attack or ability
    line, and owned count. Reprints of the same card text collapse to one row
    with a printing count and a preferred printing (owned first).
  - A text search returns up to ~200 rows in one call. Its tool-result cap is
    raised so those rows are not truncated.
  - Deck-E filters the rows himself; there is no Jev pre-filter in this pass.
  - The prompt tells him that card-text questions ("which cards do X") are
    answered from DeckPal, not the web, and that "list"/"every"/"all" means
    comprehensive.
- **Grounding** (as built: dotted ids fixed; only real tool results ground — see the decision record) accepts any card id a DeckPal tool returned anywhere in the
  conversation, including the replayed evidence of earlier turns. `showDeck`
  accepts an id when check_deck resolved that line, and renders the resolved
  printing. A check failure says so plainly.
- **Saving:**
  - `save_deck` becomes one all-or-nothing write. Retrying the same list does
    not duplicate the deck. The widget is a convenience, not the only route.
  - If `showDeck` fails, he saves with `save_deck`, and never tells the reader
    he has no save tool.
  - After a deck saves, he offers to write the strategy guide from the research
    already in the conversation, and writes it with `deck_strategy` on "yes".
- **No announcing then stopping.** He must not end a turn by announcing an
  action he has not taken ("I'll open them and compare"). He either does it in
  the same turn or asks.
- **Approval card:**
  - The headline follows what the call actually does: create a list / add to
    a list / remove from a list / create a deck / change a deck / save a
    strategy guide, including the target name.
  - Create and edit calls for decks and lists show a thumbnail strip (about 6
    cards and "+N more"). It expands inline to the full set as small thumbnails
    (new) or a diff of added and removed cards with counts (edit).
  - `deck_strategy` shows the guide text (collapsible).
- **Thumbs:**
  - Real thumb icons, visible (not muted-invisible), with accessible labels.
  - They appear on every finished reply, and in History, where the reader can
    still rate a past reply.
- **Animation:**
  - Work poses keep playing after an `express` gesture.
  - During long work he cycles through fitting poses instead of holding one
    (e.g. `card_show` while searching cards, `card_stash` while saving,
    `loading`/`curious` during research).
  - Reduced-motion behaviour is unchanged.
