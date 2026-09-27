---
date: "2026-08-13"
title: "Top bar: the cover header is pinned to its own composited layer"
decided_by: "agent, from a user report of the bar flickering during scroll."
areas: ["general"]
supersedes: []
---
## 2026-08-13 — Top bar: the cover header is pinned to its own composited layer
**Decided by:** agent, from a user report of the bar flickering during scroll.
**Decision:** `.app-header` in `cover` mode carries `transform: translateZ(0)`,
`will-change: backdrop-filter` and `backface-visibility: hidden`. **Do not remove them
as redundant.**

What was ruled out first, so this is not cargo cult:
- **Not JS.** Nothing in AppShell listens to scroll; the only state is `collapsed` /
  `drawerOpen` / route. The inline `<style>` block re-renders only when the sidebar
  width changes.
- **Not performance.** Measured a controlled A/B (`?topbar=cover` vs `?topbar=flat`),
  synthesised wheel scroll, rAF frame intervals: warm, both modes sit at 8.3ms mean,
  p95 ≈ 9ms, ZERO frames over 32ms, on both a static grid and the virtualised Pokédex.
  The blur costs nothing. (An earlier reading of 23–24% long frames on /pokedex was a
  COLD run — first image decodes plus Vite dep optimisation — and is not real; re-measure
  warm before trusting any number from that page.)

What is left is a compositor correctness artifact, not a cost one: a `position: fixed`
element with a backdrop-filter must re-read its backdrop every frame the content behind
it moves, and with no promotion hint the compositor may re-rasterise that snapshot
against the scrolling layer, strobing between a fresh and a stale sample. The three
declarations are the standard remedy. `translateZ` is safe here **only** because nothing
inside the header is `position: fixed` — it would otherwise become their containing
block; re-check that before adding fixed children to the header.

NOT confirmed visually: headless Chromium rasterises in software, so the artifact does
not reproduce there. `?topbar=flat` is the one-click A/B — if flat is smooth and cover is
not, the backdrop-filter is confirmed as the cause, and the next lever is the 18px blur
radius (large radii are the usual trigger), not the tint, which was measured into place.

**Addendum — the flicker's dependable trigger is the overscroll bounce (Chrome/macOS).**
User: it happens on a set page's card list, most reliably when the scroll hits the very
top or bottom and rubber-bands, and otherwise on fast flicks. Chrome implements the
elastic bounce by translating the SCROLLING LAYER past its bounds in the compositor; the
cover header is a fixed element sampling that layer through a backdrop-filter, and the
backdrop snapshot is mishandled while the layer is displaced. Hence
`overscroll-behavior-y: none` on the root and body, scoped to
`[data-skin='premium'][data-topbar='cover']` — it removes the trigger outright rather
than mitigating it, costs nothing visually, and leaves `flat` with the native bounce.
Verified: cover → `overscrollBehaviorY: none` + promoted header, flat → `auto` + no
promotion, header rect byte-identical in both.

If it survives that, the next lever is the **blur radius** (18px), not the tint. Large
radii are the usual trigger for stale-tile artifacts, and the radius is a spatial filter
— it barely moves the bar's average value, so the measured tint tuning survives a
reduction to ~12px. That change is the user's call, since they set 18 deliberately.
