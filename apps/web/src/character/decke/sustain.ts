/**
 * Sustain — the reason a state can be ONGOING rather than a thing that plays
 * once and freezes on its last frame.
 *
 * Every authored clip in the playbook has the same three-part shape:
 *
 *     [ in ]------[ sustain ]------[ out ]
 *      rise        the pose         return to rest
 *      into it     he holds
 *
 * The port used to play the whole thing and then hold the FINAL beat forever.
 * Because nearly every clip's final beat IS the rest pose, that meant "be happy"
 * resolved to "be briefly happy and then be nothing", and the two clips whose
 * last beat is not rest (`sleep`, `loading`) froze on a yawn and on a mouthful of
 * cards respectively. Neither is a state. Both were reported from the screen
 * recording of 2026-08-19, along with the general rule the reviewer stated three
 * separate times: *he should never snap to being done — he should stay in the
 * state until told to leave it.*
 *
 * So a state now runs as a small machine:
 *
 *     enter -> intro [0, fromMs) -> sustain (loop [fromMs, toMs]) -> outro -> next
 *
 * and `setState` without a duration simply never leaves the sustain.
 *
 * WHY A LOOP WINDOW AND NOT A HELD POSE. Holding one pose is dead, and the
 * reviewer asked for the opposite in specific words for four states: thinking
 * "should continue to do that rocking back and forth", confused's "back and
 * forth animation just continues to loop", frustrated "should stay like that",
 * alert "just continuing to do the little vibrate". The authored clips already
 * contain those oscillations — they are simply in the middle of the clip, where
 * a play-once-then-hold can never reach them twice. Looping a window is
 * therefore not new animation; it is the animation that was always there.
 *
 * WHY THE WINDOWS ARE DATA AND NOT DERIVED. A heuristic ("loop the widest
 * plateau") gets `thinking` wrong — its sustain is a 900 ms oscillation, not a
 * plateau — and gets `nod_yes` wrong in the other direction. Each window below
 * is chosen off the beat table and carries the beat times it was chosen from.
 * `__tests__/sustain.test.ts` then checks the thing that actually matters: that
 * the two ends of every window agree channel by channel, so the wrap is
 * invisible. A window that drifts fails the test rather than shipping a pop.
 */
import { evalCurve } from './curve'
import type { Beat, CompiledState, PlaybookDoc, Pose, StateClip } from './playbook'

/**
 * THE LOOP SEAM, AND WHY A WINDOW IS NOT ENOUGH ON ITS OWN.
 *
 * Choosing `[fromMs, toMs]` off the beat table gets the POSE approximately right
 * at both ends and says nothing at all about the two things that actually make a
 * wrap visible:
 *
 *   1. THE VALUES ONLY NEARLY AGREE. Beats are sparse and a channel missing from
 *      a beat is at REST at that beat, not held — so `curious`'s beat 1250 omits
 *      `pz` and the loop dropped him 0.04 units and put him back, once a second,
 *      forever. That is the reviewer's "it does like a pop upward, boom, boom,
 *      boom". `happy` did the same with 0.03 of `sq` (3% of his height),
 *      `proud` with 0.01 (the "he kind of shrinks slightly vertically" note),
 *      and `listening` and `card_stash` with small drifts on three channels
 *      each. Every one of them is a state whose sustain is a HELD pose, which is
 *      why they were the ones reported: against stillness, any jump is the only
 *      thing moving.
 *
 *   2. THE VELOCITIES DISAGREE EVEN WHERE THE VALUES DO NOT. `fromMs` and `toMs`
 *      are interior keys of the authored clip, and their tangents were solved
 *      for the neighbours the window cuts away. `thinking` measured a 32.6 deg/s
 *      step in `ry` across a seam whose values match exactly.
 *
 * So the sustain is not a pair of times into the authored clip any more. It is
 * its OWN clip, built once at load:
 *
 *   - the window's interior beats, rebased to zero;
 *   - a head beat SAMPLED from the compiled curves at `fromMs`, which fills in
 *     every channel the authored beat left out;
 *   - a tail beat that is a COPY of the head — so the two ends are equal by
 *     construction rather than by inspection, and no window can ever drift;
 *   - `cyclic: true`, which makes `makeCurve` give the seam one shared tangent
 *     instead of two terminal ones.
 *
 * The window ends therefore no longer have to land on authored beats, which is
 * what makes `confused`'s cadence fixable at all — see its entry below.
 *
 * WHAT SURVIVES. A STEPPED channel still steps across the seam, because the
 * final key of a step segment is never rendered under a modulo loop (the clock
 * wraps before it reaches it) and the segment holds the previous key's value
 * right up to the wrap. That is deliberate: `confused` and `frustrated` are
 * authored in a stepped robot register and the alerts carry a 15 Hz `px`
 * vibrate, and all three were explicitly kept — "some of them, that's on
 * purpose... the alerts are supposed to have a little vibration, that's
 * intentional. All of the UNINTENTIONAL pops in the loop should be eliminated."
 */
