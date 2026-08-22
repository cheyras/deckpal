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
import { forcePreview, requiresApproval, wouldMutate } from '../adapters/aisdk.js'

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
