---
date: "2026-11-03"
title: "Deck-E and the playbooks state the same rules from one source"
decided_by: "Chey (via Claude)"
areas: ["agents", "decke", "mcp"]
supersedes: []
---
## 2026-11-03 — Deck-E and the playbooks state the same rules from one source
**Decided by:** Chey (via Claude)

**Decision:** Phase 7, part one. The rules that DeckPal's two agent guides both state now live in one module, `packages/agent-tools/src/playbooks/shared.ts` (`SHARED_RULES`). One guide is the playbooks that claude.ai and MCP agents read; the other is Deck-E's routed pathway texts. Each rule is interpolated, word for word, into the playbooks and the pathways that need it.

The rules:
- review depth;
- the fair-judgement test for a misplay;
- the five causes;
- the review's shape;
- how a record splits by how games ended;
- when a new deck version is due;
- how deck changes are offered;
- the set goals;
- where rules answers come from (and `propose_note`).

**Owner rulings (2026-10-26) on the places the two disagreed:**
- **Depth:** the digest's `review worth` decides. The deck's record (a new archetype, one met three or more times, a second straight loss to it) only raises standard to deep. This replaces Deck-E's history-first "Light / Standard / Deep" order, which skipped the digest for light games.
- **Deck changes:** at least three ranked options everywhere. This replaces Deck-E's "at most two changes".
- **Review shape:** the playbook's version everywhere:
  - five causes, with **Ending** added;
  - the **Opponent** line;
  - the deep block (Key turns, Pattern, Try next);
  - the strict misplay bar ("only when clearly yes").

**Corrected:** Deck-E said "There is no numbered set goal". `set_progress` has had one since #300 (`SET_PROGRESS_GOALS`), so Deck-E now names four goals. Lists and carts still take complete with `rarity_exclude`.

**Kept apart, on purpose:** how each client acts.
- Deck-E keeps `log: "@pasted"`, its `ask_user` cards, approval cards, `consult` and Deep Think.
- The playbooks keep their `dry_run` steps.
- No shared rule mentions dry runs. A "preview first" line once took Deck-E's write calls to 0/15, and a test now enforces this.

The MCP server instructions and prompts (`apps/mcp/src/guidance.ts`, the third copy) were brought in line by hand, since their 4,000-character budget cannot hold the full rules. They are now 3,905 characters.

**Why:**
- Phase 7 of the plan approved 2026-10-13: single-source playbooks feeding both claude.ai and Deck-E.
- A read-only audit found 14 disagreements between the two guides, one of them a factual error.
- A rule fixed in one guide stayed wrong in the other; the Phase 5 eval tuned the playbook's review, and Deck-E never got it.

**Implications:**
- A test in `apps/api/src/decke/__tests__/pathways.test.ts` checks every shared rule appears unchanged in each pathway and playbook that carries it, and that every shared rule is placed somewhere. Editing a rule in one place only fails CI.
- **Deck-E behaviour changes:**
  - Every Live game is now digested.
  - A brief game saves its Read line with `edit_battle_log`, so the reader sees a second approval card. Before, the line went on the logging call.
  - Reviews gain the Opponent line.
  - Tuning offers three or more options.
- These change what Deck-E writes, so Phase 7b measures Deck-E's reviews (Haiku gathers, Sonnet writes) against the eval before anything further ships.
- Size budgets hold: game-analysis is at 5,000 of 5,000; Deck-E's battle_log pathway at 8,297 of 9,000.
