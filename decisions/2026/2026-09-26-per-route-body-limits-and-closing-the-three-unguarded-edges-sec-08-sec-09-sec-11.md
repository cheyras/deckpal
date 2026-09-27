---
date: "2026-09-26"
title: "Per-route body limits and closing the three unguarded edges (SEC-08, SEC-09, SEC-11)"
decided_by: "Claude (Sonnet 5), on behalf of @cheyras, from an internal"
areas: ["operations"]
supersedes: []
---
## 2026-09-26 — Per-route body limits and closing the three unguarded edges (SEC-08, SEC-09, SEC-11)

**Decided by:** Claude (Sonnet 5), on behalf of @cheyras, from an internal
security audit's edge-hardening findings.

**Decision:**

1. **Body-size limits are per route, not one blanket parser.** Removed the
   single `express.json({limit:'12mb'})` that sat on `app` ahead of every
   route (including `preAuthFloodGuard`, `authMiddleware`, and the bare-origin
   OAuth routes). In its place, `apps/api/src/index.ts` mounts named,
   most-specific-first parsers *immediately after `preAuthFloodGuard` and
   ahead of `authMiddleware`* (see finding 5 below for why that exact
   position matters), inside the base-path router: `/bugs` 12mb,
   `/dev/scan-queue` 4200kb, `/dev/scan-flags` 4200kb, `/decke` 2mb, `/lists`
   2mb, `/decks` 512kb (see findings 3–4 below for why these three aren't
   rounder, smaller numbers), and a 100kb default for everything else.
   `/register` and `/token` keep their existing 16kb parsers in
   `oauthServer.ts`, which are now actually reachable.
   `apps/api/src/http.ts`'s `errorMiddleware` now translates a body-parser
   `entity.too.large` error into a proper `413 payload_too_large` JSON
   response instead of a generic `500`.
2. **`/register`, `/token`, the two `.well-known` OAuth discovery routes, and
   `/mcp` each get a rate limiter.** The first four share a new
   `oauthPublicRateLimit` (`apps/api/src/rateLimit.ts`), 30/min per source IP,
   checked before the host allowlist or any body parsing — they previously had
   no limiter anywhere upstream of them, and `POST /register` is an
   unauthenticated `oauth_client` INSERT. `/mcp` (`apps/mcp/src/cloud.ts`)
   gets two limiters: a global, single-key 300/min-per-instance admission
   counter checked before `resolveToken`, and a 60/min-per-token budget keyed
   on the resolved `tokenId`, checked only after `resolveToken` succeeds (see
   the "Astra review" note below for why it is two layers and not one).
3. **`/bugs`' rate limit moved from `req.ip` to `req.user.id`.** A new
   `bugsRateLimit` (10/hour, `perUserRateLimit`) replaces the route's own
   hand-rolled per-IP bucket map in `routes/bugs.ts`.

**Why:**

- The blanket body parser meant every route — including unauthenticated ones
  — paid the bug reporter's 12mb ceiling before anything throttled it, and it
  silently shadowed `/register`'s and `/token`'s own smaller parsers:
  `express.json()` no-ops on a request whose body a *prior* matching parser
  already consumed, so whichever parser for a path ran first decided the
  limit, and the blanket one on `app` always ran first. The fix depends on
  that same mechanism running in the opposite, deliberate direction — see
  `apps/api/src/__tests__/bodyLimits.test.ts`'s regression control, which
  reproduces the original bug on purpose by reversing the mount order.
- `/register`, `/token` and the well-known discovery routes are mounted at the
  bare origin, ahead of the ordinary `/api` router that carries
  `preAuthFloodGuard` — so none of that router's guards ever ran for them.
  `/mcp` is a wholly separate Vercel function and was never in scope of any
  REST limiter either.
- `/mcp`'s per-token layer is keyed on the credential rather than the IP
  because claude.ai (and other hosted MCP connectors) call from that
  provider's own shared egress IPs — an IP-keyed limit there would let one
  heavy user on a connector exhaust the budget for every other user sharing
  the same egress IP, locking out strangers rather than the abuser.
