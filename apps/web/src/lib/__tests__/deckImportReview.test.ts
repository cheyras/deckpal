import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { DeckFormat, DeckImportFix, DeckImportSummary } from '../api'
import {
  deriveImportReview, importReviewReducer, initialImportReview, reviewedImportPayload,
  type ImportReviewAction, type ImportReviewState,
} from '../deckImportReview'

const PIKACHU = '1 Pikachu SVI 1'
const IONO = '1 Iono PAL 185'
const ANCIENT = '1 Ancient Card PAL 1'
const TYPO = '1 Iono PAL 999'
const MYSTERY = '1 Mystery PAL 999'
const MATCHED = new Set([PIKACHU, IONO, ANCIENT])

/** Deliberately independent of the review projection: this is the fixture
 * catalog and format rule that a dry-run response represents. */
function serverSummary(text: string, formatCode: DeckFormat): DeckImportSummary {
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean)
  const unresolvedLines = lines.filter(line => !MATCHED.has(line))
  const matched = lines.filter(line => MATCHED.has(line))
  return {
    source: 'ptcgl', resolvedEntries: matched.length, distinctCards: new Set(matched).size,
    totalCards: matched.length, unresolved: unresolvedLines, unresolvedLines,
    formatIssues: formatCode === 'standard' && matched.includes(ANCIENT)
      ? [{ cardId: 'ancient', reason: 'Not legal in Standard' }] : [],
    warnings: [], variantNote: '',
  }
}

function candidate(state: ImportReviewState, lineIndex: number): DeckImportFix {
  const original = state.text.split('\n')[lineIndex].trim()
  const replacement = original === MYSTERY ? ANCIENT : IONO
  return {
    lineIndex, original, replacement,
    card: { id: replacement === ANCIENT ? 'ancient' : 'iono', name: replacement === ANCIENT ? 'Ancient Card' : 'Iono', set: 'PAL', number: replacement === ANCIENT ? '1' : '185' },
    reason: 'Catalog correction', confidence: 'suggested',
  }
}

function dispatch(state: ImportReviewState, action: ImportReviewAction): ImportReviewState {
  const next = importReviewReducer(state, action)
  assertSafe(next)
  return next
}

function validate(state: ImportReviewState): ImportReviewState {
  return dispatch(state, { type: 'validated', revision: state.revision, summary: serverSummary(state.text, state.formatCode) })
}

function renderedSkip(state: ImportReviewState): Extract<ImportReviewAction, { type: 'skip' }> {
  return { type: 'skip', revision: state.revision, lineIds: deriveImportReview(state).unresolved.map(row => row.lineId) }
}

/** The write gate's independent oracle uses the fixture catalog, the physical
 * lines, and the exact revision of an explicit skip. */
function assertSafe(state: ImportReviewState): void {
  const review = deriveImportReview(state)
  const payload = reviewedImportPayload(state)
  assert.equal(Boolean(payload), review.canImport, 'the write path must use the review gate')
  assert.equal(state.lineIds.length, state.text.split('\n').length)
  assert.equal(new Set(state.lineIds).size, state.lineIds.length)
  if (!payload) return

  assert.equal(payload.text, state.text)
  assert.equal(payload.formatCode, state.formatCode)
  assert.equal(state.validation?.revision, state.revision, 'a checked old snapshot cannot import')
  assert.deepEqual(state.validation.summary, serverSummary(state.text, state.formatCode), 'the current server facts must agree with the physical lines')
  const physical = state.text.split('\n').map((raw, index) => ({ line: raw.trim(), id: state.lineIds[index] })).filter(row => row.line)
  assert.ok(physical.some(row => MATCHED.has(row.line)), 'an unmatched-only list cannot import')
  const acceptedCardIds = new Set([...state.corrections.values()].flatMap(history => history.map(fix => fix.card.id)))
  assert.ok(state.formatCode !== 'standard' || !acceptedCardIds.has('ancient') || physical.every(row => row.line !== ANCIENT), 'an accepted illegal correction cannot import')
  const unmatched = physical.filter(row => !MATCHED.has(row.line))
  if (unmatched.length) {
    assert.equal(state.skipped?.revision, state.revision, 'skip must be confirmed for the current revision')
    for (const row of unmatched)
      assert.ok(state.skipped!.lineIds.includes(row.id), `unmatched physical line ${row.id} needs explicit confirmation`)
  }
}

