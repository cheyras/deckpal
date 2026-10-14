---
date: "2026-10-14"
title: "Bulk list jobs in one call: search_cards shows and filters finishes, edit_list add_search adds a whole search"
decided_by: "Chey (via Claude)"
areas: ["agents", "lists"]
supersedes: []
---
## 2026-10-14 — Bulk list jobs in one call: search_cards shows and filters finishes, edit_list add_search adds a whole search
**Decided by:** Chey (via Claude)

**Decision:** Phase 4 of the plan approved on 2026-10-13, first PR.
- **`search_cards`:**
  - Every row now shows the finishes the card is printed in (`finishes normal/reverse`).
  - A new `finish` filter keeps only cards with a printing in one of the listed finishes: `normal`, `holo`, `reverse`, `lenticular`, `metal`, the catalog's `variant_kind.finish`.
- **`edit_list`:** a new `add_search` adds every card a search with `search_cards`' filters matches, in the same single bulk write as `add_cards`.
  - **Filters:** `query`, `set_id`, `category`, `rarity`, `standard_legal`, `tag`, `owned_only`, `exclude_owned`, `min_value_usd`, `finish`.
  - **Scope:** every page, up to 500 cards.
  - **Which printing:** with `finish`, each card goes in under the first listed finish it has. Within a finish it takes the plainest printing: primary, then standard tier, then catalog order, so a holo rather than its cosmos-foil cousin. Without `finish`, the primary printing.
  - **Already listed:** cards in the list are skipped, unless this same call removes their item, so "swap my normals for holos" is one call.
  - **Kept, not churned:** an item this call removes and the search would add back as the same printing is kept, and both steps dropped. Adds run before removals, and a dynamic list's add skips a printing it already holds, so otherwise the removal deleted the card (Astra, #345). On a static list this applies to add_search's re-adds, which keeps the item's quantity.
  - **Strict:** its filters are strict. `text` and `damage` are refused, never silently dropped, because dropping them widened the write.
  - **Counts:** the per-finish counts come back in the executing reply as well as the dry run.
  - **Guards:** it needs at least one filter, and a match over 500 is refused with the count. It can fill a list in the call that creates it.
- **One filter builder:** `search_cards` and `add_search` build their filters with one function, `cardFilters` in `catalog.ts`, so a search and "add everything it found" cannot disagree.
- **Playbooks:** the collection playbook does these jobs in one call, and asks in one line whether reverse holos count when the player only said "holo".

**Why:** In the owner's Haiku test, "make a list of my holo Pikachus" went wrong. `search_cards` showed one page and no finishes. The model checked about 150 cards one `get_card` call at a time and hit the 60-a-minute limit. It added the normal printing of 44 cards that have a holo one, missed 19 holo-capable cards, and reported "7 left".

The search the job needed already existed; turning its results into a list did not. Now the job is a dry run and a write: two calls whatever the size, and the rate limit stops mattering.

**Implications:**
- **Test:** a new DB integration suite, `apps/api/src/__integration__/bulkLists.mjs`, registered in `scripts/test-db-integration.mjs`. It proves which variant ids get written by running the real SQL over real rows: the finish filter, the order of choice, the cosmos foil losing to the plain holo, skips, the remove-and-swap, create-and-fill, and the limit.
- **Finishes are looked up for the page only**, in one query after the search. As a column of the search itself they were computed for every text-search candidate before the page limit, and a broad term ('energy') failed; the MCP response audit (`pnpm mcp:audit --responses`) caught it.
- **tools/list:** `search_cards`' description was tightened to keep tools/list inside its 70,000-character budget, at 69,343. Every warning it carried is still there.
- **Shipping in two PRs.** The rest of Phase 4 follows in the second: paging the same way in every tool, a warning when an argument is ignored, and tool results that stop presenting ids as the way to undo.
