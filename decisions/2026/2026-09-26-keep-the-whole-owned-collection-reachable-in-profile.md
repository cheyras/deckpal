---
date: "2026-09-26"
title: "Keep the whole owned collection reachable in Profile"
decided_by: "Chey (via Codex gpt-6-sol)"
areas: ["general"]
supersedes: []
---
## 2026-09-26 — Keep the whole owned collection reachable in Profile

**Decided by:** Chey (via Codex gpt-6-sol)

**Decision:** Keep `GET /me/cards` paged at 48 cards in Profile's showcase
picker, but offer Load more until the final page. Order cards with a unique
card ID after price and name (or update time and name), so cards tied on those
fields cannot swap across page boundaries.

**Why:** The first version of UXC-04 removed the request fan-out but showed
only the first 48 owned cards. Name search could still hide later printings
when more than 48 shared a name. The non-unique sort also made offset paging
capable of repeating or skipping tied cards. Astra review caught both gaps.

**Implications:** The picker fetches later pages only when asked and keeps
already loaded cards visible if a later page fails. The browser test proves a
49th card appears after one Load more request, and the pure query test pins the
unique sort for both orderings. The one-request initial picker contract stays.
