# "Ask Deck-E" in the decklist import: design memo

*Status: design only, paused 2026-09-26 before any code. Stacked on #216 (fix/deck-builder-data), which added the
import check (`POST /decks/import` with `dryRun`, unmatched lines listed with Edit / "Import without it" / Cancel).*

## The request

In the import dialog's unmatched-lines panel, a fourth option: **Ask Deck-E**. It does not open the chat. He appears,
stands beside the faulty lines, rewrites each one into a line that matches a real card, and under the list asks
**"Does this look correct?"**. Confirm imports everything, fixed lines included.

## 1. Why lines fail today (from reading the parser and resolver; not yet measured)

Read from `apps/api/src/deck/ptcgl.ts` and `apps/api/src/deck/db.ts` on #216's tip (ec22560). Every class below is a
hypothesis until the corpus run in section 7 measures it.

| Failure | Example | Why | Fix |
|---|---|---|---|
| PTCGO legacy export | `* 4 Pikachu SSH 65`, `##Pokémon - 13`, `Total Cards - 60`, the `******` banner lines | A card line must start with a digit; the header regex wants `:` | Parser (free) |
| Quantity written differently | `Iono x4`, `x4 Iono`, `4 x Iono`, `- 4 Iono`, `• 4 Iono` | Same leading-digit rule | Parser |
| Lower-case or glued set code | `4 Iono pal 185`, `Iono PAL185`, `Iono (PAL 185)`, `Iono PAL #185` | `SETCODE` is upper-case only; set/number must be the last two tokens | Parser |
| Letter-and-number collector numbers | `Pikachu VMAX CRZ GG30`, `Pikachu BRS TG05`, `PR-SW SWSH001` | Number must be all digits, so the set is not split off and the name is polluted | Parser + subset mapping (`CRZ`+`GG` = `CRZ-GG`) |
| Accents and punctuation | `Pokemon Catcher`, `Pokegear 3.0`, `Buddy Buddy Poffin`, `Farfetchd`, `Charizard-EX` | `normalizeName` folds case and curly apostrophes only | Resolver: accent- and punctuation-insensitive name key (unaccent + trigram index I6 already exist) |
| Promo codes outside the alias table | Limitless `SP 167` (SWSH promos), `SVP 045` | Not in `ptcgl-set-alias.json` | Alias rows; name-only fallback already rescues identity |
| Typos, nicknames, other languages | `Charizrd ex`, `Boss`, `Prof Research`, `Glurak-ex` | No exact or loose name match exists | **Deck-E** (choose among real catalogue candidates) |
| Wrong number for a real set | `Iono PAL 999` | Exact step fails; the name-in-set step needs exactly one print | Deterministic when the set has one print of that name; **Deck-E** or the print rule otherwise |

Two resolver behaviours that are not "unmatched" but violate the printing principle (section 3):

- **Name-only lines can resolve to a TCG Pocket card.** `loadByName` filters `lang='en'` only, and Pocket cards are
  English too. `4 Iono` in Standard has no H/I/J print, so the resolver falls through to "newest release", and the
  newest Iono in the catalogue is Pocket's `A2b-069` (2025-03-27) rather than Paldean Fates (2024-01-26). *To be
  confirmed against a catalogue snapshot.*
- **Name-only lines take the newest legal print, which can be a Special Illustration Rare.**

Real formats sampled for the corpus (scraped read-only from limitlesstcg.com: (not committed),
six lists from 2020 to 2025): Limitless writes basic Energy as `Psychic Energy SVE 5`, promos as `SP 167`, and names
with punctuation as printed (`Buddy-Buddy Poffin`, `PokéStop`, `Technical Machine: Evolution`,
`Arceus & Dialga & Palkia-GX`). PTCG Live writes `Basic {P} Energy SVE 5`-style lines and `PR-SV` promos.

## 2. Grounding: Deck-E never invents a card

- **Candidates come from code.** For each unmatched line the server builds up to about 8 options from the catalogue:
  the card at the stated set+number if one exists (the name was wrong), trigram neighbours of the name
  (`name_normalized % $1`, the scanner's query in `scan/catalogPort.ts`), and whole-word matches (`Boss` →
  `Boss's Orders`). One option per distinct card name, plus **none of these**.
- **The model only chooses.** Its answer is an option key. Anything else is "couldn't fix". The server then re-runs
  the real resolver on the rewritten line and keeps the fix only if it lands on exactly the chosen card id, the same
  membership idea as `decke/grounding.ts`. A test asserts no response can contain a card id that was not a candidate.
- **Jev or the chat model?** Jev (`typesafe-ai/jev`) answers "pick one of these" with a probability in 0.1–0.5 s for
  about $0.0001 per list; that is this exact shape. #225 already carries a Jev client (`decke/jev.ts`, switch
  `DECKE_JEV`, zero-data-retention per call). Plan: Jev first, the chat model (`MODELS.chat`, structured output
  restricted to the option keys) when Jev is off, slow or unsure, and deterministic top-1 as the baseline both must
  beat. **Decision deferred to the measured eval** (section 7): accuracy, false-fix rate, latency and cost on
  synthetic lists, spend cap $1. Because #225 is not in this branch's base, the Jev call is either written against
  #225's `evaluate()` (merge order #225 → this) or this PR ships chat-model-only and a follow-up switches it on.

## 3. Which printing

Chey's principle: an identical reprint is fine; a different art or rarity is not, unless we say so.

- A line that names an existing print is never changed.
- A line with no print, or a print that does not exist: `choosePrint()` (new, `apps/api/src/deck/printChoice.ts`)
  keeps the chosen card's `playable_fingerprint` (never mixes different cards), excludes TCG Pocket, then prefers a
  print the reader owns, then a legal-in-format mark, then the lowest rarity (`RARITY_RANK` in `apps/api/src/rarity.ts`),
  then the newest. The reason line says what happened: "No set given, so I used Iono PAL 185, the regular print."
