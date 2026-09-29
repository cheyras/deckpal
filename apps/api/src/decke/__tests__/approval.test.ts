/**
 * Which writes need permission, and which calls are incapable of writing.
 *
 * This is a safety control, so it is tested as one: not "does the happy path
 * work" but "is there any input for which this says no-approval-needed and the
 * tool then mutates something".
 *
 * The reason it is a control at all, rather than a prompt line, is recorded
 * twice in this codebase in the same words — "a prompt is not an enforcement
 * mechanism" — once about `click` and once about trying to stop a model
 * repeating itself by asking it not to.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { allTools, type ToolDefinition } from '@deckpal/agent-tools'
import { buildDataTools, forcePreview, requiresApproval, wouldMutate } from '../adapters/aisdk.js'

/** The conversational tool set, writes included, as api/chat.mjs builds it. */
const buildDataToolsForTest = () =>
  buildDataTools({
    pool: null as never,
    userId: 'u1',
    jwt: 'j',
    apiBase: 'https://x.test/api',
    include: () => true,
  })

const byName = new Map(allTools().map((d) => [d.name, d]))
const get = (n: string): ToolDefinition => {
  const d = byName.get(n)
  assert.ok(d, `${n} is not a tool any more — this test needs updating deliberately`)
  return d
}

test('every destructive tool needs approval, on every input, including a preview', () => {
  const destructive = allTools().filter((d) => d.annotations.destructiveHint)
  assert.equal(destructive.length, 4, 'the destructive set changed size')

  for (const d of destructive) {
    for (const input of [{}, { dry_run: true }, { dry_run: false }, null, undefined]) {
      assert.equal(
        requiresApproval(d, input),
        true,
        `${d.name} destroys data that is not otherwise recoverable and must always ask`,
      )
    }
  }
})

test('a read never needs approval', () => {
  for (const d of allTools().filter((x) => x.annotations.readOnlyHint)) {
    assert.equal(requiresApproval(d, { anything: true }), false, `${d.name} is a read`)
    assert.equal(wouldMutate(d, { dry_run: false }), false, `${d.name} cannot mutate`)
  }
})

test('a preview needs no approval; the real write does', () => {
  const logCards = get('log_cards')
  assert.equal(requiresApproval(logCards, { dry_run: true }), false)
  assert.equal(requiresApproval(logCards, {}), false, 'omitted dry_run is a preview')
  assert.equal(requiresApproval(logCards, { dry_run: false }), true)
})

test('ONLY an explicit boolean false is read as permission to write', () => {
  // The inputs a model actually produces when it stringifies a boolean, or
  // half-fills a field. Every one of them must land on the safe side.
  const logCards = get('log_cards')
  for (const dry of ['false', 'FALSE', 0, null, undefined, '', NaN, [], {}]) {
    assert.equal(
      wouldMutate(logCards, { dry_run: dry }),
      false,
      `dry_run: ${JSON.stringify(dry)} was read as permission to write`,
    )
  }
  assert.equal(wouldMutate(logCards, { dry_run: false }), true)
})

test('a write tool with NO dry_run always needs approval', () => {
  // One of them now: a guide replace has no meaningful "what would change"
  // short of the whole guide, so a preview is not expressible and every call is
  // a real write. This falls out of the rule rather than being a special case,
  // which is why the rule is written the way it is. (`add_battle_log` and
  // `edit_battle_log` left this set in the 2026-08-29 agentic pass when they
  // gained a real dry_run — their previewability pins live in aisdk.test.ts.)
  // THE WRITE SHAPE, which is what "every call is a real write" was ever about:
  // `deck_strategy` writes only when it carries `markdown`. The markdown-LESS
  // shape is a pure read by the tool's own contract — it returns the guide and
  // returns before the PUT — and asking the reader to authorise a call that
  // cannot write is misleading consent, so it left this rule on 2026-08-29.
  // See `wouldMutate`'s carve-out and the read-shape pin in aisdk.test.ts.
  for (const n of ['deck_strategy']) {
    const d = get(n)
    assert.equal(d.inputSchema && 'dry_run' in d.inputSchema.shape, false, `${n} gained a dry_run`)
    assert.equal(requiresApproval(d, { deck_id: 'd1', markdown: '# Guide' }), true)
    assert.equal(
      requiresApproval(d, { deck_id: 'd1', markdown: '# Guide', dry_run: true }),
      true,
      `${n} has no dry_run to honour`,
    )
  }
  // And the two that left the set: they HAVE a dry_run now (defaulting to TRUE),
  // so they classify exactly like log_cards — omitted dry_run is a PREVIEW
  // (forcePreview makes it one), and only an explicit `dry_run: false` is the
  // write that asks. The SDK applies zod defaults BEFORE classification, so
  // an omitted dry_run now arrives as true (preview) — the raw-{} pin below
  // and the real flow agree (wouldMutate returns false for both true and undefined;
  // only an explicit false is a mutation).
  //
  // The real-write pin passes deck_id: add_battle_log with NO deck_id is a
  // pure read (the tool's omitted-deck branch calls log-preview and writes
  // nothing — see the dedicated test below), so without deck_id the dry_run
  // flag is irrelevant and the call cannot ask. deck_id makes it the write.
  for (const n of ['add_battle_log', 'edit_battle_log']) {
    const d = get(n)
    assert.equal(d.inputSchema && 'dry_run' in d.inputSchema.shape, true, `${n} lost its dry_run`)
    assert.equal(requiresApproval(d, {}), false, `${n}: omitted dry_run is a preview`)
    assert.equal(requiresApproval(d, { deck_id: 'x', dry_run: false }), true, `${n}: the real write asks`)
  }
})