export type SustainSpec = {
  /** Where the intro ends and the loop begins, in clip ms. */
  fromMs: number
  /**
   * Where the loop wraps back to `fromMs`, in clip ms.
   *
   * `toMs === fromMs` is legal and means HOLD THIS INSTANT. It is the right
   * answer for a pose whose job is to be still — a presentation, a droop — and
   * for plateaus that drift too much across a wide window to loop without a
   * twitch. A hold is not a frozen character: the idle float, the blink schedule
   * and the gaze all keep running underneath, at whatever rate the state's own
   * modulation asks for.
   */
  toMs: number
  /**
   * Play the authored tail `[toMs, duration_ms]` on the way out instead of
   * crossfading straight to the next state. Only where that tail is a real
   * action the viewer is owed: `card_stash`'s cards filing back in and the lid
   * closing over them. Everywhere else the eased crossfade is shorter and
   * reads better than replaying an authored return.
   */
  outroTail?: true
  /**
   * A synthesized outro, for a state whose authored clip HAS no tail. `loading`
   * loops from its first beat to its last with the orbit at full deployment, so
   * there is nothing to play out; this is that missing beat.
   */
  outroClip?: StateClip
  /**
   * A synthesized sustain clip, used where the authored clip contains no
   * window worth looping. `sleep` is the only one; see SLEEP_BREATH.
   */
  clip?: StateClip
}

/** The idle float, slowed. The reviewer: "it should be a little bit of a slower
 *  float when he's in idle" — measured against `happy`'s 1.3, which is what he
 *  was actually looking at when he said it. */
const IDLE_MOD = { float_amp: 1.0, float_rate: 0.85, blink_rate: 1.0 }

/**
 * `idle` — the state the character is in whenever nothing else is asked of him,
 * and the one the playbook does not contain.
 *
 * There was no idle. `boot` was the entry state, it is 640 ms long, its
 * modulation is `float_amp: 0, blink_rate: 0`, and nothing ever left it — so a
 * freshly-loaded page showed a character who was not breathing, not blinking and
 * not looking at anything, forever. That is the "he's not doing his idle from
 * the very get-go" note, which the reviewer made four separate times and
 * apologised for making.
 *
 * It is deliberately an EMPTY clip: rest pose, one beat, no keys. Everything
 * that makes idle read alive — the three-sine float, the blink schedule, the
 * gaze flits — is procedural and composes on top. Authoring an idle clip would
 * fight those layers rather than add to them.
 */
export const IDLE_STATE: StateClip = {
  kind: 'clip',
  symbol: null,
  duration_ms: 900,
  mod: 'idle',
  modulation: IDLE_MOD,
  loop: true,
  beats: [
    { t_ms: 0, ease: 'ease', pose: {} },
    { t_ms: 900, ease: 'ease', pose: {} },
  ],
}

export const IDLE = 'idle'

/**
 * `sleep`'s sustain, which had to be written rather than found.
 *
 * The authored clip is a yawn: it ends mid-gape with the lids at 1.0, and
 * holding that final beat is what the reviewer described as "he's just getting
 * stuck on this... that just looks weird". What he asked for instead is spelled
 * out almost frame by frame: "he should do the yawn and then like his mouth
 * closes and his eyes close and then he kind of starts like leaning forward and
 * back with a back arch... that should be where he stops, where he's kind of
 * like heavy breathing in and out slowly."
 *
 * So: mouth shut, lids shut — BOTH lids. The authored yawn ends at `lid_u` 1.0
 * with `lid_l` only 0.6, which is a heavy-lidded droop rather than a closed eye,
 * and holding it reads as "sleepy" instead of "asleep". `boot` shows what shut
 * looks like on this rig: both lids at 1.0. The sustain closes the lower one the
 * rest of the way over the phase blend, which is the beat the yawn is missing.
 *
 * Then `bend` breathes around the yawn's own resting bend of 0.26 over a 4.4 s
 * cycle (~13.6 breaths/minute, the low end of a
 * sleeping adult's rate — slow enough to read as asleep rather than as idle).
 * `sq` rides with it, quarter-amplitude and in phase, so the whole body swells
 * rather than only folding. `pz` sinks slightly at the bottom of the exhale.
 *
 * The first and last beats are IDENTICAL, which is what makes the loop
 * invisible; the test enforces it.
 */
