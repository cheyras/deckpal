---
date: "2026-08-25"
title: "Animation round two: his size stopped tracking the composer, and every hop became one arc"
decided_by: "Claude, from a second narrated review the owner recorded on"
areas: ["general"]
supersedes: []
---
## 2026-08-25 — Animation round two: his size stopped tracking the composer, and every hop became one arc
**Decided by:** Claude, from a second narrated review the owner recorded on
2026-08-24 — twenty minutes of using the app and saying what was wrong, then a
frame-by-frame pass afterwards leaving 56 timestamped notes. The scope line was
drawn twice on the tape: *"I mostly just want you to focus on animation for
this pass"* and, of the agentic misbehaviour, *"this isn't for you to fix.
That's going to be in a different pass."*

**Decision:** Sixteen defects fixed, and two instruments built, because the two
most frequent complaints cannot be settled by looking at pictures.

### The most frequent defect was one number

Fourteen tagged instances of *"he all of a sudden just grew in size for no
reason"*, *"sudden resize again"*, *"same bullshit"*, ending in *"I'm sure
there are more after this but I'm going to stop labeling them."* Read frame by
frame, every one of them brackets a stretch of TYPING:

| tape | composer | him |
|---|---|---|
| 13:20 | one row | one size |
| 13:23 | draft wraps to two rows | 1.4x bigger, shifted down and left |
| 13:34 | message sent, one row again | snaps back |

`DeckeHost.characterHeightBeside()` ruled him off the composer's LIVE height,
and the composer is a textarea that grows with the draft — deliberately, so a
long card list stays readable while you type it. Sizing him from the composer
is still right, and is not what changed; the RULER is the composer at rest now
(`character/host/composerRuler.ts`, a `.ts` sibling for the usual reason: a
`.tsx` cannot be imported under `node --import tsx`).

A minimum-seen latch rather than an arithmetic reconstruction of the card's
resting height, because every term of that arithmetic is a Tailwind class in a
sibling component that nobody would think to keep in step with this file. The
composer at rest is simply the shortest it is ever seen at.

