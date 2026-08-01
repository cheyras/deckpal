# D4 · feat/coach

**Wave 4 (last — needs the knowledge layer and matches both live).**
Worktree: `~/pokedex-worktrees/coach` (create when A3 + D1 have merged) · Depends: A3, D1.
Dev server: none. Spec: §2 (coaching chat-first; pinned annotations later), §3 Wave 4.

## Mission
`coach_review(match_id)` — post-match coaching from an agent that was *in* the game, grounded
in the log it just played and in comparable games from the knowledge layer.

## Scope
- [ ] `coach_review` MCP tool: returns the match's event stream + decision-point candidates
      (turns where legal alternatives existed — the engine can enumerate what else was legal)
      + hooks for `battle_search` comps, packaged so the chat session writes the actual
      coaching. (Same pattern as A2: the server prepares evidence; Claude in chat does the
      thinking.)
- [ ] A `coach-review` SKILL.md pinning the voice: grounded and specific ("turn 4 you had
      Boss's Orders and passed on the Lunatone KO — that's the prize that ended up mattering"),
      always citing turn numbers, always referencing at least one comparable game when the
      corpus has one. Never generic tips.
- [ ] Works on any logged game, not just agent matches (a pasted Live loss deserves coaching too).
- [ ] Turn-pinned annotations in the replay UI are **out of scope** (spec "Later").

## Done gate
The spec's coaching line: a post-match review that references at least one comparable game
from the knowledge layer, citing specific turns. Chey finds it useful on a real match.
