/**
 * The rule this file guards is the one the owner's recording proved was
 * missing: a failed tool call must be LOUDER than a successful one, never
 * collapsed by default, and always recoverable.
 *
 * He watched a reply that opened *"The analyze tool timed out before it could
 * finish reading your full collection…"* and praised it on camera as "a great
 * response" — he had no idea anything had gone wrong. The chip that should have
 * told him wore the same grey pill as every success.
 *
 * The direction of this pass is quieter tool rows. That direction, applied
 * without an exception, makes that frame WORSE. These tests exist so a future
 * restyle that makes everything calmer cannot quietly take the exception with
 * it.
 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { isFailedPhase, toolRowAppearance, type ToolPhase, type ToolRowData, hintFrom } from '../toolRowState'

const row = (over: Partial<ToolRowData> = {}): ToolRowData => ({
  id: 't1',
  name: 'collection_summary',
  title: 'Collection summary',
  phase: 'ok',
  ...over,
})

const ALL: ToolPhase[] = ['start', 'progress', 'ok', 'partial', 'error']

test('a failure is never quiet, never unlabelled, and never without a way back', () => {
  for (const phase of ['partial', 'error'] as const) {
    const a = toolRowAppearance(row({ phase, summary: 'Read 0 of 604 cards' }))
    assert.notEqual(a.tone, 'quiet', `${phase} must not rest quiet`)
    assert.notEqual(a.tone, 'running')
    assert.notEqual(a.label, '', `${phase} must carry an explicit state word`)
    assert.equal(a.canRetry, true, `${phase} must offer a retry`)
    assert.equal(a.defaultExpanded, true, `${phase} must not be collapsed by default`)
  }
})

test('a partial is visibly distinct from BOTH ok and error', () => {
  const ok = toolRowAppearance(row({ phase: 'ok', summary: 's' }))
  const partial = toolRowAppearance(row({ phase: 'partial', summary: 's', reason: 'timeout' }))
  const error = toolRowAppearance(row({ phase: 'error', summary: 's' }))
  assert.notEqual(partial.tone, ok.tone)
  assert.notEqual(partial.tone, error.tone)
  assert.notEqual(partial.label, error.label)
  // And it says the word that the owner needed to read.
  assert.match(partial.label, /incomplete/i)
})

test('the reason a partial is partial reaches the label', () => {
  assert.match(toolRowAppearance(row({ phase: 'partial', reason: 'timeout' })).label, /timed out/i)
  assert.match(toolRowAppearance(row({ phase: 'partial', reason: 'truncated' })).label, /cut short/i)
  // No reason given: still says the one thing we do know.
  assert.match(toolRowAppearance(row({ phase: 'partial' })).label, /incomplete/i)
})

test('a success carries no state word — that would be the pill coming back', () => {
  assert.equal(toolRowAppearance(row({ phase: 'ok', summary: 'Read 604 cards' })).label, '')
  assert.equal(toolRowAppearance(row({ phase: 'start' })).label, '')
  assert.equal(toolRowAppearance(row({ phase: 'progress', note: 'page 3' })).label, '')
})

test('only a running call is busy', () => {
  for (const phase of ALL) {
    const a = toolRowAppearance(row({ phase }))
    assert.equal(a.busy, phase === 'start' || phase === 'progress', `busy wrong for ${phase}`)
  }
})

test('only a failure can be retried', () => {
  for (const phase of ALL) {
    assert.equal(toolRowAppearance(row({ phase })).canRetry, isFailedPhase(phase), `retry wrong for ${phase}`)
  }
})

test('a running row shows its progress note; a settled row shows its result', () => {
  const running = toolRowAppearance(row({ phase: 'progress', note: 'page 3 of 11', summary: 'ignored' }))
  assert.equal(running.detail, 'page 3 of 11')
  const settled = toolRowAppearance(row({ phase: 'ok', note: 'ignored', summary: 'Read 604 cards' }))
  assert.equal(settled.detail, 'Read 604 cards')
})

test('a row with nothing real to show offers no expander', () => {
  // The old chip put an empty `title=""` on every row. A disclosure control that
  // opens onto nothing is the same lie in a newer shape.
  assert.equal(toolRowAppearance(row({ phase: 'ok' })).expandable, false)
  assert.equal(toolRowAppearance(row({ phase: 'ok', summary: '   ' })).expandable, false)
  assert.equal(toolRowAppearance(row({ phase: 'ok', summary: 'x' })).expandable, true)
})

test('a failure with nothing to reveal is still loud, and cannot claim to be open', () => {
  const a = toolRowAppearance(row({ phase: 'error' }))
  assert.equal(a.expandable, false)
  // `aria-expanded` must not say true over an empty region.
  assert.equal(a.defaultExpanded, false)
  assert.equal(a.tone, 'danger')
  assert.equal(a.label, 'Failed')
  assert.equal(a.canRetry, true)
})

test('the announcement is a whole sentence, and failures are announced at all', () => {
  assert.equal(toolRowAppearance(row({ phase: 'start' })).live, 'off')
  assert.equal(toolRowAppearance(row({ phase: 'ok', summary: 'x' })).live, 'off')
  assert.equal(toolRowAppearance(row({ phase: 'partial' })).live, 'polite')
  assert.equal(toolRowAppearance(row({ phase: 'error' })).live, 'assertive')

  assert.match(toolRowAppearance(row({ phase: 'error', summary: 'ETIMEDOUT' })).announce, /Collection summary: failed\. ETIMEDOUT/)
  assert.match(toolRowAppearance(row({ phase: 'partial', reason: 'timeout' })).announce, /timed out/i)
})

test('a row with no title falls back to the tool name rather than announcing nothing', () => {
  const a = toolRowAppearance(row({ title: '  ', phase: 'error' }))
  assert.match(a.announce, /^collection_summary: failed/)
})

// ── The hint: three calls to one tool must be three rows, not a stutter ──────
//
// Quiet-by-default is right for one row and produces a stutter for several.
// Asking "how many cards do I have in Pitch Black?" makes three genuine
// `set_progress` calls, and collapsed they render as the same sentence three
// times — which the owner saw, and which reads as a bug rather than as work.
// The discriminator has to come out of the real result, or it is decoration
// that happens to differ.

test('a settled row carries a few real words from its own result', () => {
  const a = toolRowAppearance({
    id: '1',
    name: 'set_progress',
    title: 'Check set completion',
    phase: 'ok',
    summary: 'Pitch Black (me05): 13 of 120 complete',
  })
  assert.ok(a.hint, 'a settled row with a summary should carry a hint')
  assert.ok(
    a.hint && 'Pitch Black (me05): 13 of 120 complete'.startsWith(a.hint.replace(/…$/, '')),
    `the hint must be a prefix of the real summary, got ${JSON.stringify(a.hint)}`,
  )
})

test('two calls to the same tool with different results look different', () => {
  const row = (summary: string) =>
    toolRowAppearance({ id: 'x', name: 'set_progress', title: 'Check set completion', phase: 'ok', summary })
  const a = row('Pitch Black (me05): 13 of 120 complete')
  const b = row('Mega Evolution: 8 sets, 1,076 cards')
  assert.notEqual(a.hint, b.hint, 'identical titles with different results must not render identically')
})

test('a failure gets no hint — it already has a loud label', () => {
  const a = toolRowAppearance({
    id: '1',
    name: 'analyse',
    title: 'Analyse the collection',
    phase: 'partial',
    reason: 'timeout',
    summary: 'Read 300 of 604 cards before the deadline',
  })
  assert.equal(a.hint, undefined)
  assert.match(a.label, /incomplete/i, 'the failure still says so, in words')
})

test('hintFrom refuses to cut a long word in half', () => {
  // Half a word plus an ellipsis reads as broken. No hint is a fine row.
  assert.equal(hintFrom('Supercalifragilisticexpialidociousandthensomemoreletters'), undefined)
  assert.equal(hintFrom(''), undefined)
  assert.equal(hintFrom(undefined), undefined)
  assert.equal(hintFrom('short enough'), 'short enough')
})
