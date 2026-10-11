# Pathways brief — what each Deck-E pathway must make him do

Source material for the pathway files (`apps/api/src/decke/pathways/*.md`).
Each pathway is a template, not a script: a goal, what to know first, a few
branches by condition, a definition of done, and the traps. Domain facts come
from the 2026-10-10 research (PTCG Live log grammar, game-review practice,
deck-building method, Limitless data); harness rules from §2 of PLAN.md.

Shared rules every pathway inherits (they live in the core prompt):

- **Look before asking.** Anything DeckPal can tell him (their decks, versions,
  results, collection, prices, card text) he looks up. He asks only for what
  only the reader knows, and only when the answer changes the work.
- **Ask with the card, not a questionnaire in prose.** `ask_user`, one card per
  turn, 1–4 questions, after the cheap lookups. If they skip, proceed on stated
  assumptions.
- **Show progress with content.** One line before the first batch of lookups;
  after each batch, one or two sentences with something concrete he found and
  what's next; then the answer.
- **Card text, legality and prices come from tools, never memory.** Research
  (`web_research`) is for what changes: the meta, events, rotation, new sets,
  archetype popularity. Date-stamp anything about the meta.
- **Depth costs money; spend it where it pays.** Quick for routine work; consult
  or Standard when the work is one hard judgment; offer Deep Think only when the
  rubric says the request truly benefits, with the reason.
- **Definition of done is checked, not felt.**

---

## battle_log — log a game (PTCG Live paste, in-person report, or just a result)

**Goal:** the game is on the right deck and version with the right result, and
the note is worth reading in a month — at the depth this game deserves.

**Branches by input:**

1. *PTCG Live paste* (detected by the server; `add_battle_log` with `log:
   "@pasted"`). The log is the richest source there is. Read the digest (first/
   second, mulligans, prize timeline, opponent's cards seen → archetype guess,
   end reason). Identify the reader's in-game name from the log or ask once if
   the log can't tell.
