---
date: "2026-08-23"
title: "A navigation no longer forces the far-plane round trip (C35)"
decided_by: "Claude, from a measurement."
areas: ["frontend"]
supersedes: []
---
## 2026-08-23 — A navigation no longer forces the far-plane round trip (C35)
**Decided by:** Claude, from a measurement.
**Decision:** `travelAfterRoute` asks `viaBackground()` instead of hard-coding
`via: 'background'`. A destination genuinely across the new page still gets the
round trip; a near one goes straight there. The observer also waits for a quiet
window before launching, re-resolving the target, rather than firing on the
first mutation.

**Why.** Measured at the shipped desktop framing, same destination:

| route | duration | peak tilt |
|---|---|---|
| forced `via: 'background'` (2 legs, 29.7 + 29.0 units) | **2271 ms** | 31.7° / 30.6°, past 20° for 610 ms |
| straight there (1 leg, 8.5 units) | **836 ms** | 28.5° |

The far-plane round trip is what makes him shrink away and swell back to full
size mid-screen — C35's *"it kind of just became big"*. The first mutation after
a route change is usually the skeleton, which is why he was launching at a
loading spinner and re-aiming.

**Implications:**
- This REVERSES a shipped decision; the old comment argued the round trip was
  always right. It was right about what the round trip reads as, and wrong that
  every navigation earns it.
- `viaBackground` now measures from HIM (`screenRect()`) rather than from the
  viewport centre, falling back to the centre when his position is unresolved —
  which reproduces the old answer exactly.
- **D8 is confirmed still present and is NOT fixed by this.** Close/reopen go
  through `returnHome()`/`flyTo()` in the host, never through `runUiTool`, so no
  threshold here could ever have dissolved it — the brief's theory that it might
  have was wrong about the code path.

