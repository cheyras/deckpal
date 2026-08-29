/**
 * The AI SDK adapter — the half of it that is a safety control, and the half
 * that decides how much of the database ends up in a model's context.
 *
 * The execute path itself needs a database and is covered by the browser gates.
 * What is asserted here is everything that decides WHICH tools exist and WHAT
 * shape their output reaches the model in — both of which are wrong silently if
 * they are wrong at all.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { allTools } from '@deckpal/agent-tools'
import {
  DEFAULT_MAX_TOOL_CHARS,
  buildDataTools,
  canPreviewSafely,
  clampToolText,
  dataToolSummary,
  requiresApproval,
  safeToolError,
  wouldMutate,
} from '../adapters/aisdk.js'

/** Enough of the options to build a tool set; nothing here ever executes. */
const OPTS = {
  pool: null as never,
  userId: 'u1',
  jwt: 'jwt',
  apiBase: 'https://example.test/api',
}

test('the default tool set is read-only, and that is derived from the annotation', () => {
  const names = Object.keys(buildDataTools(OPTS))
  const byName = new Map(allTools().map((d) => [d.name, d]))

  assert.ok(names.length > 0, 'no data tools were exposed at all')
  for (const n of names) {
    assert.equal(
      byName.get(n)?.annotations.readOnlyHint,
      true,
      `${n} is exposed to the conversational model but is not annotated read-only`,
    )
  }
})

test('not one write tool is reachable before the approval flow exists', () => {
  const names = new Set(Object.keys(buildDataTools(OPTS)))
  const writes = allTools().filter((d) => !d.annotations.readOnlyHint)

  assert.ok(writes.length > 0, 'the fixture is wrong — there should be write tools to exclude')
  for (const w of writes) {
    assert.equal(names.has(w.name), false, `${w.name} can write and is exposed`)
  }
  // Named explicitly, because these four can destroy data that is not otherwise
  // recoverable and their absence should fail loudly if it ever changes.
  for (const n of ['delete_deck', 'delete_list', 'delete_battle_log', 'revert']) {
    assert.equal(names.has(n), false, `${n} is destructive and is exposed`)
  }
})

test('the filter reads the annotation, not the verb in the name', () => {
  const names = new Set(Object.keys(buildDataTools(OPTS)))
  // The two that would be classified wrongly by their names. `set_cart` only
  // composes an outbound TCGplayer URL and never contacts TCGplayer;
  // `deck_history` can roll a deck back.
  assert.equal(names.has('set_cart'), true, 'set_cart is a read and should be available')
  assert.equal(names.has('deck_history'), false, 'deck_history can revert a deck')
})

test('a narrower include is honoured — a sub-agent gets a subset', () => {
  // A research sub-agent must never hold a write tool, and the way to guarantee
  // that is to not hand it one.
  const only = buildDataTools({ ...OPTS, include: (d) => d.name === 'search_cards' })
  assert.deepEqual(Object.keys(only), ['search_cards'])
})

test('the prompt summary matches the tools actually built', () => {
  // These two must not drift: the prompt tells him what he has, and the tool
  // set is what he has. A prompt that names a tool he does not hold is the bug
  // this whole area exists to fix, in a new place.
  const built = Object.keys(buildDataTools(OPTS)).sort()
  const summarised = dataToolSummary()
    .map((t) => t.name)
    .sort()
  assert.deepEqual(summarised, built)
  for (const t of dataToolSummary()) {
    assert.ok(t.title.length > 0, `${t.name} has no title to show`)
  }
})

test('output under the ceiling is returned untouched', () => {
  const text = 'Charizard ex | me05-84 | Double Rare | holo x2 | $31.20'
  assert.equal(clampToolText(text, DEFAULT_MAX_TOOL_CHARS), text)
})

