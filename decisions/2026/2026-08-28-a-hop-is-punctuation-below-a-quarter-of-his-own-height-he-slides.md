---
date: "2026-08-28"
title: "A hop is punctuation: below a quarter of his own height he slides"
decided_by: "Claude (Opus 5), on the owner's ruling after watching the"
areas: ["general"]
supersedes: []
---
## 2026-08-28 — A hop is punctuation: below a quarter of his own height he slides
**Decided by:** Claude (Opus 5), on the owner's ruling after watching the
keyboard work land: *"He should never have to do a little hop when the keyboard
comes up or goes away... even if he moves like 10 pixels relative to where he's
supposed to be, he does a hop. Hop is really for when he is PURPOSELY traveling
somewhere, like to show off something in the UI, or to go from the chat button
and back. It's not intended to be used for tiny page shifts."*

**Decision:** `launch` — the single choke point every flight passes through —
now asks `worthHopping()` before shaping the path. Above the threshold nothing
changes. Below it the same solved, eased track is flown with `arc: 0, bow: 0`
and the travel modulation is skipped: a slide, not a second animation and not a
cut.

### Why it needed a threshold rather than a softer curve

`shapeFor`'s arc is `0.18 + dist * 0.06`. **The floor is a constant**, so at
zero distance it is still 0.18 — a re-park of a few pixels got the same
rise-and-descend as a trip across the page. No amount of easing fixes that,
because the problem is not smoothness: a hop is punctuation, and spending it on
a composer that grew by one line is the animation equivalent of shouting.

### Why the threshold is a fraction of HIM

`HOP_MIN_FRACTION = 0.25` of `characterHeightPx`, with an 18px floor for the
window before the host has measured him. He is dollied to a pixel height that
already tracks the viewport and the composer, so "a quarter of him" is the same
apparent nudge on a 390px phone and a 1600px desktop — where any fixed pixel
count is a shrug on one and a lurch on the other. At his default 300px that is
75px, and the real cases fall either side of it cleanly:

| | |
|---|---|
| a layout settle, 5–20px | slides |
| the composer growing a line, ~24px | slides |
| rising over an approval card, 150px+ | HOPS — the owner asked for that one by name |
| the beacon, or a walk to a card | HOPS |

Measured in SCREEN pixels, not world units: a move straight at the lens covers
world distance and almost no screen, and arcing through it reads as a glitch.
`screenSpan` in `flight.ts` reuses the solver's own metric to answer that.

**The leg index only advances for a hop.** It alternates the bow's sign so an
out-and-back traces a lens; letting a bow-less glide consume one would flip the
next real hop's sweep for no reason a reader could see.

### Verified

Filmed on iOS 26.5. The arrival from the beacon is still a full travelling arc
with its scale growth; the panel after a keyboard dismissal is dead static
across 45 consecutive frames. `worthHopping` is unit-tested against the cases
above, including a null and a nonsense `characterHeightPx` — a height that
could not be read must never be allowed to silently disable his arrival.

**Not verified on device:** a small re-park sliding, because triggering one on
demand needs a transcript this machine's dev server cannot create.

