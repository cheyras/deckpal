---
date: "2026-08-20"
title: "Deck-E: he is oriented to the reader, and a loop is a loop"
decided_by: "user (second narrated screen recording, 2026-08-20),"
areas: ["agents","decks"]
supersedes: []
---
## 2026-08-20 — Deck-E: he is oriented to the reader, and a loop is a loop
**Decided by:** user (second narrated screen recording, 2026-08-20),
implemented and verified against it.
**Decision:** the second review pass over the character. Twenty-odd notes, and
they fall into four groups plus a handful of one-liners.

**A loop that pops is not a loop.** "When we have it on sustain, most of the
things have this unwanted little jutter when it loops — boom, boom, you know, it
pops up, pop, pop, pop, pop." Measured, it was two separate faults at the same
seam. The VALUES only nearly agreed: beats are sparse and a channel missing from
a beat is at REST there, so `curious`'s beat 1250 omits `pz` and the loop dropped
him 0.04 units and put him back once a second — the reviewer's "it does like a
pop upward". `happy` did the same with 0.03 of `sq` (3% of his height), `proud`
with 0.01 ("he kind of shrinks slightly vertically"), `listening` and
`card_stash` with small drifts on three channels each. And the VELOCITIES
disagreed even where the values did not, because the window's two ends are
interior keys whose tangents were solved for neighbours the window cuts away:
`thinking` stepped 32.6 deg/s across a seam that matched to the digit.

A sustain is therefore no longer a pair of times into the authored clip. It is
its own CYCLIC clip, built once at load: the window's interior beats, a head beat
SAMPLED from the compiled curves (which fills in every channel the authored beat
left out), a tail beat that is a COPY of the head, and one shared tangent at the
seam. The two ends are equal by construction, so no window can drift however it
is retuned. Measured after: `curious`, `proud`, `happy` and `listening` show
exactly zero frame-to-frame motion while sustaining. What survives is what was
asked to survive — the stepped robot register on `confused` and `frustrated`, the
alerts' 15 Hz vibrate: "some of them, that's on purpose... all of the
UNINTENTIONAL pops in the loop should be eliminated." A stepped channel still
steps across the wrap, and a test asserts that it does, because a seam rule that
smoothed everything would have quietly sanded those off.

Two windows were retuned rather than merely fixed. `confused`'s loop opened on an
EASED beat inside an otherwise stepped bar — one smooth 140 ms slide and then
three held steps, which is exactly "the little back and forth motions are kind of
uneven in feel" — and it is now four even steps plus two slots of hold, which is
also the "pad out the end of that animation a little bit". `embarrassed` HOLDS
its settled flinch instead of looping the three-beat shudder: "he's like rapidly
shaking, and I don't really like that; it should just kind of hold on the facial
expression."

**How he is SEEN is not where he stands.** "Right now he's like perfectly
aligned, edges are straight, mostly parallel with the edges of the screen. But as
soon as he's presenting, he's super off... it's like he's leaning forward." And
at home: "he's like at a really weird angle when he's down here." Neither is a
bug in the parking maths; they are what a fixed perspective camera does to an
object it is not pointed at. The 40.195-degree 3/4 angle is measured against the
direction from the camera to the ORIGIN, so moving him changes it; and a camera
pitched down keystones anything off to one side.

So every parked position now gets its own view frame and he is rotated into it
(`character/decke/framing.ts`), which makes his relationship to the LINE OF SIGHT
the same wherever he is — same yaw, no lean. The ELEVATION component of that
correction is then taken back out, because the reviewer wants the vertical
parallax and asked for it precisely: "the camera space is like center of the DOM,
so if he's up here it's like he's above the camera, and if he's down here it's
like he's below the camera... he should always be at this angle on the yaw, but
then a higher or lower angle, like this visual angle." One virtual camera per
position, level with the middle of the viewport. At the staging origin the solve
is exactly the identity, which is what keeps `PARITY.md` meaningful, and a test
pins that.

The lighting rig rides with him for the same reason and by the same transform:
"it seems like the lighting rig isn't traveling with him, which it should be...
there's this hard shadow that's running across him... it's a rider on him." The
six area lights hang off one node that takes his position and his framing
rotation, and the environment map takes the azimuth. Measured: at the background
plane his mean body luminance went 0.366 to 0.560. This is NOT the thing
`AREA_LIGHTS` forbids — that rule is about yawing the rig with his FACING, which
still cross-fades against the mirrored twins underneath this.

**`facing` is in HIS frame, and the parking solve had it backwards.** "When he
goes to present something, he's facing away from it, which is incorrect. He's
always facing away from it." Always, and on both sides, which is the signature of
a sign rather than of a rule. `+1` turns him to HIS right, which the reader sees
as him facing screen LEFT; `parkBeside` assumed the reader's frame. Confirmed on
screen at both ends before it was changed, and the dev page's two buttons now say
both frames out loud, because "we need to remember that these are talking about
his right and his left rather than viewer right and viewer left."