test('truncation ANNOUNCES itself — a silent cut is a new way to lie', () => {
  const rows = Array.from({ length: 400 }, (_, i) => `Card ${i} | me05-${i} | Common | $0.10`)
  const out = clampToolText(rows.join('\n'), 500)

  assert.ok(out.length < rows.join('\n').length, 'nothing was cut')
  // A model handed a quietly shortened list will describe it as the whole list,
  // which is exactly the class of confident-claim-about-unseen-data being fixed.
  assert.match(out, /Cut off here/)
  assert.match(out, /NOT the whole result/)
  assert.match(out, /do not describe it as complete/)
  // And it says how much it kept, so he can say so too.
  assert.match(out, /showing \d+ of 400 lines/)
})

test('the cut lands on a line boundary — half a row reads as data and is not', () => {
  const rows = Array.from({ length: 100 }, (_, i) => `Card ${i} | me05-${i} | Common | $0.10`)
  const out = clampToolText(rows.join('\n'), 500)
  const body = out.slice(0, out.indexOf('\n\n[Cut off here'))
  for (const line of body.split('\n')) {
    assert.match(line, /\| \$\d/, `a row was cut mid-way: ${JSON.stringify(line)}`)
  }
})

test('a ceiling of 0 disables truncation, for the tier that wants everything', () => {
  const big = 'x'.repeat(50_000)
  assert.equal(clampToolText(big, 0), big)
})

test('a single enormous line is still cut rather than passed through', () => {
  // No newline to cut on. The line-boundary preference must not become a way to
  // bypass the ceiling entirely.
  const oneLine = 'y'.repeat(20_000)
  const out = clampToolText(oneLine, 1_000)
  assert.ok(out.length < oneLine.length)
  assert.match(out, /Cut off here/)
})

test('a failed tool never leaks a driver message into the conversation', () => {
  // A tool error is NOT a log line — it goes into the model's context, and the
  // model may say it out loud. So the bar is higher than for a log, not lower.
  //
  // A `pg` connection failure's message is built from the connection
  // parameters, and `openRlsSession` runs inside the very first `db.query` a
  // tool makes. Passing that through would put database credentials one "what
  // went wrong?" away from a chat transcript. CodeQL caught the sibling case
  // (the same error being logged) on this branch.
  const pgish = Object.assign(new Error('password authentication failed for user "deckpal"'), {
    code: '28P01',
  })
  const out = safeToolError(pgish)
  assert.equal(out.includes('password'), false)
  assert.equal(out.includes('deckpal'), false)
  assert.match(out, /28P01/, 'the code is what is diagnostic and is safe to say')

  const dsn = Object.assign(new Error('connect ECONNREFUSED 10.1.2.3:5432'), {
    code: 'ECONNREFUSED',
  })
  assert.equal(safeToolError(dsn).includes('10.1.2.3'), false)

  // No code at all — say nothing rather than guess what is safe in the text.
  assert.equal(safeToolError(new Error('postgres://user:hunter2@host/db')), 'it failed')
  assert.equal(safeToolError('some string'), 'it failed')
  assert.equal(safeToolError(null), 'it failed')
})

test('our own deliberate errors DO pass through, because they were written to be said', () => {
  // Allowlisted by CLASS, not by inspecting the text — a check on the message
  // would pass anything that happened to look friendly.
  const timeout = Object.assign(new Error('that lookup went past 10000 ms, so I stopped waiting for it'), {
    name: 'ToolHoldTimeout',
  })
  assert.match(safeToolError(timeout), /stopped waiting/)
  assert.equal(safeToolError(new Error('aborted')), 'aborted')
})

// ── add_battle_log / edit_battle_log are now PREVIEWABLE (they gained dry_run)
//
// The classification is schema-driven: `wouldMutate` / `forcePreview` /
// `canPreviewSafely` all key off `'dry_run' in def.inputSchema.shape`. Once
// those two tools carry a `dry_run`, the SDK's forced-dry-run approval preview
// path can populate their approval cards the way it does for any other dry_run
// write — `forcePreview` flips dry_run to true, the handler writes nothing, and
// `canPreviewSafely` returns true. `deck_strategy` is the lone write with no
// dry_run, so it stays unpreviewable and always needs approval. The editable
// hard-code in `buildApprovalPreview` is unchanged (editable stays log_cards).

