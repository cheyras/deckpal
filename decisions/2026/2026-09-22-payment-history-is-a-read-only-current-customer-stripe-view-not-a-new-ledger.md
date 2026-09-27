---
date: "2026-09-22"
title: "Payment history is a read-only current-customer Stripe view, not a new ledger"
decided_by: "Not recorded"
areas: ["commerce"]
supersedes: []
---
## 2026-09-22 — Payment history is a read-only current-customer Stripe view, not a new ledger

**Decision:** Profile payment history reads Stripe charges for one selected current billing account (`support` or `credits`). It adds no ledger, migration, webhook reconciliation, invoice enrichment, or money-path writes. Settled rows show actual `amount_captured` and bound refunds to it; non-settled attempts retain intended amount with explicit status. ISK/UGX use Stripe’s hundredths API scaling while Intl still localizes display.

**Why:** Stripe’s customer-scoped charge list includes standalone contributions plus current refund, dispute, capture, and receipt state. The support pointer is now a parameterized SELECT under actor RLS, so an absent row returns null without `ensureRow`. Exact customer ownership/mode checks and actor/kind/customer-generation-bound cursors keep the provider view scoped.

**Boundary and coverage:** B2 retains one middleware-owned pooled connection for each in-flight request; this feature does not release it early or alter global transaction lifecycle. Instead, customer retrieval and charge listing each set `timeout: 4000` and `maxNetworkRetries: 0`, bounding provider work to 8 seconds inside the 30-second watchdog. Responses remain private/no-store and allowlisted, receipts require credential-free HTTPS on exactly `pay.stripe.com`, and coverage states that older replaced/deleted accounts may be missing. The UI resets pagination on each last-request-wins kind selection, supplies native radio keyboard semantics, and identity unmount/cache-clear prevents stale-account rows from returning.

