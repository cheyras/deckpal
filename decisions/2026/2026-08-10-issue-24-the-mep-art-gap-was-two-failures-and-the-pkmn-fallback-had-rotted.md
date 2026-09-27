---
date: "2026-08-10"
title: "issue #24: the mep art gap was two failures, and the pkmn fallback had rotted"
decided_by: "Not recorded"
areas: ["general"]
supersedes: []
---
## 2026-08-10 — issue #24: the mep art gap was two failures, and the pkmn fallback had rotted

**What:** #24 reported "a lot of card art images missing" on
`/series/mega-evolution/mep`. It was not one gap but two, stacked, and neither
was visible from the browser.

**Why the browser could not see it.** A cache miss does not break the `<img>` —
`apps/images/src/placeholder.ts` serves a valid ~1 KB card-shaped WebP with HTTP
200. So `naturalWidth > 0` is true for a missing card and a present one alike,
and counting broken images on the page reports zero while half the set is blank.
Resource-timing bytes do not work either: the art is cross-origin without
`Timing-Allow-Origin`, so `encodedBodySize` reads 0 for every entry. The only
honest signal is fetching each URL and measuring the body. The set grid also
virtualizes — a full-page screenshot only ever renders ~16 of the 89 tiles — so
the work-list has to come from the `card` table, not the viewport.

**Gap 1 — 23 cards had a `low` object that never reached the bucket.** mep-017…031
and mep-038…045 had both qualities on the Pi's disk tier and a `high` object in
Supabase Storage, but no `low`. The cloud tier held 60 `high` and 37 `low` for the
set: a partially-completed backfill, not a source problem. `storage:backfill
--prefix images/en/me/mep` closed it. It is idempotent by design and re-recorded
the 82 per-tier rows for objects already present, which is the property that makes
a re-run repair a previous partial one.

**Gap 2 — 29 cards had no asset at all, and TCGdex genuinely does not have them.**
mep-046…063, 072, 073, 081…088 and mep-Museum. `warm:gaps --set mep` probed the CDN
and returned `upstream-gap=58` (29 cards × 2 qualities) with zero errors — real
404s, not a fetch bug. That is exactly the case `warm:pkmn` exists for.

**The fallback was broken, and its error message sent the reader the wrong way.**
`warm:pkmn` died with `could not list pkmn sets (session expired?)`. The session
was fine: `POST /v1/auth/refresh` returns 200 on the stored credentials. What had
happened is that upstream renamed `GET /v1/sets` to `GET /v1/set`, singular. Since
`apiJson` only retries on 401, a 404 fell through as a `null` and the only message
on that path blamed auth — so the obvious next move is to go re-authenticate a
token that was never the problem. Fixed to call `/v1/set`, and the throw now names
the route and says refresh succeeds independently. The envelope is unchanged
(`{ value: PkmnSet[] }`), `category` still spells English sets `'EN'` (211 of them),
and MEP is present as `ME Black Star Promos`. With the route corrected the warmer
took all 29 cards at both qualities, 3,996,572 bytes, `no-match=0 rejected=0
errors=0`.

**Verification.** `manifest:check` **CLEAN, exit 0** on disk: 47,982 rows, up
exactly 58 from 47,924, with the increase attributed to `assets.pkmn.gg` in the
provenance breakdown — the bytes and their source landed together, which is the
whole point of routing writes through `putAsset` rather than writing files
directly. `manifest:check --object-store` **CLEAN, exit 0**: 3,060 objects /
3,060 rows, 0 etag mismatches. The cloud tier now holds 89/89 at both qualities.
End-to-end against **deployed deckpal.app**, signed in as the new QA account:
all 178 URLs (89 cards × 2 qualities) return real art, 0 placeholders, 0 HTTP
failures. Browser at 428×781 — the reporter's own iPhone viewport — scrolled
through the previously-empty middle of the set: #039–042 and #065–068 render real
art. **This is the first change verified on the deployed site rather than only
locally**; the gap #16 and the 2026-08-10 series-logo entry both recorded is now
closed by the QA account rather than left outstanding.

**Implications.**

- A third-party route rename is a *when*, not an *if*, and the cost of it is set
  entirely by whether the error message points at the right thing. `apiJson`
  collapses every non-401 into `null`, so any caller that throws a guessed cause
  will mislead the same way. When a helper erases the failure reason, the call
  site is the last place that can still be honest, and "I got no envelope from
  <route>" beats a plausible theory about auth.
- "Missing image" is not observable through a placeholder that returns 200 by
  design. Any future art-coverage check must measure bytes and drive off the
  `card` table; a browser pass over a virtualized grid can only ever confirm the
  tiles it happened to mount.
- The two gaps had different causes and only one had a source problem. Reaching
  for `warm:pkmn` first would have papered over the incomplete backfill, and
  running only the backfill would have left 29 cards blank. Coverage questions
  want the per-tier breakdown before the fix, not after.
- `warm:pkmn` rotates its refresh token on use. Running it against a copy of the
  session leaves the original path holding a dead token; the live pair now sits at
  `~/Transfer/pkmn-auth.json`, the documented `PKMN_AUTH` default, verified by an
  actual `/v1/set` call rather than assumed.

_Filed by agent on behalf of @cheyras — 2026-08-10._