test('add_battle_log and edit_battle_log are previewable now that they have dry_run', () => {
  const byName = (n: string) => allTools().find((d) => d.name === n)!
  const add = byName('add_battle_log')
  const edit = byName('edit_battle_log')

  // A real write (explicit dry_run:false) still needs the reader to approve it.
  assert.equal(requiresApproval(add, { deck_id: 'x', log: 'L', dry_run: false }), true)
  assert.equal(requiresApproval(edit, { deck_id: 'x', log_id: 1, result: 'win', dry_run: false }), true)

  // …but it CAN be previewed safely: forcePreview flips dry_run to true, so the
  // handler writes nothing, and the approval card is populated from that dry run.
  assert.equal(canPreviewSafely(add, { deck_id: 'x', log: 'L', dry_run: false }), true)
  assert.equal(canPreviewSafely(edit, { deck_id: 'x', log_id: 1, result: 'win', dry_run: false }), true)

  // A preview (dry_run omitted OR true) needs no approval and is previewable.
  // The SDK applies zod defaults BEFORE classification: an omitted dry_run now
  // arrives as true (preview), so { log: 'L' } classifies the same as
  // { log: 'L', dry_run: true } — both are previews.
  assert.equal(requiresApproval(add, { log: 'L' }), false, 'omitted dry_run → preview, no approval')
  assert.equal(requiresApproval(add, { deck_id: 'x', log: 'L', dry_run: true }), false)
  assert.equal(canPreviewSafely(add, { log: 'L' }), true)
  assert.equal(canPreviewSafely(edit, { deck_id: 'x', log_id: 1, result: 'win', dry_run: true }), true)
})

test('deck_strategy still has no dry_run — never previewable, always needs approval', () => {
  const byName = (n: string) => allTools().find((d) => d.name === n)!
  const strat = byName('deck_strategy')

  // No dry_run in the schema → forcePreview leaves the input untouched and
  // wouldMutate stays true, so the handler would perform the very write the
  // reader has not authorised. canPreviewSafely must refuse it.
  assert.equal(canPreviewSafely(strat, { deck_id: 'x', markdown: 'guide' }), false)
  assert.equal(requiresApproval(strat, { deck_id: 'x', markdown: 'guide' }), true)
})

test('add_battle_log with NO deck_id is a read — no approval even with dry_run false', () => {
  // SECURITY FINDING (A): the omitted-deck_id branch calls log-preview and
  // writes nothing, before dry_run is consulted. So dry_run:false must NOT be
  // read as permission to write when there is no deck_id to write to. The
  // special case is name-scoped to add_battle_log; edit_battle_log requires
  // deck_id and is unaffected (pinned below to stay that way).
  const byName = (n: string) => allTools().find((d) => d.name === n)!
  const add = byName('add_battle_log')

  // The reader's real shape: a pasted log, deck not yet chosen.
  assert.equal(requiresApproval(add, { log: 'RAW LOG' }), false)
  assert.equal(requiresApproval(add, { log: 'RAW LOG', dry_run: false }), false, 'no deck_id → read regardless of dry_run')

  // deck_id given → the ordinary dry_run rule applies again.
  assert.equal(requiresApproval(add, { deck_id: 'x', log: 'RAW LOG', dry_run: false }), true)
  assert.equal(canPreviewSafely(add, { deck_id: 'x', log: 'RAW LOG', dry_run: false }), true)

  // deck_id: '' — presentRef (entities.ts:155–159) normalizes '' to undefined,
  // and wouldMutate's `!(input)?.deck_id` treats it as absent (`!''` is true).
  // The handler resolves it via needDeck → presentRef('') → not-found, never writes.
  assert.equal(requiresApproval(add, { deck_id: '', log: 'RAW LOG' }), false, "deck_id: '' → read, no approval")
  assert.equal(wouldMutate(add, { deck_id: '', log: 'RAW LOG', dry_run: false }), false, "deck_id: '' → cannot write even with dry_run: false")

  // edit_battle_log has NO such read branch and must keep classifying on dry_run
  // alone — the carve-out did not leak across to it.
  const edit = byName('edit_battle_log')
  assert.equal(requiresApproval(edit, { log_id: 1, dry_run: false }), true, 'edit_battle_log still asks on a real write')
})