test('format switch never carries skip confirmation or legalizes an accepted illegal correction', () => {
  let state = dispatch(initialImportReview(), { type: 'text', text: `${PIKACHU}\n${MYSTERY}` })
  state = validate(state)
  state = dispatch(state, { type: 'accept', revision: state.revision, fixes: [candidate(state, 1)] })
  assert.equal(state.text, `${PIKACHU}\n${ANCIENT}`)
  state = dispatch(state, { type: 'format', formatCode: 'expanded' })
  state = validate(state)
  assert.ok(reviewedImportPayload(state), 'the accepted correction is legal in Expanded')
  state = dispatch(state, { type: 'format', formatCode: 'standard' })
  assert.equal(reviewedImportPayload(state), null, 'switching formats invalidates the old check')
  state = validate(state)
  assert.equal(reviewedImportPayload(state), null, 'the corrected card is illegal in Standard')
  const [lineId] = state.corrections.keys()
  state = dispatch(state, { type: 'undo', lineId })
  assert.equal(state.text, `${PIKACHU}\n${MYSTERY}`)
  state = validate(state)
  assert.equal(reviewedImportPayload(state), null, 'Undo restores an unmatched line requiring a fresh skip')
  state = dispatch(state, renderedSkip(state))
  assert.ok(reviewedImportPayload(state))
  state = dispatch(state, { type: 'format', formatCode: 'expanded' })
  state = validate(state)
  assert.equal(reviewedImportPayload(state), null, 'the prior format\'s skip is not current confirmation')
})

test('blank lines, whitespace, and duplicate insertion cannot bypass an illegal correction', () => {
  let state = dispatch(initialImportReview(), { type: 'text', text: `${PIKACHU}\n${MYSTERY}` })
  state = validate(state)
  state = dispatch(state, { type: 'accept', revision: state.revision, fixes: [candidate(state, 1)] })
  const correctedId = state.lineIds[1]
  for (const nextText of [
    `${PIKACHU}\n\n${ANCIENT}`,
    `${PIKACHU}\n  \n${ANCIENT}`,
    `${PIKACHU}\n  \n${ANCIENT}\n${PIKACHU}`,
  ]) {
    state = dispatch(state, { type: 'text', text: nextText })
    assert.ok(state.lineIds.includes(correctedId), 'an untouched correction keeps its identity')
    state = validate(state)
    assert.equal(reviewedImportPayload(state), null)
  }
  state = dispatch(state, { type: 'undo', lineId: correctedId })
  assert.ok(state.text.includes(MYSTERY), 'Undo restores the same physical line after inserts')
  assert.ok(!state.text.includes(ANCIENT))
  state = validate(state)
  assert.equal(reviewedImportPayload(state), null, 'the restored line must be skipped explicitly')
})

test('removing an identical corrected line cannot transfer confirmation or bypass the illegal-card guard', () => {
  let state = dispatch(initialImportReview(), { type: 'text', text: `${PIKACHU}\n${MYSTERY}` })
  state = validate(state)
  state = dispatch(state, { type: 'accept', revision: state.revision, fixes: [candidate(state, 1)] })
  const originalId = state.lineIds[1]
  state = dispatch(state, { type: 'text', text: `${PIKACHU}\n${ANCIENT}\n${ANCIENT}` })
  state = validate(state)
  assert.equal(reviewedImportPayload(state), null)
  state = dispatch(state, { type: 'text', text: `${PIKACHU}\n${ANCIENT}` })
  assert.notEqual(state.lineIds[1], originalId, 'ambiguous duplicate removal must forget which copy was accepted')
  assert.ok(state.corrections.has(originalId), 'historical accepted-card provenance must survive ambiguous deletion')
  assert.equal(deriveImportReview(state).corrections.length, 0, 'the accepted fix cannot attach itself to the surviving duplicate')
  state = validate(state)
  assert.equal(reviewedImportPayload(state), null, 'legality still blocks import after provenance is forgotten')
})

