---
date: "2026-09-05"
title: "The region window is five seconds: twelve was sized on a fake camera"
decided_by: "Not recorded"
areas: ["scanner"]
supersedes: []
---
## 2026-09-05 — The region window is five seconds: twelve was sized on a fake camera

Owner session 2 (36 captures in 6.2 minutes, phone, identity follow + 1.5s
bridge shipped) measured that ALL auto-capture slowness is region suppression
and nothing else. Every unsuppressed capture fired at the 0.67s structural
floor, 13 of 13 with zero variance; all 16 captures slower than 2.5s (max
9.41s) had a suppressed lock; detector acquisition, the saturation gate, the
shape gates and the matcher round trip cost 0s between them. One number
against another: the window was 12s and the owner presented a new card every
7.6s, so each card waited out its predecessor. 103.4s of avoidable wait, 100%
of it in the suppressed group, and the Capture button pressed zero times.

REGION_DEPARTURE_MS 12s -> 5s. The sweep is arithmetic, not a model: this
build records `regionsExpired` and `sinceRegionExpiryMs` on every lock, so
every region's retirement instant is recoverable and `retirement - 12s` is
when production last saw that card. 5s removes all 16 slow captures and 98.2s
of the 103.4s (8s: 67.7s, 6s: 91.3s, 4s: 102.5s; below 3s nothing is left to
win). All 36 presentations still capture at every value — a shorter window
never suppresses more, and Scan.tsx's per-track refractory allows one fire per
presentation — so the duplicate count is unchanged.

THE NUMBER THAT KILLS 12s: what a region must survive is its OWN track being
gone while the card is still there. Fake cam (round 3): eight such stretches
of 4.67-11.37s on ONE card in 124s, fifteen track ids for it. Phone: session 2
has NONE (46 within-presentation lock gaps, every one 2.00-2.40s, which is the
recorder's own 2s throttle; 0/81 coasting; one track id per card), and session
1 has four at 1.07-2.38s with an EMPTY BAND to the next three at 4.12-7.26s.
Those three are the card being AWAY, not lost: every track in both sessions
reaches its first lock at age 5 (0.67s), so on this device "no track" means
"no card". 2.4s, not 11.4s, is what the constant has to clear; 5s is 2.1x that
and 0.66x the reader's cadence, which is the pair of bounds it lives between.

Also settled by the same data: the 12s window prevented ZERO duplicates in
session 2. The one card captured twice (sv10-127, put back 5.35s after its
region froze) was taken under 12s as well — suppressed for 6.54s, then let
through. Session 1 replayed: 26 -> 33 auto-captures for 2 -> 4 duplicate
fires, and its duplicate count is 2-6 at EVERY value from 3s to 15s with no
trend, because its same-card refires are 5.8-18.1s apart.

The price, named: round 3's one-card run goes 6 -> 7 captures and round 2's
6 -> 7. Both are the desktop fake camera. Its dropout distribution is the
evidence the old constant rested on and neither phone reproduces it.

Rejected: a detector-health mechanism (age a region only on ticks where the
engine holds tracks) that would cover the fake cam without paying the phone
cost. No fixture records per-tick track counts, so it cannot be validated on
what exists, and the phone data does not demand it.

Two measurement bugs found and fixed while doing this. The follow-rule table
in regions.ts's header had not been re-measured since REGION_BRIDGE_MS landed
(it read 16/1, 31/5, 52/11; with the bridge it is 23/3, 33/4, 52/11 at 5s).
And `manualPressesSaved` counted an auto-capture within 8s BEFORE the press,
which is not scale-free: shortening the window moves the auto-capture EARLIER
and out of the look-back, so the metric scored three delivered rescues as
lost and inverted the ranking of the two constants. Now 20s (8s plus the
widest window swept), on which the no-region ceiling reads 12 of 21 and
reproduces the session report's independent attribution of the other nine.

New permanent fixture: `owner-session-2-regressions.test.ts`. The round-3
fence `REGION_DEPARTURE_MS in [10s, 30s]` is rewritten rather than deleted —
it now asserts the constant sits BELOW that fixture's dropouts, so raising it
back over them has to answer the phone evidence first.

