/**
 * A refused deep call does not come back for a second approval in the same turn.
 *
 * ── THE BUG, AND WHY THE EXISTING SUITE WENT GREEN THROUGH IT ────────────────
 *
 * The reader approved `write_strategy_guide`. The daily deep cap was spent, the
 * meter refused it, and `deepOutcome.ts`'s `[[NO_WORK]]` marker worked — he did
 * not narrate a guide that was never written. He then re-read the deck, called
 * the same tool again, and raised a SECOND approval card for identical work,
 * charged against the same spent cap.
 *
 * `buildDeepTools`'s `needsApproval` only ever asked "did the human decline
 * this?", and a meter refusal is not a decline. So every test about refusals
 * passed while the retry loop sat underneath them.
 *
 * ── WHAT IS REAL IN HERE ─────────────────────────────────────────────────────
 *
 * The real `buildDeepTools`, the real `focusedTools`, the real `streamText` and
 * the real `seedMeteredRefusals`. The model is `MockLanguageModelV3` and the
 * meter is a counting stub — those are the two things a test may not have. In
 * particular the replay test builds the UI-message shape `api/chat.mjs` really
 * receives and feeds it to the real seeder, because the closure-only version of
 * this fix passes every other test in this file and leaves the measured bug
 * exactly where it was.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { streamText, stepCountIs } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import type { GatewayProvider } from '@ai-sdk/gateway'
import { buildDeepTools } from '../deep.js'
import { focusedTools } from '../focus.js'
import { isNoWork, meterRefusalScope, deepFailed } from '../deepOutcome.js'
import { DEEP_TOOL_NAMES, seedMeteredRefusals, type MeteredRefusals } from '../meteredRefusals.js'
import type { AiSdkAdapterOptions } from '../adapters/aisdk.js'

/** Enough of a context for the read tools to be constructed; none of them run here. */
const CTX = { db: null, userId: 'reader-1' } as unknown as AiSdkAdapterOptions

/** A gateway that would fail loudly if a sub-agent ever reached it. A refusal must not. */
const NO_PROVIDER = (() => {
  throw new Error('a refused deep call must never invoke a provider')
}) as unknown as GatewayProvider

interface Runnable {
  execute: (args: Record<string, unknown>, o: { toolCallId: string }) => Promise<string>
  needsApproval?: (input: unknown) => boolean | Promise<boolean>
}

type Verdict = { allowed: boolean; cap?: number; credits?: boolean; held?: boolean; balance?: number; needed?: number }

/** The deep tier, built the way `api/chat.mjs` builds it, with a counting meter. */
function tier(o: { verdict: (name: string) => Verdict; refusals?: MeteredRefusals }) {
  const charges: string[] = []
  const tools = buildDeepTools({
    ctx: CTX,
    gateway: NO_PROVIDER,
    charge: async (toolName) => {
      charges.push(toolName)
      return o.verdict(toolName)
    },
    ...(o.refusals ? { refusals: o.refusals } : {}),
  })
  return { tools: tools as unknown as Record<string, Runnable>, charges, raw: tools }
}

const CAP_SPENT = (): Verdict => ({ allowed: false, cap: 10 })
// The real `plan_deck` schema: `idea` is required, and the SDK validates it.
const PLAN = { idea: 'a fun rare deck' }

test('the tool list this fix governs is the tool list the deep tier actually builds', () => {
  const { raw } = tier({ verdict: () => ({ allowed: true }) })
  assert.deepEqual(new Set(Object.keys(raw)), new Set(DEEP_TOOL_NAMES))
})

