---
date: "2026-08-19"
title: "`edit_list` takes the same card reference as `log_cards`, and can derive the list itself"
decided_by: "Claude (on behalf of @cheyras)."
areas: ["catalog"]
supersedes: []
---
## 2026-08-19 — `edit_list` takes the same card reference as `log_cards`, and can derive the list itself
**Decided by:** Claude (on behalf of @cheyras).
**Decision:** `add_cards` accepts `card_id` | `name` + `set_id`/`number`, plus
`variant_kind` — the shape `log_cards` has accepted all along — resolved for the
whole batch in two queries. New `add_missing` derives the whole list server-side
from a set + goal + rarity/finish/price filters. New
`POST /lists/:id/items/bulk` writes them in one transaction.

**Why.** `add_cards` took a `card_id` (silently meaning "the primary variant")
or an exact numeric `variant_id`, and nothing in between. So the standard flow —
`set_progress` hands over name, number, variant kind and price for every missing
card — still cost one `get_card` per card to recover a variant id. Roughly
ninety calls to add eighty-seven cards the app had already identified.
Measured after: 144 cards added in one call, 354 ms.

