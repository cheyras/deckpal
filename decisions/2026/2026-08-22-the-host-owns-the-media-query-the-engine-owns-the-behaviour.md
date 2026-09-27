---
date: "2026-08-22"
title: "The host owns the media query; the engine owns the behaviour"
decided_by: "Claude, following the engine's own stated philosophy."
areas: ["data"]
supersedes: []
---
## 2026-08-22 — The host owns the media query; the engine owns the behaviour
**Decided by:** Claude, following the engine's own stated philosophy.
**Decision:** `prefers-reduced-motion` is read in `DeckeHost` and passed to
`DeckE` as a flag. Nothing in `character/decke/` calls `matchMedia`.

**Why:** the engine already says it honours the preference for smooth scrolling
"without this module having to know that exists". The flag keeps that true while
giving entry, flight and escort legs a real instant-arrive mode, which did not
exist and which both the entrance and the wayfinding work need.

**Implications:** the query is watched live — someone turning it on mid-session is
asking for the motion to stop now, not at the next reload.

