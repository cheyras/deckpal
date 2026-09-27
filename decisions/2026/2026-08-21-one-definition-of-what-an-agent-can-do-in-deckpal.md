---
date: "2026-08-21"
title: "One definition of what an agent can do in DeckPal"
decided_by: "Claude (Opus 5), on behalf of @cheyras."
areas: ["agents","decks"]
supersedes: []
---
## 2026-08-21 — One definition of what an agent can do in DeckPal
**Decided by:** Claude (Opus 5), on behalf of @cheyras.

**Decision.** Extract `apps/mcp`'s tool layer into `packages/agent-tools` and
give it two front-ends: the MCP protocol, and the AI SDK.

**Why.** Two unrelated answers to "what can an agent do here" existed in this
repo, and Deck-E got the empty one — 5,574 lines and 23 tools on one side, 337
lines and 6 cosmetic tools on the other. Rejected: Deck-E proxying to
`deckpal.app/mcp` over HTTP (a network hop per call on a latency-critical path,
plus a PAT/JWT auth mismatch), and Deck-E re-implementing against REST
(guarantees drift).

**Proven pure, three ways**, because a refactor asserted to be
behaviour-preserving is a refactor nobody checked: a static dump of all 23
tools' name/title/description/schema-keys/annotations from HEAD and from
`allTools()` (identical, same order); a real `initialize` + `tools/list`
JSON-RPC exchange against both, byte-compared (identical, which covers the
SDK-generated JSON Schemas); and `git diff -w` on the nine tool modules, every
line accounted for.

**The one deliberate behaviour change.** The set route is
`/series/<seriesSlug>/<setId>` and no tool returned a series slug; slugs are not
derivable from names (`scarlet-violet`, `mcdonald-s-collection`). `search_cards`,
`get_card` and `set_progress` now append it — trailing additions only, one added
JOIN each on a NOT NULL FK so no row set changes.

**Annotation audit.** `readOnlyHint` stops being documentation the moment it
becomes the control deciding what needs write approval. 12 read, 11 write, 4
destructive, 0 unannotated. The two counter-intuitive ones were re-read rather
than taken on trust: `set_cart` is a read (its POST to `/massentry` runs no
INSERT/UPDATE/DELETE — it composes TCGplayer URLs and never contacts
TCGplayer), and `deck_history` is a write (its `revert_to` branch rolls a deck
back). `readOnlyHint` is now REQUIRED in the package's type where MCP's own has
it optional, so a tool that forgets it fails to compile.

**Implications.** A tool added for Claude appears for Deck-E in the same commit.
`packages/agent-tools` is in `vercel.json`'s build command, the root build
script and CI, in that order — both functions depend on its `dist/`.

