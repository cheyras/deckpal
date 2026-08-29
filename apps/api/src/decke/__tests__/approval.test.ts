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
  for (const n of ['deck_strategy']) {
    const d = get(n)
    assert.equal(d.inputSchema && 'dry_run' in d.inputSchema.shape, false, `${n} gained a dry_run`)
    assert.equal(requiresApproval(d, {}), true)
    assert.equal(requiresApproval(d, { dry_run: true }), true, `${n} has no dry_run to honour`)
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

  // ── A PREDICATE NOW, NOT A LITERAL `true` ─────────────────────────────────
  //
  // `needsApproval` became `(input) => !alreadyDeclined(name, input)`, so that a
  // call the reader has ALREADY refused raises no second dialog — see
  // `declined.ts` for the complaint that produced it. With no declined set,
  // which is this test's construction and every sub-agent's, it must still
  // answer true for every input.
  //
  // Asserted by CALLING it rather than by relaxing this to "truthy": a function
  // is truthy whatever it returns, so a truthiness check here would pass for a
  // predicate that always said no — which is the unapproved-write bug this test
  // exists to catch, wearing a new coat.
  const asks = (t: { needsApproval?: unknown } | undefined, input: unknown): boolean => {
    const n = t?.needsApproval
    return typeof n === 'function' ? (n as (i: unknown) => boolean)(input) === true : n === true
  }

  assert.ok(
    asks(deep.write_strategy_guide, { deck: 'd1' }),
    'write_strategy_guide stores a guide and must ask the human first',
  )
  // ── AND SO DO THE OTHER THREE, WHICH IS A REVERSAL ────────────────────────
  //
  // This assertion used to be the opposite, and its reason was: "the other three
  // only read. Asking about a read is friction with no safety behind it, and
  // friction people learn to click through is worse than none." That is right
  // about SAFETY and silent about COST.
  //
  // A deep call is not a read. It is a sub-agent with its own model and up to
  // 210 seconds of wall clock; it is the scarcest thing the account has, and
  // under the credit model it is the only thing a reader can run out of.
  // Measured, on camera: asked for "a new deck, doesn't have to be good", he
  // spent one immediately — before the owner had confirmed anything — and then
  // spent another. *"He should verify first and then do the deep question."*
  //
  // The friction argument is answered by what the card SAYS, not by hiding it:
  // it carries his restatement of the request, so the tap confirms a specific
  // piece of work. A confirmation with nothing in it is the one people learn to
  // click through.
  for (const n of ['plan_deck', 'analyze_collection', 'research_meta']) {
    assert.ok(asks(deep[n], { query: 'x' }), `${n} spends the scarcest thing there is and must ask`)
  }
})

test('a call the reader ALREADY declined raises no second dialog — and still does not run', async () => {
  // The reader watched the same `deck_strategy` panel on three consecutive
  // turns having declined it every time, and wrote the complaint into the chat.
  //
  // THE TWO HALVES MUST AGREE. `needsApproval: false` means "raise no dialog",
  // never "run it" — if `execute` stopped checking, this would become a write
  // that executes unasked, which is strictly worse than the nuisance it fixes.
  const { buildDeepTools } = await import('../deep.js')
  const { callKey } = await import('../repeat.js')

  const input = { query: 'dhelmise meta' }
  const deep = buildDeepTools({
    ctx: { pool: null as never, userId: 'u1', jwt: 'j', apiBase: 'https://x.test/api' },
    gateway: (() => {}) as never,
    charge: async () => {
      throw new Error('a declined call must never be charged')
    },
    declined: new Set([callKey('research_meta', input)]),
  }) as Record<
    string,
    {
      needsApproval?: unknown
      execute?: (a: unknown, c: { toolCallId: string }) => Promise<string>
    }
  >

  const t = deep.research_meta!
  const ask = t.needsApproval as (i: unknown) => boolean
  assert.equal(ask(input), false, 'the refused call must not be put to them again')
  assert.equal(ask({ query: 'something else' }), true, 'a different question must still ask')

  // And it does not run. `charge` throws above, so reaching the body at all
  // would fail this loudly rather than quietly billing a deep call.
  const out = await t.execute!(input, { toolCallId: 'c1' })
  assert.match(out, /already said no/i)
  assert.match(out, /has not run/)
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