2. *In-person / typed report* ("lost at locals to a guy spamming Night Joker").
   Thin. Before logging, enrich it: one ask card with 3–5 debrief questions,
   chosen for this game (skip what they already said):
   - opponent's main attacker and other Pokémon / notable Trainers seen
   - went first or second; any mulligans
   - how the prizes went (who took the first KO; final score)
   - the play that frustrated them most
   - a turn they'd replay / where they think they misplayed
   - did they whiff something key (Supporter, Energy, evolution, gust)?
   If the opponent's deck is unclear, a quick `web_research` for archetypes that
   match the cards they named, offered as options on the card ("Did they play
   any of these?").
3. *Just a result* ("log a win vs Dragapult") — log it with what's known, offer
   (don't push) one question if it was close or a deck they keep meeting.

**Which deck:** if they didn't say, let `add_battle_log` (no `deck_id`) rank
their decks; pick the best match and raise the card — the card is where they
confirm. Never ask "which deck?" in prose when the ranking can answer it.

**Review depth (decide, then say which in one line):**

| Depth | When | Who writes the note |
|---|---|---|
| Light | lopsided game, a no-Basic / dead-draw loss, an early concede, a mirror they've logged plenty | Quick tier: 2–3 lines — result, the one thing that decided it, nothing invented |
| Standard | close game (prizes within 2), decided by a few decisions, the reader asks "what went wrong?", or a self-report with a clear turning point | consult (Sonnet) on the digest: turning point, cause category, one lesson |
| Deep | an archetype new to this deck's logs; an archetype they've met ≥3 times; a losing streak vs one deck; they ask for a real breakdown | offer **Deep Think** (+ research on the archetype) with the reason |

Facts that feed the decision come from tools: `battle_logs` for this deck (how
often this archetype appears, recent record vs it), the digest (prize gap, end
reason), and — for "is this archetype common?" — `web_research` (dated).

**The note (two voices, kept apart):** what the reader said, in their words;
then Deck-E's read: cause category (variance / misplay / list / matchup), the
turning point (turn + what happened), one matchup lesson ("vs X, bench only two
Basics"), one list lesson when there is one ("wished for a 3rd Boss's — watch
it over the next few games"). Unknowable things (opponent's hand, their prizes)
are said to be unknown, never guessed.

**Done:** logged on the right deck/version (card approved), result right, note
at the chosen depth, and he tells them the battle number, the version it went
on, and the deck's record now.

**Traps:** re-typing the log (never — `@pasted`); logging to the wrong deck
without the card; analysing for paragraphs when the game was a nothing-burger;
inventing opponent cards; explaining damage/prize oddities without looking up
the card text (passive effects aren't in the log).

## battle_review — what are my results telling me? (one game or many)

**Goal:** an honest read of results with evidence, and at most two things to try.

- Pull `battle_logs` (and `deck_history` per-version W/L). Group by opponent
  archetype; show record per archetype with sample sizes.
- Say plainly when a sample is too small to mean anything (a 60% record over 20
  games is anywhere from ~39% to ~78%).
- Classify losses (variance / misplay / list / matchup) from notes and digests;
  look for repeated "wished I had X" and dead cards.
- Matchups they'll meet often matter most: weight by how often they actually
  meet each archetype (their logs), and — if useful — current meta share
  (research, dated).
- **Tier:** Standard. Offer Deep Think for a whole-season review or a
  tournament prep with research.
- **Done:** per-archetype record, the 1–2 patterns that matter, one or two
  concrete next steps (play or list), each tied to specific logs.

## deck_build — build a deck *with* them

**Goal:** a legal 60 they're excited about and understand, built collaboratively.

- **Intake (ask card if unknown and not inferable):** format (Standard /
  Expanded / GLC; Live or paper), goal (casual, league, an event), budget or
  "only cards I own", playstyle or Pokémon they love, how much they'll practise.
  Look up what they own before asking about it.
- **Route:** competitive + limited practice time → start from a proven list
  (research current lists, dated) and adapt; budget → a deck that already works
  cheaply rather than a budget copy of an expensive one; "from my cards" → build
  from the collection, say what's missing and what it costs; rogue/fun → from
  scratch, honest about the trade-offs.
- **Skeleton sense:** ~20 Pokémon / 30 Trainers / 10 Energy ± a few; enough
  Basics (12 Basics ≈ 81% to open with one; 8 ≈ 65%); 4–9 draw Supporters;
  2–4 gust; Items that search. Use these to explain choices, not as law.
- **Check loop:** `check_deck` → fix what it flags → `check_deck` again → show
  with `showDeck`. Never type the list as text.
- **Collaboration beats:** propose a direction before a full list when the
  intake was thin ("Two ways to go: … which sounds more like you?"); after
  showing, ask what they'd change.
- **Tier:** Standard floor. Offer Deep Think for tournament prep that needs a
  meta read + matchup reasoning.
- **Done:** `check_deck` legal at 60, every card id grounded by a lookup, the
  2–3 key choices explained, cost/missing cards stated, the reader invited to
  react; saved only when they press Save or approve `save_deck`.

## deck_iterate — a new version from results

**Goal:** the next version is justified by evidence and recorded as a version.

- Read `deck_history` (versions with W/L) and the battle logs since the last
  change. Per-archetype record, sample-size honesty.
- Propose at most two changes at a time (one in, one out), each tied to logs
  ("dead in 4 of 6 losses", "wished for it 3 times").
- On OK, save via `save_deck` with a `version_note` saying why; `deck_history`
  shows the line. Building "off v1" is `deck_history` revert, then edits.
- **Tier:** Standard.
- **Done:** a new version saved with a note that cites the evidence, and what to
  watch in the next games.

## collection_plan — finish a set / master set, on a budget

**Goal:** a concrete plan: what's missing, what it costs, the cheapest path.

- Define the target (standard set, full set incl. secret rares, master set incl.
  reverse holos/variants) — ask only if unclear.
- `set_progress` for missing + cost to finish (from DeckPal prices). Singles
  beat packs for specific targets; sealed is a gamble (no official pull rates —
  say so; never invent EV).
- Offer to make a list (`edit_list` add_missing with a max price) and a cart
  (`set_cart`). Chase cards: `card_price_history` for trend, with its grain rules.
- **Tier:** Quick. **Done:** missing count, cost to finish, the plan, list/cart offered.

## lists — make or edit lists

- Want lists, trade lists, "missing from X under $Y". Write via `edit_list`
  (approval). Summarise what's in it and what it would cost.
- **Tier:** Quick. **Done:** list written (card approved), contents summarised.

## price_value — what's it worth, what moved

- Numbers only from tools (`get_card`, `search_cards`, `collection_value`,
  `card_price_history` and its claim rules). Cheapest printing when relevant.
- **Tier:** Quick. **Done:** the number(s) with their source and date grain.

## card_rules — card text and rulings

- Text from `get_card` / `search_cards` (text and damage filters), never
  memory; same-name cards disambiguated (N's Zoroark ex ≠ Zoroark ex).
  Rulings beyond card text → research, cited and dated.
- **Tier:** Quick.

## research — meta, archetypes, events, rotation

- `web_research` with a reader-facing purpose; scoped to what changes; dated;
  sources shown. Standard is H/I/J since 2026-04-10 (re-check: rotations land
  around April). Not for card text or legality DeckPal already has.
- **Tier:** Quick (Standard if the reader wants analysis on top).

## navigate — take me there / show me

- The existing navigation guidance (goTo vs escort/journey, selectors, route
  shapes) moves here from the core prompt.
- **Tier:** Quick (effort low).

## small_talk

- Warm, short, in character; no tools unless asked; no unrequested offers.
- **Tier:** Quick (effort low).
