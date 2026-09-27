---
date: "2026-09-26"
title: "Set pages (and the smart-list rule editor) now fetch every page of a set, not just the first"
decided_by: "Chey (via Claude)"
areas: ["frontend","catalog"]
supersedes: []
---
## 2026-09-26 — Set pages (and the smart-list rule editor) now fetch every page of a set, not just the first

**Decided by:** Chey (via Claude)

**Decision:** `GET /sets/:setId` keeps its existing `pageSize` cap of 250
(`clampInt` in `apps/api/src/routes/sets.ts`) — that cap protects the endpoint
and is correct. What changes is the client: `apps/web/src/lib/api.ts` gains
`api.setAllCards()`, which fetches page 1, reads `pagination.pageCount`, and —
only when there's more — fetches the remaining pages in parallel and
concatenates `cards`, all under the query's existing single query key so
filters stay client-side and instant. `SetDetail.tsx` (the set page) and
`ListRuleEditor.tsx` (the smart-list rule editor's rarity-exclusion picker)
now call `setAllCards` instead of `set`. The page-completeness math
(`remainingPages`, in the new `apps/web/src/lib/pagePlan.ts`) is a small,
dependency-free module with its own unit tests, mirroring `jsonContentType.ts`'s
existing pattern for exactly the reason that file documents: `lib/api.ts` pulls
in `lib/supabase.ts` → `import.meta.env`, which `node --import tsx --test`
cannot load, so the fix had to be extracted to stay unit-testable.

**Why:** 9 sets have more than 250 cards (Ascended Heroes 295, SWSH Promos
307, Fusion Strike 284, Paldea Evolved 279, Cosmic Eclipse 271, Paradox Rift
266, Scarlet & Violet sv01 258, Unified Minds 258, Surging Sparks 252). Both
`SetDetail.tsx` and `ListRuleEditor.tsx` requested exactly one page
(`pageSize: '250'`) and read `.cards` as the whole set. `pagination.total`
and `pagination.pageCount` on that one response were always correct; nothing
ever asked for page 2. The cards that silently vanished were always the
highest numbers — where a set's secret and chase rares sit. In Ascended
Heroes, all 45 of #251–#295 never rendered, including Pikachu ex #276
($946.56) — confirmed directly against the live public API in this session:
`https://deckpal.app/api/sets/me02.5` returns 250 cards ending at #250 (Fan
Rotom) from one page, and 295 cards ending at #295 (Mega Dragonite ex) —
Pikachu ex #276 at $946.56 included — once `pagination.pageCount` is
followed. Signed in, the have/need counts silently disagreed with the header
for the same reason: the Have/Need/Dupes strip is computed client-side from
whatever `cards` came back, so a truncated fetch under-reports `Need`
specifically (a card past #250 that you don't own never appears as
"need" — it just isn't there), which is the more dangerous half of the bug for
a completionist. Checked every other client fetch that reads a `pagination`
block against the same failure shape (search results, the Pokédex/dex index,
deck battle logs, series/list pages, PDF/checklist export, the agent-tools MCP
catalog search): search and battle logs already page through a real
Prev/Next UI; series, lists and the PDF/checklist export query the database
directly with no page cap at all; the agent-tools catalog search tool exposes
`page`/`page_size` to the calling agent with an explicit "more pages" footer
rather than silently dropping rows. The Pokédex/dex index (`PokedexIndex.tsx`,
`Profile.tsx`) requests `pageSize: '1025'`, which happens to equal both the
server's cap (`clampInt(..., 1, 1025)`) and the current species total, so it
is not truncated today — but it is the same "hope the cap covers it" shape,
flagged as a follow-up rather than changed here (see Implications).

**Implications:** Every set page (grid, table and binder views) and the smart
list rule editor's rarity picker now show every card in a set regardless of
size, at the cost of one extra parallel request only for the 9 sets over the
cap — every other set is unaffected. Verified: `pnpm --filter deckpal-web
test:insights` (new `pagePlan.test.ts`, 7 cases) and `pnpm test:browser` (121
cases, unrelated to this change but confirms no regression) both pass;
`pnpm -r --workspace-concurrency=1 exec tsc --noEmit` and `pnpm --filter
deckpal-web build` are clean; a synthetic 300-card fixture (`.sim/server.mjs`
in the `set250` worktree, port 5390, #001–280 owned / #281–300 missing,
deliberately straddling the 250-row page boundary) renders card #300 and
shows a reconciled "Have (280) · Need (20)" against a "280/300 Collected"
header in real headless Chromium at both 390px and 1440px. The Pokédex/dex
index's matching cap-equals-total pattern is not fixed here (it isn't broken
today, and fixing it means also raising `dex.ts`/`insights.ts`'s server-side
cap, which is a separate, deliberate change) — flagged for a follow-up rather
than folded into this PR's blast radius.
