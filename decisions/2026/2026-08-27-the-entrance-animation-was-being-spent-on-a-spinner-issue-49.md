---
date: "2026-08-27"
title: "The entrance animation was being spent on a spinner (issue #49)"
decided_by: "Claude Opus 5 on behalf of @cheyras"
areas: ["general"]
supersedes: []
---
## 2026-08-27 — The entrance animation was being spent on a spinner (issue #49)

**Decided by:** Claude Opus 5 on behalf of @cheyras

**Decision:** The premium entrance is no longer attached only to the route
wrapper. Content that arrives after its wrapper — every route with a loading
phase — now carries `px-enter` and animates when it appears, via
`apps/web/src/lib/lateEntrance.ts`.

**The defect.** `premium.css` §4 attaches `px-rise` to `.app-content > *`, which
is `<Content>`. That wrapper mounts immediately, holding a `<Spinner>`, while
react-query fetches. So on a COLD cache the entrance ran and finished over an
empty page, and the real content appeared afterwards with no motion at all.
Measured at 428px, signed in, cold cache per route:

| route | `px-rise` ended | content appeared | gap | animations on content |
|---|---|---|---|---|
| `/decks` | 927ms | 6985ms | **+6058ms** | none |
| `/series` | 3691ms | 4548ms | +857ms | none |

**Why it took three investigations.** Both halves of the contradiction were
true at once. The motion layer *measurably ran* — which is what every previous
measurement correctly found, because a developer clicking around has a warm
react-query cache and therefore has content present at first render. And the
reporter *genuinely saw nothing*, because on a cold load the animation was over
six seconds before the first deck card existed. Two earlier hypotheses were
recorded against this issue and both were falsified against the device:
`prefers-reduced-motion` (the reporter confirmed Reduce Motion was always off)
and iOS Low Power Mode (WebKit throttles animations to 30fps, it does not
disable them). This needs neither. It reproduces on a desktop with motion fully
enabled, and it is worse on a slow phone — which is where it was reported.

**Why the class is conditional.** On a warm cache the wrapper's own `px-rise`
already covers real content and is correct as authored. An unconditional second
entrance would nest two rises: 10px of travel plus another 10px, and two
multiplied opacity ramps. `useLateEntrance` therefore returns the class only
when the component has actually rendered in a pending state, so a warm load is
byte-identical to before.

**Why not re-run the wrapper's entrance instead.** The wrapper also holds the
page title and toolbar, which are on screen during the fetch. Re-animating it
when data lands would fade the heading out and back in on every load. The
entrance belongs to the part that actually appears.

**Reduced motion comes along for free.** `.px-enter` deliberately reuses the
`px-rise` keyframes, so §8's redefinition — which drops `transform` and keeps
the fade — covers it without a second copy that could drift.

**Also fixed:** `DeckeButton`'s arrival had no `motion-reduce:` counterpart, so
under `reduce` the chip did not arrive quietly, it simply existed on the next
frame. Every other entrance on that surface already names `decke-calm-in`
beside its `motion-safe:` animation; this one was missed. Same defect, same
split by property.

**Verified:** `scripts/visual-harness/probe-entrance.mjs` — a new harness probe
that listens for `animationstart` rather than sampling `getAnimations()` (a
headless tab throttles rAF, so sampling two frames later can miss a 420ms
animation entirely; an earlier draft of the probe reported "no animation" for
content that was demonstrably animating). 4/4 routes FAIL before the change,
4/4 PASS after. Plus 6 unit tests including a source guard that fails when a
route renders a `<Spinner>` without calling `useLateEntrance` — mutation-tested
by removing the hook from `DecksIndex`, which the guard named.

**Implications.**
- A new route with a loading phase must call `useLateEntrance`. The guard in
  `lateEntrance.test.ts` enforces it; do not weaken it to make a route pass.
- The entrance is now a property of the CONTENT, not of the route wrapper.
- Measuring motion on a warm cache cannot see this class of defect. Probe cold.
