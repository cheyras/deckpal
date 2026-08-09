> **Predates the cloud pivot -- re-scope before executing.**

# D1 · feat/match-server

**Wave 4.** Worktree: `~/pokedex-worktrees/match-server` (create when B3 merges) · Depends: B3
(B4 preferably merged — a trusted engine referees better). Dev server: none (MCP-only; the
board arrives in D1b). Spec: §3 Wave 4 as amended 2026-08-01 (pluggable agent brain).

## Mission
Engine-mediated matches over MCP: the engine is referee and state-holder; the agent is only
ever a policy. A full match must be playable through MCP tools alone (chat), so the interim
chat-refereed mode and the board UI are both thin layers over this.

## Scope
- [ ] **State-serialization design doc first, please** (spec §6): compact, legible board
      representation (both boards, hand sizes, prizes, attachments, active effects, discard
      knowledge) + legal-action list. **Hidden info respected**: the agent's view contains only
      what a real opponent would know — the visible subset is exactly what a Live log reveals
      about the other player (Ground Truth #7). Doubles as the sim debug view. SKILL.md when
      stable.
- [ ] MCP tools: `match_start(my_deck, agent_deck, mode)`, `match_state(match_id)`,
      `match_act(match_id, action)`, `match_concede(match_id)`. Engine validates everything;
      illegal agent picks bounce back with the legality error (a confused agent can stall,
      never corrupt).
- [ ] `matches` table: engine-serialized state, resumable across restarts (phone sessions get
      interrupted — a match must survive a pm2 restart).
- [ ] Agent-turn brain: pluggable provider — Vercel AI Gateway or wrapped Claude Code CLI
      (Sonnet) for personal use. Decide in the design doc with Chey's ack; keep the interface
      swappable either way.
- [ ] Match end → standard log through the pipeline, `source: agent_match`.

## Done gate
A full match completed through MCP tools alone from claude.ai on the phone; match survives a
restart mid-game; the emitted log synthesizes like any other game. CI green (pure parts).
