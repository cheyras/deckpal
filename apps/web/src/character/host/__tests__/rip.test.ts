/**
 * The dedup rule for a booster rip, which is the part that is easy to get
 * backwards and expensive to notice.
 *
 * The naive rule — "same id within N seconds is the same card" — is inverted:
 * at the scanner's cadence a card held steady re-stabilises about every 1.4 s,
 * so holding one card for four seconds logs it three times. A card is new
 * because it LEFT and something came back, not because it matched again.
 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { chooseVariant, COMMIT_FRAMES, LEAVE_FRAMES, emptyRip, onFrame, removeEntry, setQuantity, setVariants, TRUST_DISTANCE, type RipState, type ScanHit } from '../ripSession'

const hit = (cardId: string, distance = 3): ScanHit => ({ cardId, name: cardId, distance })

/** Feed frames in, return the final state. */
function feed(state: RipState, frames: (ScanHit | null)[]): RipState {
  let s = state
  frames.forEach((f, i) => { s = onFrame(s, f, i).state })
  return s
}

test('a card must survive COMMIT_FRAMES before it is logged', () => {
  let s = emptyRip()
  for (let i = 0; i < COMMIT_FRAMES - 1; i++) s = onFrame(s, hit('a'), i).state
  assert.equal(s.entries.length, 0, 'not yet')
  s = onFrame(s, hit('a'), 9).state
  assert.equal(s.entries.length, 1)
})

test('HOLDING one card does not log it repeatedly', () => {
  // The bug this file exists for: 30 frames of the same card is one pull.
  const s = feed(emptyRip(), Array(30).fill(hit('a')))
  assert.equal(s.entries.length, 1)
  assert.equal(s.entries[0].quantity, 1)
})

test('it counts again only after the card has LEFT the frame', () => {
  const held = Array(10).fill(hit('a'))
  const gone = Array(3).fill(null)
  const s = feed(emptyRip(), [...held, ...gone, ...held])
  // A second EVENT, recorded as a quantity on the one row for that card rather
  // than a second row — see the header note on why a duplicate cardId is a
  // corruption rather than a representation choice.
  assert.equal(s.entries.length, 1, 'still one row for the card')
  assert.equal(s.entries[0]!.quantity, 2, 'departure then return is a second event')
})

test('a card glimpsed for one frame is not a pull', () => {
  // A hand moving through the frame, then the real card.
  const s = feed(emptyRip(), [hit('x'), hit('y'), ...Array(6).fill(hit('a'))])
  assert.deepEqual(s.entries.map((e) => e.cardId), ['a'])
})

test('an untrusted distance is treated as nothing in frame', () => {
  const s = feed(emptyRip(), Array(10).fill(hit('a', TRUST_DISTANCE + 1)))
  assert.equal(s.entries.length, 0)
})

test('a single wobbly frame does NOT count as the card leaving', () => {
  // Cards wobble: a hand shifts, a reflection catches the lens, one frame comes
  // back over threshold. Treating that as a departure re-logs the card the
  // moment it steadies, which is the double-count this file exists to prevent
  // arriving by another route.
  const s = feed(emptyRip(), [...Array(5).fill(hit('a')), hit('a', 40), ...Array(5).fill(hit('a'))])
  assert.equal(s.entries.length, 1)
})

test('but a real departure still counts', () => {
  // Two consecutive empty frames is longer than a wobble and shorter than the
  // gap between pulling two cards.
  const s = feed(emptyRip(), [...Array(5).fill(hit('a')), null, null, ...Array(5).fill(hit('a'))])
  assert.equal(s.entries.length, 1)
  assert.equal(s.entries[0]!.quantity, 2)
})

test('two different cards in sequence are two entries', () => {
  const s = feed(emptyRip(), [...Array(5).fill(hit('a')), ...Array(5).fill(hit('b'))])
  assert.deepEqual(s.entries.map((e) => e.cardId), ['a', 'b'])
})

test('quantity is a user action and never inferred', () => {
  let s = feed(emptyRip(), Array(6).fill(hit('a')))
  assert.equal(s.entries[0].quantity, 1)
  s = setQuantity(s, 'a', 3)
  assert.equal(s.entries[0].quantity, 3)
  s = setQuantity(s, 'a', 0)
  assert.equal(s.entries.length, 0, 'zero removes it')
})

test('removing a mis-read lets it be rescanned immediately', () => {
  let s = feed(emptyRip(), Array(6).fill(hit('a')))
  s = removeEntry(s, 'a')
  assert.equal(s.entries.length, 0)
  // Without clearing refractory, the card would be invisible until it left the
  // frame — so a correction would look like the scanner ignoring you.
  s = feed(s, Array(6).fill(hit('a')))
  assert.equal(s.entries.length, 1)
})

// ── which printing ───────────────────────────────────────────────────────────
// The scanner matches ARTWORK, and a card and its reverse holo share artwork, so
// the printing can never be inferred from a hash. Every pack contains reverse
// holos, which makes this the difference between a correct haul and a haul that
// is silently wrong on a predictable fraction of its rows.

