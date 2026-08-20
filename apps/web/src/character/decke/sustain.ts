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
import type { Beat, PlaybookDoc, StateClip } from './playbook'

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

  // Beats 420 / 980 of the authored clip, PLUS the 310 ms spiral prologue that
  // `withSpiralEyes` inserts ahead of them. The stepped head-shake itself is
  // what "the back and forth animation just continues to loop" asks for; stepped
  // beats make the wrap a step too, which is the clip's own language rather than
  // a pop.
  confused: { fromMs: 420 + 310, toMs: 980 + 310 },

  // Beats 330 / 470 — two steps of the jaw chatter, and the only pair of the
  // five that wraps cleanly. The obvious window (240 -> 540) spans the whole
  // burst and looks tidier in the table, but its ends are `mouth` 0.34 against
  // 0.26: an 0.08 jolt of jaw, once every 300 ms, forever. The test catches it.
  // Looping the shorter pair leaves him gnashing at a steady 7 Hz, which is what
  // "he should stay like that" means for this one.
  frustrated: { fromMs: 330, toMs: 470 },

  // Beats 200 / 330, the flinch-away flutter.
  embarrassed: { fromMs: 200, toMs: 330 },

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

  // Beats 400 / 1900, the full 115-degree gape held open. The outro (1900 ->
  // 2800) is the cards filing back in and the lid closing — the reviewer
  // described exactly this: "once told to stop, that's when they all file in and
  // it animates into him and then he closes."
  card_stash: { fromMs: 400, toMs: 1900, outroTail: true },

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

/** The beats of a sustain window, for the test to compare. */
export function windowBeats(clip: StateClip, spec: SustainSpec): [Beat, Beat] | null {
  const at = (t: number) => clip.beats.find((b) => b.t_ms === t)
  const a = at(spec.fromMs)
  const b = at(spec.toMs)
  return a && b ? [a, b] : null
}
