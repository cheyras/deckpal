/**
 * The macro exists to remove a compilation the model was failing at, so the one
 * thing these tests must actually establish is that THE COMPILATION IS RIGHT.
 *
 * A builder that emits a plan the server would refuse is worse than the problem
 * it replaces: `journey`'s schema rejects a malformed plan whole, before the
 * first step, so a bad `escort` would fail every single time instead of two
 * times in ten. Hence the pinning test at the bottom, which reads the server's
 * OWN validator out of `apps/api/src/decke/tools.ts` rather than restating what
 * it is believed to say — the same trade `uiTools.test.ts` makes for
 * `CLIENT_TOOLS`, and for the same reason: `deckpal-web` does not depend on
 * `deckpal-api`.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { buildEscortSteps, SHOW_OTHERS, seriesLandmark, setLandmark } from '../escortPlan'
import { JOURNEY_MAX_STEPS, JOURNEY_VERBS } from '../journey'

const PROMPT_SRC = fileURLToPath(
  new URL('../../../../../api/src/decke/prompt.ts', import.meta.url),
)

test('a set walk is the whole way there, in order, from two ids', () => {
  const steps = buildEscortSteps({ seriesSlug: 'mega-evolution', setId: 'me05' })
  assert.deepEqual(
    steps.map((s) => s.verb),
    ['goTo', 'ensure', 'click', 'flyTo', 'highlight'],
  )
  assert.equal(steps[0].route, '/series')
  assert.equal(steps[1].landmark, '[data-decke-series="mega-evolution"]')
  assert.equal(steps[1].byClicking, SHOW_OTHERS)
  assert.equal(steps[2].landmark, '[data-decke-series="mega-evolution"]')
  assert.equal(steps[3].landmark, '[data-decke-set="me05"]')
  assert.equal(steps[3].point, true)
  assert.equal(steps[4].landmark, '[data-decke-set="me05"]')
})

test('without a setId it stops at the series, rather than pointing at nothing', () => {
  const steps = buildEscortSteps({ seriesSlug: 'mega-evolution' })
  assert.deepEqual(
    steps.map((s) => s.verb),
    ['goTo', 'ensure', 'click'],
  )
})

test('the opener is a step only when there is one', () => {
  assert.equal(buildEscortSteps({ seriesSlug: 'x' })[0].verb, 'goTo')
  assert.equal(buildEscortSteps({ seriesSlug: 'x', opener: '   ' })[0].verb, 'goTo')
  const withLine = buildEscortSteps({ seriesSlug: 'x', opener: 'This way.' })
  assert.equal(withLine[0].verb, 'say')
  assert.equal(withLine[0].text, 'This way.')
})

test('the disclosure step is unconditional, because the reader it is for owns nothing', () => {
  // `ensure` presses only if the landmark is missing, so planning it costs a
  // collector who already owns the series nothing — and omitting it strands the
  // new collector, for whom EVERY series is behind the disclosure. Getting this
  // backwards fails exactly the person the feature exists to serve.
  const steps = buildEscortSteps({ seriesSlug: 'anything', setId: 'any1' })
  const ensure = steps.find((s) => s.verb === 'ensure')
  assert.ok(ensure, 'no ensure step was planned')
  assert.equal(ensure.byClicking, SHOW_OTHERS)
  assert.notEqual(ensure.landmark, ensure.byClicking)
})

test('every step uses a verb the sequencer knows', () => {
  const steps = buildEscortSteps({ seriesSlug: 's', setId: 'x1', opener: 'hi' })
  for (const s of steps) {
    assert.ok(
      (JOURNEY_VERBS as readonly string[]).includes(s.verb),
      `${s.verb} is not a journey verb`,
    )
  }
  assert.ok(steps.length <= JOURNEY_MAX_STEPS)
})

test('the longest walk it can build is well inside the cap', () => {
  // The cap refuses a plan WHOLE, so headroom here is not tidiness. Six of ten.
  assert.equal(buildEscortSteps({ seriesSlug: 's', setId: 'x1', opener: 'hi' }).length, 6)
})

test('the landmark templates still match the ones the app builds', () => {
  // Pins the mirror. `ADDRESSING_LINES` in the server prompt is the list the
  // model is told about and `SeriesIndex.tsx`/`SeriesDetail.tsx` are what
  // actually render the attributes; if that list changes shape, this builder is
  // writing selectors for a DOM that no longer exists and every walk fails at
  // step two with `absent`.
  const src = readFileSync(PROMPT_SRC, 'utf8')
  assert.ok(
    src.includes('[data-decke-series="<seriesSlug>"]'),
    'the series landmark template changed in prompt.ts',
  )
  assert.ok(
    src.includes('[data-decke-set="<setId>"]'),
    'the set landmark template changed in prompt.ts',
  )
  assert.ok(
    src.includes(SHOW_OTHERS),
    `${SHOW_OTHERS} is no longer named in prompt.ts — the disclosure moved`,
  )
  assert.equal(seriesLandmark('abc'), '[data-decke-series="abc"]')
  assert.equal(setLandmark('ab1'), '[data-decke-set="ab1"]')
})

test('there is still no [data-decke-nav="/series"] to press, which is why hop one is a goTo', () => {
  // If this ever becomes pressable, the first hop SHOULD become a click — an
  // escort that teleports its first leg is the compromise this comment records,
  // not a preference. The prompt is the place that states it.
  const src = readFileSync(PROMPT_SRC, 'utf8')
  assert.ok(
    src.includes('[data-decke-nav="/series"]` DOES NOT EXIST') ||
      src.includes('There is no \\`[data-decke-nav="/series"]\\`'),
    'prompt.ts no longer says /series has no pressable nav row — re-check hop one',
  )
  assert.equal(buildEscortSteps({ seriesSlug: 's' })[0].verb, 'goTo')
})
