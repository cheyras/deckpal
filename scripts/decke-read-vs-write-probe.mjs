/**
 * DOES HE REACH FOR A WRITE WHEN HE WAS ASKED TO READ? — and does he look
 * things up when nobody asked him a question?
 *
 * ── THE TWO DEFECTS, FROM ONE RECORDING ──────────────────────────────────────
 *
 * 2026-08-27, a mobile screen recording, both reported in the reader's own
 * words inside the conversation itself:
 *
 *   1. *"Flagging this for a future improvement agent — you attempted to edit
 *      the strategy guide again instead of just looking at it."*  Asked "Give
 *      me insights about my slowking deck", the first thing on screen was a
 *      dialog asking to write and store a strategy guide.
 *
 *   2. *"Also flagging — there was no reason to do the browse decks commands
 *      for this request."*  The request in question was that feedback message,
 *      which told him explicitly to answer "thanks for the feedback!" — and
 *      came back with two tool rows above the reply.
 *
 * Both are prompt behaviour, so both are measured the way `ESCORT-PLAN.md`'s
 * argument had to be measured before it was believed: against the real model,
 * with the real system prompt, n trials per arm, and a control run on the old
 * prompt in the same sitting.
 *
 * ── WHAT IS REAL HERE AND WHAT IS A FIXTURE ──────────────────────────────────
 *
 * Real: the system prompt (`dist/decke/prompt.js`), the cosmetic and client
 * tools (`dist/decke/tools.js`), `focusedTools`, the model from `MODELS.chat`,
 * `stopWhen` copied verbatim from `api/chat.mjs`, and every tool DESCRIPTION —
 * copied from the sources named beside each one, because the description IS the
 * surface the choice is made from.
 *
 * Fixture: the tool HANDLERS. `decks` and `battle_logs` return plausible rows,
 * `deck_strategy` and `write_strategy_guide` record that they were called and
 * return the held-for-approval shape. Nothing is written anywhere and no deep
 * sub-agent runs. Same limitation `decke-tool-choice-probe.mjs` states about
 * its own fixtures, and it belongs beside any number this prints: what is under
 * test is the CHOICE.
 *
 * ── IT READS FROM `dist/`, SO BUILD FIRST ────────────────────────────────────
 *
 *   pnpm --filter @deckpal/db build && pnpm --filter deckpal-api build
 *
 * A stale `dist/` is the failure mode with no symptom — it would report the
 * previous prompt's behaviour as today's.
 *
 * ── COST ─────────────────────────────────────────────────────────────────────
 *
 * Same order as the tool-choice probe, ~$0.01 per trial. It never touches
 * deckpal-api, so the QA account's daily meter does not apply.
 *
 *   node scripts/decke-read-vs-write-probe.mjs --n 10
 *   node scripts/decke-read-vs-write-probe.mjs --n 10 --arm feedback
 *
 * Needs `AI_GATEWAY_API_KEY` or `DECKE_VERCEL_AI_GATEWAY_KEY` in the env.
 */
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { convertToModelMessages, streamText, stepCountIs, tool } from 'ai'
import { createGateway } from '@ai-sdk/gateway'
import { z } from 'zod'

const REPO =
  process.env.PROBE_REPO ||
  new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1').replace(/\/$/, '')
const MAX_STEPS = 12

const { buildSystemPrompt } = await import(pathToFileURL(`${REPO}/apps/api/dist/decke/prompt.js`).href)
const { buildTools } = await import(pathToFileURL(`${REPO}/apps/api/dist/decke/tools.js`).href)
const { MODELS } = await import(pathToFileURL(`${REPO}/apps/api/dist/decke/models.js`).href)
const { focusedTools } = await import(pathToFileURL(`${REPO}/apps/api/dist/decke/focus.js`).href)
const { createGrounding } = await import(pathToFileURL(`${REPO}/apps/api/dist/decke/grounding.js`).href)
const { dataToolSummary } = await import(pathToFileURL(`${REPO}/apps/api/dist/decke/adapters/aisdk.js`).href)

const argv = process.argv.slice(2)
const arg = (n, d) => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d
}
const N = Number(arg('n', 10))
const ARM = arg('arm', 'insights')
const CONCURRENCY = Number(arg('concurrency', 3))
const JSON_OUT = arg('json', null)

