> **Predates the cloud pivot -- re-scope before executing.**

# B3 · feat/card-dsl

**Wave 3 — the load-bearing feature of the whole engine track.**
Worktree: `~/pokedex-worktrees/card-dsl` (create when B2 merges) · Depends: B2.
Dev server: none. Spec: §3 Wave 3, §7 (deckgym-core, rulings sources).

## Mission
Card text → implementation becomes a mostly mechanical translation an agent performs. The DSL,
its SKILL, and both of Chey's decks implemented card-by-card with tests.

## Scope
- [ ] **DSL design**: a primitive vocabulary (search, switch, attach, damage modifiers, status,
      coin flips, effect durations, triggered abilities, replacement effects, prize
      manipulation…) such that a card implementation is a declarative composition with
      escape-hatch hooks for genuinely bespoke effects. Build on what B1 found in `@ptcg/sets`
      (declarative where it already is; don't rewrite what works).
- [ ] **`card-implementation` SKILL.md** (steal deckgym-core's document shape): primitive
      catalog, worked examples across effect categories, escape-hatch policy, rulings-check
      step — any effect touching prevention/replacement/timing windows gets a rulings lookup
      and a citation comment (verify the compendium's canonical location at build time).
- [ ] **Per-card tests are part of the definition of done**: a card isn't implemented until at
      least one scenario test asserts its effect in a constructed game state.
- [ ] Implement **both of Chey's current decks, all 60 cards each** (query deckpal-mcp/DB for the
      lists). `card_impls` rows maintained (`implemented|needs_ruling|blocked` + refs).
- [ ] Validate the SKILL: at least one card implemented by a fresh subagent from the SKILL.md
      alone, no other guidance — fix the doc until that works.

## Done gate
Both decks' full 60s implemented, tests green in CI; `card_impls` ledger accurate; the
fresh-agent SKILL test passed.
