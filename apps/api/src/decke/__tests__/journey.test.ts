/**
 * The journey plan's boundary.
 *
 * A journey is the one thing Deck-E emits that the browser then executes
 * WITHOUT another model turn in between — up to ten moves, most of them aimed
 * at pages nobody has loaded yet. Everything that bounds it therefore has to
 * bound it here, at plan time, because there is no second look.
 *
 * Three properties are asserted, and each of them was a stated requirement
 * rather than a nicety:
 *
 *   1. NO ARBITRARY SELECTORS. A CSS selector is a capability
 *      (`character/host/uiTools.ts` refuses anything outside
 *      `[data-decke-landmark]` for exactly this reason). A journey narrows it
 *      further, by SHAPE, so a plan cannot even ask for `input[type=password]`
 *      or `[data-decke-nav="/decks"] a`.
 *   2. THE CAP IS REAL. A runaway journey must not be expressible.
 *   3. `ensure` NAMES BOTH HALVES. One half is a blind click; the other half is
 *      a wait with no remedy, which is the fixed delay this verb replaces.
 *
 * Plus the property that makes the addressing scheme honest: every landmark
 * selector the app actually emits has to be expressible as a journey target.
 * That one reads `apps/web` from disk on purpose — the alternative is a
 * hand-copied list that stops being true the first time somebody marks a new
 * element, and the failure mode of THAT is a journey step that can never
 * resolve, discovered mid-escort with the reader watching.
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  isLandmarkRef,
  journeyResultSchema,
  journeySchema,
  JOURNEY_MAX_STEPS,
  JOURNEY_VERBS,
  validateJourneyStep,
  type JourneyStep,
} from '../tools.js'

const parse = (steps: unknown) => journeySchema.safeParse({ steps })
const errorOf = (r: ReturnType<typeof parse>) =>
  r.success ? '' : r.error.issues.map((i) => i.message).join(' | ')

test('a journey cannot carry a CSS selector of its own', () => {
  // Every one of these is something `document.querySelector` would happily
  // resolve, and several of them reach controls that are not landmarks at all.
  const attacks = [
    'body',
    '#root',
    '.series-card',
    'a[href]',
    'input[type=password]',
    'button',
    '[data-decke-nav="/decks"] a',
    '[data-decke-nav="/decks"] > span',
    '[data-decke-nav="/decks"],[data-decke-nav="/scan"]',
    '[data-decke-nav]:has(span)',
    '[data-decke-nav="/decks"][data-active="true"]',
    '[onclick]',
    '[data-testid="sign-out"]',
    '[data-decke-nav="/decks"]::after',
    '*',
  ]
  for (const selector of attacks) {
    assert.equal(isLandmarkRef(selector), false, `${selector} was accepted as a landmark reference`)
    for (const verb of ['flyTo', 'highlight', 'click'] as const) {
      const r = parse([{ verb, landmark: selector }])
      assert.equal(r.success, false, `${verb} accepted the selector "${selector}"`)
      assert.match(errorOf(r), /not a landmark/i)
    }
  }
})

test('the ten-step cap is not expressible past', () => {
  const step: JourneyStep = { verb: 'say', text: 'this way' }
  const ten = Array.from({ length: JOURNEY_MAX_STEPS }, () => ({ ...step }))
  assert.equal(parse(ten).success, true, `${JOURNEY_MAX_STEPS} steps should be legal`)

  const eleven = Array.from({ length: JOURNEY_MAX_STEPS + 1 }, () => ({ ...step }))
  assert.equal(parse(eleven).success, false, 'an 11-step plan must be refused')

  // And the other end: an empty plan is a call that does nothing, which the
  // model would then narrate as a journey.
  assert.equal(parse([]).success, false)
})

test('`ensure` must name both the landmark and the thing that reveals it', () => {
  const landmark = '[data-decke-series="mega-evolution"]'
  const byClicking = '[data-decke-show-others]'

  assert.equal(parse([{ verb: 'ensure', landmark, byClicking }]).success, true)

  // Only the landmark: a wait with no remedy. That is a fixed delay wearing a
  // different name, and the whole reason this verb exists is to not have one.
  const noRemedy = parse([{ verb: 'ensure', landmark }])
  assert.equal(noRemedy.success, false)
  assert.match(errorOf(noRemedy), /byClicking/)

  // Only the thing to press: a blind click on a disclosure that may already be
  // open, which is how a one-shot toggle gets toggled back shut.
  const blind = parse([{ verb: 'ensure', byClicking }])
  assert.equal(blind.success, false)
  assert.match(errorOf(blind), /landmark/)

  // Both, but the same one. It would be pressing the very thing it waits for.
  const circular = parse([{ verb: 'ensure', landmark: byClicking, byClicking }])
  assert.equal(circular.success, false)
  assert.match(errorOf(circular), /waiting for/)
})

test('a realistic escort is accepted whole', () => {
  // "Help me find Pitch Black", starting on /insights, for the QA account —
  // which has collected nothing, so every series on /series is behind the
  // disclosure and the `ensure` step is load-bearing rather than decorative.
  const r = parse([
    { verb: 'say', text: "It's under Mega Evolution — I'll walk you over." },
    { verb: 'click', landmark: '[data-decke-nav="/pokedex"]' },
    { verb: 'goTo', route: '/series' },
    {
      verb: 'ensure',
      landmark: '[data-decke-series="mega-evolution"]',
      byClicking: '[data-decke-show-others]',
    },
    { verb: 'flyTo', landmark: '[data-decke-series="mega-evolution"]', point: true },
    { verb: 'click', landmark: '[data-decke-series="mega-evolution"]' },
    { verb: 'highlight', landmark: '[data-decke-set="me05"]' },
    { verb: 'click', landmark: '[data-decke-set="me05"]' },
    { verb: 'say', text: 'Here it is — 70 of 120.' },
  ])
  assert.equal(r.success, true, errorOf(r))
})

test('a journey cannot walk anyone off the route allowlist, and is refused whole', () => {
  // `/profile` mints API tokens. Caught at PLAN time, so he never takes the two
  // legitimate hops before discovering the third was never going to happen.
  const r = parse([
    { verb: 'say', text: 'this way' },
    { verb: 'goTo', route: '/series' },
    { verb: 'goTo', route: '/profile' },
  ])
  assert.equal(r.success, false)
  assert.match(errorOf(r), /not allowed/i)

  for (const route of ['//evil.example', '/\\evil.example', 'https://evil.example', '/profile/tokens']) {
    assert.equal(parse([{ verb: 'goTo', route }]).success, false, `${route} was accepted`)
  }
  assert.equal(parse([{ verb: 'goTo', route: '/series/mega-evolution/me05' }]).success, true)
})

test('there is no way to ask for a timed wait', () => {
  // CONDITIONAL WAITS, NEVER TIMED ONES. A fixed delay after a click is wrong
  // on a slow connection and wrong in the other direction on a fast one. The
  // guarantee is structural: no wait verb, and no duration field on any step,
  // so the wrong kind of wait cannot be expressed at all.
  assert.equal(
    (JOURNEY_VERBS as readonly string[]).some((v) => /wait|delay|pause|sleep/i.test(v)),
    false,
    'a wait verb would let a model ask for a fixed delay',
  )
  for (const bad of [
    { verb: 'click', landmark: '[data-decke-show-others]', durationMs: 800 },
    { verb: 'say', text: 'one moment', delayMs: 1200 },
  ]) {
    // Unknown keys are stripped rather than honoured, which is the property
    // that matters: nothing a model invents becomes a timer.
    const r = parse([bad])
    if (r.success) {
      assert.equal(
        Object.keys(r.data.steps[0]!).some((k) => /ms$|delay|duration|wait/i.test(k)),
        false,
        'a duration field survived onto a journey step',
      )
    }
  }
})

test('each verb refuses the fields that belong to another one', () => {
  // The flat schema permits every field on every verb; this is the layer that
  // does not. Same trade `commandSchema` + `validateCommand` already makes.
  const cases: Array<[JourneyStep, RegExp]> = [
    [{ verb: 'say', text: 'hi', route: '/decks' }, /route does not belong/],
    [{ verb: 'goTo', route: '/decks', landmark: '[data-decke-deck-list]' }, /landmark does not belong/],
    [{ verb: 'click', landmark: '[data-decke-show-others]', point: true }, /point does not belong/],
    [{ verb: 'highlight', landmark: '[data-decke-price-block]', text: 'look' }, /text does not belong/],
  ]
  for (const [step, re] of cases) {
    const reason = validateJourneyStep(step)
    assert.ok(reason, `${step.verb} accepted a field from another verb`)
    assert.match(reason, re)
  }
  // `point` is flyTo's, and flyTo keeps it.
  assert.equal(validateJourneyStep({ verb: 'flyTo', landmark: '[data-decke-set="me05"]', point: true }), null)
})

test('a spoken step cannot become an essay in the speech bubble', () => {
  const long = { verb: 'say' as const, text: 'x'.repeat(400) }
  assert.match(String(validateJourneyStep(long)), /capped/)
  assert.equal(validateJourneyStep({ verb: 'say', text: '  ' }), 'verb "say" needs text')
})

test('the failure report is structured enough to plan a recovery from', () => {
  // Prose is not enough. "I could not find it" tells the model nothing; a step
  // index, a verb, a target and a named cause tell it whether to re-plan the
  // route, press a disclosure first, or stop and say so.
  const ok = journeyResultSchema.safeParse({
    ok: false,
    planned: 6,
    ran: [
      { verb: 'say', reason: 'said it' },
      { verb: 'goTo', target: '/series', reason: 'we are on that page' },
    ],
    failure: {
      step: 2,
      verb: 'click',
      target: '[data-decke-series="mega-evolution"]',
      why: 'absent',
      reason: 'that series is not on the page',
    },
  })
  assert.equal(ok.success, true, ok.success ? '' : JSON.stringify(ok.error.issues))

  // A cause outside the named set would be a new recovery nobody wrote.
  const bogus = journeyResultSchema.safeParse({
    ok: false,
    planned: 1,
    ran: [],
    failure: { step: 0, verb: 'click', why: 'weird', reason: 'no' },
  })
  assert.equal(bogus.success, false)

  // TRUTHFULNESS (PLAN X2): a journey that ran nothing reports nothing as run.
  // `ran` is required, so "it went fine" cannot be asserted by omission.
  assert.equal(journeyResultSchema.safeParse({ ok: true, planned: 3 }).success, false)
})

/**
 * ── THE ADDRESSABILITY FLOOR, CHECKED AGAINST THE REAL MARKINGS ─────────────
 *
 * Reads `apps/web/src` and harvests every `data-decke-landmark` value the app
 * emits, template literals included. Each one must be expressible as a journey
 * target — otherwise there is a marked element a journey can never name, and
 * that is discovered mid-escort rather than here.
 *
 * The reverse coupling already exists (`character/host/__tests__/uiTools.test.ts`
 * reads `apps/api/src/decke/tools.ts` to pin the `CLIENT_TOOLS` mirror), for the
 * same reason: `deckpal-web` and `deckpal-api` do not depend on each other, so a
 * cross-package invariant has to be asserted by reading rather than importing.
 */
