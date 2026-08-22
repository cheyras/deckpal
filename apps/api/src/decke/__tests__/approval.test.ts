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
  // Three of them: a preview is not expressible, so every call is a real write.
  // This falls out of the rule rather than being a special case, which is why
  // the rule is written the way it is.
  for (const n of ['deck_strategy', 'add_battle_log', 'edit_battle_log']) {
    const d = get(n)
    assert.equal(d.inputSchema && 'dry_run' in d.inputSchema.shape, false, `${n} gained a dry_run`)
    assert.equal(requiresApproval(d, {}), true)
    assert.equal(requiresApproval(d, { dry_run: true }), true, `${n} has no dry_run to honour`)
  }
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

test('a sub-agent NEVER gets a write it cannot have approved for it', async () => {
  // THE BUG THIS PINS. A sub-agent runs inside `streamText`'s own loop with
  // nothing draining an approval channel, so a write tool handed to one is not
  // gated — it is SUSPENDED FOR EVER. The adversarial pass caught exactly this:
  // the sub-agent composed a strategy guide, called `deck_strategy`, the SDK
  // held the call, the sub-agent reported "stored", and nothing was written.
  //
  // Security-positive and functionally a lie, which is the failure this whole
  // effort exists to remove — reintroduced by the mechanism added to prevent a
  // different one.
  //
  // The fix moves the question to a boundary a human can answer, so the two
  // halves must agree: a sub-agent tool set built `upstream` must be reachable
  // ONLY from a deep tool that itself requires approval.
  const { buildDeepTools } = await import('../deep.js')
  const deep = buildDeepTools({
    ctx: { pool: null as never, userId: 'u1', jwt: 'j', apiBase: 'https://x.test/api' },
    gateway: (() => {}) as never,
    charge: async () => ({ allowed: true, cap: 10 }),
  }) as Record<string, { needsApproval?: unknown }>

  assert.equal(
    deep.write_strategy_guide?.needsApproval,
    true,
    'write_strategy_guide stores a guide and must ask the human first',
  )
  // The other three only read. Asking about a read is friction with no safety
  // behind it, and friction people learn to click through is worse than none.
  for (const n of ['plan_deck', 'analyze_collection', 'research_meta']) {
    assert.equal(deep[n]?.needsApproval, undefined, `${n} does not write and must not ask`)
  }
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
