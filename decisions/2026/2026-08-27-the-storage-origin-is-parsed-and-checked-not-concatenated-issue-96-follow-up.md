---
date: "2026-08-27"
title: "The Storage ORIGIN is parsed and checked, not concatenated (issue #96 follow-up)"
decided_by: "Claude Opus 5 on behalf of @cheyras"
areas: ["images"]
supersedes: []
---
## 2026-08-27 — The Storage ORIGIN is parsed and checked, not concatenated (issue #96 follow-up)

**Decided by:** Claude Opus 5 on behalf of @cheyras

**Decision:** `object-store.ts` composes every request with
`storageUrl(supabaseUrl, path)` — a `new URL()` against a parsed, https-pinned
origin — instead of interpolating `${supabaseUrl}` into a template string.

**Why, and it is a correction.** PR #123 closed #96 with the acceptance
criterion *"zero open `js/request-forgery` alerts"*, verified against
`refs/pull/123/merge`. Measured on `main` after the merge, that is **not what
happened**: #36 (`fetch-source.ts`) and #56/#57 (`agent-tools/api.ts`) read
`fixed`, but **#37, #39 and #60 came back open** at new line numbers.

The path guard was never going to close them. `assertSafeObjectPath` hardens the
half that was reachable — the bulk paths (`backfill`, `rekeySet`, the warmers)
build keys from database values and are now checked at the choke point rather
than by convention at the caller — and that work stands. But the taint reaching
`fetch()` was the **host**: the request was `${supabaseUrl}/storage/v1/...` with
`supabaseUrl` straight out of `process.env`. No guard on the path terminates a
flow through the host.

That is the same lesson alert #63 taught on `fetch-source.ts` during the same
PR, recorded then as *"a validator that returns the value it validated has not
narrowed anything a reader — or an analyser — can rely on."* `fetch-source.ts`
got the constant-origin fix; `object-store.ts` did not, and nothing compared the
two.

**A literal `switch` is not available here** — the project URL is genuine
deployment configuration and cannot be enumerated in source. So the origin is
parsed and checked once, which buys three things the string form did not:

- a malformed `SUPABASE_URL` fails at the boundary with a named error rather
  than producing a request to something unintended;
- the scheme is pinned to `https:`, so no configuration can send the
  service-role key over plaintext;
- a path can no longer escape the origin — `new URL` resolves it, and a
  protocol-relative `//evil.example/x` becomes a path on the configured host
  rather than a new one. That is a test.

**Implications.**
- Never interpolate `supabaseUrl` again; `storageUrl()` is the only composer.
- An acceptance criterion measured on a merge ref is not measured on `main`.
  Check the branch you actually shipped to.