const key = process.env.DECKE_VERCEL_AI_GATEWAY_KEY || process.env.AI_GATEWAY_API_KEY
if (!key) throw new Error('need AI_GATEWAY_API_KEY (or DECKE_VERCEL_AI_GATEWAY_KEY) in env')

/** Every fixture that reads or writes real data — the set the feedback arm counts. */
const DATA_TOOLS = new Set(['decks', 'battle_logs', 'deck_strategy', 'write_strategy_guide'])
/** The two ways a guide gets written. Either one is the defect in arm 1. */
const WRITES = new Set(['deck_strategy', 'write_strategy_guide'])

/**
 * The two prompts, VERBATIM from the recording.
 *
 * Not paraphrased. The feedback arm in particular is a message whose exact
 * wording is the input under test — "just respond with X" is the instruction
 * the tool calls ignored.
 */
const ARMS = {
  insights: {
    say: 'Give me insights about my slowking deck',
    /** The defect: a write proposed in answer to a question that wanted prose. */
    bad: (r) => r.tools.some((t) => WRITES.has(t)),
    label: 'proposed a WRITE',
    /** Reading the deck first is right, and must not regress. */
    good: (r) => r.tools.some((t) => t === 'decks' || t === 'battle_logs'),
    goodLabel: 'read the deck first',
  },
  feedback: {
    say:
      'Flagging this for a future improvement agent - you attempted to edit the strategy guide ' +
      'again instead of just looking at it. Just respond with "thanks for the feedback!"',
    /** The defect: any lookup at all, on a message that asked nobody anything. */
    bad: (r) => r.tools.some((t) => DATA_TOOLS.has(t)),
    label: 'ran a LOOKUP',
    /** And he still has to answer, which is the half not to break. */
    good: (r) => /thanks for the feedback/i.test(r.text),
    goodLabel: 'said the line',
  },
}
if (!ARMS[ARM]) throw new Error(`--arm must be one of ${Object.keys(ARMS).join(', ')}`)

const LANDMARKS = [
  { selector: '[data-decke-nav="/decks"]', label: 'the Deck Builder link in the sidebar', clickable: true },
  { selector: '[data-decke-nav="/insights"]', label: 'the Insights link in the sidebar', clickable: true },
  { selector: '[data-decke-deck-list]', label: 'the list of your decks' },
]

/** The deck id the recording's own approval dialog showed. */
const DECK_ID = 'eaae34ba-9607-49d6-a133-1a06b777d472'

/** The guide the `decks` fixture hands back, so a rewrite can be compared to it. */
const STORED_GUIDE =
  'Slowking control. Lock the board with ability damage while Iono resets their hand. ' +
  'Weak to fast aggro; mulligan aggressively for the Slowking line.'

/** `noOp.ts`'s comparison, so the two cannot disagree about what "same" means. */
// Carriage returns stripped by code point rather than by an escape, so this
// file's own line endings cannot change what it compares.
const CR = String.fromCharCode(13)
const norm = (s) => String(s ?? '').split(CR).join('').trim()
const sameGuide = (a, b) => norm(a) === norm(b)

/**
 * Every guide-write this trial proposed, split by whether it would change
 * anything.
 *
 * THE SPLIT IS THE POINT. `noOp.ts` suppresses the DIALOG for a write that
 * changes nothing, and it cannot suppress the CALL — this rig's tools are
 * fixtures and never reach that boundary. So counting calls alone would report
 * a guard that works as a guard that does nothing. Measured across 28 trials
 * before the guard existed: 4 proposed writes, 4 of them byte-identical, 0
 * genuinely different.
 */
function guideWrites(r) {
  const out = { noOp: 0, real: 0 }
  for (const s of r.steps_log ?? []) {
    for (const c of s.calls ?? []) {
      if (!WRITES.has(c.name)) continue
      const md = c.input?.markdown ?? c.input?.guide ?? c.input?.focus ?? ''
      if (sameGuide(md, STORED_GUIDE)) out.noOp++
      else out.real++
    }
  }
  return out
}

