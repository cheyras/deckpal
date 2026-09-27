---
date: "2026-08-23"
title: "The MCP wire result carries the text and no `structuredContent`"
decided_by: "Claude."
areas: ["agents"]
supersedes: []
---
## 2026-08-23 — The MCP wire result carries the text and no `structuredContent`
**Decided by:** Claude.
**Decision:** `toCallToolResult` (`apps/mcp/src/adapters/mcp.ts`) no longer
forwards `ToolResult.structured` as MCP's `structuredContent`. The internal field
is untouched; only the wire result changed. `apps/mcp` gains its first test script
and a CI step.

**Why:** eleven tools pass metadata to `ok()`, and every one of them was answering
a client with the metadata and nothing else. Measured against production:
`search_cards("charizard")` returned `{"total":125,"page":1,"pageSize":3}` — not
one card, in the tool the whole catalogue is searched through. The five tools that
pass no metadata returned their full text over the same connection in the same
session, which makes the presence of `structuredContent` the only variable.

Neither the server nor the SDK drops anything — `projectCallToolResult` only
appends to `content`, and both blocks went out. A client is then free to choose,
and at least one major one shows the structured half; reasonably, because
`structuredContent` normally travels with an `outputSchema` that says what it is.
**No tool here declares one.** Nothing is lost by dropping it: every field it
carried is already in the rendered text.

**Implications:** Deck-E is unaffected in either direction — his AI-SDK adapter
reads `result.text` and always received it in full, and `log_cards`' rendered rows
still come from `result.structured` internally. **If `structuredContent` returns,
it returns with an `outputSchema`**, so a client knows what it is holding. Pinned
by `apps/mcp/src/adapters/__tests__/mcp.test.ts`, two mutations watched red; the
regression is a one-line spread with no failing symptom — 200s all round, every
tool still "works", and the answers quietly go missing at the far end.

**Worth the owner's eye:** this changes a shipped public surface while he was
asleep. It is one line to revert if he disagrees, but the eleven tools are
unusable as they stand, so leaving it overnight had the larger cost.

