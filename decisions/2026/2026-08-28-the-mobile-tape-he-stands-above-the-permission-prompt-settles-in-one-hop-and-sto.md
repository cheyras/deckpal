---
date: "2026-08-28"
title: "The mobile tape: he stands above the permission prompt, settles in one hop, and stops telegraphing his own animation"
decided_by: "Claude (Opus 5) on behalf of @cheyras, from a 5m56s iPhone"
areas: ["security","frontend","catalog"]
supersedes: []
---
## 2026-08-28 — The mobile tape: he stands above the permission prompt, settles in one hop, and stops telegraphing his own animation

**Decided by:** Claude (Opus 5) on behalf of @cheyras, from a 5m56s iPhone
screen recording of Deck-E on a phone.

**Decision.** Five defects, four fixes, each measured against a control run in
the same sitting.

**1. He stood on top of the permission prompt.** *"We have this issue where the
permission prompts, he's covering it up. I'd like him to like jump up above the
permission prompt … so we can actually read the text that he's covering up."*
His phone park box is anchored to the composer's top edge, and the approval card
is a sibling ABOVE the composer in the same bottom stack — so the one moment the
panel puts a block of text beside the one thing that has to be answered, the
character is drawn across it. `parkFloor.ts` now takes the higher of the two
edges, with a ceiling so a tall card cannot push him off the top of the panel
and a floor of `composerTop` so a mis-measured panel cannot push him back into
the composer. **Measured at 390x844 on the real app, before and after
(`probe-approval-clearance.mjs`): 101px of the card behind him → 8px of
clearance.** Desktop parks him beside the composer, outboard of the card's
column, and is unaffected.

**2. He drifted downward for five seconds and jittered getting there.** *"See
how that is like slowly drifting downward before it rests at the bottom? It's
also causing him to do a lot of jitter and stuff as he has to readjust a
bunch."* Tracked frame by frame at 10 Hz from 0:36.6 to 0:41.5, his silhouette's
bottom edge fell in SIX discrete hops with a retreat between each pair — ~90 CSS
px in just under five seconds. Six hops is the mark watch firing six times: any
move over 1px bought a full `flyTo` with an arc and an arrival.

Two ideas, and BOTH were needed. A size threshold (`MARK_HOP_MIN_PX`, 24px)
alone took it from six flights to four, because a drift arriving 13px at a time
crosses 24px every second hop. The missing one is that **you cannot fly to a
moving target**: a flight is the gesture for "that moved, I am going to it", and
what follows while the layout settles is him keeping station, which is a cut.
`MARK_QUIET_MS` gates the flight on the mark having been LET ALONE first.
**Measured on the real app (`probe-park-settle.mjs`), replaying the tape's own
six hops: `main` 6 flights → 1.**

Separately, `steadyHeight` (3px deadband) stops the loop that generated the
moves: his height sets `parkW`, which sets `--decke-gutter`, which re-wraps the
transcript, which the mark watch is watching.

**3. `express` was telegraphed to the reader.** *"The 'change how he looks'
commands don't need to be telegraphed to the user ever."* Filed against a turn
whose entire content was feedback and which came back with `Change how he looks
· applied 1 command(s)` above the reply. It is the tool's own contract — *"The
user never sees these commands — only your words and the animation."* The chip
was added by the pass that made `showScreen` visible, and that pass's reasoning
is entirely about PANELS: a panel is a thing on screen the next leg has to know
about, which is why its summary is replayed; an animation is not a lookup,
`lookupRecord`'s `NOT_EVIDENCE` has always refused to replay it, and the reader
is already watching it. The server stops emitting it and the client refuses to
draw one, both pinned. **Measured (`probe-quiet-tools.mjs`): the row is gone and
the `decks` row beside it still draws.**

**4. He proposed a write when he was asked to read.** *"You attempted to edit the
strategy guide again instead of just looking at it."* Asked "Give me insights
about my slowking deck", the first thing on screen was a dialog asking to write
and store a strategy guide.

`decke-read-vs-write-probe.mjs` reproduces it against the live model on the real
prompt. **n=44: eight proposed guide-writes, and ALL EIGHT were byte-identical
to the guide he had just read.** He was not making a bad judgement about what to
write — there was nothing to write. So the fix is structural rather than a
prompt rule, on the precedent `declined.ts` and `focus.ts` set: `noOp.ts` answers
"would this change anything?", and a write that changes nothing is neither asked
about nor run. A prompt paragraph went in as well and is NOT credited with
anything — it measured 2/12 before and 2/12 after.

**5. He ran lookups on a message that asked nobody anything.** *"There was no
reason to do the browse decks commands for this request"* — the request being a
feedback message that said to answer "thanks for the feedback!". A prompt rule,
because there is nothing structural to hook: **the probe could not reproduce it
from a cold turn (0/12 on both variants), so this one is unproven and is the
only change here without a measurement behind it.**

**Why.** Everything on the tape was reported in the reader's own words, twice
inside the conversation itself, which is the shape this project has repeatedly
found to be worth acting on directly.

**Implications.**
- `noOp.ts` consults its predicate from BOTH `needsApproval` and `execute`, the
  same pairing `declined.ts` uses and for the same reason: `needsApproval: false`
  means "raise no dialog", never "run it". Every path that cannot answer returns
  "it changes something", so a bug there costs a dialog and can never cost an
  unapproved write. `NO_OP_CHECKS` has one entry on purpose — the next one
  should arrive with its own recording.
- `needsApproval` for data tools is now **async**. Nothing in the SDK contract
  changed (`boolean | PromiseLike<boolean>`), but a test that calls it and
  compares `=== true` will now always fail; `noOp.test.ts` awaits it.
- `packages/agent-tools` exports `needDeck`, so the no-op check resolves a deck
  reference exactly as the write tool does. Resolving it differently would
  compare against a deck the write would not have touched.
- Three new browser probes (`probe-approval-clearance`, `probe-park-settle`,
  `probe-quiet-tools`) each carry a `--control` path or a control number, because
  every claim above is a before/after and a one-sided reading is not one.
- The park box now carries `data-decke-approval` on the card, so the geometry is
  assertable from outside rather than by reading pixels out of a WebGL buffer.

