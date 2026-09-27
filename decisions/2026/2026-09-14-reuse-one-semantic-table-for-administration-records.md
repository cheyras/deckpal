---
date: "2026-09-14"
title: "Reuse one semantic table for administration records"
decided_by: "@cheyras; recorded by Codex."
areas: ["frontend"]
supersedes: []
---
## 2026-09-14 — Reuse one semantic table for administration records

**Decided by:** @cheyras; recorded by Codex.

**Why and decision.** The owner rejected one-card-per-record lists and requested
a reusable filterable row table matching the current UI kit. Add DataTable and
DataTableToolbar with caller-owned rows/columns, controlled sort/paging,
explicit loading/error/empty/recovery states and optional row disclosure.
The same table remains on desktop and 390px with contained horizontal scrolling.

Use it for Users, Roles, Audit, credit packs/orders and the user-detail ledger.
Users/audit/orders retain supported server filters, exact totals and server
ordering; sorting only a fetched page must not imply a globally sorted result.
Roles/packs filter and sort the complete loaded list before local paging.
Preserve permission gates, user links, protected actions, revision/reason
workflows, audit details, money/debt display and private-query responsibilities.
Overview statistics, tool-navigation cards and configuration forms stay intact.

**Scope and evidence at authoring.** This is frontend presentation, with no new
API, migration, environment or security rules and no virtualization/backend-query
optimization. The core author reports six focused tests and TypeScript passing.
The gallery and six consumer conversions are implemented, and the branch preview
is available. The final built-SPA browser suite passed 57 groups in cloud and
self-host modes, including table and gallery interactions at 1280px and 390px.
Screenshots were directly reviewed; final role action sizing keeps its controls
on one line on phones, verified by actual button/cell geometry. Keyboard checks
measure rightward scroll movement from the left edge and visible focus. These
checks use local API/session/payment fixtures and cannot establish live auth,
SQL, payments or a production frontend release.


