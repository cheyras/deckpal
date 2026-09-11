// The harvest's ordering rules.
//
// These are pinned because every one of them is a DECLARED order that
// alphabetical sorting would silently replace with a wrong one — `back` before
// `negative` before `positive` is the order of their spelling and no order at
// all in the sense the reader means. A comparator that quietly degrades to
// alphabetical still returns a grid, and the grid still looks fine.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ScanFlag, ScanFlagLabel } from '../../../lib/api'
import { defaultVerdicts, filterFlags, sortFlags, verdictCounts, verdictsPresent } from '../harvest'

function flag(id: number, label: Partial<ScanFlagLabel> | null = {}): ScanFlag {
  return {
    id,
    files: ['png', 'json'],
    size: 1000,
    uploadedAt: new Date(id).toISOString(),
    comment: null,
    label: label
      ? {
          verdict: 'positive',
          reason: null,
          type: 'quad-label',
          source: 'camera',
          seededFrom: 'detector',
          sweepStage: null,
          hasObj: null,
          ...label,
        }
      : null,
  }
}

const ids = (fs: ScanFlag[]) => fs.map((f) => f.id)

test('newest/oldest are the id order — the id IS the capture time', () => {
  const fs = [flag(2), flag(3), flag(1)]
  assert.deepEqual(ids(sortFlags(fs, 'newest')), [3, 2, 1])
  assert.deepEqual(ids(sortFlags(fs, 'oldest')), [1, 2, 3])
})

test('sortFlags does not mutate its input', () => {
  const fs = [flag(1), flag(3), flag(2)]
  sortFlags(fs, 'newest')
  assert.deepEqual(ids(fs), [1, 3, 2], 'the caller’s array must be untouched')
})

test('verdict order is negatives, backs, positives, unknown — not alphabetical', () => {
  const fs = [
    flag(1, { verdict: 'positive' }),
    flag(2, { verdict: 'unknown' }),
    flag(3, { verdict: 'back' }),
    flag(4, { verdict: 'negative' }),
  ]
  assert.deepEqual(
    sortFlags(fs, 'verdict').map((f) => f.label?.verdict),
    ['negative', 'back', 'positive', 'unknown'],
  )
})

test('negatives group by reason, then newest within a reason', () => {
  const fs = [
    flag(1, { verdict: 'negative', reason: 'not_a_card' }),
    flag(2, { verdict: 'negative', reason: 'no_card' }),
    flag(3, { verdict: 'negative', reason: 'not_a_card' }),
  ]
  const out = sortFlags(fs, 'verdict')
  assert.deepEqual(
    out.map((f) => f.label?.reason),
    ['no_card', 'not_a_card', 'not_a_card'],
  )
  assert.deepEqual(ids(out).slice(1), [3, 1], 'within one reason, newest first')
})

test('sweep stage sorts HARDEST first — proposed before locked', () => {
  const fs = [
    flag(1, { sweepStage: 'locked' }),
    flag(2, { sweepStage: 'proposed' }),
    flag(3, { sweepStage: 'tracked' }),
    flag(4, { sweepStage: 'gated' }),
    flag(5, { sweepStage: 'none' }),
  ]
  assert.deepEqual(
    sortFlags(fs, 'stage').map((f) => f.label?.sweepStage),
    ['proposed', 'gated', 'tracked', 'locked', 'none'],
  )
})

test('rows with no sweep block sort after every row that has one', () => {
  // Absence of a stage is not a stage: these predate the mode or were taken
  // with it off, and floating them to the top would bury the sweep captures
  // the sort exists to surface.
  const fs = [flag(1, { sweepStage: null }), flag(2, { sweepStage: 'locked' })]
  assert.deepEqual(ids(sortFlags(fs, 'stage')), [2, 1])
})

