---
date: "2026-08-11"
title: "Agentic deck-building defaults to cheapest printing (issue #31)"
decided_by: "user (issue report), implemented by agent."
areas: ["agents","decks","frontend","operations"]
supersedes: []
---
## 2026-08-11 — Agentic deck-building defaults to cheapest printing (issue #31)
**Decided by:** user (issue report), implemented by agent.
**Decision:** When an AI agent builds or edits a deck via deckpal-mcp, the MCP
server now surfaces price in every ambiguous-candidate path and sorts candidates
cheapest-first, and tool descriptions explicitly instruct the calling LLM to
prefer the cheapest printing of a named card unless the user specified a
particular rarity or alternate art. Three coordinated changes:

1. **`resolve.ts`** — `resolveCard()` joins best USD market price per candidate
   card (same `price_current` join pattern as `search_cards`), `describeCard()`
   renders it, and the ambiguous candidates list sorts price-ascending (unpriced
   last). The "ambiguity is returned, not guessed" identity-correctness policy
   is preserved — nothing is auto-selected; the list is just ordered and
   price-annotated so the first candidate an agent picks is the cheap one.

2. **`catalog.ts`** — `search_cards` sort now groups same-name rows and orders
   them by price ascending within each name group (different names keep relevance/
   recency order). The tool description explicitly tells the calling agent to
   prefer the cheapest printing when building/pricing a deck.

3. **`decks.ts`** — `save_deck` tool description, `cards` array field description,
   and `ptcgl_text` field description all carry explicit cheapest-printing
   guidance for deck-building. This is a legitimate, first-class mechanism per
   SPEC §4 ("Descriptions state what the tool does... Zod `.describe()` on every
   field — it's the only arg docs the model gets").

**Why:** The same named card (e.g. "Mega Lucario ex") exists as multiple distinct
printings — a $0.78 regular Double Rare and a $208+ Special Illustration Rare
that are gameplay-identical. Without price awareness, agentic deck-building picks
one effectively at random, which can inflate a deck's cost by hundreds of dollars
for no gameplay benefit. The fix uses tool descriptions as an LLM-facing
default-behavior lever — a proportionate, zero-side-effect approach that aligns
with the existing SPEC convention.

**Implications:**
- `ResolvedCard` now carries a `bestMinor` field (nullable). Any future consumer
  of `resolveCard` / `describeCard` gets price for free.
- `describeCard()` output now always ends with a price segment (`$X.XX` or
  `unpriced`). Consumers that parse this string (there shouldn't be any — it's
  human/LLM-readable) should be aware.
- The `search_cards` ORDER BY is slightly heavier (adds `lower(c.name)` +
  `b.best_minor` columns to the sort) but the existing indexes cover it and the
  query was already joining `best` prices.
- Tool descriptions are longer. This is intentional — the extra sentences are
  load-bearing behavioral guidance, not documentation bloat.

_Filed by agent on behalf of @cheyras — 2026-08-11._