const SLEEP_BREATH: StateClip = {
  kind: 'clip',
  symbol: null,
  duration_ms: 4400,
  mod: 'sleep',
  modulation: { float_amp: 0.35, float_rate: 0.4, blink_rate: 0 },
  loop: true,
  beats: [
    { t_ms: 0, ease: 'ease', pose: { pz: -0.14, bend: 0.26, sq: -0.02, m_curve: 1.0, lid_u: 1.0, lid_l: 0.95, brow: -0.65 } },
    { t_ms: 1600, ease: 'ease', pose: { pz: -0.08, bend: 0.11, sq: 0.05, m_curve: 1.0, lid_u: 1.0, lid_l: 0.95, brow: -0.65 } },
    { t_ms: 2400, ease: 'ease', pose: { pz: -0.09, bend: 0.13, sq: 0.04, m_curve: 1.0, lid_u: 1.0, lid_l: 0.95, brow: -0.65 } },
    { t_ms: 4400, ease: 'ease', pose: { pz: -0.14, bend: 0.26, sq: -0.02, m_curve: 1.0, lid_u: 1.0, lid_l: 0.95, brow: -0.65 } },
  ],
}

/**
 * `loading`'s outro — the beat the authored clip does not have.
 *
 * The clip is a pure loop: its first and last beats are the same fully-deployed
 * orbit, so "play the tail" would play nothing and the cards would simply blink
 * out of existence at whatever point in their arc the stop arrived. The
 * reviewer asked for the opposite: "once it stops, then they kind of quickly
 * finish what they're doing and then he goes into idle."
 *
 * `orb_on` falling to 0 is what does the finishing. It reselects the hands'
 * target from their orbit station back to their stow, and the cards ride the
 * hands in — so they travel home rather than vanishing. 520 ms is short enough
 * to read as "quickly" and long enough to read as travel; the small `sq` /`pz`
 * lift on the way is the wind-up that stops it looking like a power cut.
 */
const LOADING_LAND: StateClip = {
  kind: 'clip',
  symbol: 'spinner',
  duration_ms: 520,
  mod: 'loading',
  modulation: { float_amp: 0.65, float_rate: 1.35, blink_rate: 0.9 },
  beats: [
    { t_ms: 0, ease: 'ease', pose: { mouth: 0.05, m_curve: -0.1, lid_u: 0.25, alert: 1, hand_l: 1, hand_r: 1, orb_on: 1, card_l: 1, card_r: 1 } },
    { t_ms: 180, ease: 'ease', pose: { pz: 0.05, sq: 0.08, mouth: 0.1, m_curve: -0.2, lid_u: 0.1, alert: 1, hand_l: 0.9, hand_r: 0.9, orb_on: 1, card_l: 1, card_r: 1 } },
    { t_ms: 360, ease: 'ease', pose: { pz: 0.02, sq: 0.02, mouth: 0.04, m_curve: -0.3, lid_l: 0.2, alert: 0.35, hand_l: 0.35, hand_r: 0.35, orb_on: 0.4, card_l: 0.4, card_r: 0.4 } },
    { t_ms: 520, ease: 'ease', pose: {} },
  ],
}

