/**
 * Breaking up the rocking loop, when something actually happened.
 *
 * ── WHAT WAS ASKED FOR ───────────────────────────────────────────────────────
 *
 * C21, from the recording at [07:43]: *"just to kind of break up this animation
 * … because he's just kind of stuck in this one thing, and so when he does
 * little responses in between, he can kind of show a different emotion for a
 * sec and then go back to thinking … make him feel less like he's just stuck
 * and not doing anything."* And at [09:38], watching the same turn: *"he's
 * still just thinking, still just playing the same, rocking back and forth."*
 *
 * The brief filed this as blocked on C20 — there was no tool-boundary hook to
 * hang a beat on. C20 shipped: every tool call now puts a real row on the
 * transcript, sourced from a real invocation, and long calls carry server-
 * composed progress notes. **So the hook exists, and this is the orchestration
 * the brief said was missing.**
 *
 * ── WHY IT IS A PURE FUNCTION AND NOT THREE LINES IN THE STREAM HANDLER ──────
 *
 * Because every rule below is a judgement that deserves to be argued with, and
 * a judgement buried in a callback cannot be tested, cannot be read, and gets
 * quietly reversed by the next person who is adjusting something nearby.
 *
 * ── THE RULES, AND WHY EACH ONE ─────────────────────────────────────────────
 *
 * **1. Only on something that really happened.** X2, the truthfulness contract:
 * every status surface is sourced from a real invocation's real result, never
 * from model prose. A beat is a status surface — it tells the reader "something
 * moved" — so it is driven by a completed call or a genuinely new progress
 * note, and by nothing else. A beat the model could ask for would be a second
 * surface to fabricate on.
 *
 * **2. No beat when it failed.** Crolic et al., *Journal of Marketing* 86(1),
 * 2022 — five studies plus telecom field data: anthropomorphic warmth aimed at
 * someone whose thing just broke measurably LOWERS satisfaction, via capability
 * expectations the failure then violates. There is no effect on people who are
 * not annoyed, so the beat buys nothing on the upside and costs on the down.
 * The failure row is already loud, ruled and auto-expanded on purpose (D2, the
 * failure that once fooled the owner into reading a timeout as "a great
 * response") — putting a character flourish beside it competes with the one row
 * that has to be read. **When something breaks, he goes plain.**
 *
 * **3. Rate-limited, because the point is contrast.** The prompt's own doctrine
 * for `express`: *"An expression on every turn is noise; an expression that
 * means something is the whole point."* Anderson et al., CHI 2015 (fMRI)
 * measured a dramatic drop in visual-processing response *after the second
 * exposure*, and Burke et al., ACM TOCHI 12(4), 2005 found animated page
 * elements raise workload and hinder visual search **even when successfully
 * ignored**. A turn that calls six tools must not strobe.
 *
 * **4. `once`, never sustained.** States sustain indefinitely by deliberate
 * design (`sustain.ts`: *"he should never snap to being done"*). That is right
 * for a mood and wrong for punctuation. A sustained beat would leave him
 * holding a nod, which is not a nod.
 *
 * **5. Nothing under reduced motion.** X1. Here the beat is genuinely
 * decoration: the row itself is the signal, and it lands either way. This is
 * the opposite call from the thinking counter, which keeps ticking under reduce
 * because there the number IS the signal — same principle, different answer,
 * which is why the strategy is per-element rather than a blanket rule.
 */

/** What a chip looks like to this decision. Deliberately not the whole `ToolChip`. */
export type BeatInput = {
  /**
   * `declined` is listed and deliberately earns no beat.
   *
   * The allow-list below IS the rule — a phase that is not on it produces
   * nothing — so widening this type is all that is needed, and that is the
   * point: a nod on a refusal would have him agreeing enthusiastically with
   * somebody cancelling his work. `partial` and `error` are silent for the same
   * reason (Crolic et al. 2022: warmth on a bad outcome reads worse than
   * neutrality), and a decline is the reader's decision rather than a failure,
   * so it gets the quietest treatment of all: none.
   */
  phase: 'start' | 'progress' | 'ok' | 'partial' | 'error' | 'declined'
  /** True only when a `progress` chip carries a note it did not carry before. */
  noteIsNew?: boolean
}

export type BeatContext = {
  /** When the last beat fired, or null if none has this turn. */
  lastBeatAt: number | null
  now: number
  /** `prefers-reduced-motion`. */
  reduced: boolean
}

export type Beat = { state: string; mode: 'once' }

/**
 * How long he must go without a beat before another one means anything.
 *
 * Four seconds is chosen against the thing being punctuated rather than picked
 * round: the owner sat through an 86-second silent turn, so a long turn should
 * get a handful of beats and not thirty. It is also comfortably longer than a
 * burst of fast catalogue reads, which is the case that would otherwise strobe.
 */
export const BEAT_COOLDOWN_MS = 4000

/**
 * The beat for a chip, or null for no beat.
 *
 * Two events qualify, and they are the two the owner described:
 *
 *   - a call FINISHED (`ok`) — the "something changed" moment;
 *   - a progress note LANDED (`progress` with a new note) — literally his
 *     "little responses in between".
 *
 * `nod_yes` for both, and the choice is deliberate. It is the one state
 * documented as punctuation rather than mood — *"a single acknowledging nod …
 * sustained, it is not a nod, it is nodding forever"* — so it reads as "got
 * that, carrying on" without claiming a feeling about a result nobody has read
 * yet. `happy` would celebrate results that are sometimes bad news, which is
 * the failure mode this pass spent most of its time removing. It is also
 * distinct from the `curious` beat that marks the answer ARRIVING
 * (`useDeckeChat.ts`), so the two moments do not blur into one gesture.
 */
export function beatForChip(chip: BeatInput, ctx: BeatContext): Beat | null {
  if (ctx.reduced) return null

  // ── THE WHOLE OF RULE 1 AND RULE 2, IN ONE LINE ─────────────────────────
  //
  // An earlier draft of this had a separate `if (error || partial) return null`
  // guard above, carrying rule 2's reasoning. **It was unreachable** — neither
  // phase is `ok` or `progress`, so this line already refused them — and it was
  // caught only by mutating the code and noticing the failure test did NOT go
  // red. A guard that cannot fail is worse than no guard: it reads as the thing
  // enforcing a decision while the decision is actually being made somewhere
  // else, so the next person edits the wrong line.
  //
  // So the allow-list IS the rule. `start` is the beginning of a wait, not an
  // event. `error` and `partial` are refused because a beat there measurably
  // costs (Crolic 2022) and competes with the loud failure row that has to be
  // read (D2). **Anything added to this line is a decision to punctuate that
  // phase — read the block at the top of this file before adding one.**
  const happened =
    chip.phase === 'ok' || (chip.phase === 'progress' && chip.noteIsNew === true)
  if (!happened) return null

  if (ctx.lastBeatAt !== null && ctx.now - ctx.lastBeatAt < BEAT_COOLDOWN_MS) return null

  return { state: 'nod_yes', mode: 'once' }
}
