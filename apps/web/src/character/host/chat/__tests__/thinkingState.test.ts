/**
 * The thinking row's two honesty rules, and its clock.
 *
 * The clock matters more than it looks: the elapsed counter is the ONLY liveness
 * signal that survives `prefers-reduced-motion: reduce`, so a formatter that
 * returns the same string for seconds on end would recreate the exact bug this
 * row exists to fix (a chat panel pixel-identical for 61 seconds of a 210-second
 * wait).
 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  describeElapsed,
  formatElapsed,
  pickThinkingLabel,
  shouldAutoExpandSteps,
  THINKING_FALLBACK_LABEL,
} from '../thinkingState'
import type { ToolRowData } from '../toolRowState'

test('the newest non-blank label wins', () => {
  assert.equal(pickThinkingLabel(['Reading your collection', 'Comparing prices']), 'Comparing prices')
  assert.equal(pickThinkingLabel(['Reading your collection', '   ']), 'Reading your collection')
  assert.equal(pickThinkingLabel([' Trimmed  ']), 'Trimmed')
})

test('with nothing from the server it claims no activity', () => {
  // X2: a label the server did not send is a fabricated status surface. The
  // fallback has to be true of every in-flight request without describing one.
  assert.equal(pickThinkingLabel([]), THINKING_FALLBACK_LABEL)
  assert.equal(pickThinkingLabel(undefined), THINKING_FALLBACK_LABEL)
  assert.equal(pickThinkingLabel(['', '  ']), THINKING_FALLBACK_LABEL)
  assert.doesNotMatch(THINKING_FALLBACK_LABEL, /search|read|analys|analyz|tool/i)
})

test('the counter changes on every tick it is asked to render', () => {
  // 500ms tick, one decimal: consecutive ticks must never print the same thing.
  const seen = new Set<string>()
  for (let ms = 0; ms < 5_000; ms += 500) seen.add(formatElapsed(ms))
  assert.equal(seen.size, 10)
})

test('elapsed formatting: tenths below a minute, whole seconds above', () => {
  assert.equal(formatElapsed(0), '0.0s')
  assert.equal(formatElapsed(4_520), '4.5s')
  assert.equal(formatElapsed(59_999), '59.9s')
  assert.equal(formatElapsed(60_000), '1m 0s')
  assert.equal(formatElapsed(210_000), '3m 30s')
  assert.equal(formatElapsed(3_599_000), '59m 59s')
})

test('the counter rounds DOWN, because a status surface must not overstate', () => {
  assert.equal(formatElapsed(4_999), '4.9s')
  assert.equal(formatElapsed(61_999), '1m 1s')
})

test('a clock that goes backwards prints zero, not a negative wait', () => {
  assert.equal(formatElapsed(-5_000), '0.0s')
  assert.equal(formatElapsed(Number.NaN), '0.0s')
  assert.equal(formatElapsed(Number.POSITIVE_INFINITY), '0.0s')
})

test('the spoken duration is grammatical', () => {
  assert.equal(describeElapsed(0), '0 seconds')
  assert.equal(describeElapsed(1_000), '1 second')
  assert.equal(describeElapsed(45_400), '45 seconds')
  assert.equal(describeElapsed(60_000), '1 minute')
  assert.equal(describeElapsed(61_000), '1 minute 1 second')
  assert.equal(describeElapsed(210_000), '3 minutes 30 seconds')
})

const step = (phase: ToolRowData['phase']): ToolRowData => ({
  id: `s-${phase}`,
  name: 'analyze_collection',
  title: 'Analyse the collection',
  phase,
})

test('steps stay collapsed — unless one of them failed', () => {
  assert.equal(shouldAutoExpandSteps(undefined), false)
  assert.equal(shouldAutoExpandSteps([]), false)
  assert.equal(shouldAutoExpandSteps([step('ok'), step('start')]), false)
  // Never collapsing a failure is worth nothing if the drawer holding it is shut.
  assert.equal(shouldAutoExpandSteps([step('ok'), step('partial')]), true)
  assert.equal(shouldAutoExpandSteps([step('error')]), true)
})
