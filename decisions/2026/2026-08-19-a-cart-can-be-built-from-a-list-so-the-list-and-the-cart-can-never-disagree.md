---
date: "2026-08-19"
title: "A cart can be built from a list, so the list and the cart can never disagree"
decided_by: "Claude (on behalf of @cheyras)."
areas: ["commerce","frontend"]
supersedes: []
---
## 2026-08-19 — A cart can be built from a list, so the list and the cart can never disagree
**Decided by:** Claude (on behalf of @cheyras).
**Decision:** `set_cart` takes exactly one of `set_id`, `list_id`, or `items`.
New routes: `GET /lists/:id/massentry` and `POST /massentry`.

**Why.** The tool only took `set_id` + `goal`, so it always recomputed "what is
missing from this whole set at this goal". An agent that had built a filtered
list — everything missing EXCEPT the Special Illustration Rares — had no way to
cart it: `set_cart` re-derived from the set and put the excluded cards straight
back in, and the user was told one thing was in the cart while something else
was. That is a structural hole (the list and the cart had no shared source of
truth), not a mistake anyone made.

**Verified:** a list built with `rarity_exclude: ['Special illustration rare',
'Mega Hyper Rare']` carts 144 cards, and Mega Darkrai ex #116/#120 and Gladion's
Final Battle #118 are absent from that cart and present in the unfiltered set
cart.