test('raw format warnings preserve the existing import choice, while accepted illegal-card provenance stays guarded', () => {
  let state = dispatch(initialImportReview(), { type: 'text', text: `${PIKACHU}\n${ANCIENT}` })
  state = validate(state)
  assert.ok(reviewedImportPayload(state), 'an untouched raw deck may be imported despite a format warning')

  state = dispatch(initialImportReview(), { type: 'text', text: `${PIKACHU}\n${MYSTERY}` })
  state = validate(state)
  state = dispatch(state, { type: 'accept', revision: state.revision, fixes: [candidate(state, 1)] })
  state = dispatch(state, { type: 'text', text: PIKACHU })
  state = dispatch(state, { type: 'text', text: `${PIKACHU}\n${ANCIENT}` })
  state = validate(state)
  assert.equal(reviewedImportPayload(state), null, 'the accepted illegal card cannot become a raw import by deletion and re-entry')
})

test('accepting a second fix on the same line cannot overwrite the first fix’s illegal-card provenance', () => {
  let state = dispatch(initialImportReview(), { type: 'text', text: `${PIKACHU}\n${MYSTERY}` })
  state = validate(state)
  state = dispatch(state, { type: 'accept', revision: state.revision, fixes: [candidate(state, 1)] })
  const correctedId = state.lineIds[1]
  state = dispatch(state, { type: 'text', text: `${PIKACHU}\n${ANCIENT}\n${ANCIENT}` })
  state = dispatch(state, { type: 'undo', lineId: correctedId })
  assert.equal(state.text, `${PIKACHU}\n${MYSTERY}\n${ANCIENT}`)
  state = validate(state)
  const legalAlternative: DeckImportFix = {
    ...candidate(state, 1), replacement: IONO,
    card: { id: 'iono', name: 'Iono', set: 'PAL', number: '185' },
  }
  state = dispatch(state, { type: 'accept', revision: state.revision, fixes: [legalAlternative] })
  assert.equal(state.text, `${PIKACHU}\n${IONO}\n${ANCIENT}`)
  assert.deepEqual(state.corrections.get(correctedId)?.map(fix => fix.card.id), ['ancient', 'iono'])
  state = validate(state)
  assert.equal(reviewedImportPayload(state), null, 'the duplicate of accepted illegal A still blocks import after B replaces that line')
  state = dispatch(state, { type: 'undo', lineId: correctedId })
  assert.equal(state.text, `${PIKACHU}\n${MYSTERY}\n${ANCIENT}`, 'Undo reverses the latest active fix B')
  assert.deepEqual(state.corrections.get(correctedId)?.map(fix => fix.card.id), ['ancient', 'iono'])
})

test('trimming whitespace around a corrected line preserves its own Undo', () => {
  let state = dispatch(initialImportReview(), { type: 'text', text: `${PIKACHU}\n  ${TYPO}  ` })
  state = validate(state)
  state = dispatch(state, { type: 'accept', revision: state.revision, fixes: [candidate(state, 1)] })
  const correctedId = state.lineIds[1]
  assert.equal(state.text, `${PIKACHU}\n  ${IONO}  `)
  state = dispatch(state, { type: 'text', text: `${PIKACHU}\n${IONO}` })
  assert.equal(state.lineIds[1], correctedId)
  assert.ok(state.corrections.has(correctedId))
  state = dispatch(state, { type: 'undo', lineId: correctedId })
  assert.equal(state.text, `${PIKACHU}\n${TYPO}`)
  state = validate(state)
  assert.equal(reviewedImportPayload(state), null)
})

