// Run: node --import tsx --test src/scan/labeler/__tests__/*.test.ts
//
// THE REJECTION TAXONOMY, and the promise that makes it worth having.
//
// Owner ruling 2026-09-06: the three reasons of 2026-09-04 become a taxonomy
// designed backwards from a future REALTIME classifier — one that can say "move
// closer" or "hold steady" while the camera is still running, and can tell
// "this is a card but not framed well enough to quad" from "this is not a card".
//
// So the load-bearing invariant here is not that the union has nine members.
// It is that EVERY CLASS CARRIES THE WORDS IT WOULD SAY. A class without
// coaching copy is a class the classifier could predict and then stand mute on,
// and the copy lives in the same table the labeler renders precisely so that
// the reader labelling hundreds of frames is reviewing it as they go.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  CARD_BACK_SPEC,
  COACH_BY_VALUE,
  COACH_SPECS,
  LEGACY_REASON_MAP,
  migrateLegacyReason,
  REASON_BY_VALUE,
  REASON_SPECS,
  type CoachClass,
  type InvalidReason,
  type LegacyInvalidReason,
  type ReasonGroup,
} from '../types'

/** The union, written out by hand. If someone adds a member to
 *  `InvalidReason` without adding it here, tsc fails on the assignment below
 *  and the count assertion fails too — a new class cannot slip into the corpus
 *  without a deliberate stop here. */
const EXPECTED_REASONS: readonly InvalidReason[] = [
  'no_card',
  'not_a_card',
  'too_blurry',
  'too_far',
  'cut_off',
  'too_dark',
  'glare_washout',
  'too_oblique',
  'multiple_no_clear_foreground',
]

describe('the taxonomy is complete and closed', () => {
  it('offers every reason in the union, exactly once', () => {
    const offered = REASON_SPECS.map((r) => r.value)
    assert.deepEqual([...offered].sort(), [...EXPECTED_REASONS].sort())
    assert.equal(new Set(offered).size, offered.length, 'no duplicates in the picker')
  })

  it('answers the two questions the owner posed, and splits them', () => {
    // "Is a card present at all?" and, when one IS, "why can no quad be
    // pinned?" — different questions, different heads, different coaching.
    const byGroup = (g: ReasonGroup) => REASON_SPECS.filter((r) => r.group === g).map((r) => r.value)
    assert.deepEqual(byGroup('absent').sort(), ['no_card', 'not_a_card'])
    assert.deepEqual(byGroup('unquaddable').sort(), [
      'cut_off',
      'glare_washout',
      'multiple_no_clear_foreground',
      'too_blurry',
      'too_dark',
      'too_far',
      'too_oblique',
    ])
    assert.deepEqual(byGroup('quaddable'), [], 'a quaddable class is never a rejection')
  })

  it('covers the failure modes the ruling named, each with its own class', () => {
    // Named explicitly so a future tidy-up cannot quietly merge two of them:
    // each is a different thing to SAY, which is what makes it a different
    // class at all.
    for (const r of ['too_blurry', 'too_far', 'cut_off', 'too_dark', 'glare_washout', 'too_oblique'] as const) {
      assert.ok(REASON_BY_VALUE[r], `${r} must exist`)
      assert.equal(REASON_BY_VALUE[r].group, 'unquaddable')
    }
  })

  it('is reachable by value for every member', () => {
    for (const r of EXPECTED_REASONS) assert.equal(REASON_BY_VALUE[r].value, r)
  })
})

describe('every class carries the words it would say', () => {
  it('gives EVERY coachable class a non-empty coaching phrase', () => {
    for (const spec of COACH_SPECS) {
      assert.ok(spec.coaching.trim().length > 0, `${spec.value} has no coaching copy`)
      assert.ok(spec.label.trim().length > 0, `${spec.value} has no button label`)
    }
  })

  it('phrases the coaching as something a person could act on, and briefly', () => {
    // The subtitle sits under a button in a picker used hundreds of times. A
    // sentence that does not fit is a sentence nobody reads — here or in the
    // product.
    for (const spec of COACH_SPECS) {
      assert.ok(spec.coaching.length <= 60, `${spec.value}: "${spec.coaching}" is too long for a subtitle`)
    }
  })

  it('says the exact phrases the ruling asked for', () => {
    assert.equal(REASON_BY_VALUE.too_blurry.coaching, 'Hold steady.')
    assert.equal(REASON_BY_VALUE.too_far.coaching, 'Move closer.')
    assert.equal(REASON_BY_VALUE.too_dark.coaching, 'More light.')
    assert.match(REASON_BY_VALUE.cut_off.coaching, /frame/i)
    assert.match(REASON_BY_VALUE.glare_washout.coaching, /tilt/i)
    assert.match(REASON_BY_VALUE.too_oblique.coaching, /directly/i)
    assert.match(REASON_BY_VALUE.multiple_no_clear_foreground.coaching, /one card/i)
    assert.equal(CARD_BACK_SPEC.coaching, 'Flip the card.')
  })

  it('marks exactly ONE class as not coachable — the hard negative', () => {
    // `not_a_card` is trainer-only: the realtime answer is not advice, it is a
    // refusal to quad. Every other class has something useful to tell the
    // person holding the phone, and `no_card` included — "point at a card" is
    // real coaching for an empty frame.
    const notCoachable = COACH_SPECS.filter((s) => !s.coachable).map((s) => s.value)
    assert.deepEqual(notCoachable, ['not_a_card'])
    assert.equal(REASON_BY_VALUE.no_card.coachable, true)
  })
})

