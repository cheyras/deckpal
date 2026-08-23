/**
 * C21 asked for a beat that breaks up the thinking loop. The interesting half
 * of this module is everything it REFUSES to beat on, so that is what most of
 * these test — a rule that only ever says yes is not a rule.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BEAT_COOLDOWN_MS, beatForChip, type BeatContext } from '../thinkingBeat'

const fresh = (over: Partial<BeatContext> = {}): BeatContext => ({
  lastBeatAt: null,
  now: 100_000,
  reduced: false,
  ...over,
})

test('a call that finished is a beat — the "something changed" moment', () => {
  const beat = beatForChip({ phase: 'ok' }, fresh())
  assert.deepEqual(beat, { state: 'nod_yes', mode: 'once' })
})

test('a progress note landing is a beat — his "little responses in between"', () => {
  assert.ok(beatForChip({ phase: 'progress', noteIsNew: true }, fresh()))
})

test('a progress chip with NO new note is not a beat', () => {
  // Progress chips update in place; re-rendering the same note is not an event.
  assert.equal(beatForChip({ phase: 'progress' }, fresh()), null)
  assert.equal(beatForChip({ phase: 'progress', noteIsNew: false }, fresh()), null)
})

test('a call STARTING is not a beat — that is the beginning of a wait', () => {
  assert.equal(beatForChip({ phase: 'start' }, fresh()), null)
})

test('a FAILURE gets no beat, and that is the evidence-backed call', () => {
  // Crolic et al. 2022: anthropomorphic warmth aimed at someone whose thing
  // just broke lowers satisfaction, with no offsetting gain on anyone else. The
  // failure row is already loud and auto-expanded by design (D2); a character
  // flourish beside it competes with the one row that must be read.
  assert.equal(beatForChip({ phase: 'error' }, fresh()), null)
})

test('a PARTIAL gets no beat either — it is a disappointment being reported', () => {
  // A journey that stopped half way, or a deep call that timed out.
  assert.equal(beatForChip({ phase: 'partial' }, fresh()), null)
})

test('reduced motion gets nothing, because here the row is the signal', () => {
  // The opposite call from the thinking counter, which keeps ticking under
  // reduce because there the NUMBER is the signal. Per-element, not blanket.
  assert.equal(beatForChip({ phase: 'ok' }, fresh({ reduced: true })), null)
  assert.equal(
    beatForChip({ phase: 'progress', noteIsNew: true }, fresh({ reduced: true })),
    null,
  )
})

test('a burst of fast calls does not strobe', () => {
  const now = 100_000
  assert.ok(beatForChip({ phase: 'ok' }, fresh({ lastBeatAt: null, now })))
  // Six catalogue reads returning inside a second: one beat, not six.
  for (const dt of [50, 120, 400, 900, BEAT_COOLDOWN_MS - 1]) {
    assert.equal(
      beatForChip({ phase: 'ok' }, fresh({ lastBeatAt: now, now: now + dt })),
      null,
      `a chip ${dt}ms after the last beat should be swallowed`,
    )
  }
})

test('a long turn still gets its beats once the cooldown has passed', () => {
  const now = 100_000
  assert.ok(beatForChip({ phase: 'ok' }, fresh({ lastBeatAt: now, now: now + BEAT_COOLDOWN_MS })))
  assert.ok(
    beatForChip({ phase: 'ok' }, fresh({ lastBeatAt: now, now: now + BEAT_COOLDOWN_MS * 3 })),
  )
})

test('the beat is `once`, never sustained', () => {
  // States sustain indefinitely by design ("he should never snap to being
  // done"), which is right for a mood and wrong for punctuation. A sustained
  // beat leaves him holding a nod, which is not a nod.
  const beat = beatForChip({ phase: 'ok' }, fresh())
  assert.equal(beat?.mode, 'once')
})

test('the thinking beat is a DIFFERENT gesture from the answer-arriving beat', () => {
  // `useDeckeChat` fires `curious` once, on the first token, to mark the moment
  // the waiting ended (OR3). If these two ever became the same state, the two
  // moments would blur into one gesture and C21's "break it up" would be lost.
  assert.notEqual(beatForChip({ phase: 'ok' }, fresh())?.state, 'curious')
})

test('a DECLINED call earns no beat — he does not nod at being cancelled', () => {
  // `deny` now emits `phase: 'declined'` rather than `ok`. If the allow-list
  // ever became a deny-list, this would silently start firing: he would nod
  // enthusiastically at the moment someone cancelled his work, which is the
  // same failure as the check mark the declined row replaced.
  assert.equal(
    beatForChip({ phase: 'declined' }, { lastBeatAt: null, now: 0, reduced: false }),
    null,
  )
})