test('a late fix and a second same-revision validation cannot reuse old approval', () => {
  let state = dispatch(initialImportReview(), { type: 'text', text: `${PIKACHU}\n${TYPO}` })
  state = validate(state)
  const staleFix = candidate(state, 1)
  const staleRevision = state.revision
  state = dispatch(state, { type: 'text', text: `${PIKACHU}\n${MYSTERY}` })
  const rejected = dispatch(state, { type: 'accept', revision: staleRevision, fixes: [staleFix] })
  assert.equal(rejected, state, 'a fix from a prior text revision must not mutate current text')
  state = validate(state)
  state = dispatch(state, renderedSkip(state))
  assert.ok(reviewedImportPayload(state))

  const newlyUnresolved = serverSummary(state.text, state.formatCode)
  newlyUnresolved.unresolvedLines = [...newlyUnresolved.unresolvedLines, TYPO]
  state = dispatch(state, { type: 'validated', revision: state.revision, summary: newlyUnresolved })
  assert.equal(reviewedImportPayload(state), null, 'a newly reported unmatched line requires fresh review')
  state = dispatch(initialImportReview(), { type: 'format', formatCode: 'expanded' })
  state = dispatch(state, { type: 'text', text: `${PIKACHU}\n${MYSTERY}` })
  state = validate(state)
  state = dispatch(state, { type: 'accept', revision: state.revision, fixes: [candidate(state, 1)] })
  state = dispatch(state, { type: 'text', text: `${PIKACHU}\n${ANCIENT}\n${TYPO}` })
  state = validate(state)
  state = dispatch(state, renderedSkip(state))
  assert.ok(reviewedImportPayload(state))
  const newlyIllegal = serverSummary(state.text, state.formatCode)
  newlyIllegal.formatIssues = [{ cardId: 'ancient', reason: 'Not legal in this format' }]
  state = dispatch(state, { type: 'validated', revision: state.revision, summary: newlyIllegal })
  assert.equal(reviewedImportPayload(state), null, 'a newly reported format issue blocks the old skip')
})

test('a Skip intent painted before a same-revision check discovers another unmatched line is rejected', () => {
  let state = dispatch(initialImportReview(), { type: 'text', text: `${PIKACHU}\n${TYPO}\n${MYSTERY}` })
  const partial = serverSummary(state.text, state.formatCode)
  partial.unresolvedLines = [TYPO]
  partial.unresolved = [TYPO]
  state = dispatch(state, { type: 'validated', revision: state.revision, summary: partial })
  const paintedSkip = renderedSkip(state)
  assert.equal(paintedSkip.lineIds.length, 1)

  state = validate(state)
  assert.equal(deriveImportReview(state).unresolved.length, 2)
  const rejected = dispatch(state, paintedSkip)
  assert.equal(rejected, state, 'the old button intent cannot confirm an unseen line')
  assert.equal(reviewedImportPayload(state), null)
  state = dispatch(state, renderedSkip(state))
  assert.ok(reviewedImportPayload(state), 'a new explicit Skip for both lines allows import')
})

test('editing or deleting an unresolved line revokes skip; delayed validation cannot approve a new revision', () => {
  let state = dispatch(initialImportReview(), { type: 'text', text: `${PIKACHU}\n${TYPO}` })
  state = validate(state)
  state = dispatch(state, renderedSkip(state))
  assert.ok(reviewedImportPayload(state))
  const oldRevision = state.revision
  const oldSummary = serverSummary(state.text, state.formatCode)
  state = dispatch(state, { type: 'text', text: `${PIKACHU}\n${MYSTERY}` })
  state = dispatch(state, { type: 'validated', revision: oldRevision, summary: oldSummary })
  assert.equal(reviewedImportPayload(state), null)
  state = validate(state)
  assert.equal(reviewedImportPayload(state), null)
  state = dispatch(state, renderedSkip(state))
  assert.ok(reviewedImportPayload(state))
  state = dispatch(state, { type: 'text', text: PIKACHU })
  assert.equal(reviewedImportPayload(state), null)
  state = validate(state)
  assert.ok(reviewedImportPayload(state), 'a newly checked fully matched list needs no skip')
})