function makeDataTools(seen) {
  const record = (name) => seen.push(name)

  // Description from `packages/agent-tools`' deck reader.
  const decks = tool({
    description:
      'List or read the decks in this DeckPal collection. Without deck: every deck with its ' +
      'card count and format. With deck (name or id): the full card list, the stored strategy ' +
      'guide if there is one, and how many of each card the collection owns.',
    inputSchema: z.object({ deck: z.string().optional(), page: z.number().int().min(1).default(1) }),
    execute: async (args) => {
      record('decks')
      if (!args.deck) {
        return {
          ok: true,
          decks: [{ id: DECK_ID, name: 'Toolbox Slowking', cards: 60, format: 'Standard' }],
        }
      }
      return {
        ok: true,
        deck: { id: DECK_ID, name: 'Toolbox Slowking', format: 'Standard' },
        cards: [
          { card_id: 'sv3-043', name: 'Slowking', count: 3, owned: 3 },
          { card_id: 'sv1-196', name: 'Iono', count: 4, owned: 4 },
          { card_id: 'svi-196', name: 'Ultra Ball', count: 4, owned: 4 },
        ],
        // THE GUIDE ALREADY EXISTS, which is the case the recording caught: a
        // stored guide is REPLACED, so volunteering a rewrite destroys one.
        strategy_guide:
          'Slowking control. Lock the board with ability damage while Iono resets their hand. ' +
          'Weak to fast aggro; mulligan aggressively for the Slowking line.',
      }
    },
  })

  // Description from `packages/agent-tools`' battle-log reader.
  const battle_logs = tool({
    description:
      'Read recorded games. Without filters: the most recent games. With deck: that deck only. ' +
      'Each row carries the result, the opponent deck, and any notes that were written down.',
    inputSchema: z.object({ deck: z.string().optional(), page: z.number().int().min(1).default(1) }),
    execute: async () => {
      record('battle_logs')
      return {
        ok: true,
        games: [
          { id: 48, result: 'LOSS', opponent: 'Dragapult ex', note: 'Too slow, never found Slowking' },
          { id: 47, result: 'WIN', opponent: 'Gardevoir ex', note: 'Iono at 2 cards won it' },
        ],
      }
    },
  })

  // The agent-tools write. Dumb storage that REPLACES the guide — the property
  // that makes volunteering one destructive rather than merely unasked-for.
  const deck_strategy = tool({
    description:
      'Store a strategy guide on a deck. This REPLACES the whole guide — it does not append. ' +
      'It only stores text; it does not write one for you.',
    inputSchema: z.object({ deck: z.string(), guide: z.string() }),
    execute: async () => {
      record('deck_strategy')
      return { ok: false, held: true, note: 'Held for the reader to approve. Nothing has been written.' }
    },
  })

  // Description verbatim from `apps/api/src/decke/deep.ts`.
  const write_strategy_guide = tool({
    description:
      'Write a real strategy guide for one of their decks and save it. Reads the deck and ' +
      'its battle logs, then writes the guide and stores it with deck_strategy. ' +
      'It CANNOT look anything up on the web — if the guide should reflect the current ' +
      'meta, research that first and pass what you found in `focus`. ' +
      'Note that deck_strategy only STORES text — this is the tool that writes it.',
    inputSchema: z.object({
      deck: z.string().max(120),
      focus: z.string().max(300).optional(),
      deepest: z.boolean().optional(),
    }),
    execute: async () => {
      record('write_strategy_guide')
      return { ok: false, held: true, note: 'Held for the reader to approve. Nothing has been written.' }
    },
  })

  return { decks, battle_logs, deck_strategy, write_strategy_guide }
}

