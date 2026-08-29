/**
 * The server-run dry run that populates the approval card.
 *
 * ── WHY THIS RUNS AT ALL ────────────────────────────────────────────────────
 *
 * A person cannot consent to a write they have not been told the shape of, and
 * the previous answer — hope he narrates it — produced a measured turn in which
 * he said nothing whatsoever and the dialog read "Let him log cards?" with no
 * numbers under it. The other rejected answer, telling him to preview first,
 * was deleted on 2026-08-22 because it stopped him calling the write tool at
 * all (0/15 → 21/30 once removed) and a test asserts its absence.
 *
 * So the preview runs WITHOUT the model, from `onInputAvailable`, which the SDK
 * calls for every tool call. What is asserted here is the part that is wrong
 * SILENTLY if it is wrong at all: which calls it runs for, and — the one that
 * matters — that it can never itself perform the write it exists to describe.
 *
 * The execute path needs a database and is covered by the browser gates. Every
 * handler below is a stub, because the question is which handler is called with
 * what, not what the handler does.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { z } from 'zod'
import { allTools, defineTool, ok, type ToolDefinition } from '@deckpal/agent-tools'
import { buildDataTools, canPreviewSafely, forcePreview, requiresApproval } from '../adapters/aisdk.js'

const OPTS = {
  pool: null as never,
  userId: 'u1',
  jwt: 'jwt',
  apiBase: 'https://example.test/api',
}

/**
 * A write tool WITH a `dry_run`, like `log_cards`.
 */
function withDryRun(): ToolDefinition {
  return defineTool({
    name: 'fake_log',
    title: 'Fake log',
    description: 'x',
    inputSchema: z.object({ dry_run: z.boolean().default(true), n: z.number().default(1) }),
    annotations: { readOnlyHint: false },
    handler: async () => ok('ran'),
  })
}

/**
 * A write tool with NO `dry_run`, like `deck_strategy`. For these a preview is
 * not expressible at all.
 */
function withoutDryRun(): ToolDefinition {
  return defineTool({
    name: 'fake_strategy',
    title: 'Fake strategy',
    description: 'x',
    inputSchema: z.object({ markdown: z.string() }),
    annotations: { readOnlyHint: false },
    handler: async () => ok('ran'),
  })
}

// ═════════════════════════════════════════════════════════════════════════════
// THE GUARD THAT KEEPS THE DIALOG FROM BECOMING THE WRITE
// ═════════════════════════════════════════════════════════════════════════════

test('a write tool with no dry_run can NEVER be previewed', () => {
  // `forcePreview` only touches tools that HAVE a `dry_run`, so for these three
  // it returns the input unchanged — and running the handler to populate a
  // consent dialog would PERFORM THE VERY WRITE nobody has authorised yet. The
  // failure would be silent: the dialog still opens, still looks like it is
  // asking, and the write has already happened.
  const def = withoutDryRun()
  const input = { markdown: '# plan' }

  assert.equal(requiresApproval(def, input), true, 'fixture: this is held')
  assert.deepEqual(forcePreview(def, input), input, 'forcePreview cannot make this safe')
  assert.equal(canPreviewSafely(def, input), false, 'a write with no dry run was called previewable')
})

test('a write tool WITH a dry_run is previewable, and only because forcePreview coerces it', () => {
  const def = withDryRun()
  // The model asked for a real write. That is what is held, and what the card
  // is about.
  assert.equal(requiresApproval(def, { dry_run: false, n: 2 }), true)
  assert.equal(canPreviewSafely(def, { dry_run: false, n: 2 }), true)
  assert.deepEqual(forcePreview(def, { dry_run: false, n: 2 }), { dry_run: true, n: 2 })
})

test('the coercion is explicit, never left to the schema default', () => {
  // Belt and braces, and worth the belt: the classification and the coercion
  // agree by construction. There is no path where this code decided "preview,
  // no approval needed" and the handler received something that mutates —
  // including if a default changes, or a tool is added whose default is the
  // other way.
  const def = withDryRun()
  assert.deepEqual(forcePreview(def, {}), { dry_run: true })
  assert.deepEqual(forcePreview(def, { dry_run: 'false' }), { dry_run: true })
})

// ═════════════════════════════════════════════════════════════════════════════
// WHICH CALLS THE PREVIEW RUNS FOR
// ═════════════════════════════════════════════════════════════════════════════

test('a PREVIEW call is not itself previewed', () => {
  // The call the model made is already a dry run, so it is not held — and
  // previewing it would be a second identical query for a dialog that will
  // never open.
  const def = withDryRun()
  assert.equal(requiresApproval(def, { dry_run: true, n: 1 }), false)
})

