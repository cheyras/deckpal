---
date: "2026-08-23"
title: "Deck-E can be turned off, and the setting is remembered"
decided_by: "Claude, on measured evidence."
areas: ["agents","decks","catalog"]
supersedes: []
---
## 2026-08-23 — Deck-E can be turned off, and the setting is remembered
**Decided by:** Claude, on measured evidence.
**Decision:** A per-device `localStorage` preference (`character/deckePreference.ts`)
hides Deck-E entirely. `DeckeHost` returns null before the canvas, the launcher
and every effect that reaches for the runtime, so hiding him also stops him
costing anything. Restored from a labelled control in Profile.

**Why.** He could not be removed. There was no dismissal anywhere — the launcher
mounted on every signed-in page and its only control opened him. That is the
shape of the best-documented assistant backlash on record: Snapchat pinned My AI
with no way to remove it and went **3.05 → 1.67** stars, one-star share **35% →
75%**, review volume 5×. The complaint analysis is unambiguous that the anger was
about being **pinned and unremovable**, not about answer quality — so Deck-E
being good is not protection.

**Implications:**
- Per-device, not per-account, and the UI says so. It is a display preference
  about one screen, it must resolve before any request does, and making it an
  account column would need a migration, an API and a sync path.
- **Every storage access is wrapped.** Reading `localStorage` *throws* in a
  browser set to block site data; an unwrapped read would take the character
  host down on exactly the privacy-conscious setup most likely to want him gone.
  On a throw he is SHOWN — a reader who cannot persist a preference has not
  asked for anything.
- A same-tab custom event is dispatched alongside `storage`, which fires only in
  other tabs; without it the control would appear to do nothing until a reload.
- Still open: a one-click dismissal from his own panel. The settings toggle is
  the reliable path; the direct one belongs beside the panel's ✕.