/**
 * `card_stash`'s way out — the beat its authored tail cannot be.
 *
 * The authored tail runs 1900 -> 2800 and SLAMS the mouth shut at 2010, 110 ms
 * in. That is the right timing for the clip it belongs to, where the five cards
 * were back inside by 1333 ms and he then sat with his mouth open for half a
 * second; it is impossible for the way out the reviewer asked for, which has the
 * cards still travelling: "when they're ready to go in, they all come up
 * together like this, but hopefully so they're not clipping, and then quickly go
 * down in."
 *
 * So the body gets its own outro, timed to the gather-and-dive in `cards.ts`:
 * the cards are gathered by 380 ms, filed in by 820, and the lid closes over
 * them at 900. He leans back and opens wider as they come (an intake), gulps,
 * and settles into a small satisfied smile with his own card back inside him —
 * `single` returns to its rest value of 1 on the last beat, which is what "it
 * animates into him and then he closes" means for the card that was already
 * there.
 *
 * The card timing is COUNT-INDEPENDENT by construction (see `STASH.fileSpanMs`),
 * so this one clip is the right length for a batch of two and for a batch of
 * twelve.
 */
const STASH_CLOSE: StateClip = {
  kind: 'clip',
  symbol: null,
  duration_ms: 1040,
  mod: 'happy',
  modulation: { float_amp: 0.85, float_rate: 0.9, blink_rate: 0.9 },
  beats: [
    { t_ms: 0, ease: 'ease', pose: { bend: -0.62, brow: 0.6, mouth: 2.09, pz: 0.14, sq: 0.2, single: 0 } },
    { t_ms: 380, ease: 'ease', pose: { bend: -0.68, brow: 0.64, mouth: 2.09, pz: 0.2, sq: 0.26, single: 0 } },
    { t_ms: 620, ease: 'ease', pose: { bend: -0.58, brow: 0.55, mouth: 2.09, pz: 0.12, sq: 0.18, single: 0 } },
    { t_ms: 820, ease: 'ease', pose: { bend: -0.3, brow: 0.4, mouth: 2.0, pz: 0.0, sq: 0.05, single: 0 } },
    { t_ms: 900, ease: 'ease', pose: { bend: 0.3, brow: 0.15, mouth: 0.04, lid_u: 0.72, m_curve: -0.35, pz: -0.08, sq: -0.2, single: 0 } },
    { t_ms: 1040, ease: 'ease', pose: { bend: -0.05, lid_l: 0.32, m_curve: -0.75, pz: 0.04, sq: 0.06 } },
  ],
}

/**
 * The loop window per state, with the beat times it was read off.
 *
 * States absent from this table are ONE-SHOTS: they play, then hand over to
 * `idle` (or to whatever the caller named). Only three qualify — `boot`, which
 * is a lifecycle event, and the two `travel_*` clips, which are the flight's own
 * body language and are meaningless held.
 */