Three smaller repairs travelled with it, each a real bug on its own:
`setCharacterHeight` now ignores a call that changes nothing (it was unpinning
and re-solving the station on every ResizeObserver fire); `syncStation` keeps
the dirty flag when a solve fails rather than discarding the correction until
some unrelated event re-arms it (this is the "wrong for ten or twenty seconds,
then a hop" half of the report); and a composer that cannot be measured while
the chat is open no longer falls back to the full-page formula, which is up to
300px against a composer-ruled ~168px — the same defect arriving by a different
door.

### Every hop stopped dead in the middle

*"He makes to stop right here in the wrong spot, before then continuing to
where he's supposed to go"* — and, later, *"hiccup/temporary pause on the way
again. happens every time pretty much."*

`DeckeChat` has to release his page pin before it freezes the document, and it
did that by calling `returnHome()` — which releases the pin on its way to
LAUNCHING A FLIGHT to the abstract home corner. That effect runs on `[visible,
shownMinimised]`, which is every chat open and every return from a
presentation: exactly the edges `DeckeHost` parks him on. Two legs launched in
one commit, the second replacing the first mid-air, and `launch` opens every
track with an anticipation dip. `DeckE.releasePin()` is the half that was
wanted. The same call clears `flightScale`, which is also why the dismissal
sometimes *"missed the chat button by quite a bit"* — the dive's shrink froze
wherever it had got to.

`DeckE.resize`'s own debounced re-park had the second half of the same bug: it
called `launch()` outright where `syncStation` has always STEERED an in-flight
leg. It steers now.

### The instruments, and why they exist

`capture-decke.mjs` asserts nothing on purpose. Neither of the above can be
read off what it produces — a ratio needs both sides in the same measurement,
and a 60 ms stall in a 700 ms hop is three frames of a 24-frame sheet. So:

- **`probe-decke-size.mjs`** measures his silhouette off the pixels, types a
  draft, measures again. It measures the pixels rather than asking the app how
  big it thinks he is, because the whole defect is a disagreement between those
  two.
- **`probe-decke-flight.mjs`** samples `DeckE.screenRect()` every animation
  frame and reads the leg's speed profile.

Both were run against two dev servers on the same machine in the same minute —
this branch and a detached worktree at the commit before it:

| | before | after |
|---|---|---|
| size ratio on a wrapped line | **1.281** | **0.995** |
| mid-flight stall (4 runs) | **4/4**, to a dead stop at +314 ms (ratio 0.007) | **0/4** |
| flinch after landing | **28 px** | 9 px (float is under 14) |
| resize after landing | **7.1%** | 0.5% |
| ring's bottom edge vs the next tile | **6 px inside it** | 42 px clear |

**Two traps, both paid for.** The flight probe must run `--headed`: headless
Chromium throttles `requestAnimationFrame` to about 5 Hz here, which is coarser
than the entire defect, and headless it reported a clean leg on the build that
stalls every time. And its first version defined the leg by "he was moving fast
enough", which started the leg during the grow-at-the-chip and reported the
real LANDING as a mid-flight stall, twice out of two, confidently. The leg is
the run of `flying` now.

### The rest, each traced to a note

- **The entrance re-reads the launcher chip.** It used the rect captured on
  click and consumed after the runtime loads — 7.4 s cold, measured — so
  anything that moved the button in between left him growing out of where it
  used to be. And with no chip at all he was cut in at full size at a viewport
  fraction near the middle of the screen; he grows from his mark instead.
- **The facing turn is bounded by the flight it rides.** 495 ms constant
  against a 303-385 ms short hop meant the last stretch of every turn played
  out after he had landed — the *"unnecessary turn/adjustment that feels like a
  flinch"*. And `setFacing` ignores a request for the facing it is already
  turning to, which is the yaw judder filed separately.
- **`setEntryScale(0)` is gated on a genuinely fresh controller.** It ran for a
  reused one too, snapping an already-visible character out of existence in one
  frame with nothing scheduled to bring him back.
- **The post-navigation flight waits for the page's scroll to settle.** The
  reveal this tool asks for is answered with `GridView`'s own smooth scroll;
  `driveScroll` disarms itself the instant it sees an offset it did not write,
  and it cannot tell that scroll from the reader's wheel. So the destination was
  solved against a rect still in motion and the drive was dead on arrival —
  *"the scrolling doesn't happen so he just dives off the page downward."*
- **He plays `loading` during a navigation wait.** That state is authored, is
  declared engine-owned in the model's own prompt, and had never once been
  played by anything but the dev preview. 300 ms of grace first, so a fast route
  swap does not flash a spinner.
- **A bare `goTo` no longer closes the chat in the same tick the reply ends.**
  The arrival callback only deferred to the bubble's read timer when a ring was
  still up; without one it called `seeYouOut()` synchronously, `chatOpen` went
  false in the same React batch as `busy`, and the timer's first run returned
  before arming — *"not nearly enough time to actually read it."*
- **The presented card's mirror gate holds while a card is visible.** `gate` is
  keyed by state name; `state` switches on the tick `setState` is called and the
  pose crossfades for 320 ms after it, so `k` flipped under a card that was
  still plainly on screen.
- **The highlight ring hugs the card, not the row track.** `GridView`'s rows are
  `display: grid` with an explicit height and no `alignItems`, so CSS's default
  `stretch` inflated every tile's own `getBoundingClientRect` by the 30 px row
  gap. The ring then added its 6 px halo to that. `elementHighlight` had no test
  file at all; it has one now, including a control that reproduces the old
  geometry so a revert is caught here rather than in a browser.
- **`cardArt` is wired through to the catalog.** The prompt tells the model to
  set the art before `card_present`; the client's applier dropped the op on the
  floor with an "until PR 5" comment, so he always held the placeholder baked
  into the glb — *"shows a card, but it's a placeholder one rather than being
  the actual card the user asked about. lame."*
- **Both budget-exhaustion paths telegraph.** They appended a sentence to the
  reply and changed nothing about him, where every sibling failure in the same
  file pairs a notice with `alert_error` — *"he should probably do his error
  state or something… he parks here for way too long before displaying his
  error message, and he's full size."*

### The feature request: he uses four states out of eighteen

*"He's not really using all of his different animation states… I'd like him to
be more brimming with personality."*

Two causes, and only one of them is the model's.

The pose the owner named — *"leaning in toward the message"* — is not a model
choice at all. It is an engine-forced `curious` on the first streamed token,
which fires on EVERY reply regardless of content, and `curious` is a forward
lean at `lean: 0.62`. It still fires, because the moment the waiting ends wants
marking; it now yields when the model has already expressed something this turn,
which is strictly more informed than a transition marker.

The other cause is the prompt's own governing rule, which read SILENCE IS A
VALID EMISSION and paired it with a trigger table written at the altitude of a
whole reply. Turn-level triggers plus an explicit licence to do nothing is a
character with one pose per turn, and the engine's default for a turn that never
called `express` is `idle` — a blank pose. The rule now reads EXPRESSION TRACKS
THE BEAT, NOT THE TURN. That is deliberately not "emit more": what the old
wording was protecting — expression that does not track the words — is still
forbidden in as many words. What changed is that a reply which looks something
up, finds it surprising and says so is three beats, and `express` may be called
for each; the browser applies each command the instant it streams in, so a state
emitted mid-sentence lands mid-sentence. That path existed and nothing had ever
asked for it.

**Unmeasured, and it must not be reported as measured.** The prompt half of this
is a behavioural change to a model, and this pass built no rig for counting
which states it reaches for across N turns.
`roadmap/plans/decke-experience-pass/NEXT.md` describes the probe shape that
would answer it at about a cent per turn. The mechanical half — the forced
`curious` yielding — is code, and is covered.

**Why:** Everything above is one class of bug wearing sixteen faces: something
that should be a smooth function of the frame was instead a step function of an
event, and the event fired more often than anyone had modelled. A dolly driven
by a growing textarea, a station re-solve thrown away on a missed frame, two
components both entitled to launch a flight, a gate keyed to a name that changes
a crossfade before the picture does. The tests and the probes are the part that
lasts: 598 tests pass where 576 did, and 22 of the new ones exist because the
thing they pin had no test at all.

---

