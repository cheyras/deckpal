---
date: "2026-08-10"
title: "The catalog goes public, and the leakage audit that made it safe"
decided_by: "agent on behalf of @cheyras (owner-approved product change)"
areas: ["catalog"]
supersedes: []
---
## 2026-08-10 — The catalog goes public, and the leakage audit that made it safe

**Decided by:** agent on behalf of @cheyras (owner-approved product change)

**Decision:** Logged-out visitors can browse the whole catalog on deckpal.app —
series index, set pages, card detail, search and the Pokédex. Everything
per-user stays gated: collection quantities and owned state, completion
percentages, lists, binders, decks, battle logs, insights, the scanner, profile,
bug reports and MCP tokens.

Public (anonymous-readable): `GET /search`, `/series`, `/series/:slug`,
`/sets/:setId`, `/cards/:cardId`, `/dex`, `/dex/:speciesId`,
`/insights/pokedex`, `/insights/pokedex/:speciesId`, plus `/health` and the
index. Everything else 401s exactly as before, including
`/sets/:setId/massentry` and `/sets/:setId/checklist.pdf`, which sit on public
paths but are per-user by definition (the cards you still NEED).

**Why:** The catalog was the product's shop window and it was behind the signup
form. 23,546 cards, every set, every price — invisible until you had an account.
Nothing about that data is private.

**The hard part was never routing.** Catalog responses had quietly grown
per-user fields: `/series` carries a completion rollup, `/sets/:setId` carries
three progress goals plus per-card `ownership` and per-variant owned counts, the
Pokédex carries capture/level/shiny. A previous agent had already noticed the
symptom and marked those routes `private, no-cache` *precisely because* they
carry ownership. Opening them without touching their payloads would have handed
an anonymous visitor whichever user the route happened to resolve.

**Three independent layers now sit between an anonymous request and anyone's
collection, listed in the order they fail:**

1. **Identity.** A second, explicit seam beside `currentUserId()`:
   `resolveOptionalIdentity` + `optionalUserId()`, whose answer is
   `string | null` where `null` means *settled: nobody* — distinct from *nobody
   has asked yet*, which still throws the same loud 500. It is a separate
   function rather than a widened `currentUserId`, because widening would have
   made ~30 user-scoped call sites nullable and a nullable user id in a `WHERE`
   clause is the exact bug the identity seam was built to prevent. An anonymous
   request still leaves `req.user` undefined, so a route that reaches for a real
   user throws instead of reading one. The CI guard is untouched and extended:
   it now recognises both accessors, and `__tests__/identity.test.ts` covers all
   four branches of the new middleware plus the "currentUserId still throws on
   an anonymous request" case.
2. **SQL.** The `null` is bound as a parameter, so `ci.user_id = $2` evaluates
   to UNKNOWN for every row. Not a filter that can be forgotten — three-valued
   logic. The anonymous result set is empty by the semantics of the language.
3. **RLS.** This is the layer that was actually missing. The pool connects as
   `postgres`, which OWNS every table in `public`; the tables are not `FORCE ROW
   LEVEL SECURITY`, so **the pool role bypasses RLS entirely**. Before this
   change that did not matter — anonymous requests only reached `/search` and
   `/health`, which touch no user table. Now they read `collection_item`,
   `user_set_progress` and `user_dex_state` in LEFT JOINs. So anonymous requests
   in `SUPABASE_MODE` now open the same per-request transaction authenticated
   ones do, with `SET LOCAL role = 'anon'` and no JWT claims.

**Measured, not assumed** (live production DB, 2026-08-10):

| as role | `collection_item` | `user_set_progress` | `user_dex_state` | `card` |
|---|---|---|---|---|
| `postgres` (pool owner) | 455 | 642 | 0 | 23 546 |
| `anon` (anonymous requests) | **0** | **0** | **0** | 23 546 |

The catalog policies are `USING (true)`; every per-user table has no policy an
anonymous caller can satisfy, and `anon` already held the SELECT grants from
Supabase's schema defaults. So the full catalog is visible and the per-user
tables are empty — enforced by the database, not by the query.

**Absent, not zeroed.** Anonymous responses OMIT the ownership keys rather than
sending zeroes. "0 of 1,823 collected" is a claim about a person who is not
there, and absence makes the audit `Object.keys(response)` instead of an
argument about which zero is real. The web types made the same fields optional,
which is what forced every consumer to state what it renders instead — quantity
steppers became "Sign in to track", progress bars became the reason they are
missing. The compiler enumerated all 14 call sites; none was found by reading.

**Audit method (repeat it before opening any further route):** for each route,
`curl` it with no `Authorization` header and print `Object.keys()` of the top
level, of each collection element, and of every nested per-user object. The
anonymous shape must not contain `progress`, `ownership`, `quantity`,
`captured`, `completion`, `owned`, `ownedQuantity`, `uniqueOwned`, `level`,
`levelLabel`, `shiny` or `shinyBreadth`. Verified for all nine public routes.

**Caching stays `private, no-cache, must-revalidate` for both shapes.** It was
tempting to serve the anonymous shape as `public, max-age=…` — it is pure
catalog. Rejected: one URL would then have two variants in a shared cache, and
without a `Vary: Authorization` a CDN honours, a signed-in visitor could be
handed the ownership-free copy. That is a UX bug rather than a privacy one, but
it is a silent, hard-to-reproduce one, and the caching win was not asked for.

**Implications:**

- Self-host is unchanged in every branch. There is no signed-out state there
  (the reverse proxy is the auth boundary, SECURITY.md), `optionalUserId` always
  returns the single local user, and no anonymous role is ever set.
- Anonymous cloud requests now hold a pooled connection for the request's
  lifetime, exactly as authenticated ones do. Contract B2's budget of 2 is
  unchanged, but the *share* of requests holding a connection goes up with
  logged-out traffic. Worth watching in the Supabase dashboard.
- Adding a per-user field to any of the nine public routes is now a leak unless
  it is added inside the `userId === null ? {} : {…}` spread. The web type must
  stay optional; making it required is the tell that someone forgot.
- The frontend's rule is "no authenticated query mounts while `signedIn !==
  true`". `useSignedIn()` is deliberately tri-state; asking the negative
  question (`!signedOut`) is `true` during the tick before the session is read
  from localStorage, and that one tick was enough to fire `GET /avatar` and take
  a 401 on every catalog page. Caught in a real browser, not in review.

_Filed by agent on behalf of @cheyras — 2026-08-10._