- `routes/bugs.ts`'s own limiter keyed on `req.ip`, which behind a reverse
  proxy (self-host, `trust proxy` false) is always the same loopback peer —
  effectively one shared bucket for the whole deployment — and on Vercel read
  the raw, unvalidated `req.ip` rather than the platform-checked
  `x-vercel-forwarded-for` every other limiter in this codebase uses. Either
  way, one signed-in user filing 10 reports could silence the reporter for
  every other user. The route already requires identity by the time it runs,
  so keying on the account is both more correct and no harder.

**Sizing note (deviating from the audit's illustrative numbers where the
audit's own suggestion would have broken a real caller):** the audit's SEC-08
write-up suggested "4mb" for `/bugs`, but `routes/bugs.ts`'s own
`MAX_IMG_BYTES` is 8mb *decoded* — base64 costs +33%, so a real screenshot is
~10.7mb on the wire before the JSON wrapper. 12mb (the number this repo
already used) is correct; 4mb would have 413'd a legitimate full-size
screenshot. Two more routes needed exceptions the audit's SEC-08 write-up
didn't name at all: `/decke` (`routes/deckeHistory.ts`'s transcript-history
POST) and `/lists` (`POST /:id/items/bulk`). A third, `/decks`, was missed
entirely in the first pass and caught by the independent review below.

**Independent review (Astra/codex) caught two real regressions before this
shipped; both are fixed in the code this entry describes, not just noted
here:**

1. **[P1] The `/mcp` limiter's first version was itself a DoS.** It keyed its
   only check on `sha256(raw credential)`, before `resolveToken` — but an
   unauthenticated caller can mint unlimited distinct credential strings for
   free, and the check ran against the same bounded 10,000-key map every
   limiter in this codebase uses for safety. Review reproduced it directly:
   10,000 fabricated Bearer values filled the map's admission capacity, and a
   brand-new, never-before-seen, perfectly valid credential was then rejected
   too — for a full five-minute sweep window, since expired-but-present
   entries still counted against capacity until the next sweep. Fixed by
   splitting into two layers (see decision 2 above): a global, single-key
   counter before `resolveToken` (nothing for a flood to fill, since there is
   no key), and the per-token budget moved to run only after resolution,
   keyed on the database-verified `tokenId` rather than the raw string.
2. **[P2] The first pass sized character caps as if 1 character = 1 byte.**
   Every character-count cap in this codebase (`MAX_TEXT`, `STRATEGY_MAX`,
   `RAW_LOG_MAX`, …) is a JS string length — UTF-16 code units — not the
   UTF-8 bytes an `express.json()` limit measures. A BMP character outside
   Latin-1 (CJK, Hangul, Cyrillic — most non-English scripts) is 1 code unit
   but 3 bytes. Reproduced directly: 40,000 Japanese characters in a
   `strategyMd` field, well within `decks.ts`'s own `STRATEGY_MAX`, produced
   a 120,017-byte body — over the 100kb default that had no exception for
   `/decks` at all in the first pass, and `/decke`'s original 512kb was only
   ~2% headroom over its own worst case once measured correctly. Fixed by
   adding `/decks` (256kb) and bumping `/decke` (512kb → 1mb), both computed
   at the ×3 worst-case ratio, and by adding real multibyte HTTP tests
   (`apps/api/src/__tests__/bodyLimits.test.ts`) rather than trusting
   ASCII-only fixtures again.
3. **[P2] `/dev/scan-queue` and `/dev/scan-flags` had the mirror-image
   problem: 1 decoded byte was assumed to need less than 1.34 wire bytes.**
   `MAX_PHOTO_BYTES`/`MAX_UPLOAD_BYTES` (3 MB decoded) divides evenly by 3, so
   base64 encoding produces EXACTLY 4 MB on the wire — leaving zero room for
   the `{"jpg":…,"name":…,"source":…}` wrapper around it, not "room for the
   JSON wrapper" as `dev/scanQueue.ts`'s own pre-existing comment claimed.
   Reproduced with an actual `Buffer.alloc(3*1024*1024).toString('base64')`,
   not an ASCII estimate: a real max-size upload from a client that had done
   everything right — normalized correctly, stayed under the documented
   decoded cap — still 413'd against a bare 4mb parser. Fixed by widening
   both to 4200kb (~104kb of real headroom) and correcting the stale comment
   in `dev/scanQueue.ts` that asserted the opposite of what the arithmetic
   says. The test now encodes and sends a real 3 MiB buffer rather than an
   ASCII fixture, so this class of "estimated size, not measured size" bug
   cannot silently regress again.