describe('not_a_card — the hard-negative class', () => {
  it('is separate from no_card, and is a presence question', () => {
    // The distinction IS the value: an empty frame teaches the presence head
    // nothing, whereas a shipping envelope is the current build's known false
    // positive. Folding them together throws that away.
    assert.notEqual(REASON_BY_VALUE.not_a_card.value, REASON_BY_VALUE.no_card.value)
    assert.equal(REASON_BY_VALUE.not_a_card.group, 'absent')
    assert.equal(REASON_BY_VALUE.no_card.group, 'absent')
  })

  it('is placed prominently — second in the picker, beside the other presence call', () => {
    assert.deepEqual(REASON_SPECS.slice(0, 2).map((r) => r.value), ['no_card', 'not_a_card'])
  })

  it('names what it is for, in the copy the reader sees', () => {
    // The reader has to recognise the class in a glance; abstract wording would
    // send envelopes into no_card, which is where they already are in v1.
    assert.match(REASON_BY_VALUE.not_a_card.coaching, /envelope|label|coaster|screen/i)
  })
})

describe('card_back — a positive, deliberately NOT a rejection reason', () => {
  it('is absent from the rejection union entirely', () => {
    // A card back has a perfectly pinnable quad. Putting it in the picker would
    // train the detector that backs are not cards, which is the opposite of
    // true, and would cost the quad the frame does have.
    assert.equal(EXPECTED_REASONS.includes('card_back' as InvalidReason), false)
    assert.equal(REASON_SPECS.some((r) => (r.value as CoachClass) === 'card_back'), false)
  })

  it('still sits in the one coaching table, so its copy is reviewed like the rest', () => {
    assert.equal(COACH_BY_VALUE.card_back, CARD_BACK_SPEC)
    assert.equal(CARD_BACK_SPEC.group, 'quaddable')
    assert.equal(CARD_BACK_SPEC.coachable, true)
  })

  it('makes the coaching table exactly the rejection reasons plus itself', () => {
    assert.equal(COACH_SPECS.length, REASON_SPECS.length + 1)
    assert.deepEqual(
      COACH_SPECS.map((s) => s.value).sort(),
      [...EXPECTED_REASONS, 'card_back'].sort(),
    )
  })
})

describe('version-1 rows stay harvestable', () => {
  const V1: readonly LegacyInvalidReason[] = ['no_card', 'multiple_cards', 'too_blurry']

  it('maps every v1 reason forward — the map is total by construction', () => {
    for (const r of V1) {
      const mapped = migrateLegacyReason(r)
      assert.ok(EXPECTED_REASONS.includes(mapped), `${r} -> ${mapped} must land in the current union`)
    }
    assert.deepEqual(Object.keys(LEGACY_REASON_MAP).sort(), [...V1].sort())
  })

  it('renames multiple_cards to the verdict it always meant', () => {
    // The v1 editor printed the same "one clear foreground subject is a
    // POSITIVE" rule beside the button, so the population is the same; only
    // the name got honest.
    assert.equal(migrateLegacyReason('multiple_cards'), 'multiple_no_clear_foreground')
  })

  it('leaves too_blurry and no_card under their own names', () => {
    assert.equal(migrateLegacyReason('too_blurry'), 'too_blurry')
    assert.equal(migrateLegacyReason('no_card'), 'no_card')
  })

  it('does NOT map anything onto not_a_card — that class has no v1 population', () => {
    // v1 had nowhere to put a shipping envelope, so v1 no_card rows are a
    // MIXTURE. Mining them for hard negatives would feed the presence head
    // frames that are mostly empty and occasionally an envelope, with no way to
    // tell which. The class starts clean, at schema 2.
    assert.equal(Object.values(LEGACY_REASON_MAP).includes('not_a_card'), false)
  })
})
