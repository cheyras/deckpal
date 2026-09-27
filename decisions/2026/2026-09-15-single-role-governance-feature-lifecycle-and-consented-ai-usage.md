---
date: "2026-09-15"
title: "Single-role governance, feature lifecycle and consented AI usage"
decided_by: "@cheyras; implemented and documented by Codex under the"
areas: ["general"]
supersedes: []
---
## 2026-09-15 — Single-role governance, feature lifecycle and consented AI usage

**Decided by:** @cheyras; implemented and documented by Codex under the
verified feedback workflow.

**Decision:** Every account has one canonical role, default User, with built-in
User/Superuser/Contributor/Admin/Superadmin/Owner tiers. Contributor keeps
ordinary personal self-service and development tools but receives no
Administration. A separate Dev tools directory excludes product experiments.
Admin assignment checks the current target as well as the destination.
Superadmin/Owner edit safe role definitions; immutable identities, permission
ceilings and protected Owner authority cannot be manufactured by editable bits.
Owner is seeded from trusted bootstrap state, distinct from Superadmin, with
last-active-Owner protection and no ordinary transfer UI.

Product access is a revisioned lifecycle plus personal opt-in. Released is
available to active users; beta requires explicit opt-in for every tier;
Superuser/Contributor/Admin can opt into every experiment, Superadmin/Owner
receive experiments automatically, and disabled stops new requests/attempts for
everyone. Scanner/Deck-E initialize experimental. Character visibility,
feature opt-in and conversation sharing are separate preferences.

Owner may set per-user unlimited usage and nullable markup independently of
role. Null inherits and zero is valid. Reservations freeze policy/override
revisions; new work cannot select a revoked revision. Unlimited uses explicit
zero debit with no synthetic grant and retains access, holds/debt and operational
budgets. Existing flat quoted charging, refunds/recovery and Stripe settlement
remain intact.

Chat now records durable server request and local provider-attempt metadata
independently of browser history, including nested/retry/fallback/failure/cancel
paths. Reported decimal cost, nullable token evidence, full SHA and trusted PR
provenance remain honest when unavailable. Observations expose complete/unknown
samples and populate explicit estimate drafts; they never settle wallets by
actual cost automatically. Optional current-message/visible-response content
requires both first-leg and current enabled consent at the same epoch.
Sharing defaults off; withdrawal hides prior content and off-on cannot restore
it. Personal history uses validated owned exchange correlation and cannot forge
server cost/build. No raw tool/context/error payloads enter general telemetry.

Core UI controls, navigation and statuses use the shared SVG Icon or a deliberate
semantic CSS mark with accessible labels. Semantic DataTable rows retain
controlled sort/filter/page and mobile overflow behavior; no parallel component
system is introduced.

**Why:** These boundaries make delegated authority, feature eligibility and
financial policy explicit while supporting useful real usage observations.
They prevent role unions/demotion shortcuts, stale override selection, accidental
sharing of earlier exchanges, unknown cost being presented as zero, and browser
history being mistaken for server evidence.

**Implications:** Apply reviewed migrations 068–071 through the normal runner
without altering shipped checksums. 068 archives prior assignments and offers
read compatibility only; ambiguous mappings fail atomically. Local PostgreSQL
verified process-scoped PGOPTIONS mapping across runner transactions, but actual
pooler forwarding needs operator verification. A failed file does not undo
earlier committed files; rollback requires verified compatibility or a reviewed
backup plan. Stripe readiness recognizes protected-query delivery on the exact
HTTPS origin/path and required mode/events; a dedicated stable sandbox endpoint
is separate from existing production support payments.

The implementation passed isolated API/SDK/financial tests and the full guarded
PostgreSQL runner, including the actual history HTTP/SQL/consent chain in cloud
and UUID self-host fixtures. This documentation pass changed Markdown only and
made no live configuration, payment, migration or deployment calls. Production
rollout, pooler forwarding and actual new webhook delivery require separately
recorded operator evidence. Previously viewed or copied shared text cannot be
recalled.

### Review corrections: current permissions and provider charge boundary

Usage SQL and its capability projection require current admin.access as well as
an active session and tier >=40. Editing a custom role revokes usage metadata and
consented content together. First provider-operation persistence and the credit
start marker now commit atomically, with fresh authorization after lock waits.
Known pre-invocation cancellation uses exact-operation compensation; actual
provider attempts, including retries, keep their flat charge. Financial
summaries accept historical flat and current effective-policy snapshots and
count missing estimates as unpriced. UI aggregate counts name provider
operations. Disposable SQL/HTTP and SDK lifecycle regressions cover these paths;
these changes do not establish production deployment or live payment readiness.