export const SUSTAIN: Record<string, SustainSpec> = {
  // `idle` is a loop with nothing in it — every channel is at rest and all of
  // the life comes from the procedural layers. It still needs an entry here, or
  // it would be classified as a one-shot and hand over to itself once a second.
  [IDLE]: { fromMs: 0, toMs: 900 },

  // Beats 160 / 900: the leaned-in listening plateau, either side of an
  // 0.02-wide drift on every channel.
  listening: { fromMs: 160, toMs: 900 },

  // Beats 320 / 1220. `ry` runs -8.68 -> -6.51 -> -7.0 -> +8.68 -> +6.51 ->
  // +7.0 -> -8.68: one full rock is 900 ms and the two ends are the SAME beat
  // value, so this wrap is exact rather than merely close.
  thinking: { fromMs: 320, toMs: 1220 },

  // Beats 500 / 1400, the settled grin.
  happy: { fromMs: 500, toMs: 1400 },

  // A HOLD at beat 1900, not a loop.
  //
  // `sad` is the one plateau that is really a slow settle: across 520 -> 1900
  // the mouth closes 0.04 and the frown eases 0.05, so any window wide enough to
  // be worth looping carries a couple of degrees of lid back to its start on
  // every wrap. `fromMs === toMs` is a legal window and means "hold this
  // instant", which is the right answer here — sad is a droop and should be
  // still. What keeps it alive is the procedural layer underneath, which for
  // this state is running at `float_rate` 0.55: a slow, heavy breath.
  sad: { fromMs: 1900, toMs: 1900 },

  // Beats 560 -> 1260 of the authored clip, PLUS the 310 ms spiral prologue that
  // `withSpiralEyes` inserts ahead of them.
  //
  // WAS 420 -> 980, and that window was the one thing about `confused` that was
  // wrong: "the loop point is a little too quick, so the little back-and-forth
  // motions he's doing are kind of uneven in feel. I would just pad out the end
  // of that animation a little bit."
  //
  // BOTH HALVES OF THAT ARE THE SAME MISTAKE. The clip is a stepped register —
  // beats 560, 700, 840, 980 are `step` and each holds for exactly 140 ms — but
  // beat 420 is EASED, so a window opening there began with a 140 ms smooth
  // slide and then snapped into three held steps. One eased beat inside a
  // stepped bar is precisely "uneven in feel". Starting at 560 makes every step
  // in the loop the same 140 ms.
  //
  // And the padding is then free, because a window end no longer has to land on
  // a beat: 980's step holds through to 1600, so 1260 is two more 140 ms slots
  // of the LAST head position. He shakes three times and then holds for a beat
  // before going again, which is what stops a loop of a head-shake reading as a
  // machine. 700 ms round, against 560.
  confused: { fromMs: 560 + 310, toMs: 1260 + 310 },

  // Beats 330 / 470 — two steps of the jaw chatter, and the only pair of the
  // five that wraps cleanly. The obvious window (240 -> 540) spans the whole
  // burst and looks tidier in the table, but its ends are `mouth` 0.34 against
  // 0.26: an 0.08 jolt of jaw, once every 300 ms, forever. The test catches it.
  // Looping the shorter pair leaves him gnashing at a steady 7 Hz, which is what
  // "he should stay like that" means for this one.
  frustrated: { fromMs: 330, toMs: 470 },

  // A HOLD at beat 1150, not the flutter.
  //
  // "He's like rapidly shaking, and I don't really like that. It should just kind
  // of hold on the facial expression rather than having this vibration."
  //
  // The flutter is beats 200/260/330, three stepped shudders, and looping them
  // shook him indefinitely. It is a good ENTRANCE and a terrible state, so it
  // stays in the intro — he flinches once, on the way in — and the sustain holds
  // beat 1150, which is that flinch settled: turned away, brows down, gaze off
  // to the side. Everything that keeps it alive from there is procedural.
  embarrassed: { fromMs: 1150, toMs: 1150 },

  // Beats 390 / 1250, the head-tilt hold.
  curious: { fromMs: 390, toMs: 1250 },

  // Beats 450 / 1500, the chest-out hold.
  proud: { fromMs: 450, toMs: 1500 },

  // Beats 90 / 350, one nod. Looping it is what makes "nod yes, nod yes, nod
  // yes" expressible; a single play is still available as `mode: 'once'`.
  nod_yes: { fromMs: 90, toMs: 350 },

  // Beats 280 / 540, one shake of the head.
  shake_no: { fromMs: 280, toMs: 540 },

  // Beats 756 / 1802 on every alert: the post-roll hold, then the 15 Hz
  // `px` vibrate burst, then back. Both ends sit at `px = 0, alert = 1`, so the
  // wrap is exact. One loop is 1046 ms, which is the "little vibrate every half
  // second or whatever the cadence is" the reviewer asked to keep.
  alert_money: { fromMs: 756, toMs: 1802 },
  alert_star: { fromMs: 756, toMs: 1802 },
  alert_warn: { fromMs: 756, toMs: 1802 },
  alert_error: { fromMs: 756, toMs: 1802 },
  alert_dizzy: { fromMs: 756, toMs: 1802 },
  alert_scribble: { fromMs: 756, toMs: 1802 },

  // Beats 900 / 1800 — the mouth bob, and the two beats are IDENTICAL, so this
  // wrap is exact.
  //
  // Not the whole clip, which is the obvious choice and is wrong: beat 0 has
  // `card_l`/`card_r` at zero (the cards have not spawned yet) and beat 1800 has
  // them at one, so looping 0 -> 1800 despawns and respawns both orbiting cards
  // once every 1.8 seconds. That is precisely the reported defect — "these
  // shouldn't be going away and then coming back, they should stay just circling
  // him" — reintroduced from the other end. Starting the loop after the spawn
  // stagger keeps the entrance and drops the re-entrance.
  loading: { fromMs: 900, toMs: 1800, outroClip: LOADING_LAND },

  // Beats 400 / 1900, the full 115-degree gape held open, with the fan of cards
  // hanging around him for as long as he is asked to hold it. The way out is
  // SYNTHESIZED rather than the authored tail; see `STASH_CLOSE` for why the
  // authored one cannot be used once the cards are still in the air.
  card_stash: { fromMs: 400, toMs: 1900, outroClip: STASH_CLOSE },

  // HOLDS at the end of the plateau, for the same reason as `sad`.
  //
  // All three are presentations, and a presentation should be STILL — the
  // reviewer's words for two of them are "he should stay with it like that until
  // told to stop" and "he should stay in that state where he's showing it".
  // Their plateaus also drift enough over a second and a half (card_show closes
  // 0.03 of mouth, `point` walks its gaze 0.2 units) that looping them would put
  // a small twitch on a pose whose whole job is to hold steady while the reader
  // looks at what he is holding.
  card_show: { fromMs: 1600, toMs: 1600 },
  card_present: { fromMs: 1600, toMs: 1600 },
  point: { fromMs: 1320, toMs: 1320 },

  // Synthesized; see SLEEP_BREATH.
  sleep: { fromMs: 1600, toMs: 1600, clip: SLEEP_BREATH },
}