test('seeded action sequences preserve the write gate and unrelated line identities after every step', () => {
  let seed = 0x256c0de
  const random = (maximum: number): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed % maximum
  }
  const actions = ['paste', 'edit', 'blank', 'duplicate', 'delete', 'accept', 'undo', 'skip', 'format', 'validate', 'late'] as const
  const seen = new Set<string>()
  const lines = [PIKACHU, IONO, ANCIENT, TYPO, MYSTERY, '  ', '']
  const exercised = { accept: 0, undo: 0, skip: 0, import: 0 }
  for (let run = 0; run < 100; run++) {
    seed = (0x256c0de ^ Math.imul(run + 1, 0x9e3779b9)) >>> 0
    let state = initialImportReview()
    let delayed: { revision: number; summary: DeckImportSummary } | null = null
    for (let step = 0; step < 200; step++) {
      const kind = actions[random(actions.length)]
      seen.add(kind)
      // When a user reaches a button that is currently unavailable, drive the
      // real paste/check actions that make it available before taking the
      // chosen action. This keeps the random run from being mostly no-ops.
      if (kind === 'accept' && (!deriveImportReview(state).current || !deriveImportReview(state).unresolved.length)) {
        state = dispatch(state, { type: 'text', text: `${PIKACHU}\n${TYPO}` })
        state = validate(state)
      }
      if (kind === 'undo' && deriveImportReview(state).corrections.length === 0) {
        state = dispatch(state, { type: 'text', text: `${PIKACHU}\n${TYPO}` })
        state = validate(state)
        state = dispatch(state, { type: 'accept', revision: state.revision, fixes: [candidate(state, 1)] })
        exercised.accept++
      }
      if (kind === 'skip' && !deriveImportReview(state).canSkip) {
        state = dispatch(state, { type: 'text', text: `${PIKACHU}\n${TYPO}` })
        state = validate(state)
      }
      const before = state
      const current = state.text.split('\n')
      let action: ImportReviewAction
      switch (kind) {
        case 'paste': action = { type: 'text', text: Array.from({ length: 1 + random(5) }, () => lines[random(lines.length)]).join('\n') }; break
        case 'edit': {
          current[random(current.length)] = lines[random(lines.length)]
          action = { type: 'text', text: current.join('\n') }; break
        }
        case 'blank': current.splice(random(current.length + 1), 0, random(2) ? '' : '  '); action = { type: 'text', text: current.join('\n') }; break
        case 'duplicate': current.splice(random(current.length + 1), 0, current[random(current.length)]); action = { type: 'text', text: current.join('\n') }; break
        case 'delete': current.splice(random(current.length), 1); action = { type: 'text', text: current.join('\n') }; break
        case 'accept': {
          const unresolved = deriveImportReview(state).unresolved
          const row = unresolved.length ? unresolved[random(unresolved.length)] : null
          action = { type: 'accept', revision: state.revision, fixes: row ? [candidate(state, row.lineIndex)] : [] }; break
        }
        case 'undo': {
          const active = deriveImportReview(state).corrections
          action = { type: 'undo', lineId: active[random(active.length)]?.lineId ?? 'missing' }; break
        }
        case 'skip': action = renderedSkip(state); break
        case 'format': action = { type: 'format', formatCode: random(2) ? 'standard' : 'expanded' }; break
        case 'validate': delayed = { revision: state.revision, summary: serverSummary(state.text, state.formatCode) }; action = { type: 'validated', ...delayed }; break
        case 'late': action = delayed ? { type: 'validated', ...delayed } : { type: 'start' }; break
      }
      state = dispatch(state, action)
      if (action.type === 'accept' && state.revision > before.revision && state.text !== before.text) exercised.accept++
      if (action.type === 'undo' && state.revision > before.revision && state.text !== before.text) exercised.undo++
      if (action.type === 'skip' && !before.skipped && state.skipped) exercised.skip++
      if (reviewedImportPayload(state)) exercised.import++
      if (state.revision !== before.revision && random(4) !== 0 && (action.type === 'text' || action.type === 'format' || action.type === 'accept' || action.type === 'undo')) {
        if (random(3) === 0) delayed = { revision: before.revision, summary: serverSummary(before.text, before.formatCode) }
        state = validate(state)
        if (reviewedImportPayload(state)) exercised.import++
      }
      if (action.type !== 'text' || action.text === before.text) continue
      const oldLines: string[] = before.text.split('\n').map(line => line.trim())
      const newLines: string[] = state.text.split('\n').map(line => line.trim())
      for (const [oldIndex, line] of oldLines.entries()) {
        if (oldLines.filter(item => item === line).length !== 1 || newLines.filter(item => item === line).length !== 1) continue
        const newIndex = newLines.indexOf(line)
        assert.equal(state.lineIds[newIndex], before.lineIds[oldIndex], `untouched unique line identity changed after ${kind}`)
      }
    }
  }
  assert.deepEqual([...seen].sort(), [...actions].sort())
  assert.ok(exercised.accept > 100, `successful accepts: ${exercised.accept}`)
  assert.ok(exercised.undo > 100, `successful Undos: ${exercised.undo}`)
  assert.ok(exercised.skip > 100, `successful skips: ${exercised.skip}`)
  assert.ok(exercised.import > 100, `import-ready states: ${exercised.import}`)
})