test('add_battle_log with NO deck_id is a pure read — no approval, even with dry_run false', () => {
  // SECURITY FINDING (A): add_battle_log called WITHOUT deck_id ranks the log
  // against the caller's decks and writes nothing — the handler's omitted-deck
  // branch (deckIntel.ts: "OMIT deck_id … writes nothing"). It takes that
  // branch before dry_run is consulted, so dry_run is irrelevant to whether it
  // mutates. Classifying on dry_run alone would have shown a consent dialog for
  // a call that cannot write whenever dry_run was false — misleading consent.
  // The fix is name-scoped to add_battle_log; edit_battle_log requires deck_id.
  //
  // deck_id: '' is treated as absent too: presentRef (entities.ts:155–159) trims
  // and normalizes '' to undefined, and wouldMutate's `!(input)?.deck_id` mirrors
  // that (`!''` is true), so an empty deck_id stays on the read path — the handler
  // resolves it via needDeck → presentRef('') → undefined → not-found, never writes.
  const add = get('add_battle_log')
  // The reader's actual call shape: a pasted log, no deck picked yet.
  assert.equal(requiresApproval(add, { log: 'RAW LOG' }), false, 'no deck_id → read, no dialog')
  // dry_run:false does NOT flip it back to a write — there is no deck to write to.
  assert.equal(requiresApproval(add, { log: 'RAW LOG', dry_run: false }), false, 'no deck_id → still a read')
  // And it cannot mutate, which is what the dialog exists to prevent.
  assert.equal(wouldMutate(add, { log: 'RAW LOG', dry_run: false }), false)
  // deck_id: '' — presentRef normalizes it to absent (entities.ts:155–159), so the
  // classifier treats it the same as omitted: no approval, cannot write.
  assert.equal(requiresApproval(add, { deck_id: '', log: 'RAW LOG' }), false, "deck_id: '' → read, no dialog")
  assert.equal(wouldMutate(add, { deck_id: '', log: 'RAW LOG', dry_run: false }), false, "deck_id: '' → cannot write even with dry_run: false")
  // deck_id GIVEN → back to the ordinary dry_run rule: false is the real write.
  assert.equal(requiresApproval(add, { deck_id: 'x', log: 'RAW LOG', dry_run: false }), true)
})

test('a call classified as a preview is FORCED to be one', () => {
  // The classification and the coercion must agree by construction. There must
  // be no path where this code decided "preview, no approval needed" and the
  // tool then received arguments that mutate — including if a default changes.
  const logCards = get('log_cards')
  const forced = forcePreview(logCards, { items: [{ id: 'me05-001', qty: 1 }] }) as {
    dry_run: unknown
  }
  assert.equal(forced.dry_run, true)

  const overridden = forcePreview(logCards, { dry_run: false }) as { dry_run: unknown }
  assert.equal(overridden.dry_run, true, 'forcePreview must override, not merge politely')
})

test('the invariant, over every tool and every plausible input', () => {
  // The property that actually matters, stated once: if a call does not require
  // approval, then after `forcePreview` it cannot mutate.
  const inputs: unknown[] = [
    {},
    { dry_run: true },
    { dry_run: false },
    { dry_run: 'false' },
    { dry_run: 0 },
    null,
    undefined,
  ]
  for (const d of allTools()) {
    for (const input of inputs) {
      if (requiresApproval(d, input)) continue
      const effective = forcePreview(d, input)
      assert.equal(
        wouldMutate(d, effective),
        false,
        `${d.name} with ${JSON.stringify(input)} needed no approval and could still write`,
      )
    }
  }
})

test('forcePreview leaves reads alone', () => {
  const search = get('search_cards')
  const input = { q: 'charizard' }
  assert.deepEqual(forcePreview(search, input), input)
})

test('the only deep tool is read-only web research and raises no approval', async () => {
  const { buildDeepTools } = await import('../deep.js')
  const deep = buildDeepTools({
    ctx: { pool: null as never, userId: 'u1', jwt: 'j', apiBase: 'https://x.test/api' },
    gateway: (() => {}) as never,
    charge: async () => ({ allowed: true, cap: 10 }),
  }) as Record<string, { needsApproval?: unknown }>
  assert.deepEqual(Object.keys(deep), ['web_research'])
  const policy = deep.web_research?.needsApproval
  assert.equal(
    typeof policy === 'function'
      ? (policy as (input: unknown) => boolean)({ query: 'x', topic: 'general', purpose: 'x' })
      : policy === true,
    false,
  )
})

test('`approvals: upstream` is never the default, on any tool', () => {
  // The escape hatch exists for one caller. If it ever became the default, every
  // write in the conversational path would execute unasked — and the tests above
  // would still pass, because they check the policy functions rather than the
  // wiring.
  const conversational = buildDataToolsForTest()
  for (const [name, t] of Object.entries(conversational)) {
    const def = byName.get(name)
    if (!def || def.annotations.readOnlyHint) continue
    assert.notEqual(
      (t as { needsApproval?: unknown }).needsApproval,
      false,
      `${name} can write and would execute without asking`,
    )
  }
})
