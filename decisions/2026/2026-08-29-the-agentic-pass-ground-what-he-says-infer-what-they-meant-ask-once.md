---
date: "2026-08-29"
title: "The agentic pass: ground what he says, infer what they meant, ask once"
decided_by: "the owner (narrated brief, capture-20260829-092156), executed by"
areas: ["agents"]
supersedes: []
---
## 2026-08-29 — The agentic pass: ground what he says, infer what they meant, ask once

**Decided by:** the owner (narrated brief, capture-20260829-092156), executed by
Claude Fable 5 orchestrating a Ringer swarm (GLM-5.2 workers; Codex was
rate-limited)

**Decision:** One pass, on `feat/decke-agentic-pass`, making the agent surface
match what the owner's claude.ai-via-MCP sessions proved possible. The load
order of the fixes was chosen from this repo's own history — structure first,
prompt last, because prompt-only levers here have twice measured at zero.

1. **Card rules text through the tool surface.** `get_card` now renders
   abilities, attacks, effect text, weakness/resistance and retreat from the
   tables migration 003 always had. The Lucky-Helmet class of wrong advice
   ("it protects your Pokémon" — it draws cards) was structurally guaranteed:
   no tool could show any agent what a card does. Also `set_progress
   all_sets:true` for grounded release-order answers.
2. **Battle-log deck inference, as a read.** `add_battle_log` without
   `deck_id` calls the new `POST /decks/log-preview` and returns ranked
   candidate decks (name overlap + normalized PTCG Live card codes, both
   players scored) — writing NOTHING at any candidate count; the model
   re-calls with the chosen deck and the approval card is where the reader
   confirms (X3). Explicit `result`/`opponent` args now beat the parser
   (battle #34 once listed the owner as his own opponent despite explicit
   args), and a format-drift tripwire forces `confidence: low` when both
   players' overlap is ~zero on a populated parse — the 9237a77 silent
   inversion cannot recur quietly.
3. **Previews for battle-log writes.** `add_battle_log`/`edit_battle_log`
   gained real `dry_run`; only `deck_strategy` remains always-approval. The
   approval-card preview machinery picks them up schema-driven; the editable
   surface stays `log_cards`-only.
4. **Printed set codes are addresses.** `SVI/PAL/TEF/PRE/BLK/MEG/PFL/POR/
   PBL/CRI/…` resolve through `normaliseSetId`, each alias grounded in
   `ptcgl-set-alias.json`, exact-whole-token only. `set_cart` now routes
   `set_id`/`list_id` through the resolvers — it was the last raw-comparison
   holdout.
5. **Ask once about guides, then drop it.** A declined guide write suppresses
   BOTH `deck_strategy` and `write_strategy_guide` by NAME for the rest of the
   conversation (`GuideDeclinedSet`) — the (tool, args) ledger let a reworded
   offer re-ask. And guides must come from evidence: `write_strategy_guide`
   gained a 4,000-char `findings` inlet; when findings are absent or trivial
   the server injects `no_research` into the signed input so the approval card
   states it, and the sub-agent is told to say so in the guide itself.
6. **Prompt revision (UNPROBED).** Data rule 7 (card text is looked up, not
   remembered; battle-log tallies are not card text; reprints do not inherit
   legality), a battle-log playbook, a versioning playbook ("build off v1" =
   `deck_history revert_to:1`, then edits; always name the diff's base), and
   the guide-etiquette line. Gate/probe runs are owed before any wording
   iteration.

**Adversarial review (three lanes) before merge found:** the guide approval
card rendered NO restatement (`deepRequest.ts` read `deck_name`/`deck_id`;
the schema field is `deck` — pre-existing, and it made the new `no_research`
disclosure invisible); the `findings` channel carried web text into the one
write-capable sub-agent without the DATA frame the conversational model gets;
`log-preview` had unbounded per-deck fan-out; and the inference call raised a
misleading approval dialog for a pure read. All four fixed in the same pass.

**Why:** The owner's transcripts show the experience is right when the agent
checks before claiming, infers before asking, confirms on the approval card,
and drops declined suggestions. Every failure class fixed here appears
verbatim in a transcript or in this file's own history.

**Implications:** The MCP surface changed (SPEC.md updated in the same
sitting; `add_battle_log`'s optional `deck_id` is new contract). Live-DB
exercise of the `get_card` rules-text SQL and the WS8 probe runs on a deployed
preview are still owed and tracked in `roadmap/plans/decke-agentic-pass/`.
Deck-E history builds #96-#128 were mined via an owner-authenticated export
the same day; findings feed the next round, not this branch's scope.

