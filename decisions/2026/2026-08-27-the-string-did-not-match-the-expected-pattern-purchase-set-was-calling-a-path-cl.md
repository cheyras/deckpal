---
date: "2026-08-27"
title: "\"The string did not match the expected pattern\": Purchase Set was calling a path cloud does not serve"
decided_by: "Claude Opus 5, on behalf of @cheyras (issues #89 and #113)"
areas: ["catalog"]
supersedes: []
---
## 2026-08-27 — "The string did not match the expected pattern": Purchase Set was calling a path cloud does not serve

**Decided by:** Claude Opus 5, on behalf of @cheyras (issues #89 and #113)

**Decision.** `PurchaseSetMenu` no longer fetches for itself. A new
`api.setMassEntry(setId, goal, finishes, signal)` in `apps/web/src/lib/api.ts`
is the only way to reach `GET /sets/:setId/massentry`, and it inherits what that
file already owns: the deployment-correct base path, the `Authorization` header,
and the single 401-refresh retry. Two guards ship with it — a content-type check
so a non-JSON 2xx fails loudly, and `apps/web/scripts/check-api-base.mjs`, wired
into `pnpm --filter deckpal-web build`, which fails the build on any hardcoded
API base under `apps/web/src`.

**Why.** The component wrote its own URL:

```
fetch(`/deckpal/api/sets/${setId}/massentry?${params}`, { signal })
```

`/deckpal/api` is the SELF-HOST prefix. `vercel.json` has no rewrite for it, so
on cloud the request fell through to the catch-all SPA rewrite and came back
**HTTP 200 with `text/html`** — the app's own `index.html`. `res.ok` was true,
so the hand-rolled error branch never ran, and the failure surfaced four lines
later inside `res.json()` as whatever the browser's parser calls a syntax error.
Measured against production on 2026-08-27:

```
/api/sets/me05/massentry?goal=complete          → 401 application/json
/deckpal/api/sets/me05/massentry?goal=complete  → 200 text/html
```

**Issue #113 is the user-visible half of #89, and the wording proves it.** An
iPad reporter on `/series/mega-evolution/me05` — the exact page this component
lives on — saw "did not match expected pattern". WebKit's `Response.json()`
rejects with a bare `ExceptionCode::SyntaxError` (`fulfillPromiseWithJSON`,
`JSDOMPromiseDeferred.cpp`), and `DOMException`'s table gives that code the
description `"The string did not match the expected pattern."` — no message of
its own, no path, no status. Reproduced in Chromium against the live backend:
the pre-fix component gets `200 text/html` on `/deckpal/api/...` and renders
Chromium's phrasing of the identical rejection, `Unexpected token '<',
"<!doctype "... is not valid JSON`. Same throw, different browser's sentence.

**Why not just fix the string.** The missing `Authorization` header is an
equally real defect: that route is per-user and 401s without a credential, so
correcting only the path would have swapped a mystery for a 401 on every cloud
user. The 401-refresh retry is the third. All three live in `lib/api.ts`, which
is the argument for going through it rather than reproducing it.

**Why `res.ok` needed help.** A 2xx carrying HTML is the SPA fallback's
signature, and it is invisible to every check the client had. `jsonBody()` now
refuses a success response whose content-type is not JSON and says so:
`/deckpal/api/sets/me05?… answered 200 with text/html instead of JSON — this
build is asking for an API path the deployment does not serve.` Verified in the
browser by temporarily forcing the wrong `BASE`. The predicate is a separate
zero-import module (`lib/jsonContentType.ts`) purely so it is testable under the
`node --import tsx --test` harness, which cannot load `import.meta.env`.

**Why a build gate rather than a lint rule.** One occurrence does not earn an
ESLint config this repo does not have. `check-api-base.mjs` follows
`check-precache.mjs`'s precedent — a small node script in the web app's own
`build` script, so CI and Vercel both run it. It flags a quoted path literal
starting `/deckpal/api` or `/api/` in value position; comments and prose are
excluded, since both prefixes are written in backticks all over this codebase's
explanations. Two files are allowlisted with their reasons in the file:
`lib/api.ts`, which owns the decision, and `character/host/useDeckeChat.ts`,
which targets `api/chat.mjs` — a Vercel function with no Express twin.

**Implications.**
- Nothing in `apps/web/src` may write an API path literal again; the build says
  so. A caller with no method in `lib/api.ts` should get one.
- Every `lib/api.ts` call now fails loudly on a non-JSON 2xx. No endpoint
  returns a non-JSON success body (the only 204 in the API is the CORS
  preflight), so this changes no working path.
- `apps/web/src/lib/api.ts` now type-imports `Goal` from `routes/setSearch`.
  Type-only, so it erases — no runtime lib→routes edge.
- **A second, independent cause of "spotty" cart links is NOT fixed here and is
  reported instead.** `buildCart` deliberately separates PROVEN product-id lines
  from BEST-EFFORT token lines into different URLs, because Mass Entry is
  all-or-nothing and one unresolvable line voids a whole submission. But
  `cartPayload` concatenates them into one `urls` array and the UI renders every
  entry as an identical "part i of N" button, so a best-effort link that adds
  nothing looks exactly like a proven one that works — which is what closed
  issue #37 ("it always says it couldn't fill every single one") describes. The
  response already carries `exactUrls` and `bestEffortUrls` separately; labelling
  them is a UI change for its own issue.
- The 20s `AbortSignal.timeout` is NOT a cause. Measured through the dev proxy
  against production on `me05` (120 cards): complete 2.9 s, master 2.1 s,
  grandmaster 2.8 s — roughly 7x headroom. Its message was still the plumbing's
  ("signal timed out"), so it now reads as a deadline the reader can act on.

---

