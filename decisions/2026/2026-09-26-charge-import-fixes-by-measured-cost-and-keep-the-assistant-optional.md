---
date: "2026-09-26"
title: "Charge import fixes by measured cost and keep the assistant optional"
decided_by: "Chey (via Codex)"
areas: ["agents","data"]
supersedes: []
---
## 2026-09-26 — Charge import fixes by measured cost and keep the assistant optional

**Decided by:** Chey (via Codex)

**Decision:** Import fixes remain available when Deck-E's character is hidden; the review panel uses his visual style without the character art. A known gameplay identity favors a printing the reader owns, even when it is rarer; otherwise the closest collector number in the pasted line wins before ordinary legal and rarity preferences. An import fix uses one daily Deck-E turn and, when paid credits are enabled, its provider-reported AI cost as a fraction of a credit. Fractions accumulate until the existing wallet ledger debits a whole credit.

**Why:** Hiding the character is a presentation preference, not a request to lose useful repair tools. An owned card saves a swap; the pasted number is the best clue when ownership is absent. A flat one-credit fee overprices a short repair, while a free call hides real AI use.

**Implications:** Migration 077 adds an account-scoped fractional accumulator, ledger-backed hold and settlement record. The import route records the model call in the existing Deck-E usage tables. It commits admission and releases the request connection before calling the provider; settlement uses one later checkout from the same shared pool, even after a browser disconnect. Paid-wallet admission debits one credit through the shared ledger lock and honors wallet holds. The browser still requires review and a second exact import check before creating a deck. A short fix was estimated at about $0.002, or about 0.2 credit under the default $0.01-per-credit policy; the actual charge follows the provider report.