**A presentation is anchored to the element, so he scrolls with it** — "when we
scroll, he should really scroll with it, because he's showing that thing" — and
his vertical angle follows for free, because the framing is re-solved from
wherever he ends up. Where he is parked is now a STATION that can be re-solved
rather than a coordinate, which is also how he starts at home instead of dead
centre, and how home follows a resize. Scroll far enough and he leaves the
viewport, so there is a beacon: a 52 px chip at the edge with a pointer aimed at
him and a LIVE second render of the scene inside it — a scissored second pass on
the same canvas, not a second context — and clicking it smooth-scrolls him back
to centre. "Like they do in Smash Bros... it shows what he's actually doing in
here... make it fairly small, like how we do our circular buttons."

**The cards.** Three faults, all of them measured before they were touched.

The `card_stash` fan was authored with all five cards converging on one point (an
x spread of 0.79 for a card 1.57 wide), so they interpenetrated and stood in
front of his face: "they're like all clipping through each other, and we need to
not have them do that." It is now a computed layout — and computed in the plane
the READER sees, not in his local frame, which is the correction that made the
difference. A polar version with even angular spacing failed its own test at five
cards, because `sin` flattens near 90 degrees and two cards 67 degrees apart on a
ring land 0.67 units apart on screen when they need 0.78. The fan is a grid:
columns out to each side, rows up the frame, a clear column down the middle where
he stands. It is DYNAMIC in count to twelve, because the real use is "they add a
whole bunch of cards to their collection, and this is his way of showing the
actual cards they added going down into the deck box" — anything past the fifth
mesh is a clone, and the cards shrink as the batch grows. On the way out they
gather into a stack above the mouth and dive in: "they all come up together like
this, but hopefully so they're not clipping, and then quickly go down in." That
needed a synthesized outro, because the authored tail slams the mouth shut 110 ms
in.

`loading` flashed a ghost card on entry: "we see one of the cards like very
small, zoom off and then disappear, and then it comes out properly." Measured —
the right-hand card reached 19% scale at 150 ms, travelled a third of the way
round the orbit and shrank back to nothing by 300 ms. The playbook channel and
the baked fade schedule disagree on purpose (240 ms against 1533 ms, and the 1.3
second stagger is the entrance), and the old code blended between them on
`orb_on`, which ramps through the crossfade and let the channel leak in. Keying
off the STATE instead fixes the same leak in the other direction too: stopping a
sustained `loading` before 1533 ms used to pop the unspawned card into existence
at full size.

The loading spinner's glyph orbited instead of turning: "the pivot point on the
rotate is not centered, so they're kind of like moving around... a little bit of
travel around in a circle." The shared parallax offset is computed in the eye's
frame and added inside each control's own frame — a fixed shift for the six
controls that never turn, and a fixed shift on the wrong side of a rotation for
the one that turns a revolution a second. It is faithful to the .blend and it is
wrong; the offset now goes inside the rotation. Measured with the character
frozen and only `sym_spin` moving: the annulus travelled a closed loop of about
3 px, and now its centroid moves 0.15 px with an IoU of 0.984 between opposite
phases.

And the presented card rides him at half amplitude — "like it's a rider on him...
doing the same motions as him, but a little less of a magnitude, like half" —
which the hands never did, because `Orbit_Root` is a SIBLING of `DeckE_Float`.

