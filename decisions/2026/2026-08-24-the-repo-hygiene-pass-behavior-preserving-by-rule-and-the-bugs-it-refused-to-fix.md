---
date: "2026-08-24"
title: "The repo-hygiene pass: behavior-preserving by rule, and the bugs it refused to fix as hygiene"
decided_by: "Claude Fable 5 (multi-agent hygiene pass) on behalf of @cheyras"
areas: ["general"]
supersedes: []
---
## 2026-08-24 — The repo-hygiene pass: behavior-preserving by rule, and the bugs it refused to fix as hygiene

**Decided by:** Claude Fable 5 (multi-agent hygiene pass) on behalf of @cheyras

**Decision:** One concurrent multi-fixer pass over the whole repo (branch
`chore/repo-hygiene`) under a single hard rule: **zero observable behavior
change.** Nothing that leaves the program moved a byte — API response shapes
and messages, user-visible text, DOM structure/classNames/CSS, emitted log
lines, model prompt text, wire formats, localStorage keys, CustomEvent names,
env var names, HTTP headers, retry/timeout timings. Where two copies of a
thing differed in any emitted string, only the identical parts were deduped
and the differing strings stayed exactly where they were. The working
principles were adapted from the ponytail decision ladder: reuse > stdlib >
platform before writing anything new; deletion over addition; no abstraction
beyond what a finding prescribes; and a protected-zone list no fixer could
touch — the checksummed migrations (`packages/db/src/migrations/*.sql`),
`packages/db/src/pool.ts`, `DevBackendRibbon.tsx`, every env-var fail-loudly
warning and `/health` gate field, zod at trust boundaries, error handling
that prevents data loss, security and a11y code.

What it did:

- **Deleted dead files** — each confirmed unreferenced repo-wide first,
  including the one dynamic surface (the sole
  `import.meta.glob('../../**/*.gallery.tsx')` in
  `routes/design/CatalogSection.tsx`) plus tests, `scripts/`, `api/*.mjs`,
  and docs that assert exports: `apps/web/preview-server.mjs`,
  `scripts/build-demo.mjs`, `apps/sync/src/catalog/dryrun.ts`,
  `api/tsconfig.json`.
- **Chose one home per copy-pasted thing:** `UUID_RE` lives in
  `apps/api/src/http.ts`, `SOURCE_SHAPE` in `apps/api/src/mutations.ts`,
  `pct` in `apps/api/src/insights/trainerLevel.ts`; the web client's one
  fetch pipeline is `request<T>` in `apps/web/src/lib/api.ts`; storage's
  retry loop is the one `withRetries` in
  `packages/storage/src/object-store.ts`; the bulk image commands share
  `parallelMap` (`apps/images/src/parallel.ts`); the catalog and dex
  importers share `batchInsert` (`apps/sync/src/batchInsert.ts`); the
  agent-tools vocabulary that used to be re-declared per tool file
  (GOALS/FINISHES, `errText`, `defaultGoal`) lives in
  `packages/agent-tools/src/shared.ts`; and the web app grew two small homes
  of the same kind (`lib/reducedMotion.ts`, `routes/searchParams.ts`).
  `packages/storage`'s export surface is now curated rather than `export *`
  — a name is added only when something outside gains a real caller.

**Why:** Copies drift — most of these consolidations existed because a second
caller pasted rather than imported, and each copy was one bugfix away from
disagreeing with its sibling. Dead files mislead every agent that greps. And
the zero-behavior-change rule is what made a swarm of concurrent fixers safe
to run at all: any fixer that could not prove a change byte-identical in
effect had to skip it and record why. At entry time the tracked diff stood at
157 files, +813/−1536 lines, plus six new untracked files (the shared homes
above and a `research/foil-harness/README.md` script inventory).

**Implications:**

- The shared homes are the contract now: a new caller imports, it does not
  re-paste. Grep for the names above before writing any of them again.
- **Deliberately NOT done — routed to behavior-allowed passes.** Recorded so
  nobody "finishes" these as hygiene; each changes something observable and
  needs its own review:
  - `PurchaseSetMenu.tsx` fetches `/deckpal/api/...` directly
    (`PurchaseSetMenu.tsx:49`), bypassing `lib/api`'s pipeline with a
    self-host-only base path — broken in cloud. A real bug, not a
    consolidation.
  - `apps/api/src/decke/narration.ts` `TOOL_TAGS` (line 71) omits `journey`
    and `escort` from the roster `decke/tools.ts` defines.
  - The system prompt's duplicate "3." numbering — the prompt's bytes are
    measured; renumbering is a behavior change by this repo's own standards.
  - `apps/api/src/export/pdf.ts:60` prints a literal `'pokédex'` brand mark
    in the title band — user-visible text.
  - GLC `set_carveouts` is vendored in `apps/api/src/deck/data.ts` but never
    enforced — a legality gap, not dead data.
  - `log_cards` (`packages/agent-tools/src/tools/logging.ts`) can pass a raw
    driver error through to tool output.
  - Deferred consolidations that would move rendered output or need product
    judgment: a skin/topbar factory, the TableView/CardTile counter dedup, a
    `loadDeckModel` extraction, repo-wide ui-import canonicalization.

**Verified:**
- Every deletion re-checked against the tree at apply time: repo-wide
  reference grep including the dynamic import surface, tests, `scripts/`,
  `api/*.mjs`, and docs. All four deletions show as `D` in `git status`;
  nothing else was deleted.
- Each consolidation home confirmed the single definition in the tree at
  entry time (one `const UUID_RE`, one `withRetries`, one `parallelMap`, one
  `batchInsert`, one `shared.ts` vocabulary).
- Each routed-away finding confirmed still present (unfixed) at entry time —
  the hardcoded base path, the `TOOL_TAGS` roster, the `'pokédex'` literal,
  the unenforced `set_carveouts`.
- **Not verified (at entry time):** the pass's verification phase runs AFTER
  this entry — the plan is the full build, workspace-wide `tsc --noEmit`,
  the pure suites, and before/after UI capture at 1280×800 and 390 px
  against the live backend signed in with the QA account (`.qa-account`).
  None of it had run when this was written; this entry records the pass and
  its plan, not its proof.

---

