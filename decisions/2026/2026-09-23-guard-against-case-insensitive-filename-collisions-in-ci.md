---
date: "2026-09-23"
title: "Guard against case-insensitive filename collisions in CI"
decided_by: "Claude (Sonnet 5), on behalf of @cheyras"
areas: ["operations"]
supersedes: []
---
## 2026-09-23 — Guard against case-insensitive filename collisions in CI

**Decided by:** Claude (Sonnet 5), on behalf of @cheyras

**Decision:** Rename `apps/web/src/components/ui/dataTable.ts` (the pagination
and sort helpers added in commit 270665b0, PR #188) to `dataTableHelpers.ts`,
and add `scripts/check-case-collisions.mjs` as a new, early CI step
(`.github/workflows/ci.yml`) that scans `git ls-files` for (1) tracked paths
that become identical when lowercased and (2) same-directory source files
whose basename matches case-insensitively once one resolvable extension is
stripped.

**Why:** `apps/web/src/components/ui/DataTable.tsx` (the component) and the
former `dataTable.ts` (the helper) differed only by case and extension.
`apps/web/src/components/ui.tsx` imports the extensionless `./ui/DataTable`;
Vite/Rolldown's resolver tries candidate extensions against that path with a
plain `fs.stat`, and on a standard Mac's case-insensitive (but
case-preserving) APFS volume, the `.ts` candidate matched `dataTable.ts` — a
different file — before the `.tsx` candidate was tried. The build failed with
`"DataTable" is not exported by ".../DataTable.ts"`. CI runs on Linux, which
is case-sensitive, so it built the same commit clean every time; the bug was
invisible to CI and only reproduced on a contributor's own machine. A repo-wide
scan (`git ls-files`, no build needed) found no other such pair after the
rename.

**Implications:** Every future PR gets a free, near-instant check (runs before
`pnpm install`, needs nothing but `git ls-files`) that fails loudly on a new
same-directory case/extension collision or a same-directory
case-insensitive full-path collision, instead of building clean on Linux CI
and failing only on a contributor's Mac. `dataTableHelpers.ts` exports the
same `DATA_TABLE_PAGE_SIZES`, `nextDataTableSort`, `getDataTablePage` and
`DataTableSort` type; its only consumers (`DataTable.tsx` and
`__tests__/DataTable.test.ts`) were updated to import from the new path.

**Evidence and status:** The observed live result was 9/10 signed approvals, with one residual prose-confirmation miss after `get_card`; the finite sample does not prove causation or universal liveness. This is a metadata-only correction with zero writes. Existing preview descriptor, schemas, normalization, preflight, approval eligibility/HMAC/replay, system prompt, tool routing, API transport and MCP behavior remain unchanged. Live follow-up remains pending.

