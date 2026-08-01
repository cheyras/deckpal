# B2 · feat/engine-modern-rules

**Wave 2.** Worktree: `~/pokedex-worktrees/engine-modern-rules` (create when B1 merges) ·
Depends: B1 (its gap analysis is your requirements doc). Dev server: none. Spec: §3 Wave 2.

## Mission
Close the B1 gap analysis at the *rules* level — no card-specific work. When this merges, the
engine speaks Standard 2026's rulebook.

## Scope
- [ ] Work items = exactly the B1 gap-analysis list. Expected shape (verify against the doc,
      not this plan): current-form Pokémon ex + multi-prize KO rules; current first-turn rules
      (who can attack/play supporters when); Ace Spec + Technical Machine conventions; current
      status-condition + ability timing; current Stadium semantics; anything else B1 flagged.
- [ ] Rule-level tests per gap item (pure, CI-safe) — constructed states asserting the rule,
      not card behaviors.
- [ ] Where card text underdetermines timing/replacement interactions, check official rulings
      and cite them in comments (the B3 SKILL will formalize this; start the habit here).

## Done gate
Every gap-analysis item has passing rule-level tests or a written deferral (with Chey's ack for
anything deferred). CI green.
