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
import {
  hintFrom,
  isFailedPhase,
  toolRowAppearance,
  toolRowFromChip,
  type ToolPhase,
  type ToolRowData,
} from '../toolRowState'

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

// ── The refusal row ──────────────────────────────────────────────────────────

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * "LEAVE IT" DREW A CHECK MARK.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * *"There's a check mark here and there shouldn't be. That should be like a
 * little red x — nothing was written, you cancelled it."*
 *
 * The row exists because a refusal that left NO mark let his next sentence read
 * as though the write had happened — a real report. But `deny` emits it with
 * `phase: 'ok'`, which is the phase for a call that RAN AND SUCCEEDED, so the
 * fix for "the transcript never said it was cancelled" shipped a transcript that
 * said it was done.
 *
 * MUTATION: make `toolRowFromChip` the identity function and every assertion
 * below goes red. Watched.
 */
test('a refusal is recognised by the id `deny` actually builds', () => {
  const declined = toolRowFromChip({
    id: 'call_a7f3-declined',
    name: 'log_cards',
    title: 'Nothing was written',
    phase: 'ok',
    summary: 'You left it, so nothing changed.',
  })
  assert.equal(declined.phase, 'declined')

  const a = toolRowAppearance(declined)
  assert.equal(a.tone, 'declined')
  assert.equal(a.label, 'Cancelled', 'the word, not just the glyph')
  assert.match(a.announce, /nothing was written/i, 'the consequence is what has to be announced')
  assert.equal(a.canRetry, false, 'there is nothing to retry — they said no on purpose')
})

/**
 * MUTATION: drop the `chip.phase === 'ok'` half of the predicate and the second
 * assertion goes red. Both halves must match so that the day `useDeckeChat`
 * emits a real `declined` phase, this bridge simply stops firing rather than
 * fighting it.
 */
test('the bridge is narrow: an ordinary success is left exactly alone', () => {
  const ok = { id: 'call_b1', name: 'set_progress', title: 'Checked set completion', phase: 'ok' as const }
  assert.equal(toolRowFromChip(ok), ok, 'an unrelated row must not even be copied')
  const failed = {
    id: 'call_c2-declined',
    name: 'log_cards',
    title: 'Adding to your collection',
    phase: 'error' as const,
  }
  assert.equal(toolRowFromChip(failed).phase, 'error', 'a FAILURE that happens to end in -declined stays a failure')
})

/**
 * A CANCELLATION IS NOT A FAILURE, AND MUST NOT LOOK LIKE ONE.
 *
 * MUTATION: map `declined` to the `danger` tone and this goes red. A red band
 * across the transcript would tell somebody their own deliberate decision was a
 * problem — and it would sit beside real failures, which is where the loud
 * treatment has to keep its meaning.
 */
test('a cancellation stays as quiet as a success', () => {
  const a = toolRowAppearance({
    id: 'x-declined',
    name: 'log_cards',
    title: 'Nothing was written',
    phase: 'declined',
  })
  assert.notEqual(a.tone, 'danger')
  assert.notEqual(a.tone, 'warn')
  assert.equal(a.live, 'off', 'they pressed it themselves; it must not interrupt')
})

/**
 * ══════════════════════════════════════════════════════════════════════════════
 * A ROW THAT IS A RECORD, NOT A LIVE CALL.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * The transcript viewer replays stored rows through this exact module and this
 * exact component, deliberately, so that a restyle of one is a restyle of both.
 * That is only safe if the two facts that stop being true in a record are
 * enforced here rather than remembered at the call site:
 *
 *   nothing replayed is still running, and nothing replayed can be retried.
 *
 * The third fact is the one this codebase has already got wrong once, in the
 * other direction: a tick is an ASSERTION, and a row with no recorded outcome
 * must not draw one.
 */
test('a record is never busy, however it was left', () => {
  // MUTATION: drop `&& !data.recorded` from `running` and this goes red. Without
  // it a call that was still in flight when somebody closed the panel draws a
  // travelling ring forever, in a document, saying "still going" about something
  // that stopped days ago.
  for (const phase of ['start', 'progress'] as const) {
    assert.equal(toolRowAppearance(row({ phase })).busy, true, `${phase} is busy while live`)
    assert.equal(toolRowAppearance(row({ phase, recorded: true })).busy, false, `${phase} is busy in a record`)
  }
})

