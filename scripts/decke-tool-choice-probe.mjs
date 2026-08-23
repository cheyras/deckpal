/**
 * WHICH TOOL DOES HE REACH FOR? — the instrument the escort argument rests on.
 *
 * ── WHAT IT MEASURES ─────────────────────────────────────────────────────────
 *
 * Asked "help me find pitch black" from `/decks`, Deck-E can answer three ways:
 * describe the route in prose, teleport with `goTo`, or walk the person there
 * with `escort` / `journey`. `ESCORT-PLAN.md` argues the barrier is CONSTRUCTION
 * COST — that he skips `journey` because compiling a multi-step program in one
 * pass with no reasoning tokens is expensive, not because he is reluctant to
 * move. `escort` was built to test that: same walk, two ids instead of a
 * program. **That argument was reasoning until this script was run.**
 *
 * Read a run by WHICH TOOL, not only by whether he moved. `escort` rising while
 * `journey` stays flat is the diagnosis confirmed. `journey` attempts that come
 * back malformed are also confirmation. Prose either way falsifies it.
 *
 * ── WHY IT TALKS TO THE GATEWAY AND NOT TO A DEPLOYMENT ──────────────────────
 *
 * The intended rig (`local-chat.mjs` against a worktree) needs `.env.prod`
 * Supabase secrets to verify a JWT before `api/chat.mjs` will look at the
 * request. So this reproduces the REAL control flow instead — the real system
 * prompt, the real cosmetic/client tools, the real `stopWhen`/`prepareStep`/
 * `MAX_STEPS` out of `api/chat.mjs` — and synthesizes ONLY the two data tools
 * the observed sequences actually call (`search_cards`, `set_progress`), whose
 * descriptions and schemas are copied verbatim from `catalog.ts` so the model
 * sees the same prompt surface it would in production.
 *
 * That is a real limitation and it belongs next to any number this prints: the
 * data tools are FIXTURES. What is under test is the model's CHOICE, and the
 * choice is made from the prompt and the tool surface, both of which are real.
 * Gate 22 in `decke-gates.mjs` is the authority on ARRIVAL — this reads the
 * wire, and the wire cannot tell you the person got anywhere.
 *
 * ── IT READS FROM `dist/`, SO BUILD FIRST ────────────────────────────────────
 *
 *   pnpm --filter @deckpal/db build && pnpm --filter deckpal-api build
 *
 * A stale `dist/` is the failure mode with no symptom: the probe runs happily
 * against the tool surface of whatever was last built and reports it as today's.
 * `--variant baseline` on a tree whose `dist/` predates `escort` will report
 * 0 escorts and look like a finding. Check `grep -c escort
 * apps/api/dist/decke/tools.js` before believing a zero.
 *
 * ── COST ─────────────────────────────────────────────────────────────────────
 *
 * ~$0.0115 per trial, measured. n=20 is about a quarter. The QA account's
 * 120-turn daily meter does NOT apply — this never touches deckpal-api.
 *
 *   node scripts/decke-tool-choice-probe.mjs --n 20 --say "help me find pitch black" --route /decks
 *   node scripts/decke-tool-choice-probe.mjs --n 10 --route /decks --json out.json
 *
 * Needs `AI_GATEWAY_API_KEY` or `DECKE_VERCEL_AI_GATEWAY_KEY` in the env.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { convertToModelMessages, streamText, stepCountIs, tool } from 'ai'
import { createGateway } from '@ai-sdk/gateway'
import { z } from 'zod'

const REPO = process.env.PROBE_REPO || new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1').replace(/\/$/, '')
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
const N = Number(arg('n', 5))
const SAY = arg('say', 'help me find pitch black')
const ROUTE = arg('route', '/decks')
// MSYS/Git-Bash REWRITES a leading-slash argv into a Windows path: `--route
// /decks` arrives as `C:/Program Files/Git/decks`. That silently changes what
// page the model thinks it is standing on, which is an INPUT to the decision
// under test — a set of comparisons was run and thrown away over exactly this.
// Refuse rather than un-mangle; recovering the intended route from the MSYS
// root is guesswork, and a probe that guesses is what this guards against.
if (!/^\/[a-z0-9/_-]*$/i.test(ROUTE)) {
  throw new Error(
    `--route got ${JSON.stringify(ROUTE)}, which is not an app route.\n` +
      'Git Bash rewrote it. Prefix the command with MSYS_NO_PATHCONV=1, or run it from PowerShell.',
  )
}
const JSON_OUT = arg('json', null)
const CONCURRENCY = Number(arg('concurrency', 3))
// What a CORRECT escort looks like for the default prompt, straight out of the
// `set_progress` fixture below. Override when probing a different destination.
const EXPECT = { seriesSlug: arg('expect-series', 'mega-evolution'), setId: arg('expect-set', 'me05') }
const VARIANT = arg('variant', 'baseline') // 'baseline' | 'settle-on-any-act' | 'no-narrow-journey'

const key = process.env.DECKE_VERCEL_AI_GATEWAY_KEY || process.env.AI_GATEWAY_API_KEY
if (!key) throw new Error('need AI_GATEWAY_API_KEY (or DECKE_VERCEL_AI_GATEWAY_KEY) in env')

const LANDMARKS = [
  { selector: '[data-decke-nav="/lists"]', label: 'the My Lists link in the sidebar', clickable: true },
  { selector: '[data-decke-nav="/decks"]', label: 'the Deck Builder link in the sidebar', clickable: true },
  { selector: '[data-decke-nav="/pokedex"]', label: 'the Pokédex link in the sidebar', clickable: true },
  { selector: '[data-decke-nav="/insights"]', label: 'the Insights link in the sidebar', clickable: true },
  { selector: '[data-decke-nav="/scan"]', label: 'the Scan Card link in the sidebar', clickable: true },
  { selector: '[data-decke-deck-list]', label: 'the list of your decks' },
]

// ── Synthetic data tools, real descriptions/schemas (catalog.ts) ────────────
// Pitch Black's real TCGdex set id, per catalog.ts's own comment about the
// defect this whole investigation is chasing: "the set is `me05`".
function makeDataTools() {
  const search_cards = tool({
    description:
      'Search cards by NAME. `query` matches CARD names only — never a set name, ' +
      'a series name or an artist. To find a SET, call set_progress with no set_id ' +
      'and match the name in the list; searching for a set name here always returns ' +
      'nothing, however many ways you spell it. ' +
      'Accent-insensitive substring, with ' +
      'optional filters: set, category, rarity, Standard legality, owned-only, and minimum ' +
      'USD market value. Each row shows owned quantity and best USD market price. When multiple ' +
      'printings of the same card name appear (e.g. a regular and a Special Illustration Rare), ' +
      'they sort cheapest first within that name group. When building or pricing a deck, prefer ' +
      'the cheapest printing of a named card unless the user specifically asked for a particular ' +
      'rarity, parallel, or set. Use this to find cards or list slices of the collection; for ' +
      'full detail on ONE card (variants, tiers, per-source prices) use get_card instead, and ' +
      'for set completion use set_progress.',
    inputSchema: z.object({
      query: z.string().optional(),
      set_id: z.string().optional(),
      category: z.enum(['Pokemon', 'Trainer', 'Energy']).optional(),
      rarity: z.string().optional(),
      owned_only: z.boolean().default(false),
      standard_legal: z.boolean().optional(),
      min_value_usd: z.number().min(0).optional(),
      page: z.number().int().min(1).default(1),
      page_size: z.number().int().min(1).max(50).default(20),
    }),
    execute: async (args) => {
      if (args.set_id === 'me05' || (args.query ?? '').toLowerCase().includes('pitch black')) {
        return {
          ok: true,
          note: "'Pitch Black' is a SET name, not a card name — this search matched nothing. Call set_progress with no set_id to find its real id (it is me05), or call set_progress with set_id 'me05' directly.",
        }
      }
      return { ok: true, cards: [], note: 'No cards match. Loosen the query or drop a filter.' }
    },
  })

  const set_progress = tool({
    description:
      'Completion progress toward the three goals (complete = one of any variant per card, ' +
      'master = every standard-tier variant, grandmaster = every variant). Without set_id: ' +
      'every set with any progress, sorted by completion of the requested goal. With set_id: ' +
      "that set's three goal lines plus the paged list of missing cards/variants for the " +
      'requested goal with the cheapest USD price each, and the total cost to finish (unpriced ' +
      'items counted separately, never $0). Goal defaults to your default goal setting. Not ' +
      'for whole-collection stats — use collection_summary.',
    inputSchema: z.object({
      set_id: z.string().optional(),
      goal: z.enum(['complete', 'master', 'grandmaster']).optional(),
      rarity: z.array(z.string()).optional(),
      rarity_exclude: z.array(z.string()).optional(),
      page: z.number().int().min(1).default(1),
      page_size: z.number().int().min(1).max(50).default(20),
    }),
    execute: async (args) => {
      if (!args.set_id) {
        return {
          ok: true,
          sets: [
            { set_id: 'me05', name: 'Pitch Black', series_slug: 'mega-evolution', complete_pct: '24.9%' },
            { set_id: 'sv3pt5', name: '151', series_slug: 'scarlet-violet', complete_pct: '61.0%' },
          ],
        }
      }
      return {
        ok: true,
        set_id: args.set_id,
        name: args.set_id === 'me05' ? 'Pitch Black' : args.set_id,
        series_slug: 'mega-evolution',
        goals: { complete: '24.9%', master: '10.2%', grandmaster: '3.1%' },
        owned: 45,
        total: 181,
        missing_sample: ['Charizard ex (me05-054)', 'Mega Charizard Y ex (me05-006)'],
        total_cost_to_finish_usd: 312.47,
      }
    },
  })

  return { search_cards, set_progress }
}

async function once(i) {
  const started = Date.now()
  const writer = { write: () => {} }
  const grounding = createGrounding()
  const gateway = createGateway({ apiKey: key })
  const choice = MODELS.chat

  const allDeckeTools = {
    ...buildTools(writer, grounding),
    ...makeDataTools(),
  }

  // ── stopWhen, copied verbatim from api/chat.mjs (the thing under test) ────
  const stopWhen = [
    stepCountIs(MAX_STEPS),
    ({ steps }) => {
      const last = steps[steps.length - 1]
      if (!last) return false
      const spoke = steps.some((s) => (s.text ?? '').trim().length > 0)
      const ACTS =
        VARIANT === 'settle-on-any-act'
          ? new Set(['express', 'showScreen', 'journey', 'goTo', 'flyTo'])
          : new Set(['express', 'showScreen'])
      const lastCalls = (last.toolCalls ?? []).map((c) => c.toolName)
      const settled = lastCalls.length > 0 && lastCalls.every((n) => ACTS.has(n))
      return spoke && settled
    },
  ]

  const steps_log = []
  const result = streamText({
    model: gateway(choice.id),
    instructions: buildSystemPrompt({
      route: typeof ROUTE === 'string' ? ROUTE : '/',
      signedIn: true,
      landmarks: LANDMARKS.slice(0, 40),
      dataTools: dataToolSummary({ include: () => true }),
    }),
    messages: await convertToModelMessages([{ role: 'user', parts: [{ type: 'text', text: SAY }] }]),
    tools: allDeckeTools,
    stopWhen,
    prepareStep: ({ stepNumber }) => ({
      activeTools:
        VARIANT === 'no-narrow-journey'
          ? [...focusedTools(allDeckeTools, stepNumber), 'journey']
          : focusedTools(allDeckeTools, stepNumber),
    }),
    maxOutputTokens: 1200,
    onStepFinish: (step) => {
      steps_log.push({
        text: (step.text ?? '').trim(),
        toolCalls: (step.toolCalls ?? []).map((c) => c.toolName),
        // THE ARGUMENTS, not only the names. "He called escort" and "he called
        // escort correctly" are different findings, and a probe that records
        // only names cannot tell them apart — which is how construction cost
        // would hide in a number that looks like success.
        calls: (step.toolCalls ?? []).map((c) => ({ name: c.toolName, input: c.input ?? c.args ?? null })),
        finishReason: step.finishReason,
      })
    },
  })

  let text = ''
  try {
    for await (const part of result.textStream) text += part
  } catch (e) {
    return { i, error: String(e), steps_log }
  }
  // Ensure steps are flushed
  await result.steps
  const tools = steps_log.flatMap((s) => s.toolCalls)
  const calls = steps_log.flatMap((s) => s.calls ?? [])
  return { i, ms: Date.now() - started, tools, calls, text: text.trim(), steps_log }
}

const results = []
for (let start = 0; start < N; start += CONCURRENCY) {
  const batch = []
  for (let k = 0; k < CONCURRENCY && start + k < N; k++) batch.push(once(start + k))
  results.push(...(await Promise.all(batch)))
  process.stdout.write(`  …${results.length}/${N}\n`)
}

const has = (r, t) => !!r.tools?.includes(t)
const WALKS = ['escort', 'journey']
const errs = results.filter((r) => r.error)
const ok = results.filter((r) => !r.error)
// A WALK is the thing being asked for: he takes them, step by step. A JUMP is
// `goTo` alone — he moves, but the person is simply somewhere else now, which
// is the behaviour the owner described as "mostly it just goes right to the page".
const walked = ok.filter((r) => WALKS.some((t) => has(r, t)))
const jumped = ok.filter((r) => has(r, 'goTo') && !WALKS.some((t) => has(r, t)))
const escorted = ok.filter((r) => has(r, 'escort'))
const journeyed = ok.filter((r) => has(r, 'journey'))
const described = ok.filter((r) => !has(r, 'goTo') && !WALKS.some((t) => has(r, t)))

console.log(`\nvariant: ${VARIANT}   prompt: ${JSON.stringify(SAY)}   from: ${ROUTE}   n=${N}`)
console.log(`  WALKED them there  ${walked.length}/${ok.length}`)
console.log(`    via escort       ${escorted.length}`)
console.log(`    via journey      ${journeyed.length}`)
console.log(`  JUMPED (goTo only) ${jumped.length}`)
console.log(`  described only     ${described.length}`)
// ── WAS THE CALL USABLE? ─────────────────────────────────────────────────────
// The escort schema wants a series SLUG and a set ID as the data tools returned
// them — "mega-evolution" and "me05" here. A title ("Pitch Black"), a name
// ("Mega Evolution") or a missing slug produces a call that looks like success
// on the wire and walks nobody anywhere. Report it separately or the headline
// number is measuring the wrong thing.
const escortCalls = ok.flatMap((r) => (r.calls ?? []).filter((c) => c.name === 'escort'))
if (escortCalls.length) {
  const wellFormed = escortCalls.filter(
    (c) => typeof c.input?.seriesSlug === 'string' && /^[a-z0-9-]+$/.test(c.input.seriesSlug),
  )
  const rightIds = escortCalls.filter(
    (c) => c.input?.seriesSlug === EXPECT.seriesSlug && (!EXPECT.setId || c.input?.setId === EXPECT.setId),
  )
  console.log(`  escort args:`)
  console.log(`    slug-shaped      ${wellFormed.length}/${escortCalls.length}`)
  console.log(`    matched fixture  ${rightIds.length}/${escortCalls.length}  (${EXPECT.seriesSlug}${EXPECT.setId ? ' / ' + EXPECT.setId : ''})`)
  const shapes = {}
  for (const c of escortCalls) {
    const k = `seriesSlug=${JSON.stringify(c.input?.seriesSlug)} setId=${JSON.stringify(c.input?.setId)}`
    shapes[k] = (shapes[k] ?? 0) + 1
  }
  for (const [k, v] of Object.entries(shapes).sort((a, b) => b[1] - a[1])) console.log(`    ${String(v).padStart(3)}×  ${k}`)
}
if (errs.length) console.log(`  errors             ${errs.length}  e.g. ${errs[0].error}`)
console.log(`  avg steps          ${(results.reduce((a, r) => a + (r.steps_log?.length ?? 0), 0) / results.length).toFixed(2)}`)
console.log(`  tool sequences:`)
const seqs = {}
for (const r of results) if (r.tools) seqs[r.tools.join(' → ') || '(none)'] = (seqs[r.tools.join(' → ') || '(none)'] ?? 0) + 1
for (const [k, v] of Object.entries(seqs).sort((a, b) => b[1] - a[1])) console.log(`    ${String(v).padStart(3)}×  ${k}`)
if (JSON_OUT) {
  writeFileSync(JSON_OUT, JSON.stringify(results, null, 2))
  console.log(`\n  raw runs → ${JSON_OUT}`)
}
