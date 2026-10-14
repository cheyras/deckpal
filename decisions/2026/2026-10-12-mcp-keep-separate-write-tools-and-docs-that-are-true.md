---
date: "2026-10-12"
title: "MCP: keep separate write tools, and docs that are true"
decided_by: "@cheyras (owner ruling 2026-10-12)"
areas: ["agents", "docs"]
supersedes: []
---
## 2026-10-12 — MCP: keep separate write tools, and docs that are true
**Decided by:** @cheyras (owner ruling 2026-10-12), on the options recorded in `2026-10-12-mcp-tool-surface-and-write-safety.md`. Written up by Claude Opus 5.5.

**Decision:** Three rulings.

1. **Keep add, edit and delete as separate MCP tools.** Option A of the tool-surface audit (one write tool per entity, 28 tools to 24) is declined. `add_battle_log`, `edit_battle_log`, `delete_battle_log`, `save_deck`, `delete_deck`, `edit_list` and `delete_list` stay as they are.
2. **Name the battle simulator on the landing page.** `simulate_battles` is served to every connected AI today, so the public tool lists (llms.txt and /connect) include it, and `landingCopy.test.ts` no longer bans the word. The card scanner, Deck-E and replay stay banned there, because those really are gated or unreleased.
3. **All documentation, the landing page and the OG image must be true.** The landing's tool count is now checked by a test, the same way the docs' counts already were.

**Why:**
- Separate tools: the audit measured the saving at about 700 to 950 tokens (4 to 6% of `tools/list`). Against that, merging renames seven tools for every connected client and for Deck-E, makes the merged battle-log tool's annotations destructive (so an add would warn and need approval), and loosens the schemas. The saving does not pay for a breaking change.
- The simulator: hiding a tool that every connected AI can already see made the public tool list wrong, not the simulator secret.
- True docs: the landing said 26 tools while the server served 28, the OG image said 21, and two read-only audits found dozens of present-tense claims in the docs that the code no longer backs (sign-in methods, credit pricing, the scanner, the self-host steps, paths, routes and counts).

**Implications:**
- `apps/mcp/src/__tests__/docs.test.ts` now also checks the "N tools (R read, W write)" and "Read only gives your AI the N tools" claims in `apps/web/src/routes/landing/copy.ts`, and the "N tools over MCP" pill in `scripts/gen-og-image.mjs`, against the live `tools/list`. Adding or removing a tool fails that test until the landing and the OG card follow. The card is a JPEG: after changing the script, rebuild the web app, run `node scripts/gen-og-image.mjs`, and commit the image with its re-measured `MANIFEST.json` entry.
- `landingCopy.test.ts` checks that the /connect tool groups and llms.txt list the same tools, each once, and that the count matches the quoted one.
- What the docs now say about writes is what is true today: every write previews by default except `deck_strategy`; battle-log edits and deletes cannot be undone; a `save_deck` edit to a deck version with no battle logs overwrites it in place. A separate change may alter the last two; the docs will follow it then, not before.
- Dated records (`decisions/`, `roadmap/`) are history and were not rewritten.
