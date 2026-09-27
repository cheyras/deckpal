---
date: "2026-09-12"
title: "Security ingress guards, the UI chrome, and repo-hygiene cleanup"
decided_by: "GPT-6 Astra on behalf of @cheyras."
areas: ["security","frontend"]
supersedes: []
---
## 2026-09-12 — Security ingress guards, the UI chrome, and repo-hygiene cleanup

**Decided by:** GPT-6 Astra on behalf of @cheyras.

**Decision — API ingress guard.** A pre-auth rate limiter runs on the
ordinary base-path API router (`api`, mounted at `/api` on Vercel /
`/deckpal/api` self-host) in the `createApp` pipeline **before**
`authMiddleware`/token resolution and **before** the RLS `pool.connect()`. It
covers all requests on that router, including unauthenticated catalog reads,
at **600 requests/minute per source IP per process**. On the real Vercel
runtime (`process.env.VERCEL === '1'`) a narrow resolver uses the validated
platform `x-vercel-forwarded-for` (preferred) or `x-forwarded-for`; Vercel
overwrites these at ingress. Outside Vercel, forwarding headers are ignored
and the socket peer is used. Express `trust proxy` stays at its default
**false** (not loopback), and no new production env variable is required —
the existing `VERCEL` is platform-provided, not user input. The Stripe
raw-body webhook and the bare-origin OAuth discovery / `/register` / `/token`
handlers are mounted separately on `app` ahead of that router and are
**not** covered by this guard; the MCP transport at `/mcp` is a separate
function (`api/mcp.mjs`).

**Decision — per-user session routes.** `/tokens` 20/min, `/avatar` 10/min and
`/oauth` 30/min are guarded **after** authentication but **before** the RLS
`pool.connect`, mounted once above their routers (`requireSession` rejects PATs
and anonymous requests cheaply first). On self-host, where `authMiddleware`
leaves `req.user` unset, the account guards key on the socket peer; on cloud
`requireSession` still rejects anonymous/PAT before any per-user budget is
checked. Refusal is `429` with a `Retry-After` header in seconds. Each request
is charged **once per applicable budget** — it may consume both the ingress
budget and a per-user session budget, but there is no duplicate route-level
charge (the routers below carry no second limiter). Existing `requireSession`
policies are unchanged.

**Decision — what the budgets are and are not.** All application budgets are
bounded in-memory fixed windows, **per process / per serverless function
instance**, reset on restart or cold start. They are not a durable distributed
quota. Bounded key capacity (`MAX_KEYS`) and amortised expiry avoid memory
growth and per-rejection full-map scans. The guard stops retry storms and
casual abuse; it does **not** protect from distributed or network flooding,
and reverse-proxy / platform controls remain the deployment boundary. Never
claim otherwise.

**Decision — self-host images.** `apps/images` stays bound to `127.0.0.1`.
Health is **60 requests/min before `cacheStats` DB work**. Four sprite/set/card
asset routes share a generous **3000/min budget before filesystem/DB work**.
Identity is the socket peer; behind the ordinary loopback proxy these are
coarse shared **process/peer** budgets, **not** per-end-user quotas. Existing
cache headers, placeholders, path guards and provenance behaviour stay
unchanged; no asset writes, migrations or nginx changes happened.

**Decision — `sniffContentType`.** Malformed non-byte input types return
`application/octet-stream`; genuine `Buffer`/`Uint8Array` including nonzero-
`byteOffset` views are supported. Object/string/array values are rejected via
`util.types.isUint8Array`, which checks the internal `[[TypedArrayName]]`
slot.