test('a record is never retryable, even when it failed', () => {
  // MUTATION: drop `&& !data.recorded` from `canRetry`. The turn is over and the
  // call site is gone; a "Try again" there is a button that cannot do its job.
  for (const phase of ['partial', 'error'] as const) {
    assert.equal(toolRowAppearance(row({ phase })).canRetry, true)
    assert.equal(toolRowAppearance(row({ phase, recorded: true })).canRetry, false, `${phase} offered a retry in a record`)
  }
})

test('a record announces nothing', () => {
  // Opening a transcript must not shout three old failures at a screen-reader
  // user. It is a document, not news.
  for (const phase of ['error', 'partial'] as const) {
    assert.notEqual(toolRowAppearance(row({ phase })).live, 'off')
    assert.equal(toolRowAppearance(row({ phase, recorded: true })).live, 'off', `${phase} interrupted from a record`)
  }
})

test('a call that never finished says so, and does not read as a success', () => {
  const a = toolRowAppearance(row({ phase: 'start', recorded: true }))
  assert.match(a.label, /never finished/i)
  assert.notEqual(a.glyph, 'check', 'a call that never came back drew a tick')
  assert.match(a.announce, /never finished/i)
})

test('a phase the app does not recognise draws no tick and says why', () => {
  // `shapeTools` on the server writes `unknown` for any phase string it does not
  // know. This is the whole of X2 applied to a stored row: an outcome nobody
  // recorded must not be dressed as one.
  const a = toolRowAppearance(row({ phase: 'unknown', summary: 'something' }))
  assert.notEqual(a.glyph, 'check', 'an unknown outcome drew a tick')
  assert.notEqual(a.label, '', 'an unknown outcome said nothing at all')
  assert.match(a.label, /not recorded/i)
  assert.match(a.announce, /not recorded/i)
  assert.equal(a.busy, false)
  assert.equal(a.canRetry, false)
})

test('an unknown row is not dressed as a failure either', () => {
  // MUTATION: give `unknown` the `warn` tone. A history read back through an
  // amber wash trains the eye to skip exactly the tint that matters, and it
  // would be claiming something went wrong when nobody knows that it did.
  const a = toolRowAppearance(row({ phase: 'unknown' }))
  assert.notEqual(a.tone, 'warn')
  assert.notEqual(a.tone, 'danger')
  assert.equal(a.defaultExpanded, false)
})

test('exactly one appearance draws a tick', () => {
  // MUTATION: point any other tone at `check` in the GLYPH map. This is the
  // guard against the defect this codebase actually shipped — a refusal drawn
  // with a check mark — coming back through a new phase nobody thought about.
  const cases: { data: ToolRowData; ticks: boolean }[] = [
    { data: row({ phase: 'ok', summary: 'Read 604 cards' }), ticks: true },
    { data: row({ phase: 'partial' }), ticks: false },
    { data: row({ phase: 'error' }), ticks: false },
    { data: row({ phase: 'declined' }), ticks: false },
    { data: row({ phase: 'unknown' }), ticks: false },
    { data: row({ phase: 'start', recorded: true }), ticks: false },
  ]
  for (const c of cases) {
    const a = toolRowAppearance(c.data)
    assert.equal(a.glyph === 'check', c.ticks, `${c.data.phase}${c.data.recorded ? ' (recorded)' : ''} drew the wrong mark`)
  }
})

test('a record reads its stored summary even for a phase that was mid-flight', () => {
  // The live branch reads `note`, which a record never has. Without the
  // `recorded` split, a stored row left at `progress` would show nothing at all
  // and quietly lose whatever the record DID keep.
  const a = toolRowAppearance(row({ phase: 'progress', recorded: true, summary: 'Read 3 of 11 pages' }))
  assert.equal(a.detail, 'Read 3 of 11 pages')
  assert.equal(a.expandable, true)
})
