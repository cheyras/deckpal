# Deck-E agentic pass — plan

Origin: the owner's narrated brief (`E:/Users/cheyr/Videos/CursorCaptures/capture-20260829-092156`,
2026-08-29) plus 14 claude.ai-via-MCP transcripts in `Downloads/Claude PTCG Chats`
(13 unique — `conversation_transcript (4).md` duplicates (3)). Goal: talking to
Deck-E should be extremely helpful, on point, and grounded — modeled on what the
Claude/MCP sessions did well, fixing what they exposed.

Recon inputs (2026-08-29, 11-agent sweep): transcript analysis ×3, prior-pass
distillation, Deck-E harness map, agent-tools map, weak-area code dive,
history mine, feedback-storage map, and two industry-research reports. Archived
in the session scratchpad; conclusions inlined below.

## The owner's six asks, and what the evidence says

1. **Deck inference for pasted battle logs** — no tool support today
   (`add_battle_log` requires strict `deck_id`, `deckIntel.ts:290`). The parser
   already extracts `myPokemon`/`opponentDeckGuess` (`apps/api/src/deck/battlelog.ts`);
   the same name-overlap scoring generalized across all the user's decks yields
   ranked candidates. Confirm/deny must ride the approval card (X3: the call IS
   the approval request), not a prose question.
2. **Grounding in real card text (Lucky Helmet class)** — structural, not
   behavioral: the DB has full rules text (`card.effect`, `card_attack`,
   `card_ability`, `card_matchup` — migration 003) and **no tool returns any of
   it** (`get_card` stops at HP/rarity/legality, `catalog.ts:622-627`). The model
   literally cannot check what a card does. Transcript 5's Vengeful-Anchor
   "scaling" claim is the same failure class, live.
3. **Strategy guides always research-backed** — `write_strategy_guide` cannot
   research by design and takes findings via a 300-char `focus` funnel
   (`deep.ts:1178-1186`); nothing requires evidence before a guide write.
4. **Deck versioning ("build v3 off v1")** — machinery exists (`deck_history`
   `revert_to` with dry-run diff predicting bump-vs-amend) but nothing teaches
   the composition, the prompt never mentions versions, and `save_deck` results
   don't state lineage. History is linear (no parent pointer) — this pass is
   conversational fluency, not schema.
5. **Lists reliability** — largely remediated in main (PR #104: mode
   create/edit, `add_missing`, strict writes, restore-from-bin) and the live
   web-side bugs are on `fix/lists-prices-insights` (do not duplicate; its Wave 2
   files are HOT). History lesson: every lists "done" hid one more fault only a
   live probe found — probe the exact "Pitch Black missing at master tier"
   scenario before claiming done.
6. **Suggest-once etiquette** — `declined.ts` keys on (tool, args), so a
   reworded strategy-guide offer re-asks. Needs a name-level per-conversation
   decline for the guide tools.

