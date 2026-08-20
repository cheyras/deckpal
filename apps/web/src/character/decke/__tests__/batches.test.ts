/**
 * The stash run: batching, and the arithmetic that decides when a card is in.
 *
 * These are assertions about SCHEDULE, not about pixels, for the same reason the
 * rest of `cards.test.ts` is: the two defects this code has actually produced
 * were both off-by-a-frame and both invisible in a still. The batch boundary one
 * shipped as "the top of the stack skips a card", which reads as a texture bug
 * and is a comparison operator.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BATCH_MAX,
  MAX_BATCHES,
  MAX_RUN,
  MAX_STASH,
  STASH,
  batchSchedule,
  closeProgress,
  sizeForCount,
  splitBatches,
  stashLayout,
} from '../cards'

// ---------------------------------------------------------------- splitting

test('a run that fits on screen is one batch', () => {
  for (let n = 1; n <= BATCH_MAX; n++) {
    const b = splitBatches(new Array(n).fill(0))
    assert.equal(b.length, 1, `${n} cards should be one batch`)
    assert.equal(b[0].length, n)
  }
})

test('batches fill up before a new one starts, and nothing is lost or duplicated', () => {
  for (const n of [13, 17, 24, 25, 37, MAX_RUN]) {
    const items = Array.from({ length: n }, (_, i) => i)
    const batches = splitBatches(items)
    // FULL, NOT BALANCED. Thirteen is 12 + 1, never 7 + 6: the count is
    // information about what the user did, and two half-hearted fans lose it.
    for (const b of batches.slice(0, -1)) assert.equal(b.length, BATCH_MAX)
    assert.deepEqual(batches.flat(), items, `${n} cards must survive the split in order`)
  }
})

test('a run longer than the cap is truncated, and the cap is honest', () => {
  const batches = splitBatches(new Array(500).fill(0))
  assert.equal(batches.length, MAX_BATCHES)
  assert.equal(batches.flat().length, MAX_RUN)
})

test('an empty run does not produce an empty batch', () => {
  // `enter` substitutes a single null rather than calling this with [], but a
  // zero-length batch would divide by zero in the file-in stagger, so the
  // function must not be able to emit one whatever it is handed.
  for (const b of splitBatches([])) assert.ok(b.length > 0)
  for (const b of splitBatches([1, 2, 3])) assert.ok(b.length > 0)
})

// ---------------------------------------------------------------- the clock

/** When card `i` of a batch of `n` is fully inside him, in batch-local ms. The
 *  same expression `apply` uses: `d` reaches 1 at `diveAt + diveMs`. */
function fullyInAt(closeAt: number, i: number, n: number): number {
  const diveAt = STASH.gatherMs + (n > 1 ? (i / (n - 1)) * STASH.fileSpanMs : 0)
  return closeAt + diveAt + STASH.diveMs
}

test('every card of an intermediate batch is in before the next batch starts', () => {
  // THE REGRESSION THIS FILE EXISTS FOR. `endMs` used to equal the last card's
  // dive exactly, and the batch advance runs first, so the last card of every
  // intermediate batch was swapped away one frame before it landed — and the
  // deck's top face skipped it. A frame is 16.7 ms; the margin has to beat it.
  for (let n = 1; n <= BATCH_MAX; n++) {
    const s = batchSchedule(n, { first: false, last: false })
    assert.notEqual(s.closeAt, null)
    const lastIn = fullyInAt(s.closeAt!, n - 1, n)
    assert.ok(
      s.endMs - lastIn >= 1000 / 30,
      `n=${n}: batch ends ${s.endMs - lastIn} ms after the last card lands — under one frame at 30 fps`,
    )
  }
})

test('the last batch hangs; it does not close itself', () => {
  for (let n = 1; n <= BATCH_MAX; n++) {
    assert.equal(batchSchedule(n, { first: true, last: true }).closeAt, null)
    assert.equal(batchSchedule(n, { first: false, last: true }).closeAt, null)
  }
})

test('only the first batch waits for the lid', () => {
  const first = batchSchedule(5, { first: true, last: false })
  const later = batchSchedule(5, { first: false, last: false })
  assert.equal(first.launch[0].outMs, STASH.gapeMs)
  assert.equal(later.launch[0].outMs, 0)
  // The gape is the ONLY difference: a later batch is the same animation
  // starting sooner, not a different one.
  assert.equal(first.endMs - later.endMs, STASH.gapeMs)
})

test('the launch cadence is unchanged where it was reviewed, and capped past it', () => {
  // Up to seven cards the authored 130 ms gap is exact — every earlier review
  // was done at five, and a "tightening" that also retimed those would be a
  // silent regression of work that was signed off.
  for (let n = 1; n <= 7; n++) {
    const s = batchSchedule(n, { first: true, last: true })
    for (let i = 1; i < n; i++) {
      assert.equal(
        Math.round(s.launch[i].outMs - s.launch[i - 1].outMs),
        STASH.staggerMs,
        `n=${n}, card ${i}`,
      )
    }
  }
  // And past it the whole launch is bounded, however many there are.
  for (let n = 8; n <= BATCH_MAX; n++) {
    const s = batchSchedule(n, { first: false, last: true })
    const span = s.launch[n - 1].outMs - s.launch[0].outMs
    assert.ok(span <= STASH.launchSpanMaxMs + 1e-9, `n=${n}: launch span ${span} ms`)
  }
})