const VARIANTS = [
  { variantId: 10, displayName: 'Normal', isPrimary: true },
  { variantId: 11, displayName: 'Reverse Holofoil', isPrimary: false },
]

/** Feed one card through to a commit. */
function committed(cardId = 'a'): RipState {
  let s = emptyRip()
  for (let i = 0; i < COMMIT_FRAMES; i++) s = onFrame(s, hit(cardId), i).state
  return s
}

test('a newly committed card has no printing chosen yet', () => {
  const s = committed()
  assert.equal(s.entries[0]!.variantId, null)
  assert.deepEqual(s.entries[0]!.variants, [])
})

test('the catalog answer defaults the selection to the primary printing', () => {
  const s = setVariants(committed(), 'a', VARIANTS)
  assert.equal(s.entries[0]!.variantId, 10, 'matches what the Have toggle does in SQL')
  assert.equal(s.entries[0]!.variants.length, 2)
})

test('a reader choice survives a later catalog answer', () => {
  let s = setVariants(committed(), 'a', VARIANTS)
  s = chooseVariant(s, 'a', 11)
  s = setVariants(s, 'a', VARIANTS) // a second, late response
  assert.equal(s.entries[0]!.variantId, 11, 'must not be reset to primary')
})

test('choosing a printing touches only that row', () => {
  let s = committed('a')
  for (let i = 0; i < COMMIT_FRAMES; i++) s = onFrame(s, null, 100 + i).state
  for (let i = 0; i < COMMIT_FRAMES; i++) s = onFrame(s, hit('b'), 200 + i).state
  s = setVariants(s, 'a', VARIANTS)
  s = setVariants(s, 'b', VARIANTS)
  s = chooseVariant(s, 'b', 11)
  assert.equal(s.entries.find((e) => e.cardId === 'a')!.variantId, 10)
  assert.equal(s.entries.find((e) => e.cardId === 'b')!.variantId, 11)
})

test('a catalog answer for a removed card is ignored', () => {
  let s = removeEntry(committed(), 'a')
  s = setVariants(s, 'a', VARIANTS)
  assert.equal(s.entries.length, 0)
})

test('re-showing a card bumps its quantity instead of adding a second row', () => {
  let s = emptyRip()
  let t = 0
  for (let i = 0; i < COMMIT_FRAMES; i++) s = onFrame(s, hit('a'), t++).state
  assert.equal(s.entries.length, 1)

  // It leaves the frame, which releases the refractory hold...
  for (let i = 0; i < LEAVE_FRAMES + 1; i++) s = onFrame(s, null, t++).state
  assert.equal(s.refractory.size, 0)

  // ...and is shown again. That is a second event and it counts — but on the
  // row that already exists, because every consumer addresses a row by cardId.
  let last
  for (let i = 0; i < COMMIT_FRAMES; i++) { last = onFrame(s, hit('a'), t++); s = last.state }
  assert.equal(s.entries.length, 1, 'one row per card, always')
  assert.equal(s.entries[0]!.quantity, 2, 'the return counted')
  assert.equal(last!.committed?.quantity, 2, 'and the UI is told what changed')
})

test('no two rows may ever share a cardId', () => {
  // The invariant the whole design rests on: React keys off cardId, and
  // setQuantity/removeEntry match on it.
  let s = emptyRip()
  let t = 0
  for (let round = 0; round < 4; round++) {
    for (let i = 0; i < COMMIT_FRAMES; i++) s = onFrame(s, hit('a'), t++).state
    for (let i = 0; i < LEAVE_FRAMES + 1; i++) s = onFrame(s, null, t++).state
  }
  const ids = s.entries.map((e) => e.cardId)
  assert.deepEqual(ids, [...new Set(ids)], 'no duplicate cardIds')
  assert.equal(s.entries[0]!.quantity, 4)
})

test('editing a re-shown card touches exactly one row', () => {
  let s = emptyRip()
  let t = 0
  for (let i = 0; i < COMMIT_FRAMES; i++) s = onFrame(s, hit('a'), t++).state
  for (let i = 0; i < LEAVE_FRAMES + 1; i++) s = onFrame(s, null, t++).state
  for (let i = 0; i < COMMIT_FRAMES; i++) s = onFrame(s, hit('a'), t++).state
  assert.equal(removeEntry(s, 'a').entries.length, 0, 'removing takes the one row')
  assert.equal(setQuantity(s, 'a', 7).entries[0]!.quantity, 7)
  assert.equal(setQuantity(s, 'a', 7).entries.length, 1)
})

test('a removed card can be rescanned immediately', () => {
  let s = emptyRip()
  let t = 0
  for (let i = 0; i < COMMIT_FRAMES; i++) s = onFrame(s, hit('a'), t++).state
  s = removeEntry(s, 'a')
  assert.equal(s.entries.length, 0)
  // No departure needed: `removeEntry` drops the refractory hold too.
  for (let i = 0; i < COMMIT_FRAMES; i++) s = onFrame(s, hit('a'), t++).state
  assert.equal(s.entries.length, 1, 'a corrected mis-read is scannable again')
})