test('the FIRST cap refusal still asks, still refuses, and now says which limit', async () => {
  const { tools, charges } = tier({ verdict: CAP_SPENT })
  assert.equal(await tools['plan_deck']!.needsApproval!(PLAN), true, 'the first call must still raise a card')
  const out = await tools['plan_deck']!.execute(PLAN, { toolCallId: 'c1' })
  assert.equal(charges.length, 1, 'the first call is charged — a denial path worth exercising')
  assert.ok(isNoWork(out), 'a refusal is still the NO_WORK marker, not a fluent sentence')
  assert.equal(meterRefusalScope(out), 'cap')
  assert.match(out, /today's 10 deep-thinking questions are spent/)
})

test('the SECOND identical call raises no card and never reaches the meter', async () => {
  const { tools, charges } = tier({ verdict: CAP_SPENT })
  await tools['plan_deck']!.execute(PLAN, { toolCallId: 'c1' })

  // THE ORIGINAL BUG, stated as an assertion: this returned `true`.
  assert.equal(await tools['plan_deck']!.needsApproval!(PLAN), false, 'a second approval card for impossible work')

  // AND the execution guard, which is not the same check twice: a model can
  // still emit the call even with no card, and the SDK will still execute it.
  const out = await tools['plan_deck']!.execute(PLAN, { toolCallId: 'c2' })
  assert.equal(charges.length, 1, 'the spent cap was asked a second time for identical work')
  assert.ok(isNoWork(out))
  assert.equal(meterRefusalScope(out), 'cap')
})

test('a spent CAP suppresses the sibling deep tools too — the limit is on the tier', async () => {
  const { tools, charges } = tier({ verdict: CAP_SPENT })
  await tools['plan_deck']!.execute(PLAN, { toolCallId: 'c1' })

  for (const name of ['analyze_collection', 'write_strategy_guide', 'research_meta']) {
    const args = { question: 'what should I build', query: 'standard meta', deck: 'Toolbox', focus: 'sideboard' }
    assert.equal(await tools[name]!.needsApproval!(args), false, `${name} still asked after the tier was spent`)
    assert.ok(isNoWork(await tools[name]!.execute(args, { toolCallId: `x-${name}` })))
  }
  assert.equal(charges.length, 1, 'a spent tier was charged once per sibling tool')
})

test('a held wallet behaves like a spent cap, and says so', async () => {
  const { tools, charges } = tier({ verdict: () => ({ allowed: false, held: true, credits: true }) })
  const first = await tools['plan_deck']!.execute(PLAN, { toolCallId: 'c1' })
  assert.equal(meterRefusalScope(first), 'hold')
  assert.equal(await tools['analyze_collection']!.needsApproval!({ question: 'q' }), false)
  assert.equal(charges.length, 1)
})

test('an INSUFFICIENT-CREDIT refusal blocks the identical call and nothing else', async () => {
  const { tools, charges } = tier({
    verdict: (name) => (name === 'plan_deck' ? { allowed: false, credits: true, balance: 2, needed: 40 } : { allowed: true }),
  })
  const first = await tools['plan_deck']!.execute(PLAN, { toolCallId: 'c1' })
  assert.equal(meterRefusalScope(first), 'credits')

  // The same impossible call: suppressed, both halves.
  assert.equal(await tools['plan_deck']!.needsApproval!(PLAN), false)
  await tools['plan_deck']!.execute(PLAN, { toolCallId: 'c2' })
  assert.equal(charges.length, 1, 'the identical unaffordable call went back to the meter')

  // A DIFFERENT, possibly cheaper deep call is untouched — the brief asks that
  // unrelated affordable capability survive a per-call refusal.
  assert.equal(await tools['analyze_collection']!.needsApproval!({ question: 'q' }), true)
})

test('a credits refusal does NOT take the deep tier out of activeTools; a cap refusal does', async () => {
  const credits = tier({ verdict: () => ({ allowed: false, credits: true, balance: 2, needed: 40 }) })
  // The ledger is the one `chat.mjs` holds, so the two halves are the same object.
  const ledger = seedMeteredRefusals(null)
  const capped = tier({ verdict: CAP_SPENT, refusals: ledger })
  await credits.tools['plan_deck']!.execute(PLAN, { toolCallId: 'c1' })
  await capped.tools['plan_deck']!.execute(PLAN, { toolCallId: 'c1' })

  const all = { ...capped.raw, get_card: {}, search_cards: {} } as never
  const visible = focusedTools(all, 1, (n) => ledger.unavailable(n))
  for (const deep of DEEP_TOOL_NAMES) assert.ok(!visible.includes(deep), `${deep} survived a spent cap`)
  // FREE READS REMAIN. The whole turn is not disabled — only the tier that ran out.
  assert.ok(visible.includes('get_card') && visible.includes('search_cards'))
})

/**
 * A model that speaks, optionally calls `plan_deck`, and records what it was
 * OFFERED on every step — read off the request the provider really receives,
 * not off our belief about what `activeTools` did.
 */
function recordingModel(offered: string[][], callOnFirstStep: boolean) {
  return new MockLanguageModelV3({
    doStream: async (req) => {
      offered.push(((req.tools ?? []) as { name: string }[]).map((t) => t.name))
      const step = offered.length
      const calls = callOnFirstStep && step === 1
      return {
        stream: new ReadableStream({
          start(c) {
            c.enqueue({ type: 'stream-start', warnings: [] })
            c.enqueue({ type: 'text-start', id: '0' })
            c.enqueue({ type: 'text-delta', id: '0', delta: calls ? 'Let me try.' : 'It did not happen.' })
            c.enqueue({ type: 'text-end', id: '0' })
            if (calls) {
              c.enqueue({ type: 'tool-call', toolCallId: 'c1', toolName: 'plan_deck', input: JSON.stringify(PLAN) })
            }
            c.enqueue({
              type: 'finish',
              finishReason: { unified: calls ? ('tool-calls' as const) : ('stop' as const), raw: 'stop' },
              usage: {
                inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
                outputTokens: { total: 1, text: 1, reasoning: 0 },
              },
            })
            // CLOSED. An unclosed mock stream does not fail, it hangs — the
            // same silent non-event `wire.test.ts` bounds its reader against.
            c.close()
          },
        }) as never,
      }
    },
  })
}

/** The replayed history a refused first leg leaves behind, for the next POST to read. */
async function refusedTurn(tool: string, input: Record<string, unknown>) {
  const output = await tier({ verdict: CAP_SPENT }).tools[tool]!.execute(input, { toolCallId: 'c1' })
  return [
    { role: 'user', parts: [{ type: 'text', text: 'plan me a deck' }] },
    {
      role: 'assistant',
      parts: [{ type: `tool-${tool}`, state: 'output-available', input, approval: { id: 'a1', approved: true }, output }],
    },
  ]
}

test('the real SDK is not OFFERED the deep tier once the tier is spent', async () => {
  // The production `prepareStep` from `api/chat.mjs`, verbatim, over two real
  // legs — which is the only shape this can be tested in, because a deep call
  // that has NOT been refused yet stops the turn waiting for an approval the
  // browser supplies. Each leg is a separate `streamText`, exactly as each is a
  // separate POST.
  const run = async (ledger: MeteredRefusals, offered: string[][]) => {
    const { raw: all } = tier({ verdict: CAP_SPENT, refusals: ledger })
    const result = streamText({
      model: recordingModel(offered, false),
      messages: [{ role: 'user', content: 'plan me a deck' }],
      tools: all,
      stopWhen: [stepCountIs(2)],
      prepareStep: ({ stepNumber }) => ({
        activeTools: focusedTools(all, stepNumber, (n) => ledger.unavailable(n)),
      }),
    })
    await result.consumeStream()
    await result.steps
  }

  const fresh: string[][] = []
  await run(seedMeteredRefusals(null), fresh)
  for (const deep of DEEP_TOOL_NAMES) {
    assert.ok(fresh[0]!.includes(deep), `${deep} was withheld from a turn that has refused nothing`)
  }

  const spent: string[][] = []
  await run(seedMeteredRefusals(await refusedTurn('plan_deck', PLAN)), spent)
  for (const deep of DEEP_TOOL_NAMES) {
    assert.ok(!spent[0]!.includes(deep), `${deep} was still offered after the tier refused`)
  }
  // The rest of the turn keeps working — this removes a spent tier, not a turn.
  assert.ok(spent[0]!.length === 0 || spent[0]!.every((n) => !DEEP_TOOL_NAMES.has(n)))
})

test('a FORCED deep call inside the real SDK loop is refused without a second charge', async () => {
  // `activeTools` is a boundary, but a guard that exists only there is one
  // layer deep. This run does NOT filter, so the model really does emit the
  // call and the SDK really does execute it — which is the path a forced call,
  // a stale tool choice or a future regression would take.
  const ledger = seedMeteredRefusals(await refusedTurn('plan_deck', PLAN))
  const { raw: all, charges } = tier({ verdict: CAP_SPENT, refusals: ledger })
  const offered: string[][] = []
  const result = streamText({
    model: recordingModel(offered, true),
    messages: [{ role: 'user', content: 'plan me a deck' }],
    tools: all,
    stopWhen: [stepCountIs(3)],
  })
  await result.consumeStream()
  const steps = await result.steps

  assert.ok(offered.length >= 2, 'the forced call did not execute — the turn stopped for an approval')
  assert.equal(charges.length, 0, 'the SDK loop went back to a cap it had already been refused by')
  // Read off `content` rather than `toolResults`: the shape the SDK really
  // produces is the thing under test, and a typed accessor that silently
  // returns [] is how the wire bug in `wire.test.ts` survived for months.
  const results = steps.flatMap((s) => (s.content ?? []).filter((c) => c.type === 'tool-result')) as { output: unknown }[]
  assert.equal(results.length, 1)
  assert.ok(isNoWork(results[0]!.output as string), 'a blocked call produced something other than NO_WORK')
  assert.equal(meterRefusalScope(results[0]!.output as string), 'cap')
})

test('a REPLAYED approval leg carries the refusal across the HTTP boundary', async () => {
  // `api/chat.mjs` reconstructs every tool on every POST, so an in-memory
  // closure is empty here. This is the leg the measured bug lived on: approve,
  // refuse, re-propose, approve.
  const replayed = [
    { role: 'user', parts: [{ type: 'text', text: 'write up the strategy guide' }] },
    {
      role: 'assistant',
      parts: [
        {
          type: 'tool-write_strategy_guide',
          state: 'output-available',
          input: { deck: 'Toolbox Slowking', focus: 'sideboarding' },
          approval: { id: 'a1', approved: true },
          // The exact string the first leg returned.
          output: (await tier({ verdict: CAP_SPENT }).tools['write_strategy_guide']!.execute(
            { deck: 'Toolbox Slowking', focus: 'sideboarding' },
            { toolCallId: 'c1' },
          )),
        },
      ],
    },
  ]

  const ledger = seedMeteredRefusals(replayed)
  // A BRAND NEW tool set, as the next POST would build — nothing carried in memory.
  const { tools, charges } = tier({ verdict: CAP_SPENT, refusals: ledger })
  const reworded = { deck: 'Toolbox Slowking', focus: 'a different angle on sideboarding' }
  assert.equal(await tools['write_strategy_guide']!.needsApproval!(reworded), false, 'a second card on the replay leg')
  assert.ok(isNoWork(await tools['write_strategy_guide']!.execute(reworded, { toolCallId: 'c2' })))
  assert.equal(charges.length, 0, 'the replay leg charged a cap it had already been refused by')
  assert.ok(ledger.unavailable('plan_deck'), 'the tier-wide block did not survive the replay')
})

test('a NEW user message is a new turn — no permanent lockout', async () => {
  const refused = (await tier({ verdict: CAP_SPENT }).tools['plan_deck']!.execute(PLAN, { toolCallId: 'c1' }))
  const history = [
    { role: 'user', parts: [{ type: 'text', text: 'plan me a deck' }] },
    { role: 'assistant', parts: [{ type: 'tool-plan_deck', state: 'output-available', input: PLAN, output: refused }] },
  ]
  assert.ok(seedMeteredRefusals(history).unavailable('plan_deck'), 'same turn should still be blocked')

  // The reader tops up and asks again. Their message ends the turn the refusal
  // belonged to, so the meter is asked for real.
  const nextTurn = [...history, { role: 'user', parts: [{ type: 'text', text: 'topped up — try again' }] }]
  const ledger = seedMeteredRefusals(nextTurn)
  assert.equal(ledger.unavailable('plan_deck'), false)
  const { tools, charges } = tier({ verdict: () => ({ allowed: true }), refusals: ledger })
  assert.equal(await tools['plan_deck']!.needsApproval!(PLAN), true, 'a new turn must be able to ask again')
  await tools['plan_deck']!.execute(PLAN, { toolCallId: 'c2' }).catch(() => {})
  assert.equal(charges.length, 1, 'a new turn must re-evaluate the balance')
})

test('one reader\'s spent cap is invisible to another reader\'s turn', async () => {
  const a = tier({ verdict: CAP_SPENT })
  await a.tools['plan_deck']!.execute(PLAN, { toolCallId: 'c1' })
  // A different request, a different user: nothing is shared at module scope.
  const b = tier({ verdict: () => ({ allowed: true }) })
  assert.equal(await b.tools['plan_deck']!.needsApproval!(PLAN), true)
  assert.equal(seedMeteredRefusals(null).unavailable('plan_deck'), false)
})

test('a transient provider failure is NOT a terminal meter refusal', async () => {
  // A 503 must not disable the tier for the turn. Two halves: the live path,
  // where the charge succeeded and the sub-agent threw...
  const { tools, charges } = tier({ verdict: () => ({ allowed: true }) })
  const out = await tools['plan_deck']!.execute(PLAN, { toolCallId: 'c1' }).catch(() => '')
  assert.equal(meterRefusalScope(out), undefined, 'a provider fault carried a meter scope')
  assert.equal(await tools['plan_deck']!.needsApproval!(PLAN), true, 'a provider fault suppressed the retry')
  assert.equal(charges.length, 1)

  // ...and the replay path, where a FAILED result sits in the history.
  const history = [
    { role: 'user', parts: [{ type: 'text', text: 'plan me a deck' }] },
    {
      role: 'assistant',
      parts: [{ type: 'tool-plan_deck', state: 'output-available', input: PLAN, output: deepFailed('503 from the gateway') }],
    },
  ]
  assert.equal(seedMeteredRefusals(history).unavailable('plan_deck'), false)
  assert.equal(seedMeteredRefusals(history).blocked('plan_deck', PLAN), undefined)
})

/** A guide the model asked for, built fresh each time — never the same object twice. */
const guideArgs = (deck = 'Toolbox Slowking') => ({ deck, findings: '' })
const THIN_BALANCE = (): Verdict => ({ allowed: false, credits: true, balance: 0, needed: 2 })

test('the no_research flag the SERVER injects does not change a call\'s identity', async () => {
  // THE SECOND MEASURED LOOP. `needsApproval` writes `no_research: true` onto
  // the guide's input so the card can show the guide is unbacked, and `execute`
  // then notes the MUTATED object. The model's next emission has no such key,
  // so the ledger missed it and a second card went up for identical work.
  //
  // Fresh objects on both sides on purpose: sharing one would be mutated by the
  // first `needsApproval` and hide the bug, which is how it survived.
  const { tools, charges } = tier({ verdict: THIN_BALANCE })
  const first = guideArgs()
  assert.equal(await tools['write_strategy_guide']!.needsApproval!(first), true)
  assert.equal(first.findings, '', 'sanity: findings is trivial, so the flag really is injected')
  assert.equal((first as Record<string, unknown>)['no_research'], true, 'the injection under test did not happen')
  assert.ok(isNoWork(await tools['write_strategy_guide']!.execute(first, { toolCallId: 'c1' })))

  const again = guideArgs()
  assert.equal(await tools['write_strategy_guide']!.needsApproval!(again), false, 'a second card for the same guide')
  assert.ok(isNoWork(await tools['write_strategy_guide']!.execute(again, { toolCallId: 'c2' })))
  assert.equal(charges.length, 1, 'the same unaffordable guide went back to the meter')
})

test('the injected flag does not change identity across the HTTP boundary either', async () => {
  // The browser replays the input the CARD carried, which is the mutated one;
  // the model re-emits the plain one. Both must fingerprint the same, or the
  // fix holds in memory and fails on exactly the leg it exists for.
  const refused = await tier({ verdict: THIN_BALANCE }).tools['write_strategy_guide']!.execute(
    { ...guideArgs(), no_research: true },
    { toolCallId: 'c1' },
  )
  const ledger = seedMeteredRefusals([
    { role: 'user', parts: [{ type: 'text', text: 'write up the guide' }] },
    {
      role: 'assistant',
      parts: [
        {
          type: 'tool-write_strategy_guide',
          state: 'output-available',
          input: { ...guideArgs(), no_research: true },
          approval: { id: 'a1', approved: true },
          output: refused,
        },
      ],
    },
  ])
  const { tools, charges } = tier({ verdict: THIN_BALANCE, refusals: ledger })
  assert.equal(await tools['write_strategy_guide']!.needsApproval!(guideArgs()), false, 'a second card on the next leg')
  assert.ok(isNoWork(await tools['write_strategy_guide']!.execute(guideArgs(), { toolCallId: 'c2' })))
  assert.equal(charges.length, 0)

  // GENUINELY DIFFERENT WORK, and a cheaper tool, both still ask: `credits` is
  // a fact about one call's price, not about the tier.
  assert.equal(await tools['write_strategy_guide']!.needsApproval!(guideArgs('Rare Candy Charizard')), true)
  assert.equal(await tools['analyze_collection']!.needsApproval!({ question: 'what should I build' }), true)
  assert.equal(ledger.unavailable('plan_deck'), false, 'a credits refusal hid the deep tier')
})

test('a human DECLINE is not read as a meter refusal, and still behaves as a decline', async () => {
  // `declined.ts` writes its own `[[NO_WORK]] REFUSED` strings. They carry no
  // `[meter:…]` token, so they can never make the tier look spent — the two
  // mechanisms stay independent, which is what keeps signed approvals honest.
  const declinedText = (await tier({
    verdict: () => ({ allowed: true }),
  }).tools['research_meta']!.execute({ query: 'standard meta' }, { toolCallId: 'c1' }).catch(() => ''))
  assert.equal(meterRefusalScope(declinedText), undefined)
  const history = [
    { role: 'user', parts: [{ type: 'text', text: 'look up the meta' }] },
    {
      role: 'assistant',
      parts: [
        {
          type: 'tool-research_meta',
          state: 'approval-responded',
          input: { query: 'standard meta' },
          approval: { id: 'a1', approved: false, reason: 'the reader declined' },
        },
      ],
    },
  ]
  assert.equal(seedMeteredRefusals(history).unavailable('research_meta'), false)
})