test('hasObj sorts LOW first, and rows with no reading sort last', () => {
  const fs = [flag(1, { hasObj: 0.9 }), flag(2, { hasObj: null }), flag(3, { hasObj: 0.1 })]
  assert.deepEqual(ids(sortFlags(fs, 'hasObj')), [3, 1, 2])
})

test('hasObj = 0 is a reading, not a missing one', () => {
  // The bug this pins: `if (!av)` instead of `if (av == null)` sends the most
  // interesting row in the corpus — a card the model scored zero — to the end.
  const fs = [flag(1, { hasObj: 0.5 }), flag(2, { hasObj: 0 }), flag(3, { hasObj: null })]
  assert.deepEqual(ids(sortFlags(fs, 'hasObj')), [2, 1, 3])
})

test('a row whose sidecar could not be read still sorts, as unknown', () => {
  const fs = [flag(1, null), flag(2, { verdict: 'negative' })]
  assert.deepEqual(ids(sortFlags(fs, 'verdict')), [2, 1])
  assert.equal(verdictCounts(fs).unknown, 1, 'and it is COUNTED — a row that exists is never omitted')
})

test('an empty filter selection means everything, never nothing', () => {
  const fs = [flag(1), flag(2)]
  assert.equal(filterFlags(fs, new Set()).length, 2)
})

test('the filter matches on verdict, and an unreadable row filters as unknown', () => {
  const fs = [flag(1, { verdict: 'positive' }), flag(2, { verdict: 'negative' }), flag(3, null)]
  assert.deepEqual(ids(filterFlags(fs, new Set(['negative']))), [2])
  assert.deepEqual(ids(filterFlags(fs, new Set(['unknown']))), [3])
  assert.deepEqual(ids(filterFlags(fs, new Set(['positive', 'negative']))), [1, 2])
})

test('verdictsPresent offers only what the corpus contains, in display order', () => {
  const fs = [flag(1, { verdict: 'positive' }), flag(2, { verdict: 'negative' }), flag(3, { verdict: 'positive' })]
  assert.deepEqual(verdictsPresent(fs), ['negative', 'positive'], 'no chip that would filter to nothing')
})

// ── The scanner's telemetry shares this prefix ──────────────────────────────
//
// `capture-event`, `lock-event` and `identity-event` are written into
// `dev-flags/` by the product scanner (scan/ui/flags.ts), one PNG + JSON per
// event. A real session produces hundreds: the owner's first look at the
// harvest found 224 of them, reported as "I'm not sure where these came from".
// They are legitimate records and they are not the corpus.

test('the default filter selects the LABEL verdicts and leaves events out', () => {
  const fs = [
    flag(1, { verdict: 'positive' }),
    flag(2, { verdict: 'negative' }),
    flag(3, { verdict: 'unknown', type: 'lock-event' }),
    flag(4, { verdict: 'unknown', type: 'capture-event' }),
  ]
  const def = defaultVerdicts(fs)
  assert.deepEqual([...def].sort(), ['negative', 'positive'])
  assert.deepEqual(ids(filterFlags(fs, def)), [1, 2], 'events are off by default')
})

test('the default never hides EVERYTHING — an events-only corpus still shows', () => {
  // A filter that resolves to "no matches" over a view that plainly has rows in
  // it reads as a broken screen. Empty selection means everything (filterFlags),
  // so a corpus with no labels yet shows its events rather than a blank grid.
  const fs = [flag(1, { verdict: 'unknown', type: 'lock-event' })]
  const def = defaultVerdicts(fs)
  assert.equal(def.size, 0)
  assert.deepEqual(ids(filterFlags(fs, def)), [1])
})

test('the events are still reachable, and still counted', () => {
  const fs = [flag(1, { verdict: 'positive' }), flag(2, { verdict: 'unknown', type: 'identity-event' })]
  assert.equal(verdictCounts(fs).unknown, 1, 'a row that exists is never omitted from a total')
  assert.deepEqual(ids(filterFlags(fs, new Set(['unknown']))), [2], 'one chip brings them back')
})
