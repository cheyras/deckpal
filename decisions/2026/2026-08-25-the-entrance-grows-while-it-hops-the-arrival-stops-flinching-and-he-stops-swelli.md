---
date: "2026-08-25"
title: "The entrance grows while it hops, the arrival stops flinching, and he stops swelling on the way home"
decided_by: "Claude, on the owner's report against the pass merged earlier"
areas: ["general"]
supersedes: []
---
## 2026-08-25 — The entrance grows while it hops, the arrival stops flinching, and he stops swelling on the way home
**Decided by:** Claude, on the owner's report against the pass merged earlier
the same day: *"he's still doing a lot of unnecessary little turns when he
arrives at his destination after a hop. reads as a flinch, and not
intentional."* and *"He's growing out of the button THEN moving — i want him to
grow as he's hopping out of the button so it feels quicker."* and *"he just
barely traveled to a target to show me, and disappeared on arrival. Then
reappeared to hop back, and missed the button."*

**Decision:** Three engine/host changes, and a third probe, because the previous
pass's probes could not see any of this.

### The entrance was sequential, and the wait was on purpose

`PARK_SETTLE_MIN_MS = 240` and a two-consecutive-agreeing-reads test held the
travel leg until the panel had stopped moving. The grow takes ~245 ms and the
settle ~345, so he finished growing and then stood at full size on the chip.
Measured, three runs of three: **full size 100 ms before the leg started**.

Both are gone. The leg launches at the first ON-SCREEN read, and the reason the
wait existed — a rect read mid-transform aims him where the mark is still
leaving — is answered instead of ignored: `settledRect()` reads the
UNTRANSFORMED layout box (`offsetTop`/`offsetLeft` walk the offset-parent chain
and ignore transforms), which is where the mark LANDS. Verified stable at
(527, 494) from t+152 ms through t+1103 while the animated rect was still
travelling from (515, 542).

The station stays the element: `flyTo` is re-issued against the selector on
arrival with `instant: true`, by which time the two agree and nothing moves.

### The arrival flinch was a SECOND FLIGHT

Not the turn system — measured, `facing`, `lean`, `twist` and `bend` have
**exactly zero** excursion after landing. Every entrance flew twice:

| build | flights |
|---|---|
| before | 409-959 ms, then **1203-1392 ms** |
| after | 155-688 ms, and nothing else |

The second is the composer mark-watch reacting to the panel's OWN entrance
animation — movement the entrance had already accounted for. Its baseline is
taken when the effect mounts, which is the frame the chat opens, so it captures
the composer mid-animation and correctly concludes it moved. It now re-baselines
at the entrance's landing (`entranceParkedAtRef`): everything before that
instant was the entrance's business.

### He swelled 45% on the way home

A presentation parks him on the BACKGROUND plane at a third scale. The
dismissal omitted `depth`, and `flyTo` defaults it to `foreground` — so the trip
into the chip pulled him toward the camera. Measured on the return leg: drawn
height **43.3 px → 62.9**, a 45% swell, on a leg whose own contract says he
"never grows during the trip". `getState()` publishes his current depth and the
dismissal keeps it. The return also got shorter, 664 ms → 325 ms, because it is
no longer a depth change.

### Measured, before and after, four runs each, headed

| | before | after |
|---|---|---|
| scale when the leg starts | 1.046 (full) | **0.23** |
| full size vs. the leg | 100 ms **before** | 150 ms **after** |
| flights per entrance | **2** | **1** |
| correction after touchdown | 8.8 px + a second hop | **4.3-5.0 px** (the idle float) |
| growth on the return leg | **x1.45** | **x1.00** |
| where he vanishes vs the chip | — | 17 px (the chip is 52 px) |

### What the probes could not see, which is why this was needed twice

`probe-decke-present.mjs` is new and covers the presentation round trip —
out to a page element, hold, and the dismissal — which no probe covered before.
That gap is precisely why the earlier pass reported the missed-the-button pair
as fixed: **it was never exercised.**

Three flaws were found in the instruments themselves, and they are worth
recording because each one produced a confident false result:

- The flight probe measured the arrival flinch as centre DISPLACEMENT, which is
  nearly blind to a yaw, and its tolerance was set from a guess rather than a
  control — so it waved through the very 9 px correction being complained about.
  It records `facing` and the grow/leg overlap now.
- The presentation probe's first version read the launcher rect WHILE THE PANEL
  WAS OPEN, when `DeckeButton` is unmounted. Every run reported `nullpx` and
  passed. A check that cannot fail is not a check.
- Its "did he miss the button" metric then measured the last frame he was on
  screen AT ALL, which is the dismissal deliberately parking an INVISIBLE
  character at the home corner — 262 px of pure artifact against a dive that
  lands 17 px from the chip centre. It measures the last frame he was VISIBLE
  now.

Every new gate was run against a control with the fix removed, and fails there.

### Ruled out, so the next person does not re-run them

The 24 px arrival snap that appeared with the early launch was NOT: the chase
loop outliving the flight (disabling it changed nothing); `unpin()` (he is not
pinned at the composer — `canPin` refuses during a flight and `ridesThePage`
refuses a fixed ancestor); the keep-out band (no CSS transition on it); or an
easing `syncStation` (tried, measured, reverted — it did not move the number and
destabilised the leg). It was the destination, and `settledRect` is the fix.

**Still open, and it is a design question rather than a defect:** while
presenting he is **43 px** of drawn height on a 900 px viewport — about 5% of
the screen, which is a plausible reading of "disappeared on arrival". That is
the background plane working as specified ("he parks small… the content stays
the subject", and an earlier ruling called the alternative "annoyingly big"), so
it is not being changed unilaterally.

**Why:** all three are the same shape as the first pass — something that should
be a smooth function of the frame was a step function of an event nobody had
counted. A leg aimed at a moving target, a watch counting an animation it had
already been compensated for, and a default that was right for every caller
except the one that omitted it.

---

