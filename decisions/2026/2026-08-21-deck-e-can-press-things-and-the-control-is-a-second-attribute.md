---
date: "2026-08-21"
title: "Deck-E can press things, and the control is a second attribute"
decided_by: "Claude (Opus 5), on behalf of @cheyras."
areas: ["agents","decks"]
supersedes: []
---
## 2026-08-21 — Deck-E can press things, and the control is a second attribute
**Decided by:** Claude (Opus 5), on behalf of @cheyras.

**Decision.** A `click` tool, authorised by `data-decke-clickable` — a SECOND
attribute on top of `data-decke-landmark`.

**Why not reuse the landmark.** Pointable is not pressable. A price block, a
completion bar and a card image are all worth flying to and ringing, and none
should ever be pressed; several sit next to controls that write. One attribute
for both would mean marking something "worth pointing at" silently also marked
it "safe to press".

**Two controls are marked**, both read before marking: `/series`'s "Show N
series" disclosure (`setShowAll(true)`, nothing else) and `CardDetail`'s
"Additional Variants" toggle (one piece of local state). The variant rows the
second reveals contain quantity steppers, which are writes and are deliberately
not marked — revealing a control is not the same capability as operating it.

The `/series` one matters most: for a collector who owns nothing, which is every
new account and the QA account the gates run as, every series on that page is
behind that button.

**THE LIMIT, recorded rather than implied.** The runtime cannot inspect what a
React `onClick` does. It checks that an element was marked and that it is the
kind of thing that gets pressed. It cannot check that pressing it does not
write. "Never a write" is therefore a property of the MARKING DISCIPLINE, not of
the code, and whoever adds the attribute is the safeguard.

**Which is why there is an audit test that fails when a new control is marked.**
The evidence that a review step is needed rather than a rule: the spec that
designed this tool listed the quantity stepper and the add-card control as
clickable in its own table. Both are writes. It caught itself — a rule its own
author broke while writing it down needs a second pair of eyes on every use.

**This invalidates a premise in this file.** The 2026-08-21 clean security
verdict rests explicitly on "there is no `click` tool, so `flyTo`/`highlight`
can only move and ring." That premise is now false, and the adversarial pass was
re-run against the new surface rather than assumed to still hold.

