---
date: "2026-09-13"
title: "Add owner administration and an explicit AI credit economy"
decided_by: "@cheyras; recorded by Codex."
areas: ["commerce","operations"]
supersedes: []
---
## 2026-09-13 — Add owner administration and an explicit AI credit economy

**Decided by:** @cheyras; recorded by Codex.

**Trigger.** The owner needs to delegate contributor access, discover existing
privileged tools, manage users and defaults, and set credit meaning, usage
markup and pack prices without code changes. Environment owner/QA lists and
fixed credit constants do not support those workflows.

**Decision.** Add a permission-filtered Administration area with Overview,
Users, Roles, Settings, Audit and Tools, plus a Profile/chat-linked AI credit
wallet. Migrations 064–067 define application roles, permissions, account state,
audited mutations and effective skin/topbar defaults for unset preferences.
Roles compose a fixed permission catalog; delegation cannot exceed the actor's
authority. The protected last active Super admin cannot be removed through
concurrent demotion or suspension. A private, one-time transaction imports the
existing configured owner/QA accounts and exact legacy credit-enable flag.
Database changes then govern access and charging; there is no first-user
enrollment, permanent environment bypass or preview exemption.

Administrative and wallet endpoints require active sessions, never personal
or OAuth connector tokens. SQL independently authorizes scoped functions.
Governance writes, financial administration, token insertion and OAuth exchange
share a transaction lock with revocation and recheck state after acquiring it.
Manual token responses follow a successful commit. This closes the initial
Astra finding where an uncommitted mint could survive revoke-all. Restrictive
owned-table policies and three narrow legacy-billing guards extend suspension
beyond Express; already-running work and downloaded/signed-URL data remain
outside recall.

Credit policies use integer microUSD estimates, a denomination and markup to
round future flat charges up to whole credits. Initial 1/4/75 prices and all
existing integer balances/events are preserved; the stale initial chat estimate
is called out before sales. Each HTTP chat leg and its deep work keep one
pricing revision. Debit, snapshot and reservation are atomic; cancellation
before provider start refunds, while provider-started work retains its quoted
charge. Accounting connections are released across model streaming, and an
accepted replay cannot obtain another free invocation. This is estimated
pricing, not actual token settlement or a realized-profit report.

Packs start empty and have independent USD sale prices. Checkout freezes order
terms server-side and signed webhooks reconcile current Stripe state before a
unique grant. Refunds/disputes reverse credits into explicit debt when already
spent; pending refunds and unresolved disputes hold purchases/work. Positive
grants repay debt first, and a reasoned closed-dispute hold resolution cannot
override debt or open payment work. Per-order reconciliation revisions reject
stale remote snapshots; deterministic order-before-wallet locking coordinates
hold resolution and settlement. Existing voluntary support/gifts remain separate.
Readiness inspects the existing webhook configuration read-only, including nine
credit event subscriptions; no readiness flag or automatic endpoint mutation
is introduced.

The actual SPA clears sensitive state across account changes. Its service
worker bypasses both runtime and HTTP caches for private or Authorization-bearing
APIs, retires mixed API caches, and preserves anonymous cloud catalog/art/shell
caching. Self-host APIs are all network-only because reverse-proxy identity is
opaque; art/shell caching remains.

**Rollout and observed verification.** The owner guide and deployment runbook
require schema before code: 065 alone is Supabase-only, while 067's cloud grants
are conditional and its functions also support UUID self-host. Worker reports
record passing pure/type checks, real disposable PostgreSQL governance,
credential-race and 17 financial suites, and 27 browser groups across both build
modes. The supervisor inspected desktop and 390px screenshots. These fixtures
use selected dependencies/new migrations, synthetic sessions and local
Stripe/model responses; they do not rehearse every historical migration.
Final independent PR review/CI, production schema/bootstrap and actual payment
or refund/dispute delivery remain unverified at authoring. This documentation
worker changed only docs and executed no product tests or production requests.

---