const WEB_SRC = fileURLToPath(new URL('../../../../web/src/', import.meta.url))

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) tsxFiles(p, out)
    else if (p.endsWith('.tsx')) out.push(p)
  }
  return out
}

test('every landmark the app actually marks is expressible as a journey target', () => {
  const files = tsxFiles(WEB_SRC)
  assert.ok(files.length > 20, `expected to find the web app at ${WEB_SRC}`)

  const found = new Set<string>()
  for (const f of files) {
    const src = readFileSync(f, 'utf8')
    for (const m of src.matchAll(/data-decke-landmark=(?:"([^"]+)"|\{`([^`]+)`\})/g)) {
      // `${s.slug}` and friends are catalog identifiers at runtime. A sample
      // exercises the same shape a real one would.
      found.add((m[1] ?? m[2]!).replace(/\$\{[^}]+\}/g, 'sample-id-42'))
    }
  }
  assert.ok(found.size >= 25, `only harvested ${found.size} landmark selectors — the scan is wrong`)

  for (const selector of found) {
    assert.equal(
      isLandmarkRef(selector),
      true,
      `${selector} is marked as a landmark but a journey cannot address it. Either the ` +
        'marking is a compound selector (it should be one [data-decke-…] attribute) or ' +
        'LANDMARK_REF in tools.ts has fallen behind the markup.',
    )
  }
})
