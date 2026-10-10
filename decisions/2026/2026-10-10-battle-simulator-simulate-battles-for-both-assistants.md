---
date: "2026-10-10"
title: "Battle simulator: simulate_battles for both assistants"
decided_by: "@cheyras (goal: stack a deck against a field of archetypes, simulate many battles quickly, get real data an LLM can reason about); built by Claude Opus 5.5."
areas: ["agents", "decks"]
supersedes: []
---
## 2026-10-10 — Battle simulator: simulate_battles for both assistants
**Decided by:** @cheyras (goal: stack a deck against a field of archetypes, simulate many battles quickly, get real data an LLM can reason about); built by Claude Opus 5.5.

**Decision:** One read-only agent tool, `simulate_battles`, registered in `@deckpal/agent-tools` right after `check_deck`, so the MCP server and Deck-E both get it. It calls `POST /decks/simulate`, which plays a saved deck (id or name) or an unsaved `check_deck`-shaped list against up to 8 of the caller's decks (default: 6 of their other decks) in `@deckpal/sim` and returns `{ text, report }`. Games are PAIRED: each seed is played twice with the seats swapped, so each deck goes first in exactly half the games; the two games share a seed but not their deals (each seat shuffles from its own stream), so they stay independent. All matchups share one 25 s budget; pairs are played whole, an opponent reached after the budget is spent is reported as 0 games played, and the report says when the budget rather than `games` decided the count. The text (≤ 5,000 chars) gives every rate with its Wilson 95% interval and n, counts draws, time-outs and engine errors apart from wins and losses (win rate = wins / decided games), names every card the engine only approximates or cannot play, says "SIMULATED … not real games" on its first line and carries the standing caveat on its last. Default seed 1, so a re-run replays the same games and two versions of a deck compared with the same seed share their random numbers. The CPU pilot is the engine's `makePilot('search')` when it exports one, else `RandomPilot` — and the report calls the random placeholder out by name.

**Why:** The owner wants Deck-E and claude.ai to test a list or a change against a gauntlet and get numbers back that a model can reason about. A model reads numbers literally, so the honesty has to be in the format, not left to the model's discretion: an unqualified "62%" from 24 bot games would be repeated as a real win rate. Pairing removes the going-first edge as a source of noise without correlating the deals (identical deals in both games of a pair would make the Wilson interval too narrow). 25 s keeps the request inside the RLS middleware's 30 s connection hold (`PGRLS_MAX_HOLD_MS`) and under the 60 s API and MCP function limits; the runner yields to the event loop between pairs so a long batch does not stall other requests on a shared instance.

**Implications:**
- Nothing is stored: simulated games are a computation over decklists, never battle logs, and never presented as real-game statistics.
- Frames for the engine come from `fingerprintInputs` (deck/db.ts) plus the catalogue id and regulation mark (`apps/api/src/sim/frames.ts`) — the exact `card` shape of `GET /cards/:cardId`, with no second copy of that SQL. Ad-hoc lists resolve through `check_deck`'s resolver (`resolveCheckLines`, now exported).
- `POST /decks/simulate` is rate-limited to 6 calls a minute per account (`simulateRateLimit`).
- `@deckpal/sim` is built before the API in CI and in `scripts/vercel-build.mjs` (apps/api imports its `dist/` at runtime); CI runs `pnpm --filter @deckpal/sim test`.
- The connector now serves 26 tools (15 read, 11 write). The public landing page and llms.txt still say 25 and do not name the tool: `landingCopy.test.ts` bans "simulat" as not generally released, and the simulator ships with a placeholder pilot. Updating that copy (count, the Decks line, and the ban) is the owner's call when the simulator is announced.
- Card impact ("played by own turn 2 vs not") is an association, not a cause, and is shown only for cards with enough games on both sides of the split.
- Open: the per-opponent budget is an even split of what is left, so one slow matchup can starve the ones after it of games (each still reports its n).
