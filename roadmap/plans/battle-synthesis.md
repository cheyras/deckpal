> **Predates the cloud pivot -- re-scope before executing.**

# A2 · feat/battle-synthesis

**Wave 1.** Worktree: `~/pokedex-worktrees/battle-synthesis` · Depends: W0 (rebase when it
merges; tool + SKILL design can start now). Dev server: none. Spec: §3 Wave 1 (as amended
2026-08-01: chat-driven, no server-side LLM).

## Mission
Synthesis follows the established pattern: Claude in chat reads via MCP, writes back via MCP.
The server's only intelligence is embedding (local ollama) and archetype normalization.

## Scope
- [ ] `synthesis_queue` read tool: logs missing narrative/structured fields → raw log + parsed
      output, paged, compact rows (follow `apps/mcp/SPEC.md` conventions).
- [ ] `save_synthesis` write tool (dry-run defaulted): narrative (~150–300 words, written for
      retrieval) + structured fields (archetypes, tags, key_cards). On commit: normalize
      archetypes through the W0 registry (reject/flag unknown labels rather than silently
      inventing), embed narrative via ollama `nomic-embed-text` → `battle_memories`, stamp
      `ai_generated` metadata.
- [ ] Idempotent re-synthesis (re-saving replaces narrative + embedding cleanly).
- [ ] `battle-synthesis` SKILL.md: the narrative rubric (matchup, opening quality, key turns,
      what decided it, notable lines) + structured-field definitions, so any chat session
      produces consistent output.
- [ ] Ollama integration: OpenAI-compatible `/v1/embeddings` on localhost; handle ollama-down
      honestly (save succeeds, embedding queued/flagged — no silent nulls).

## Done gate
Every stored log synthesized via a real chat session using the SKILL (Chey or you in claude.ai /
Claude Code); embeddings present; re-synthesis idempotent; CI green.
