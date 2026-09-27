---
date: "2026-09-07"
title: "The scanner ships to production owner-only, and the model rides the build"
decided_by: "@cheyras, verbatim: *\"push what we've done here live to prod, but"
areas: ["agents","scanner","frontend","operations"]
supersedes: []
---
## 2026-09-07 — The scanner ships to production owner-only, and the model rides the build

**Decided by:** @cheyras, verbatim: *"push what we've done here live to prod, but
remove the scanner entirely for anyone that isn't me (cheyras@gmail.com). so
scanner is updated/current live on prod but only accessible to my account for the
time being just like is the case for Deck-E... I'd also like the quad training dev
surface to be live on prod (but again, just for me)."* Implemented by Claude Opus 5.

**Decision:** the rebuilt scanner goes live on `deckpal.app` and is reachable by
one account. "Entirely" is read as covering every door and every mention, not
just the route.

### Six doors, and the two that are actually controls

`/scan` gets the `beforeLoad` guard `/design` and `/dev/decke` already use — DEV
open, self-host open, cloud asks `GET /me` for the server-computed `owner` flag,
everything else `notFound()`, with the `catch` falling through to the same
refusal so a network blip fails closed. The nav row, the header camera button and
the mobile drawer read the same flag through `lib/ownerSurface.ts`, a copy of
Deck-E's entitlement module including its module-scope auth listener — the escape
hatch that file exists to warn about, because Deck-E's was written and never
connected, and the result was a feature that never appeared until a hard refresh.

Those four decide what is DRAWN. The one that decides what HAPPENS is
`apps/api/src/scan/router.ts`: `POST /scan`, `/scan/resolve` and `/scan/embed`
now answer 404 to a non-owner on production. Deck-E's postmortem is the whole
argument — `POST /api/chat` was gated only in the browser, and an ordinary
signed-in account got a full model turn by asking the endpoint directly. Gating
the route and not the API would have left the old public scanner running behind a
hidden button, which is not what "remove the scanner entirely" means.

**404, not 403.** A 403 confirms to anyone probing that deckpal.app has a scanner
behind a door. The route guard throws `notFound()` for the same reason, and a
pair like this leaks whatever the more talkative half gives away. `/dev/scan-flags`
keeps its 403: it is a documented operator tool whose existence is uninteresting.
That difference is now a parameter on one shared middleware
(`apps/api/src/ownerGate.ts`) rather than three hand-synced copies of `isOwner` —
`routes/me.ts` had one, `dev/scanFlags.ts` had a second with a comment admitting
it was kept in sync by hand, and the scanner would have been the third.

The sixth door was not a door at all: the public marketing landing page carried a
"Card scanner" feature block, and `index.html`'s meta description and JSON-LD
advertised the scanner to crawlers. Every reader of those is a non-owner. An
advertisement for a feature that answers Not Found is the trace the gate exists
to remove, so all three are gone; `ScanMockup` stays in the file, unimported and
tree-shaken, so reopening is one import. `/scan` also left Deck-E's
`ROUTE_ALLOWLIST` on both sides, because `DECKE_ENTITLED_USER_IDS` deliberately
includes the QA account — he would have been walking an entitled non-owner to a
404.

**The scanner does NOT get `/dev/quad-labeler`'s `*.vercel.app` allowance.** That
allowance stays exactly as it was (round 9 measured what removing it costs: it
locked out the only person who uses the surface, since the owner labels signed in
as QA per B12). The scanner was gated "just like Deck-E", and `/dev/decke` is
owner-only on every cloud deployment including previews. The consequence is real
and stated rather than discovered later: **the QA account cannot open `/scan` on a
preview deployment.** Browser verification of the scanner is an owner-session job
now.

### The model file: "placed by hand" described a laptop, not a deployment

`apps/api/assets/embed/clip-vit-b32-openai.onnx` is 88 MB, gitignored, and named
by `vercel.json`'s `includeFiles` — which can only carry a file that is on disk
when Vercel traces the function. A cloud builder clones the repo and nothing
else, so those two facts had no overlap and the checkpoint was never in a
deployed bundle.

`scripts/fetch-embed-model.mjs` runs first in the build chain: it downloads the
model from the `card-art` bucket, verifies a pinned sha256
(`871a5a90…31421759`), and writes it where the API reads it. It is staged as
`.part0/.part1/.part2` because one 88 MB object was refused with a 413, and the
loop stops at the first missing part after part0 so a re-stage at another chunk
size needs no code change. No dependencies, because it runs before anything is
built — which is also why `EMBED_MODEL_ID` is spelled twice and a test pins the
copies together.

Two asymmetric failure modes, on purpose. **No credentials → loud log, exit 0**:
a fork, CI or a self-host build must not break over an asset it was never going
to use, and with `SCAN_EMBED_MATCH` off the ladder already degrades exactly as a
missing model makes it. **Digest mismatch → fail the build**: a model that is
present and wrong produces query vectors incomparable with the catalogue's, so
the scanner would rank confidently and rank nonsense. Same reasoning
`tools/embed-catalog` records for refusing to run without its checkpoint.

### One bug found on the way, worth more than the feature

`@deckpal/matching` was missing from `vercel.json`'s build chain. Its package
`exports` resolve to `dist/index.js` at RUNTIME and `scan/router.ts` imports
`EMBED_MODEL_ID` from it at module scope, so an unbuilt copy makes
`api/index.mjs` throw `ERR_MODULE_NOT_FOUND` on cold start and **500 the whole
API, not just the scanner**. Nothing caught it: the package's `types` condition
points at `src/`, so `tsc --noEmit` is perfectly happy without a `dist/`, and CI
built it while production did not. It is in the chain now and a test asserts both
its presence and its order.

**Implications:** `DESIGN_EDITOR_USER_ID` now gates the scanner as well as
`/design` and the `/dev/*` routes — DEPLOYMENT.md's entry says so, and an unset
variable still means nobody. Reopening the scanner is: delete one line in
`scan/router.ts`, delete the `beforeLoad` in `main.tsx`, drop `ownerOnly` from
the nav row, restore the landing block and the two metadata phrases, and put
`/scan` back in both `ROUTE_ALLOWLIST`s. Each of those is pinned by a test that
names what to do.

---

