---
date: "2026-10-14"
title: "DeckPal hosts its own agent playbooks: a playbook tool, a public /skill page and a pointer skill for claude.ai"
decided_by: "Chey (via Claude)"
areas: ["agents"]
supersedes: []
---
## 2026-10-14 — DeckPal hosts its own agent playbooks: a playbook tool, a public /skill page and a pointer skill for claude.ai
**Decided by:** Chey (via Claude)

**Decision:** DeckPal serves the step-by-step guides an AI app follows with a DeckPal account. They live in one place, `packages/agent-tools/src/playbooks/texts.ts`: an index of the rules for every job, plus eleven playbooks:
- battle-log, game-analysis, record-review;
- deck-build, deck-tune, strategy-guide;
- rules, collection, prices;
- undo-and-history, tools.

Three things read that one source:
- **A read-only `playbook` tool** `{ name? }`, in the shared registry, so MCP clients and Deck-E both have it. The MCP server instructions now open with "Before a job, call `playbook`…", say the playbook wins where they differ, and keep a summary that states the same policy (a request is the go-ahead to write; three or more ranked deck options; the digest's review worth; endings kept apart). The four MCP prompts were brought in line too.
- **`GET /playbooks`** (public, cacheable), rendered by the public page **deckpal.app/skill**, which /connect links to. `?format=markdown` returns the same texts as one Markdown document a plain fetch can read.
- **A claude.ai skill to download** (`/skill/deckpal-skill.zip`, built reproducibly by `scripts/build-skill-pointer.mjs`, checked by a test). It holds no guidance of its own: it tells Claude to call `playbook`, falling back to the Markdown document (the page needs JavaScript).

The playbooks are v2 of the skill the owner tested on 2026-10-13, with every change the owner asked for:
- rules from `rules_lookup` and `get_card` tags, never memory, with the two invented myths named;
- when DeckPal and the player disagree, say what conflicts and look it up again;
- review depth from the digest's "review worth", and the player's notes outrank it;
- deep reviews use `detail: 'turns'` and `battle_turn_review`, and never call a reasonable play a misplay;
- the opponent's decisions, concessions and timeouts examined;
- the second-person voice, and no internal ids;
- archetype keys reused from the record;
- a request is the go-ahead to write;
- one-line clarifications only;
- deck planning collaborative, with three or more ranked options, never a pasted netdeck;
- records split by how games ended;
- the screen name never asked for.

To support that last split, `battle_logs` rows now say "ended before the last Prize (concession, deck-out, the timer or no Pokémon left)" when the winner took fewer than six. Every tool a playbook names is checked against the registry by a test, and every argument written beside a tool ("`tool` with `arg`", or in a tool's table row) against THAT tool's schema: a real argument of another tool is dropped silently by validation (Astra, #344: `delete_list` has no `restore`). `simulate_battles`' description was trimmed so tools/list keeps its 70,000-character budget (68,781 with the new tool); its usage guidance lives in the deck-tune playbook.

**Why:** The owner, 2026-10-13: "host the skill at something like deckpal.app/skill" as the single source of truth, with the copy saved in the client only a pointer. A skill file saved in claude.ai goes stale the day DeckPal changes a tool, and in the tests it already named a screen name DeckPal now learns, and had no word about `rules_lookup`. A guide the server returns always matches the tools that server serves. The tests showed the procedure works on Haiku when it is written down step by step. The judgement gaps the tests found are closed by the playbooks pointing at the new truth tools: `rules_lookup`, the digest's moments, and the turn review.

**Implications:**
- **Counts.** The MCP surface is 31 tools (20 read).
- **Deck-E.** Deck-E has the tool too; its routed pathway texts remain its primary guidance until Phase 7 makes them read the same source.
- **Changing a playbook.** It is an ordinary code change: one edit reaches the MCP tool, the page and every client at once. The pointer skill only changes if the tool or page moves.
- **Static files.** `vercel.json`'s SPA rewrite now excludes `.zip`, so the download is served as a file.