/**
 * `confused` gets the spiral eyes, which the authored clip does not have.
 *
 * "On confused, I'd like his eyes to go to the spiral animation, because I think
 * it would read more as confusion. So, not doing the total alert state, but
 * having him — maybe before playing the confused animation — blink, and when he
 * opens his eyes he's just like this, but with his eyes as spirals. And he's not
 * looking at the camera during confused, just looking straight forward."
 *
 * Three things in that, and they resolve to one mechanism.
 *
 * The spiral is `dizzy`, and the way a symbol gets into an eye is the alert
 * REEL — the pupil drum rolls up and out while the glyph rolls in under it. But
 * the reel on its own is the loud alert entrance, which is explicitly not wanted
 * ("not doing the total alert state"). The BLINK is what makes it quiet: the
 * lids shut, the drum turns behind them, and the lids open on a face that has
 * changed. That is the same trick the gaze layer uses for glance-aways, and it
 * works for the same reason — the eye is not being watched while it moves.
 *
 * "Not looking at the camera" then comes free rather than needing a rule of its
 * own: `aimPupil` releases the gaze in proportion to `alert`, because a reel
 * needs a centred drum. With the spirals in, there is no pupil to point.
 *
 * And the spin comes free too: `spinRateFor` keys off the SYMBOL, not the state,
 * so a spiral turns at the atlas's 150 deg/s wherever it appears.
 *
 * The prologue is inserted rather than replacing the clip, and `alert` is
 * stamped onto every later beat — beats are complete poses, so a channel that
 * stops being mentioned drops back to rest, which here would drop the spirals
 * out again on the very next beat.
 */
const BLINK_SHUT_MS = 90
const BLINK_HOLD_MS = 70
const BLINK_OPEN_MS = 150

function withSpiralEyes(clip: StateClip): StateClip {
  const prologueMs = BLINK_SHUT_MS + BLINK_HOLD_MS + BLINK_OPEN_MS
  const lead: Beat[] = [
    { t_ms: 0, ease: 'ease', pose: {} },
    // Shut, with the reel already starting so the drum is moving before the
    // lids finish closing — a reel that only starts once the eye is shut has to
    // be over before it opens, which needs a longer blink than reads as one.
    { t_ms: BLINK_SHUT_MS, ease: 'ease', pose: { lid_u: 1, lid_l: 0.7, alert: 0.45 } },
    { t_ms: BLINK_SHUT_MS + BLINK_HOLD_MS, ease: 'ease', pose: { lid_u: 1, lid_l: 0.7, alert: 1 } },
    { t_ms: prologueMs, ease: 'ease', pose: { alert: 1 } },
  ]
  const rest: Beat[] = clip.beats
    .filter((b) => b.t_ms > 0)
    .map((b) => ({ ...b, t_ms: b.t_ms + prologueMs, pose: { ...b.pose, alert: 1 } }))

  return {
    ...clip,
    symbol: 'dizzy',
    duration_ms: clip.duration_ms + prologueMs,
    beats: [...lead, ...rest],
  }
}

/**
 * Clip transforms applied at load, alongside the authored playbook.
 *
 * Kept here rather than in `gen-playbook.py` because these are PRODUCT
 * decisions, not corrections to the transcription: the generator's job is to
 * reproduce the .blend faithfully, and quietly editing its output would make the
 * `--check` mode lie. A transform that belongs upstream should move upstream.
 */