async function once(i) {
  const seen = []
  const writer = { write: () => {} }
  const grounding = createGrounding()
  const gateway = createGateway({ apiKey: key })
  const allDeckeTools = { ...buildTools(writer, grounding), ...makeDataTools(seen) }

  // `stopWhen`, copied verbatim from `api/chat.mjs`. The thing under test runs
  // inside it, and a different stop condition is a different experiment.
  const stopWhen = [
    stepCountIs(MAX_STEPS),
    ({ steps }) => {
      const last = steps[steps.length - 1]
      if (!last) return false
      const spoke = steps.some((s) => (s.text ?? '').trim().length > 0)
      const ACTS = new Set(['express', 'showScreen'])
      const lastCalls = (last.toolCalls ?? []).map((c) => c.toolName)
      return spoke && lastCalls.length > 0 && lastCalls.every((n) => ACTS.has(n))
    },
  ]

  const steps_log = []
  const result = streamText({
    model: gateway(MODELS.chat.id),
    instructions: buildSystemPrompt({
      route: '/decks',
      signedIn: true,
      landmarks: LANDMARKS,
      dataTools: dataToolSummary({ include: () => true }),
    }),
    messages: await convertToModelMessages([
      { role: 'user', parts: [{ type: 'text', text: ARMS[ARM].say }] },
    ]),
    tools: allDeckeTools,
    stopWhen,
    prepareStep: ({ stepNumber }) => ({ activeTools: focusedTools(allDeckeTools, stepNumber) }),
    maxOutputTokens: 1200,
    onStepFinish: (step) => {
      steps_log.push({
        text: (step.text ?? '').trim(),
        // THE ARGUMENTS, not only the names — "he called it" and "he called it
        // with their deck id" are different findings.
        calls: (step.toolCalls ?? []).map((c) => ({ name: c.toolName, input: c.input ?? c.args ?? null })),
      })
    },
  })

  let text = ''
  try {
    for await (const part of result.textStream) text += part
  } catch (e) {
    return { i, error: String(e), tools: [], text: '', steps_log }
  }
  await result.steps
  return {
    i,
    tools: steps_log.flatMap((s) => s.calls.map((c) => c.name)),
    text: text.trim(),
    steps_log,
  }
}

const results = []
for (let start = 0; start < N; start += CONCURRENCY) {
  const batch = []
  for (let k = 0; k < CONCURRENCY && start + k < N; k++) batch.push(once(start + k))
  results.push(...(await Promise.all(batch)))
  process.stdout.write(`  …${results.length}/${N}\n`)
}

const a = ARMS[ARM]
const errs = results.filter((r) => r.error)
const ok = results.filter((r) => !r.error)
const bad = ok.filter(a.bad)
const good = ok.filter(a.good)

console.log(`\narm: ${ARM}   n=${N}   prompt: ${JSON.stringify(a.say)}`)
console.log(`  ${a.label.padEnd(20)} ${bad.length}/${ok.length}    <- the defect; lower is better`)
console.log(`  ${a.goodLabel.padEnd(20)} ${good.length}/${ok.length}    <- must not regress`)
if (ARM === 'insights') {
  // OF THOSE WRITES, HOW MANY WOULD HAVE CHANGED ANYTHING?
  //
  // A byte-identical rewrite raises no dialog in production — `noOp.ts` answers
  // `needsApproval` false for it — and this rig cannot see that, because its
  // tools are fixtures and never reach that boundary. Counting calls alone
  // would therefore report a working guard as a guard that does nothing.
  //
  // Measured across 28 trials on two prompt variants: 4 proposed writes, ALL
  // FOUR byte-identical, none genuinely different. A `different` above zero is
  // the case the prompt rule has to carry on its own, and is worth knowing
  // about separately the moment it appears.
  const w = ok
    .map(guideWrites)
    .reduce((sum, x) => ({ noOp: sum.noOp + x.noOp, real: sum.real + x.real }), { noOp: 0, real: 0 })
  console.log(`  of those writes:     ${w.noOp} byte-identical (no dialog), ${w.real} different (asks)`)
}
if (errs.length) console.log(`  errors               ${errs.length}`)
const counts = {}
for (const r of ok) for (const t of new Set(r.tools)) counts[t] = (counts[t] ?? 0) + 1
console.log(
  `  tools used: ${
    Object.entries(counts)
      .sort((x, y) => y[1] - x[1])
      .map(([k, v]) => `${k}=${v}`)
      .join(' ') || '(none)'
  }`,
)
if (JSON_OUT) {
  writeFileSync(JSON_OUT, JSON.stringify({ arm: ARM, n: N, results }, null, 2))
  console.log(`  wrote ${JSON_OUT}`)
}
