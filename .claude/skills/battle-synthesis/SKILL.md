---
name: battle-synthesis
description: Synthesize stored PTCG battle logs into retrieval-oriented narratives plus structured fields (archetypes, tags, key cards) via the rotom-mcp synthesis_queue / save_synthesis tools. Use when the user asks to synthesize battle logs, work the synthesis queue, backfill battle narratives/embeddings, or re-synthesize a corrected game. Chat-driven by design — Claude reads the raw log, writes the synthesis, the server only normalizes archetypes and embeds.
---

# battle-synthesis

Battle intel is chat-first (BATTLE-INTEL-SPEC): the server never calls an LLM. **You** are
the synthesizer — `synthesis_queue` hands you raw logs + parser output, you write the
narrative and structured fields, `save_synthesis` normalizes and embeds them. The narrative
you write is what `battle_search` retrieves later, so every sentence should earn its place
in a semantic search over "games like this".

## Workflow

1. `synthesis_queue` — the worklist (logs missing narrative, archetypes, or embedding).
   Default page has 3 entries with full raw logs; work a page at a time.
2. **Read the raw log yourself.** The parser output is a summary, not the truth — the raw
   log has draw reveals, mulligans, and the actual line-by-line flow. Ground every claim
   in it; never synthesize from the parsed fields alone.
3. `save_synthesis` with `dry_run: true` (the default) — check the merged fields, archetype
   normalization, and word count.
4. Re-run with `dry_run: false` to commit. The server embeds the narrative via local
   ollama; if ollama is down the save still lands and the embedding is flagged **pending**
   — re-run later with just `log_id` to embed (omitted fields keep stored values).
5. Repeat until `synthesis_queue` reports the honest empty state.

Re-synthesis is idempotent: re-saving replaces the narrative *and* its embedding cleanly.
To fix one field, pass only that field.

## The narrative (~150–300 words, written for retrieval)

Cover, in rough order — as flowing prose, not headed sections:

- **Matchup:** both archetypes and who was favored on paper, if known. Name the decks in
  the first sentence — retrieval queries will.
- **Opening quality:** who went first, hand quality both sides as far as the log reveals
  (mulligans, dead cards, turn-1 setup), whether the opening dictated the game.
- **Key turns:** the 2–4 turns where the game actually moved — name the turn number, the
  play, and what it changed (board, prizes, tempo).
- **What decided it:** the single clearest cause of the result — a whiffed energy, an Iono
  to 1, a bad promote, a prize-race math error. Be specific enough that a future "why do I
  lose this matchup" search hits it.
- **Notable lines:** anything reusable — a line of play worth repeating, a misplay to
  avoid, a tech card that mattered, what you'd do differently.

Style rules: past tense, concrete card names, turn numbers over vague sequencing, no
filler ("it was a close game"), no invented details — if the log doesn't show it, don't
claim it. Write "I/my" for the deck owner's side, matching the log's perspective. The
structured fields carry the categorical facts; the narrative carries the *story and the
why*. 150–300 words is the target; under 50 or over 500 is refused.

## Structured fields

- **my_archetype / opp_archetype** — stored as canonical **slugs** from the archetype
  registry (`archetype` + `archetype_alias`, FK-enforced). You may pass the slug
  (`dragapult-dusknoir`), a registered alias, or the display name — `save_synthesis`
  normalizes to the slug and **rejects unknown labels with suggestions rather than
  inventing** (matchup stats group on these slugs; unclassified rows are reported, never
  dropped). If a genuinely new archetype shows up, register it first, then re-save. When
  the opponent's list is ambiguous, pick the closest registered archetype the log supports
  and note the uncertainty in the narrative.
- **tags** — lowercase kebab-case, reusable across games, ≤12. Prefer established ones
  (reuse what earlier syntheses used — check stored fields on queue rows) e.g.
  `prize-race`, `bad-opening-hand`, `donk`, `comeback`, `bricked`, `time-called`,
  `misplay-decided`, `energy-drought`, `went-first`, `mirror`.
- **key_cards** — the ≤12 cards that actually decided the game (either side), exact card
  names, not the whole list. "Iono" belongs here when Iono won the game, not because it
  was played.
- **ai_generated** — a co-hosted app discipline, carried by `battle_log.source` (writer
  attribution): `true` if you wrote or paraphrased any of the narrative (the normal case —
  stamps `rotom-mcp`); `false` ONLY for the user's verbatim text (stamps `user`). When in
  doubt, `true`. This gates any future personal-voice use — contamination is irreversible.

## Honesty rules (standing, from the spec)

- Sample sizes are what they are — never pad a narrative to imply more games or certainty
  than exist (~10 logs is the current corpus; "n=4" is a correct answer).
- A `NO RESULT` log stays uncertain in the narrative unless the raw log shows the ending;
  fix classification with `edit_battle_log`, not by asserting a result in prose.
- Pending embeddings are visible in `synthesis_queue` — never consider a log finished
  until the queue says so.