Cross-cutting from the transcripts: identifier resolution is the biggest tax
(set codes `PAL/TEF/MEG` unmapped; `set_cart` bypasses the resolver entirely —
`shopping.ts:182,186`); explicit `add_battle_log` args lost to the parser
(battle #34 "LOSS vs cheyras"); the trust loop the owner confirms every time is
resolve → dry-run → grouped preview with corrections flagged → explicit confirm
→ result with undo handle.

## Constraints (settled — do not reopen)

- **X2** every status surface renders from real tool results, never model prose.
- **X3** the write call is the approval request; never a prose "Confirm?".
- **Prompt is measurement-pinned** (`prompt.ts:277-435`): wording/position are
  load-bearing; edits are a prompt revision needing probe runs; prompt levers
  measured near-zero twice (printing 100/100→100/100; escort) — prefer
  structural fixes.
- Confirm before every deep call; `[[NO_WORK]]` leads refusals; credits
  hard-stop design stands (flag off, migrations 041/042 not run).
- OR4: no numeric confidence meters — provenance/candidate style only.
- B9/B11/B12; CI needs explicit `test:*` script + `ci.yml` step for any new
  suite; every new test watched failing (mutate → red → restore).
- `fix/lists-prices-insights` owns: `apps/api/src/routes/lists.ts` item-shaping,
  `apps/api/src/routes/cards.ts`, list-view web components, `apps/sync`. Hands off.
- No schema migrations in this pass (nothing below needs one).

## Workstreams

### WS1 — Card rules text through the tool surface (highest leverage)
`packages/agent-tools/src/tools/catalog.ts`:
- `get_card` renders effect text, attacks (cost/name/damage/effect), abilities,
  weakness/resistance, retreat — compact pipe format, from the tables migration
  003 already populates.
- A grounded all-sets listing (release ordering): extend `set_progress`
  overview with an `all_sets` switch (id, name, series, released_on, counts)
  rather than a 24th tool.
- Optional stretch: `get_card` accepts up to ~10 `card_id`s (batch) to kill
  serial-lookup grinds.

### WS2 — Battle-log deck inference + parser truth
- New API: `POST /decks/log-preview` (`apps/api/src/routes/decks.ts`), body
  `{log, player_name?}` → `{parsed, candidates: [{deck_id, name, version, score,
  matched, deck_size}]}` — reuses `battlelog.ts` parsing + overlap scoring
  across all the user's decks.
- `battlelog.ts`: PTCG Live code normalization (`me1_104` → `me01-104`,
  `sv6-5_38` → `sv06.5-038`, `_ph` suffixes) feeding both owner-ID and
  deck-matching; **format-drift tripwire** — when both players' overlap ≈ 0 on a
  log that parsed cards, force `confidence: low` (the 9237a77 lesson, pinned by
  a test with the code-prefixed format).
- Explicit args win: `result`/`opponent`/`opponent_deck` passed by the caller
  are authoritative over parser output (battles #34/#35 both came back wrong
  despite explicit args).
- `add_battle_log` (`deckIntel.ts`): `deck_id` optional + `dry_run` param. No
  deck → returns ranked candidates (resolver-ambiguity doctrine: ≤N candidates,
  never a guess). `dry_run` gives Deck-E's approval card a computed preview
  (parsed result, W/L, target deck, candidates) via the existing
  `onInputAvailable` seam — the owner's confirm/deny prompt, X3-compliant.
  `edit_battle_log` gains `dry_run` for the same reason.
- `apps/api/src/decke/adapters/aisdk.ts`: remove the two tools from the
  no-dry-run list; keep `deck_strategy` always-approval.

### WS3 — Grounding rules (prompt revision, one batch)
Single revision to `apps/api/src/decke/prompt.ts` (+ pinned tests):
- New data rule: never state what a card's attack/ability/tool/effect does, or
  its legality, without `get_card` this conversation; battle-log client lines
  (damage tallies) are NOT card text; never infer legality from set era or
  reprint existence.
- Battle-log playbook: pasted log → infer intent to log; blend the user's own
  words + verified analysis into notes; echo battle #/version/W-L.
- Versioning playbook (WS4) and etiquette line (WS5) land in the same revision.
Live probe measurement happens post-deploy (QA meter budget) — the revision
ships with prompt-test pinning now, probe specs written, gates listed.

### WS4 — Version fluency
- `deckIntel.ts`: `save_deck`/`deck_history` results state lineage explicitly
  ("created v6 from v5" / "amended v5 in place — no battle logs yet");
  descriptions teach "build off vN = `deck_history revert_to:N`, then edit" and
  that the diff is shown against the chosen base.

### WS5 — Suggest-once etiquette
- `apps/api/src/decke/declined.ts`: name-level per-conversation decline for
  `deck_strategy` + `write_strategy_guide` — once refused, any-args re-offers
  are suppressed for the conversation (message tells the model to drop it).

### WS6 — Research-backed guides
- `deep.ts`: widen the findings channel into `write_strategy_guide`
  (`findings` arg, ~4000 chars, replacing the 300-char `focus` funnel for
  evidence); description mandates research-first and says what counts as
  evidence (research_meta output, get_card reads, battle-log data).
- Host check: guide-write approval preview names the evidence provenance
  ("based on: research_meta this conversation + 3 card lookups" / "NO research
  this conversation") so the reader sees ungrounded writes before approving.

### WS7 — Identifier ergonomics
- `entities.ts`: official printed set-code aliases (SVI, PAL, TEF, PRE, BLK,
  MEG, ASC, JTG, SSP, SCR, SVI…) resolving through `normaliseSetId` — sourced
  from `card_set` data where possible, curated map otherwise.
- `shopping.ts`: `set_cart` routes `set_id`/`list_id` through the resolvers
  like every other tool (the one remaining bypass).

### WS8 — Verification
- Watched-failing unit tests per area; suites: `test:deck`, `test:decke` (api +
  web), `test:pure`, agent-tools tests; full typecheck; `check-functions.mjs`.
- Live scenario probes (post-deploy, owner-visible): Pitch Black master-tier
  list end-to-end; battle-log paste with no deck named; "what does Lucky Helmet
  do"; "build the new version off v1". Gate 15 extension spec for
  research-backed guides.

## Out of scope (recorded, not forgotten)
- Schema changes: battle-log notes >2000 chars; version branching
  (parent_version); per-card price history tool.
- Fin-style post-generation claim-validation pass (big feature; revisit after
  WS1-3 measure).
- Mining the owner's `decke_turn` history (builds #96+): readable only
  authenticated as the owner — needs the owner to export or run the mining
  session. The 2026-08-25 mine (builds #80-95) already shaped `entities.ts`.
- MCP wire structured output, memory panel, conversation resumption.
