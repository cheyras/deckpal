---
date: "2026-08-18"
title: "Deck-E ships to production, owner-only"
decided_by: "user."
areas: ["agents","decks"]
supersedes: []
---
## 2026-08-18 — Deck-E ships to production, owner-only
**Decided by:** user.
**Decision:** `/dev/decke` is no longer dev-only. It ships in the production
build and is gated to the deployment's owner, the same shape `/design` already
uses.

`GET /me` grows an `owner` boolean beside the existing `designEditor`. Both are
the same answer from the same server-side check against `DESIGN_EDITOR_USER_ID`;
`owner` simply says what it means, and is what new owner-only surfaces should
read. The env var keeps its historical name deliberately — it is already set in
production, and renaming it would silently close BOTH surfaces on the next
deploy. Unset still means nobody, so this fails closed.

The check stays server-side, verified against the JWT. A client-side check would
be a suggestion rather than a gate, and would also bake the owner's identity into
the public bundle.

**What this costs, and who pays it.** Shipping the route means rollup emits its
chunk — ~945 kB of three.js and the character runtime — and the character's
5.6 MB of assets sit in `public/models/`. The import is lazy, so nobody who does
not open the route downloads any of it. That is only true because both are
excluded from the PWA precache manifest, which is EAGER: `globPatterns` matches
all `**/*.js`, so without `globIgnores: ['models/**', 'assets/Decke-*.js']` the
service worker would pull 6.5 MB into every visitor's cache on first load, for a
route exactly one account can open. Measured after the change: precache unchanged
at 25 entries / 1964 KiB, and the Decke chunk present in `dist/assets/` but
absent from `sw.js`.

That exclusion is now load-bearing in a way it was not when the route was
dev-only, and the comment in `vite.config.ts` says so.

**Rejected:** a dedicated `DECKE_PREVIEW_USER_ID`. It would allow gating the two
surfaces independently, which nothing needs today, and would require setting a
new Vercel variable before the route worked at all — until then it would deploy
and 404 for everybody, which is safe but pointless.