test('a launch is monotonic and each card rises before it travels', () => {
  for (let n = 1; n <= BATCH_MAX; n++) {
    const s = batchSchedule(n, { first: n === 1, last: false })
    for (let i = 0; i < n; i++) {
      const l = s.launch[i]
      assert.ok(l.outMs < l.crestMs && l.crestMs < l.arriveMs, `n=${n} card ${i}`)
      if (i) assert.ok(l.outMs >= s.launch[i - 1].outMs)
    }
    // Nothing may still be arriving once the gather has begun, or a card would
    // be flying outward and inward at the same time.
    assert.ok(s.closeAt! > s.launch[n - 1].arriveMs, `n=${n}`)
  }
})

test('a whole run is a sane length', () => {
  // Not a taste assertion: the cap exists so that "I imported my collection"
  // cannot take the character out of service for minutes. If a constant is
  // retuned upward, this is what says so.
  let total = 0
  const groups = splitBatches(new Array(MAX_RUN).fill(0))
  groups.forEach((g, i) => {
    total += batchSchedule(g.length, { first: i === 0, last: i === groups.length - 1 }).endMs
  })
  assert.ok(total < 30_000, `a full run is ${Math.round(total)} ms`)
  assert.ok(total > 5_000, `a full run is only ${Math.round(total)} ms — did a batch stop hanging?`)
})

// ------------------------------------------------------- the fan, per batch

test('a batch can never be bigger than the fan the layout can hold', () => {
  // `cards.test.ts` proves the fan cannot interpenetrate for every n up to
  // `MAX_STASH`. That proof is what makes batching safe — and it only covers
  // batching because `BATCH_MAX` IS `MAX_STASH`. Someone raising the batch size
  // for pace would silently walk the layout past the range anything has checked,
  // so the coupling is asserted rather than assumed.
  assert.equal(BATCH_MAX, MAX_STASH)
  assert.equal(splitBatches(new Array(MAX_STASH + 1).fill(0))[0].length, MAX_STASH)
  // And every batch is a size `stashLayout` will actually fill.
  for (const b of splitBatches(new Array(MAX_RUN).fill(0))) {
    assert.equal(stashLayout(b.length).length, b.length)
    assert.ok(sizeForCount(b.length) > 0)
  }
})

// ------------------------------------------------- giving the cards up

test('a hanging batch is not closing', () => {
  // The last batch has no `closeAt` and the state is not outroing: nothing is
  // being put away, so there is no progress to report.
  assert.equal(closeProgress(0, null, null), null)
  assert.equal(closeProgress(99_999, null, null), null)
  // And an intermediate batch before its own close time.
  assert.equal(closeProgress(0, 2880, null), null)
  assert.equal(closeProgress(2879, 2880, null), null)
})

test('an intermediate batch closes on its own clock', () => {
  assert.equal(closeProgress(2880, 2880, null), 0)
  assert.equal(closeProgress(3000, 2880, null), 120)
})

test('the state outro closes the last batch, exactly as it always did', () => {
  // This is the animation that was reviewed and signed off: `closeAt` is null,
  // and the close time IS the outro's own clock. Any change here changes a
  // shipped animation.
  for (const t of [0, 1, 100, 380, 820]) assert.equal(closeProgress(1234, null, t), t)
})

test('the state outro closes an intermediate batch that was still hanging', () => {
  // THE REGRESSION. `tb` freezes at the outro, so a batch that had not reached
  // its own `closeAt` used to report `null` forever — twelve cards hung
  // motionless while the lid came down on them, then vanished at the state
  // change. It must start closing, and start from zero.
  const tbFrozen = 2100 // mid-hang: below `closeAt`
  assert.equal(closeProgress(tbFrozen, 2880, 0), 0)
  assert.equal(closeProgress(tbFrozen, 2880, 500), 500)
})

test('a batch interrupted mid-gather continues rather than restarting', () => {
  // It was 220 ms into its own gather when the outro began, and `tb` is frozen
  // there. The close must pick up from 220 — not jump back to 0, which would
  // send every card back out to its station for a second time.
  const tbFrozen = 3100
  const closeAt = 2880
  assert.equal(closeProgress(tbFrozen, closeAt, 0), 220)
  assert.equal(closeProgress(tbFrozen, closeAt, 60), 280)
})

test('the close only ever moves forward', () => {
  // The property that actually matters, over every shape at once: whatever the
  // batch and whenever the interrupt lands, the number this returns never goes
  // down. A gather that goes backwards is cards flying outward again.
  for (const closeAt of [null, 0, 900, 2880]) {
    for (const interruptAt of [0, 500, 2000, 2880, 3100, 5000]) {
      let prev = -Infinity
      let started = false
      for (let t = 0; t <= 6000; t += 16) {
        // Before the interrupt the batch clock runs; after it, it is frozen and
        // the outro clock runs instead — which is exactly what `apply` does.
        const outroT = t >= interruptAt ? t - interruptAt : null
        const tb = t >= interruptAt ? interruptAt : t
        const v = closeProgress(tb, closeAt, outroT)
        if (v === null) {
          assert.ok(!started, `closeAt=${closeAt} interrupt=${interruptAt} t=${t}: un-closed after closing`)
          continue
        }
        started = true
        assert.ok(
          v >= prev - 1e-9,
          `closeAt=${closeAt} interrupt=${interruptAt} t=${t}: went backwards ${prev} -> ${v}`,
        )
        prev = v
      }
    }
  }
})