**Also:** the gaze flits are gated — a hard 0.9 s floor enforced on the schedule
rather than a wider interval draw, because the failure asked about ("sometimes
it'll be like, boom, boom") is the tail of a distribution and a floor is an
invariant a test can assert — and their amplitude is down from 30% of the pupil's
travel per flit to 12%. The hover is 20% slower everywhere, through one
multiplier on the rate rather than an edit to twenty-seven authored values,
because the relative structure between states was right and the tempo was not.
Both procedural schedules now EXTEND rather than rebuild when they run past their
horizon, which they did every ten minutes — replacing the flit he was in the
middle of, and making the gate a property of one generation rather than of the
run.

**Implications.** `character/decke/framing.ts` and `beacon.ts` are new; the
character now writes a rotation to `DeckE_Root`, which it never did before, and
the note there about the root never being yawed still holds for FACING and now
says which is which. The test suite is 87 (from 66) and three of the new ones are
property tests over the whole input range rather than examples — the stash fan
cannot produce two overlapping cards at any count from 1 to 12, no card stands in
front of his face, and the framing solve is the identity at the staging origin.
Two of those found real defects while being written.

**A review pass over the above, which found four ship-blockers.** All four are
the same shape: the phase machine and the objects a state DEPLOYS disagreeing
under interruption, which is precisely the class the previous pass's own
addendum warned about.

`hasOutro(interrupted)` decided whether an interrupted state owed an outro by
looking at its PHASE, on the theory that a sustain never reached has deployed
nothing to put away. That is false for both states that have an outro:
`card_stash`'s first card leaves the mouth inside its 400 ms intro and
`loading`'s left card is fully spawned 200 ms into a 900 ms one. Cutting away
during an intro — two agent commands 300 ms apart, which is an ordinary turn —
deleted a card the reader was looking at. It now asks the card system what is
actually on screen, which is exact rather than a timing guess.

A `durationMs` shorter than the intro fired the outro from the intro, and the
stash outro had no per-card spawn gate: every card that had not launched popped
into existence at full size at its station and then filed in. `setStashCount`
re-laid-out cards already in the air, teleporting them — and the command surface
reaches that in one message, because `count` applied immediately while the state
queued behind whatever was playing. And `STASH_FLOAT.releaseMs` was dead code:
the outro never faded the free float, so every card jumped up to 0.18 units — a
tenth of a card — at the sustain-to-outro boundary. That last one is the exact
jutter this pass exists to remove, relocated to a phase boundary.

Also from that pass: re-issuing the state he is already in is now a NO-OP rather
than a restart (an agent saying "still thinking" three turns running should not
re-enter it three times, and for `card_stash` a restart despawned every card in
the air); `setState` validates `then` eagerly, because it is consumed inside the
animation frame and `tick` re-schedules itself BEFORE calling `update`, so one
typo threw on every frame for the life of the page; the beacon's second render
pass restores the scissor and viewport in a `finally`, or one throw inside it
collapses the whole character into a 52 px corner for the rest of the session;
the gaze walked its whole schedule every frame and the schedule now grows
forever, so it has a cursor and prunes behind it; the prefiltered environment is
disposed with the stage (it is not in the scene graph, so the caller's traverse
never saw it); and the first stash card no longer launches through a lid that is
still opening — the authored `start_ms` carried a 400 ms gape delay that the
respecification dropped.

**And the independent visual pass found a fifth, in the same family.** The
loose-card schedule runs on the state's UNWRAPPED clock, and that clock keeps
running through the outro — so sustaining `loading` for one second and then
leaving let the right-hand card cross its 1533 ms spawn time DURING the way out
and appear, at whatever `orb_on` had faded to. Measured at 0.081 of scale, 330
to 500 ms after the release: the same "pops up small, zooms off and disappears"
this rule exists to remove, relocated to the exit. The schedule's clock is now
frozen at the moment the outro begins, exactly as the stash flight's `born` is —
which is the third time in this pass that freezing a clock at the phase boundary
was the answer, and the reason the restructure below is worth doing.

That pass also reported the framing quaternion as "frozen" for a purely vertical
move and flagged it as a likely defect. It is the design, and the confusion is
reasonable enough to be worth writing into `framing.ts`: a straight up-or-down
move changes neither azimuth nor roll, so the alignment has nothing to correct,
and the pitch give-back then deliberately adds nothing either — `PITCH_FOLLOW =
1` means "let the camera do it". Measured over a 780 px vertical sweep the
quaternion moves by 1e-5 while the angle you look at him from swings 37.5
degrees.

**The restructure this points at, recorded so it is not rediscovered.** All four
of those, and the same-state-restart bug beside them, are one weakness: WHAT IS
ON SCREEN has three authorities that can disagree — the phase machine in
`DeckE`, string checks on state names in `cards.ts`, and clip channels. Every
hole was a disagreement between them under interruption, and each was fixed
locally. The change that would dissolve the class is to give deployed objects a
lifecycle of their own — spawned-at / alive / despawning — that the state layer
REQUESTS rather than implies, so an object can never appear or vanish except
through its own spawn or despawn animation. Interrupts would then degrade to
"everything plays its 200 ms despawn" for free, `hasOutro(interrupted)`'s
special-casing would disappear, and a count change mid-state would become a
spawn/despawn diff rather than something to defer. That is a bigger change than
this pass should carry, and it is the right next one.

**What is still open, stated rather than left to be discovered.** The
intro/sustain/outro machine has no UNIT tests — it needs a WebGL context, so the
interrupt paths above are covered by a Playwright integration script rather than
by `test:decke`. That is a real gap and the reason all four of those defects were
found by review rather than by CI. `prefers-reduced-motion` is respected only
where the browser does it for us (the beacon's smooth scroll); a perpetually
bobbing character has no damping hook. And the beacon decides to appear from his
BODY's silhouette while the chip frames the whole deployed model, so a wide card
fan can still be half on screen when the chip appears — which is the behaviour I
want, but it is a choice and not an accident.