test('unknown GLC type keeps accepted Pokémon pending through whitespace and duplicate edits', () => {
  let state = importReviewReducer(initialImportReview(), { type: 'text', text: '1 Squirtle SVI 999' })
  state = importReviewReducer(state, { type: 'start' })
  state = importReviewReducer(state, { type: 'validated', revision: state.revision,
    summary: { ...serverSummary(TYPO, 'expanded'), unresolvedLines: ['1 Squirtle SVI 999'] } })
  state = importReviewReducer(state, { type: 'accept', revision: state.revision, fixes: [{
    lineIndex: 0, original: '1 Squirtle SVI 999', replacement: '1 Squirtle SVI 54',
    card: { id: 'squirtle', name: 'Squirtle', set: 'SVI', number: '54' }, reason: 'Correct number', confidence: 'suggested',
  }] })
  state = importReviewReducer(state, { type: 'format', formatCode: 'glc' })
  const summary = { ...serverSummary(IONO, 'expanded'), glcType: null, pendingTypeCardIds: ['squirtle'] }
  for (const text of ['1 Squirtle SVI 54\n1 Bulbasaur SVI 1', '\n1 Squirtle SVI 54\n1 Squirtle SVI 54\n1 Bulbasaur SVI 1', '1 Squirtle SVI 54\n1 Bulbasaur SVI 1']) {
    state = importReviewReducer(state, { type: 'text', text })
    state = importReviewReducer(state, { type: 'validated', revision: state.revision, summary })
    const review = deriveImportReview(state)
    assert.equal(review.canAct, false)
    assert.equal(review.canSkip, false)
    assert.equal(reviewedImportPayload(state), null)
    assert.deepEqual(review.pendingTypeCardIds, ['squirtle'])
    assert.match(review.issues[0].reason, /GLC type is unknown/)
  }
  state = importReviewReducer(state, { type: 'text', text: '1 Squirtle SVI 54' })
  assert.equal(reviewedImportPayload(state), null, 'one-type text still needs its own check')
  state = importReviewReducer(state, { type: 'validated', revision: state.revision,
    summary: { ...summary, glcType: 'Water', pendingTypeCardIds: [] } })
  assert.ok(reviewedImportPayload(state), 'a validated Water correction can import')
})
