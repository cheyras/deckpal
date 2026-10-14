---
date: "2026-10-14"
title: "battle_turn_review: the simulator's strongest pilot ranks the reader's options on a turn, as a DeckPal tool"
decided_by: "Chey (via Claude)"
areas: ["agents", "decks"]
supersedes: []
---
## 2026-10-14 — battle_turn_review: the simulator's strongest pilot ranks the reader's options on a turn, as a DeckPal tool
**Decided by:** Chey (via Claude)

**Decision:** A read-only tool, `battle_turn_review` `{ deck_id, log_id, turn, player_name? }`, is backed by `GET /decks/:id/logs/:logId/turns/:turn/review` and `reviewTurn` in `packages/sim/src/replay/turnReview.ts`. It works in four steps:
1. **Replay to the turn.** The stored log is replayed to the reader's first main decision of the turn, and the position is copied. Both decks are then rebuilt to their real size: 60 less every card out of the deck, the Stadium in play included. The reader's deck is rebuilt from the deck version the game was logged against, count for count less the copies already out. Listed cards the log never showed are built from the list (by printing code, else by name), so the search can draw them. Cards are counted by game text, not name: two printings of one name with different text are two cards, and two entries of one reprinted text are one card with both quantities. Without a list, the deck is estimated from the cards the log showed.
2. **Wide search.** The simulator's own-turn search (the pilot its games are played with) runs over three determinised worlds. Each world resamples the opponent's hand, deck and Prizes, and the reader's deck order and Prizes, so the search never sees what the reader could not. This search shortlists the best first actions.
3. **Focused search.** Each shortlisted first action, the reader's own always among them, gets a search of its own from the position it leads to, with the same budget in the same worlds. Best-first search otherwise leaves a quiet opening unexplored: on a real game it put the reader's Stadium-then-3-Prize-attack turn 13.7 Prizes "behind". With the focused search it ties the best.
4. **Report.** For each option the tool reports:
   - its first action;
   - its line through the end of the turn, in one sampled world;
   - the Prizes it takes and the Pokémon it Knocks Out;
   - how far behind the best it is, in Prize cards of the engine's evaluation.

   The answer ends with a plain verdict and the caveats.

**Other details:**
- **Seed.** It is seeded, so a stored game's review does not change from call to call.
- **Side.** The reader's side follows the digest's order: the explicit name, then the PTCG Live name, then the stored owner, then the deck.
- **Rate limit.** 20 a minute per user, on its own bucket, because it is CPU-bound: about 0.3–0.5 seconds a turn in testing.
- **Deck-E.** Deep battle reviews call it on the one or two turns that decided the game. Options within a third of a Prize are equal, and a reasonable play is never called a misplay on its word alone.

**Why:** The owner asked (2026-10-13) why Claude over MCP could not use the simulator's own evaluation of the plays available on a turn. It can, once that evaluation is a DeckPal tool rather than something only the simulation page runs. In the owner's tests the judgement gaps were in exactly this place: Haiku could not tell a misplay from a reasonable line. A rules engine that plays the turn out is the cheapest grounding for that judgement, and it is the same answer for Deck-E and every MCP client.

**Implications:**
- **An opinion, not an oracle.** The pilot is a strong heuristic player (51.7% against the previous pilot, #331). The tool says so, and says how many hand cards the log never showed and the search had to guess.
- **Turns it cannot reach.** A turn the replay cannot reach (an unscripted card, a divergence) is answered with the reason, not an error. So is an opponent's turn.
- **Tool count.** Adding the tool raises the MCP read-tool count by one, and every document that states the counts was updated in the same change.