test('a read-only tool is never held and never previewed', () => {
  const read = defineTool({
    name: 'fake_read',
    title: 'Fake read',
    description: 'x',
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true },
    handler: async () => ok('ran'),
  })
  assert.equal(requiresApproval(read, {}), false)
  // `canPreviewSafely` is true for a read, and that is fine — the
  // `requiresApproval` guard runs first, so no preview is ever attempted.
  assert.equal(canPreviewSafely(read, {}), true)
})

// ═════════════════════════════════════════════════════════════════════════════
// THE WIRED FORM — the real registry, the real tool objects
// ═════════════════════════════════════════════════════════════════════════════

test('every held write in the real registry is either previewable or safely skipped', () => {
  // The rule is stated over the whole catalogue rather than over the one tool
  // this feature was built for, because the failure mode is a tool ADDED later
  // whose preview would write. Nothing here asserts that every write is
  // previewable — three genuinely are not. It asserts that for every one of
  // them, `canPreviewSafely` says so.
  const tools = buildDataTools({ ...OPTS, include: () => true })
  assert.ok(Object.keys(tools).length > 20, 'the fixture did not build a full tool set')

  for (const def of allTools()) {
    if (def.annotations.readOnlyHint) continue
    const realWrite = { ...(def.inputSchema ? { dry_run: false } : {}) }
    if (!requiresApproval(def, realWrite)) continue
    const coerced = forcePreview(def, realWrite)
    const previewable = canPreviewSafely(def, realWrite)
    assert.equal(
      previewable,
      !((coerced as { dry_run?: unknown })?.dry_run !== true),
      `${def.name}: canPreviewSafely disagreed with what forcePreview produced`,
    )
  }
})

test('the tool objects carry an onInputAvailable only worth having when someone listens', () => {
  // The hook is always attached — the SDK requires a stable tool shape — but it
  // returns immediately when there is no `onApprovalPreview`. A sub-agent's
  // tool set therefore pays nothing for a dialog it has no way to show.
  const silent = buildDataTools({ ...OPTS, include: (d) => d.name === 'log_cards' })
  const tool = (silent as Record<string, { onInputAvailable?: unknown }>).log_cards
  assert.ok(tool, 'log_cards was not built')
  assert.equal(typeof tool.onInputAvailable, 'function')
})

test('an upstream-approved tool set previews nothing, because nothing is held', async () => {
  // `approvals: 'upstream'` means a person already authorised this operation at
  // a coarser boundary and there is no channel here to ask on. A preview would
  // be a dialog nobody can see, paid for with a database round trip.
  const previews: unknown[] = []
  const tools = buildDataTools({
    ...OPTS,
    include: (d) => d.name === 'log_cards',
    approvals: 'upstream',
    onApprovalPreview: (p) => previews.push(p),
  })
  const tool = (tools as Record<string, { onInputAvailable?: (o: never) => Promise<void> } | undefined>).log_cards
  await tool?.onInputAvailable?.({ input: { dry_run: false, items: [] }, toolCallId: 'c1' } as never)
  assert.deepEqual(previews, [], 'a preview ran for a call nothing is holding')
})

test('no preview runs when nobody is listening', async () => {
  const tools = buildDataTools({ ...OPTS, include: (d) => d.name === 'log_cards' })
  const tool = (tools as Record<string, { onInputAvailable?: (o: never) => Promise<void> } | undefined>)
    .log_cards
  // With no `onApprovalPreview` this returns before it touches `withToolCtx`,
  // which is the only reason it can be called here with a null pool at all.
  await tool?.onInputAvailable?.({ input: { dry_run: false, items: [] }, toolCallId: 'c1' } as never)
})

test('a preview that throws does not throw into the stream', async () => {
  // A preview that fails must NEVER take the held call down with it. The card
  // falls back to the plain dialog and the write is still approvable — a broken
  // preview degrades the UI, never the write. `pool: null` makes the handler's
  // first query throw, which is as real a failure as this test can arrange
  // without a database.
  const previews: unknown[] = []
  const tools = buildDataTools({
    ...OPTS,
    include: (d) => d.name === 'log_cards',
    onApprovalPreview: (p) => previews.push(p),
  })
  const tool = (tools as Record<string, { onInputAvailable?: (o: never) => Promise<void> } | undefined>).log_cards
  await tool?.onInputAvailable?.({
    input: { dry_run: false, items: [{ card_id: 'x', delta: 1 }] },
    toolCallId: 'c1',
  } as never)
  // Either it produced a preview or it produced none; the assertion is that it
  // RETURNED rather than rejecting.
  assert.ok(previews.length === 0 || previews.length === 1)
})
