---
date: "2026-08-20"
title: "Deck-E: a state is something he STAYS in"
decided_by: "user, from the 2026-08-19 narrated screen recording of `/dev/decke`."
areas: ["agents","decks"]
supersedes: []
---
## 2026-08-20 — Deck-E: a state is something he STAYS in
**Decided by:** user, from the 2026-08-19 narrated screen recording of `/dev/decke`.

The pass produced about twenty notes. Nearly all of them are one architectural
mistake, said in different words on different buttons: **the port had emotes but
no states.** A clip played once and then held its last beat forever, and because
almost every clip's last beat is the rest pose, "be happy" resolved to "be
briefly happy, then be nothing". The two clips whose last beat is *not* rest
froze on a yawn (`sleep`) and on a mouthful of orbiting cards (`loading`). The
reviewer stated the general rule three separate times — *he should never snap to
being done; he should stay in the state until told to leave it* — and asked
specifically for the agent to be able to say either "hold this" or "do this for
N milliseconds, then go back to idle".

**A state is now `intro -> sustain -> outro`.** `sustain.ts` carries one loop
window per state, read off the beat table. This is not new animation: the
oscillations the reviewer asked to keep ("continue to do that rocking back and
forth", "the back and forth animation just continues to loop", "continuing to do
the little vibrate") were already in the middle of each clip, where a
play-once-then-hold could never reach them twice. `fromMs === toMs` is legal and
means *hold this instant*, which is the right answer for a presentation or a
droop. `__tests__/sustain.test.ts` evaluates both ends of every window and fails
if they disagree by more than the budget for that channel — a loop is a cut back
to its start, so a window that drifts is a pop once per loop forever. The budget
is per-channel because the channels are not commensurate: a degree and a half of
motion for the four with a known physical mapping (`bend`, `lean`, `twist`, and
`mouth`, whose tenths drive 5.5 degrees of the lid his eyes are mounted on),
4.5 degrees for the root euler, and a flat 0.06 for morph weights and gaze
offsets, which have no degrees to convert to.
It caught three: `frustrated` (0.08 of jaw), `sad`, and a `loading` window that
would have despawned and respawned both orbiting cards every 1.8 s, which is the
reported defect reintroduced from the other end.

**There was no `idle`.** `boot` was the entry state, it is 640 ms long, its
modulation is `float_amp: 0, blink_rate: 0`, and nothing ever left it — so a
freshly loaded page showed a character who was not breathing, blinking or
looking at anything, ever. That is the note the reviewer made four times and
apologised for making. `idle` is synthesized, empty, and looped; everything that
makes it read alive is the procedural layer composing on top.

**The look-at constraint had never been ported.** `Ctrl_Target` carries a Copy
Location from the camera in the `.blend`; constraints do not export, and the
exporter emitted it as a childless ROOT node, so `rig.ts` faithfully wrote the
gaze onto an object nothing reads. The pupils sat at their bind pose — which is
a baked SAMPLE of that constraint — so he stared up and to the right through
every state, every turn and every flight. `look.ts` rebuilds it as an aim in each
eye's own frame, clamped to the roam ellipse, with the gain calibrated so the
staging camera reproduces the glb's bind pose to 0.02%. Parity work had measured
this rig against Blender in fourteen poses and three clips and could not see it,
because a frozen constraint and a correctly-evaluated one agree exactly at the
frame the constraint was frozen on.

**Two symbol defects were one wrong axis.** `sym_spin` rotated the glyph about
three's Y — blender's Z, an axis lying *inside* the glyph plane — which tips the
symbol edge-on instead of turning it. That is the dizzy spiral "getting all
warpy", and the same 180-degree right-eye phase applied about that axis is a pure
horizontal MIRROR, which is why the money symbol read backwards while the
symmetric glyphs looked fine. Both spins are now driven from unwrapped state time
at the atlas's own rates; recovering `alert_dizzy`'s authored ramp as exactly
`spin_deg_per_s` is what confirms the rate rather than assuming it. The `loading`
spinner had never turned at all — nothing read `spin` or `spinner_deg_per_s`.

**`flyTo` picks its side by the element's half of the screen**, not by where
there is room. The old rule sent him to the larger gap, which for anything left
of centre means "over on the right", a long way from the thing he is presenting.
He now parks OUTBOARD and looks back across the element, with one exception for
an element against a viewport edge. `returnHome` is the bottom-right corner of
the viewport rather than the world origin: the origin is where he is STAGED for
parity stills and is the worst place to leave an assistant on a page.

**Highlighting is now half the presentation,** and it lives in the design system
rather than beside the character, which is where it was asked for: "I would build
the highlighting functionality into the design system itself." A chasing
multi-hue ring (`components/ui/elementHighlight.ts`, with `HighlightRing.tsx` and
a gallery entry over it) built from the three brand hue scales, as an overlay
rather than a class, so it works on elements it has never seen and inside
`overflow: hidden`. Deck-E is its first caller and should not be its last —
anything that has to say *this element* wants it, and none of those should have
to import a mascot to get it.
A travelling rainbow edge is the one border treatment no static UI state uses, so
it cannot be confused with focus, selection, error or hover.

**Also:** the turn is 1.75x faster; `talk` ramps over 220 ms instead of cutting
the jaw off mid-syllable; the default crossfade is 320 ms and EASED, because a
linear blend reads as a cut at both ends however long it is; `confused` gets
spiral eyes swapped in behind a blink; the stash cards' two-frame spawn pop is
time-warped to 280 ms and they hang on independent floats until told to file in;
the card fronts get thin-film iridescence and a roughness that is not glTF's
default 1.0; and an agent can author its own clip with `op: "keyframes"`, which
compiles through the same path as the playbook and is therefore a state like any
other.

**A second pass, from an adversarial review of the above,** which is where four
of these landed. Three were the same root cause in a new place: the UNWRAPPED
state clock leaking into things that are only meaningful against the authored
clip timeline. `loading`'s outro scaled the orbit's ACCUMULATED angle to zero, so
the longer he had been loading the more revolutions the hands unwound in 520 ms —
four after eleven seconds, twenty-two after a minute; it now unwinds a wrapped
angle, at most half a turn. A sustained `card_present` walked off the end of its
own mirror gate after 2.3 s and swept the presented card through his body; the
gate now runs on the clip clock while the orbit keeps the unwrapped one. The
outro queue had two holes of its own: a second `setState` during an outro cut it
short instead of replacing the queue, and leaving during an INTRO played an outro
for an orbit that had never deployed, popping two cards into existence inside the
animation whose only job is to remove them.

The fourth is worth its own line because it is a shape that recurs: the parked
re-park on resize was written as a leading-edge throttle while its comment
described a trailing debounce. Those are three nearly identical lines with
opposite behaviour — the throttle fires on the FIRST event and drops the last
one, so a continuous drag leaves him beside where the element used to be, which
is the failure the code exists to prevent.

**Implications.** `PARITY.md`'s stills were taken against the frozen gaze, so any
frame where the gaze has since moved is now a comparison against a different
thing — intended, since the frozen pose was the bug. The character tests existed
before this and were only ever run by hand, which is how a look-at solve that
nothing consumed survived a full parity pass; they run in CI now
(`pnpm --filter deckpal-web test:decke`, 66 tests).

