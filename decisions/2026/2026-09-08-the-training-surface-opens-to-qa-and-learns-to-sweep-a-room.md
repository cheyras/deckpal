---
date: "2026-09-08"
title: "The training surface opens to QA, and learns to sweep a room"
decided_by: "@cheyras, verbatim: *\"i want the scanner and the quad training"
areas: ["general"]
supersedes: []
---
## 2026-09-08 — The training surface opens to QA, and learns to sweep a room

**Decided by:** @cheyras, verbatim: *"i want the scanner and the quad training
surface to be live (quad training surface only accessible for my account and the
qa account)"*, and, on the trainer itself: *"so that I can for example, point it
around the room and see what nonsense it's drawing quads around, so that i can
focus my 'not a card' and 'no card' training efforts on stuff that it is
actually somewhat detecting as being card-like"*. Implemented by Claude Opus 5.

### One flag, because two gates have to agree

`/dev/quad-labeler` was owner-only on production. So was `POST /dev/scan-flags`
— which is not a second surface but the SAME one: `labeler/saveLabel.ts` is the
only path a label takes and it posts there. Widening the route alone would have
given the QA account a page that labels happily and 403s on every save, which is
the Deck-E hole run backwards: a client more permissive than its server rather
than less.

So both now read one predicate. `isLabelerEntitled` sits next to `isOwner` in
`apps/api/src/ownerGate.ts` — the file that exists because three hand-synced
copies of `isOwner` had already drifted — and is surfaced as `labeler` on
`GET /me` for the route guard. The production/refusal half of both middlewares
is written once (`entitledOnlyInProduction`); only the predicate varies.

**`LABELER_ENTITLED_USER_IDS`, falling back to Deck-E's list.** Unset, the
labeler inherits `DECKE_ENTITLED_USER_IDS`, which is already set in production
and already names the owner plus the QA account — so the ruling took effect on
the next deploy with no Vercel change and no B9 approval to wait on. That
matters more than it looks: B11's postmortem is about `/design` shipping gated
on a variable nobody set, silently, for four days. A gate that needs a config
step is a gate that can be half-deployed.

**The coupling is real and is the price.** Widening Deck-E later would widen the
labeler. Setting `LABELER_ENTITLED_USER_IDS` REPLACES the inherited list, which
is how the two get decoupled without a code change; `GET /health` reports which
of the two is in force (`owner-plus-list` vs `owner-plus-decke-list`) so the
answer is never a guess. An empty string is treated as a typo and falls back
rather than locking the owner out of their own tool.

**`/scan` did not widen.** The 2026-09-07 ruling stands untouched — owner-only,
404 not 403. The two route guards sit twenty lines apart in `main.tsx` and share
a shape, which is exactly the distance at which a widening gets copied by
accident, so `scannerGate.test.ts` now asserts BOTH halves: the labeler gates on
`me.labeler` and never on `me.owner`, and the scanner the reverse.

### Sweep mode: the stage that stopped it is the datum

`CaptureStage` ran no live detection, on purpose and with a good reason recorded:
the detector runs once on the frozen frame, and burning it on a view nobody is
about to save buys nothing. That reason holds for labelling a stack of cards and
fails completely for the job asked for here. Walking a room, the frames worth
capturing are the ones the reader cannot pick out by eye — a doorframe the
presence head scores 0.42 looks exactly like one it scores 0.02.

So `live` is an opt-in toggle (OFF by default, the default being the
load-bearing part) that drives `createScanEngine()` against the same `<video>`
the stage already owns. One camera, one stream, the shipping engine.

**What it reports is WHICH STAGE said no**, because the pipeline has five places
to refuse and they mean different things. A near-miss at the presence gate is a
`not_a_card` worth labelling; a quad that dies on the tracker's reticle filter
is not a detector problem at all (the reader was not aiming at it); one that
reaches the lock and dies on saturation is the postal-envelope case
`DEFAULT_LOCK_MIN_SATURATION` exists for. Calling all three "false positive"
throws away the only thing that separates them. `labeler/sweep.ts` is the pure
reduction of one `EngineState` to that verdict, and it is pure so it can be
tested without a camera, a model or a DOM.

**Two additive fields on `EngineState`, and nothing in the product reads them.**
`observed` (post-gate, post-refine, pre-reticle) and `ungated` (the model's
corners whatever the presence head said) were already computed by the tick and
thrown away; publishing them is what lets the overlay draw what the scanner
hides. The detect path, the gate, the tracker and the lock policy are untouched.
A diagnostic view running different code from the shipping one measures itself,
which is why this is a field rather than a second engine — and why `QuadOverlay`
took a `diagnostic` prop instead of gaining a sibling: the alignment maths is the
part that has been wrong before (53 px, the whole 2026-09-04 owner session), and
a second copy of it could disagree while looking entirely plausible.

**`EngineState.thresholds` reports the numbers actually in force.** The readout
prints `hasObj` against the acquire threshold that judged it, not against a
constant imported separately — the same rule `labeler/types.ts` already applied
to `seedAcquireThreshold`, for the same reason: a re-tune must not retroactively
change what a recorded row meant.

**The verdict rides the row.** A frame captured with the sweep on carries
`pipeline.sweep` — what the LIVE pipeline was saying at the shutter, which is a
different measurement from the seed's single-frame `hasObj` on the frozen
square. The disagreement is the point: `sweep.stage: 'tracked'` with
`seedFallback: 'no_object'` is a false positive only the live path produces, and
no still-frame corpus could ever have found it.

**Verification:** `pnpm -r exec tsc --noEmit` clean; `deckpal-api test:pure`
379/379 (17 new in `ownerGate.test.ts`); `deckpal-web test:scan` 671/671 (9 new
in `labeler/__tests__/sweep.test.ts`); `deckpal-web build` clean, with `engine-*`
and `QuadLabeler-*` still separate chunks — the sweep does not pull the model's
19 MB onto any route that is not asking for it.

