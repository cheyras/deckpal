/**
 * `escort` exists because `journey` asked the model to compile a program and it
 * mostly declined — 2 walks in 10, against `goTo`'s 100%, on the same model, the
 * same prompt and the same turn. The macro moves that compilation into
 * `apps/web/src/character/host/escortPlan.ts`.
 *
 * ── WHAT THIS FILE IS FOR ────────────────────────────────────────────────────
 *
 * Moving the compilation only helps if the compiled plan is one the server would
 * accept. `journeySchema` refuses a malformed plan WHOLE, before the first step,
 * so a builder that gets one field wrong does not degrade the feature — it
 * breaks every walk, every time, which is strictly worse than the 8-in-10 it
 * replaced.
 *
 * `deckpal-web` does not depend on `deckpal-api`, so the two halves meet on a
 * LITERAL rather than an import: the plan below is byte-for-byte the plan
 * `escortPlan.test.ts` asserts the builder produces, and this asserts the real
 * validator accepts it. Either half drifting fails one of the two.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { z } from 'zod'
import { buildTools, CLIENT_TOOLS, journeySchema } from '../tools.js'

/** `buildTools` only ever calls `write`; nothing here needs a real stream. */
const noopWriter = { write: () => {} }

/**
 * The exact plan `buildEscortSteps({ seriesSlug: 'mega-evolution', setId: 'me05',
 * opener: 'This way.' })` returns. Keep in step with `escortPlan.test.ts`.
 */
const EXPANDED_ESCORT = [
  { verb: 'say', text: 'This way.' },
  { verb: 'goTo', route: '/series' },
  {
    verb: 'ensure',
    landmark: '[data-decke-series="mega-evolution"]',
    byClicking: '[data-decke-show-others]',
  },
  { verb: 'click', landmark: '[data-decke-series="mega-evolution"]' },
  { verb: 'flyTo', landmark: '[data-decke-set="me05"]', point: true },
  { verb: 'highlight', landmark: '[data-decke-set="me05"]' },
]

test('the plan the browser builds from two ids is one the server would accept', () => {
  const parsed = journeySchema.safeParse({ steps: EXPANDED_ESCORT })
  assert.ok(
    parsed.success,
    `the expanded escort is not a valid journey: ${
      parsed.success ? '' : JSON.stringify(parsed.error.issues, null, 2)
    }`,
  )
})

test('the shorter walk — series only, no opener — is valid too', () => {
  const parsed = journeySchema.safeParse({
    steps: [
      { verb: 'goTo', route: '/series' },
      {
        verb: 'ensure',
        landmark: '[data-decke-series="mega-evolution"]',
        byClicking: '[data-decke-show-others]',
      },
      { verb: 'click', landmark: '[data-decke-series="mega-evolution"]' },
    ],
  })
  assert.ok(parsed.success, 'the series-only escort is not a valid journey')
})

test('that test would have caught a wrong plan', () => {
  // A guard that cannot fail is decoration. Three ways the builder could
  // plausibly be wrong, each refused by the real validator.
  const singleQuoted = journeySchema.safeParse({
    steps: [{ verb: 'click', landmark: "[data-decke-series='mega-evolution']" }],
  })
  assert.equal(singleQuoted.success, false, 'single-quoted landmarks are supposed to be refused')

  const ensureWithoutRemedy = journeySchema.safeParse({
    steps: [{ verb: 'ensure', landmark: '[data-decke-series="x"]' }],
  })
  assert.equal(ensureWithoutRemedy.success, false, 'an ensure with no byClicking should be refused')

  const ensurePressingItself = journeySchema.safeParse({
    steps: [
      {
        verb: 'ensure',
        landmark: '[data-decke-show-others]',
        byClicking: '[data-decke-show-others]',
      },
    ],
  })
  assert.equal(ensurePressingItself.success, false, 'an ensure pressing its own target is refused')
})

test('escort is fulfilled by the browser, not the server', () => {
  // It has no `execute` on purpose: the browser expands it and runs the same
  // sequencer `journey` uses. `tools.test.ts` pins the whole list structurally;
  // this names the one tool this change added, so a regression says which.
  assert.ok(
    (CLIENT_TOOLS as readonly string[]).includes('escort'),
    'escort must be a client tool or the server will try to execute it',
  )
})

test('escort asks for two ids and nothing that has to be quoted exactly', () => {
  // The WHOLE POINT. If this schema ever grows a landmark, a selector or a step
  // list, it has become `journey` again and the model is back to compiling the
  // thing it demonstrably will not compile.
  const tools = buildTools(noopWriter) as Record<
    string,
    { inputSchema: z.ZodObject<z.ZodRawShape> } | undefined
  >
  const escort = tools.escort
  assert.ok(escort, 'buildTools no longer builds an escort tool')

  const fields = Object.keys(escort.inputSchema.shape).sort()
  assert.deepEqual(fields, ['opener', 'seriesSlug', 'setId'])

  // And it accepts exactly what a data tool hands back, with nothing to quote.
  const ok = escort.inputSchema.safeParse({ seriesSlug: 'mega-evolution', setId: 'me05' })
  assert.ok(ok.success, 'escort refused the two ids search_cards returns')
})