**Decision — migration CLI errors.** The CLI's error output is a **closed set**
of fixed diagnostics plus an explicitly known pg/system code allowlist. The
`safeDiagnostic`/`safeReadCode` path never includes `err.message`,
`err.stack`, `err.detail` or `String(err)`, avoids getters/`toString`/coercion,
and guards dictionary membership as own-only. `safeReadCode` reads the `code`
descriptor as a data property, and the `getOwnPropertyDescriptor` call it makes
**can** trigger a hostile Proxy trap during descriptor inspection — those trap
exceptions are caught and discarded (never logged or stringified), returning a
fixed diagnostic. Unknown code strings are never echoed — a `TOPSECRET`-style
code would leak through a regex redactor, which is why a regex redactor (or an
uppercase-code regex) is insufficient: a redactor can only scrub shapes it
enumerates, and a hostile code property is a value, not a pattern.

**Decision — dependency advisories.** Addressed via `sharp >= 0.35.4`,
`hono >= 4.13.5`, `qs >= 6.16.0`, `fast-uri >= 3.1.6`; resolved versions live in
`pnpm-lock.yaml` (`sharp@0.35.4`, `hono@4.13.7`, `qs@6.16.0`, `fast-uri@3.1.7`).
Within-major `pnpm` overrides remain scoped. `hono` is explicit in
`apps/mcp/package.json` because optional peer resolution otherwise retained
the vulnerable version. The existing Dependabot batch plus the `sharp` and
`github-script` updates are consolidated into this changeset.
`actions/github-script` v7→v9 is an Actions **major** upgrade, not a minor
update. Permissions/approval logic is unchanged.

**Decision — MCP scope.** The MCP transport at `/mcp` (separate
`api/mcp.mjs` function) is **not** automatically covered by the 600/min guard.
The MCP token/OAuth **management** endpoints (`/tokens`, `/oauth`, `/avatar`)
are REST routes on the base-path router and use these REST controls. Existing
MCP-specific security details are preserved.

**Decision — UI chrome (logged concisely; not a UI-spec rewrite).**
- **#153/#174:** counters/badges stay above lifted card art (`z-index: 2`);
  pointer-hover effects apply only on hover-capable fine pointers
  (`@media (hover: hover) and (pointer: fine)`); keyboard focus remains on any
  device; touch scrolling does not latch hover.
- **#173:** mobile (<567px, incl. 390px) variant row is name+stepper on row 1,
  price on row 2; desktop (gap+) keeps the 3-column grid.
- **#154:** one mobile Actions dropdown (Shop/PurchaseSet/PrintChecklist; only
  Shop when signed out), desktop inline actions; shared purchase dialog resets
  safely on reopen/navigation; failed-logo fallback renders set names as text
  (no `outerHTML`/innerHTML sink) and recovers for new sets.
- **#162:** desktop wordmark 30→22.5 and D 33→24.75; mobile 22 unchanged.
- **#155:** redundant Overview/Trends tabs removed; chart/range/currency kept;
  30-day delta, Top Movers and empty states shown together.

**Decision — repo hygiene.** 10 ancestry/exact-merged-PR-verified local
branches and 2 verified-merged remote branches deleted; 12 stale
remote-tracking refs pruned; 13 gone-upstream links cleared. All linked
worktrees and branches with unique/ambiguous work were retained. Git bundles
were created before deletion, and 15,059 existing WIP files rehashed unchanged
after branch cleanup. Machine-specific backup paths are not published in
portable project docs. These are factual branch operations — no design
rationale is invented beyond proof-based preservation.

**Why.** The hygiene work closed real disclosure surfaces (unbounded
unauthenticated DB-connection acquisition, per-user mint endpoints with no
budget, raw `pg` message leakage into operator-facing CLI diagnostics,
dependency advisories) and corrected chrome regressions, while deleting
branches that had been verified merged or ancestry-duplicated.

**Implications.** Docs now state the exact limits, scope, `Retry-After`,
deployment identity and per-process limitation; `ARCHITECTURE.md` carries the
new middleware order; `apps/mcp/SPEC.md` and wiki `MCP-Setup` carry the
REST/OAuth/token distinction without inventing MCP transport changes.

---

