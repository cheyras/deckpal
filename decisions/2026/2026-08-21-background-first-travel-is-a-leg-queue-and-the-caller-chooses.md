---
date: "2026-08-21"
title: "Background-first travel is a leg queue, and the caller chooses"
decided_by: "Claude Opus 5 on behalf of @cheyras."
areas: ["general"]
supersedes: []
---
## 2026-08-21 — Background-first travel is a leg queue, and the caller chooses
**Decided by:** Claude Opus 5 on behalf of @cheyras.
**Decision:** `flyTo(..., { via: 'background' })` flies two legs — out to the far
plane above the destination's column, then in — implemented as a `legQueue` in
`DeckE`, shifted in `update` when a leg lands. `goTo` always uses it after a
navigation; `flyTo` uses it only when the target is more than a third of the
viewport from centre.

**Why it had to be built.** The brief asks for "he always travels to the
background first", and the engine could not do it: `launch` takes ONE
destination, `solveFlight` interpolates a straight line with a lateral bow and a
vertical arc, and `onArrive` is a single slot that cannot start another flight.
The swooping impression the existing flights give comes from `bow` saturating at
4 world units with its sign alternating per leg — which exists to keep long
moves OFF the view axis, the opposite of going via the background.

**Mid-journey legs do not arrive.** The queue is shifted BEFORE `onArrive`
fires, so `then` runs once at the end of the journey rather than once per leg.
Firing it at a waypoint would have him pointing at nothing from the far plane.

**Not always right, so not automatic.** A depth change is 24-27 world units
against under 3 for any same-depth leg, so routing a short hop through the far
plane spends most of the trip going nowhere. Measured: 55 frames direct against
139 via the background for the same target, a 2.5x difference. After a
navigation it is always worth it — the page under him has just been replaced, so
there is no continuity to preserve, and pulling back and coming in is what makes
a route change read as travel rather than teleportation.

**It is seamless by construction.** Legs chain inside a single frame, so
`flying` never drops between them — which also means a test cannot count legs by
watching that flag. Duration is the observable difference.

---