- Coordination: feat/deck-equivalent-prints (not on origin yet) is adding migration 076,
  `card.identical_print_group` (same fingerprint, rarity, illustrator and artwork hash). When it lands, the "owns"
  preference narrows to the same group. Agreed with that lane by message on 2026-09-26.

## 4. The moment (UX)

- **Where he stands.** Deck-E's canvas is `z-30`; modals are `z-100`, so today he would be hidden under the dialog.
  The existing mechanism for "stand here without covering anything" is a landmark box sized to his silhouette
  (`PARK_LANDMARK`, `SILHOUETTE` 1.28 × `SILHOUETTE_ASPECT` 0.76 in `DeckeChat.tsx`; #220 extended it to approval
  cards and the Top-up button). Plan: the panel reserves a small **bay** in its header row (about 72×92 px at 390,
  larger at 1440), marked `data-decke-errand`. A tiny store (`character/host/errand.ts`, no dependencies, main bundle)
  lets the dialog summon and release him. `DeckeHost` handles an errand like a chat entrance with a different mark:
  grow from the launcher chip, fly to the bay with `centre: true`, re-park when the bay moves (the same `markWatch`
  rules), raise the canvas above modals only while on an errand, and dive back into the chip when released, with no
  farewell line.
- **Working state.** The bay shows him thinking; the panel says "Deck-E is checking 3 lines…". Reduced motion: he
  cuts instead of flying, and nothing pulses.
- **Before → after, in place.** Each unmatched row becomes: the old text struck through, the new line beside it,
  the card's small art, and one plain reason ("SVI 123 is Scarlet & Violet #123", "Boss is short for Boss's Orders").
  Rows he could not fix stay flagged with #216's Edit and skip options.
- **"Does this look correct?"** under the list: **Confirm and import** plus an **Undo** on every fixed row (it
  restores the original line and its flag). Confirm imports exactly the confirmed cards.
- **Accessibility.** Buttons are real buttons in tab order; an `aria-live="polite"` region announces "Deck-E fixed 2
  of 3 lines. 1 still needs you."; struck text is labelled "was: …" for screen readers.
- **Phone (390 px) first.** The bay sits in the header row, so it covers neither the rows nor the pinned footer
  buttons. The browser test asserts that with bounding boxes.

## 5. Permissions, cost and failure

- **Who sees it.** Only accounts with `decke.use`, the same test the launcher uses (`deckeEntitled()`). Everyone else
  sees #216's dialog unchanged. If the reader has hidden Deck-E (`deckeHidden()`), the button still works; the fix
  happens without his body.
- **Cost: free in credits.** Measured model cost is a fraction of a cent (Jev about $0.0001; the chat model about
  $0.002 for a short prompt), and charging people to repair a line our own parser could not read is the wrong
  lesson. Abuse bound: each fix request uses one unit of the durable daily meter (`chargeSql('chat_turns')`, 120/day
  by default). Accounting: one `decke_ai_request` (charge mode `daily`, no conversation) and one `decke_ai_operation`
  per model call, `tool_key`/`operation_key` `import_fix`, with the Gateway's reported cost. No migration needed.
- **Consent.** The fix is read-only, so no approval card. The import is the write, and Confirm is the consent. This
  fits DECKE-AGENT-SPEC.md: approval cards gate writes Deck-E performs; here the reader performs the write.
- **Failure.** Offline, 429 (meter), 403 (lost entitlement), or a 6 s deadline: he says so in one line in the bay
  ("I can't reach my brain right now. You can still edit these lines yourself."), goes home, and #216's options
  remain. Partial success shows the fixed rows and leaves the rest flagged.

## 6. Not through the chat

A focused endpoint, `POST /api/decks/import/fix` in the Express API: body `{ lines, formatCode }`, response
`{ fixes: [{ original, replacement, card: { id, name, set, number, image }, reason, confidence }], unfixed: [...] }`.
It never writes the deck. It uses the Deck-E Gateway key (`DECKE_VERCEL_AI_GATEWAY_KEY`, dev fallback as in
`api/chat.mjs`).

## 7. Measurement plan (not started)

- Corpus: the six Limitless lists above rendered as PTCG Live, Limitless, PTCGO legacy and handwritten text, plus
  hand-made hard lines (typos, nicknames, foreign names, accents, `ex`/`EX`/`V`/`VSTAR` casing, wrong numbers).
- Catalogue: a snapshot of every print of every name in the corpus, read from deckpal.app's public
  `/api/search` and `/api/cards/:id`, loaded into a scratch Postgres 17 (`/opt/homebrew/opt/postgresql@17`) with
  the real migrations 001–017, so the real `resolveDeck` runs before and after.
- Report: lines resolved before → after the parser work, per format; then on the remainder, deterministic top-1
  vs Jev vs the chat model: correct fix rate, wrong-fix rate, abstentions, p50/p95 latency, cost per fix.

## 8. Things to know when resuming

- #220 (the landmark/park changes in `DeckeHost`) is on main but **not** in #216's branch. pr-deck-bugs will merge
  main into fix/deck-builder-data after #223 and #219 land, and will message; merge that tip before touching
  `DeckeHost.tsx`.
- Browser tests: #220 added WebKit to `.github/workflows/browser.yml` and `checkDeckeStates` to
  `tests/browser/chat.mjs`. Put this feature's checks in a new `tests/browser/deckImport.mjs` to avoid conflicts.
- The Limitless scrape was a read-only sample of six public lists; it is not committed.