export const CLIP_PATCH: Record<string, (clip: StateClip) => StateClip> = {
  confused: withSpiralEyes,
}

/** The states that end by themselves. Everything else sustains. */
export const ONE_SHOT = new Set(['boot', 'travel_point', 'travel_far'])

/**
 * The symbol spin rate for a state, in degrees per second, or 0.
 *
 * Both spins used to be broken in different ways and for the same underlying
 * reason: nothing drove them from time.
 *
 * `loading`'s spinner never turned at all — the clip carries `spin: true` and
 * the atlas carries `spinner_deg_per_s`, and no code read either, so the two
 * arcs in his eyes sat still while he "loaded". `alert_dizzy`'s spirals were
 * keyed as a linear `sym_spin` ramp instead, which worked exactly once: it
 * cannot survive a loop, because wrapping the clip clock rewinds the angle by
 * 157 degrees every 1046 ms.
 *
 * Driving both off UNWRAPPED state time from the atlas rates fixes both. The
 * authored dizzy ramp is 400.5 degrees over 2670 ms = 150 deg/s, which is
 * `spin_deg_per_s` to the digit — so this is the authored rate, recovered, not a
 * new one.
 */
export function spinRateFor(clip: StateClip, doc: PlaybookDoc): number {
  const a = doc.symbol_atlas
  if (clip.symbol === 'spinner') return a.spinner_deg_per_s
  if (clip.symbol === 'dizzy') return a.spin_deg_per_s
  return 0
}

/** Compile the synthesized clips alongside the authored ones. */
export function synthesizedStates(): Record<string, StateClip> {
  return { [IDLE]: IDLE_STATE }
}

/** Every channel the state moves, sampled at one instant. Unlike a beat, this is
 *  COMPLETE: a channel the authored beat omitted comes back with the value the
 *  curve actually has there. */
function sampleAt(src: CompiledState, t: number): Pose {
  const out: Pose = {}
  for (const [ch, curve] of src.curves) out[ch] = evalCurve(curve, t)
  return out
}

/** The interpolation mode governing the segment that CONTAINS `t` — i.e. the
 *  ease of the last beat at or before it. A window that opens inside a stepped
 *  hold has to keep stepping. */
function easeAt(clip: StateClip, t: number): Beat['ease'] {
  let e: Beat['ease'] = 'ease'
  for (const b of clip.beats) {
    if (b.t_ms > t) break
    e = b.ease
  }
  return e
}

/**
 * The sustain window, as a clip in its own right. See the note on `SustainSpec`.
 *
 * Returns null for a HOLD (`toMs === fromMs`): a constant has no seam, and the
 * existing hold path already evaluates the authored clip at one frozen instant,
 * which is both cheaper and exactly equivalent.
 */
export function windowClip(src: CompiledState, spec: SustainSpec): StateClip | null {
  const { fromMs, toMs } = spec
  const dur = toMs - fromMs
  if (dur <= 0) return null

  const head: Beat = {
    t_ms: 0,
    ease: easeAt(src.clip, fromMs),
    pose: sampleAt(src, fromMs),
  }
  const inner: Beat[] = src.clip.beats
    .filter((b) => b.t_ms > fromMs && b.t_ms < toMs)
    .map((b) => ({ ...b, t_ms: b.t_ms - fromMs, pose: { ...b.pose } }))
  // The tail is the head. Not "the pose at toMs, which should be close" — the
  // head itself, so a window can never drift and the test that checks it is
  // checking a construction rather than a coincidence.
  const tail: Beat = { t_ms: dur, ease: easeAt(src.clip, toMs), pose: { ...head.pose } }

  // Everything else about the state carries over verbatim: the symbol (which is
  // what `spinRateFor` keys off), the modulation, the gaze lock, the per-channel
  // linear overrides. Only the timeline is new.
  const out: StateClip = {
    ...src.clip,
    duration_ms: dur,
    beats: [head, ...inner, tail],
    loop: true,
    cyclic: true,
  }
  // `flight_spans_ms` are offsets into the AUTHORED timeline and mean nothing
  // rebased. A stale copy would be read as a flight span that is not there.
  delete out.flight_spans_ms
  return out
}