4. **[P2] The ×3 multibyte fix in finding 2 was itself insufficient for a
   real client.** `/decke`, `/lists` and `/decks` are reachable over the
   plain REST API (a personal access token, an MCP client, a script), not
   only this repo's own browser client — so a limit sized only against this
   repo's `JSON.stringify` (which never escapes non-ASCII) is sized against
   the wrong client. Reproduced directly: Python's `json.dumps`
   (`ensure_ascii=True`, the default) encodes a supported 50,000-character
   `rawLog` as 300,013 bytes — `\uXXXX` costs 6 ASCII bytes for what a raw
   UTF-8 encoder spends 3 on — comfortably over the ×3-sized `/decks`
   exception finding 2 added. Fixed by resizing all three character-based
   exceptions to the ×6 worst case (`/decke` 1mb→2mb, `/lists` 1mb→2mb,
   `/decks` 256kb→512kb) and adding a second test per route that sends the
   ASCII-escaped serialization, not just the raw-UTF-8 one.
5. **A merge-order hazard with a concurrently open PR, found while verifying
   the coordinator's own note about it.** PR #209 (`fix/error-boundaries`)
   adds `POST /client-errors`, mounted immediately after `preAuthFloodGuard`
   and reading `req.body` directly with no parser of its own — relying, like
   every other route in this codebase, on a shared parser having already
   run. The coordinator's framing ("make sure your default covers ~16kb")
   was addressing body SIZE; checking the actual diff found a different,
   more serious problem: that route sits before this PR's entire body-size
   block (which, until this finding, sat after `authMiddleware` and the
   per-user rate limits) — so once both PRs merge, `/client-errors` would
   run with NO body parser having executed at all, silently logging every
   crash report as empty rather than erroring. Fixed by moving the whole
   SEC-08 block to mount immediately after `preAuthFloodGuard`, ahead of
   `authMiddleware` — a genuine improvement on its own (bodies bounded
   before spending any auth work) that also means a future PR inserting
   something at that same insertion point produces a textual merge conflict
   to resolve consciously, rather than a silent, no-conflict merge that
   quietly breaks whichever route arrived first.

All five findings are the kind that plausible reasoning and ASCII-only test
fixtures cannot catch — the first needed an adversarial "what can an attacker
who never authenticates do" pass; the second, third and fourth each needed an
actual multibyte string, an actual base64-encoded buffer, or an actual
ASCII-escaped serialization, not an estimate of what one would look like; the
fifth needed reading the other PR's actual diff instead of trusting a
secondhand description of it. Recorded here because the pattern (character
length vs. byte length, in both directions and both serializations;
per-credential vs. global admission for unauthenticated traffic; verify a
cross-PR claim against the real diff) will recur the next time someone sizes
a limit or coordinates a shared file in this codebase.

**Implications:**

- `SECURITY.md`'s "Rate limiting (REST API)" and new "Body-size limits (REST
  API), per route" sections, and `DEPLOYMENT.md`'s "Rate limiting" and new
  "Body-size limits" subsections, document the exact numbers and the ordering
  mechanism above. Read those before changing any of these limits again — the
  ordering (most-specific-first, default last, all of it ahead of
  `authMiddleware`) is load-bearing, not cosmetic.
- No new environment variable: every number above is a hardcoded constant,
  matching the existing style of every other limiter in `rateLimit.ts`.
- If a future route needs a body bigger than 100kb, it needs its own scoped
  `express.json()` mounted *before* the 100kb default in `index.ts`'s ordered
  block — appending it after the default is the exact bug this decision
  fixes. If a future route needs no identity at all (like `/client-errors`),
  its natural home is that same block, right after `preAuthFloodGuard` —
  which is exactly why finding 5 above moved the block there.
- If a future character-count cap needs a body-size exception, size it at
  ×6, not ×3: a raw-UTF-8 client is the CHEAPEST case, not the worst one, once
  the route is reachable from anything other than this repo's own browser
  code.
- Deck-E's live chat (`api/chat.mjs`, SEC-04 in the same audit) is a separate
  Vercel function with its own body handling and is untouched by any of this;
  an open PR (`fix/decke-hardening`) bounds its request body with zod
  independently.
