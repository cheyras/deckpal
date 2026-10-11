/**
 * showDeck's deck check, driven through the wiring `api/chat.mjs` ACTUALLY has.
 *
 * Every `showDeck` call failed on a preview with "the deck check failed: Cannot
 * read properties of undefined (reading 'send')", and Deck-E fell back to a
 * plain-text list. `api/chat.mjs` handed `checkDeck` its `toolCtx` — the
 * OPTIONS a `Ctx` is built from (`pool`, `jwt`, `apiBase`, …) — where
 * `checkDeck` wants a `Ctx`, whose `api` it calls. The options object has no
 * `api`, so the widget had never once rendered since #267 wired it.
 *
 * Nothing caught it because nothing ran it. `tools.test.ts` injects a fake
 * `checkDeck` into `buildTools`, which is right for testing `showDeck` and says
 * nothing about the function `api/chat.mjs` injects; and `chatWiring.test.ts`
 * pinned the broken expression's TEXT, so it guarded the bug rather than the
 * behaviour.
 *
 * `api/chat.mjs` cannot be imported here (it reaches for the environment at
 * module scope), so this does the next most literal thing: it lifts the
 * `toolCtx` literal and the `checkDeck:` binding out of that file's source,
 * evaluates them against the very modules that file imports (their sources,
 * not `dist`), and runs the real `showDeck` through them with only `fetch`
 * stubbed. Change the wiring there and this runs the change.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { buildTools } from '../tools.js'

/**
 * `api/chat.mjs` with its comment lines dropped, so prose that mentions
 * `checkDeck:` or `toolCtx` can never be mistaken for the code. Local, matching
 * `chatWiring.test.ts`.
 */
const SRC = readFileSync(fileURLToPath(new URL('../../../../../api/chat.mjs', import.meta.url)), 'utf8')
  .split('\n')
  .filter((l) => {
    const t = l.trimStart()
    return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*')
  })
  .join('\n')

/** The balanced `{…}` / `(…)` expression starting at `from`, ending at the first top-level `,` or close. */
function expressionAt(src: string, from: number): string {
  let depth = 0
  for (let i = from; i < src.length; i++) {
    const c = src[i]
    if (c === '(' || c === '{' || c === '[') depth++
    else if (c === ')' || c === '}' || c === ']') {
      if (depth === 0) return src.slice(from, i).trim()
      if (--depth === 0 && c === '}' && src[from] === '{') return src.slice(from, i + 1)
    } else if (c === ',' && depth === 0) return src.slice(from, i).trim()
  }
  throw new Error('unterminated expression in api/chat.mjs')
}

/** `const toolCtx = { … }`, as written. */
function toolCtxSource(): string {
  const at = SRC.indexOf('const toolCtx = {')
  assert.ok(at >= 0, 'api/chat.mjs no longer builds `toolCtx` — update this test deliberately')
  return expressionAt(SRC, SRC.indexOf('{', at))
}

/** The value of `checkDeck:` in the options `api/chat.mjs` gives `buildTools`. */
function checkDeckSource(): string {
  const call = SRC.indexOf('...buildTools(writer')
  assert.ok(call >= 0, 'api/chat.mjs no longer spreads buildTools(writer, …)')
  const key = /\bcheckDeck:\s*/g
  key.lastIndex = call
  const m = key.exec(SRC)
  assert.ok(m, 'api/chat.mjs no longer passes a deck check to buildTools — showDeck would render unchecked')
  return expressionAt(SRC, m.index + m[0].length)
}

/**
 * Every name `api/chat.mjs` imports from `apps/api/dist`, mapped to the SOURCE
 * module it was compiled from, so the binding resolves exactly as it does there.
 */
async function chatImports(names: Iterable<string>): Promise<Record<string, unknown>> {
  const wanted = new Set(names)
  const scope: Record<string, unknown> = {}
  for (const m of SRC.matchAll(/import\s*\{([^}]+)\}\s*from\s*'\.\.\/apps\/api\/dist\/([^']+)\.js'/g)) {
    const bindings = m[1]!.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
      const [exported, local = exported] = s.split(/\s+as\s+/)
      return { exported: exported!, local: local! }
    })
    if (!bindings.some((b) => wanted.has(b.local))) continue
    const mod = await import(new URL(`../../${m[2]}.ts`, import.meta.url).href) as Record<string, unknown>
    for (const b of bindings) if (wanted.has(b.local)) scope[b.local] = mod[b.exported]
  }
  return scope
}

/** Identifiers an expression mentions — enough to know which imports it needs. */
const identifiers = (src: string): string[] => [...new Set(src.match(/[A-Za-z_$][\w$]*/g) ?? [])]

/** Evaluate `src` with exactly `scope` in view. An unknown name is a ReferenceError, loudly. */
function evaluate(src: string, scope: Record<string, unknown>): unknown {
  return new Function(...Object.keys(scope), `return (${src})`)(...Object.values(scope))
}

const CHECKED = {
  format: 'standard', total: 4, legal: true, issues: [], evolution_gaps: [], owned: 4,
  missing_cost_usd: 0, ptcgl: 'Pokémon: 4\n4 Pikachu SVI 1\n',
  lines: [{ card_id: 'sv01-1', name: 'Pikachu', supertype: 'Pokémon', quantity: 4, owned: 4, unit_price_usd: 1, resolved: true }],
}

type Sent = { url: string; method: string; headers: Record<string, string>; body: unknown }

/**
 * Build `toolCtx` and the `checkDeck` binding the way `api/chat.mjs` does for
 * a request from `deckpal.test`, then run the real `showDeck` through them.
 */
async function showDeckAsChatWiresIt(
  respond: (sent: Sent, init: RequestInit) => Promise<Response>,
  controller = new AbortController(),
) {
  const ctxSrc = toolCtxSource()
  const bindingSrc = checkDeckSource()
  const imported = await chatImports([...identifiers(ctxSrc), ...identifiers(bindingSrc)])

  // The request-local names the literal closes over in `serve`. A pool that
  // throws, because a REST-only check must never check out a connection.
  const pool = {
    connect: () => { throw new Error('the deck check opened a database connection') },
    query: () => { throw new Error('the deck check queried the pool') },
  }
  const toolCtx = evaluate(ctxSrc, {
    ...imported,
    chatPool: () => pool,
    user: { id: 'reader-uuid', token: 'reader-jwt' },
    host: 'deckpal.test',
    abortSignal: controller.signal,
    selfHop: { 'x-vercel-protection-bypass': 'bypass-token' },
  })
  const checkDeck = evaluate(bindingSrc, { ...imported, toolCtx })

  const sent: Sent[] = []
  const realFetch = globalThis.fetch
  const priorBase = process.env.DECKPAL_API_BASE
  delete process.env.DECKPAL_API_BASE
  globalThis.fetch = (async (url: string | URL, init: RequestInit = {}) => {
    const s: Sent = {
      url: String(url),
      method: String(init.method),
      headers: { ...(init.headers as Record<string, string>) },
      body: init.body === undefined ? undefined : JSON.parse(String(init.body)),
    }
    sent.push(s)
    return respond(s, init)
  }) as typeof fetch

  const writes: Array<{ type: string; data: unknown }> = []
  const events: Array<{ phase: string; summary?: string }> = []
  try {
    const tools = buildTools(
      { write: (part) => writes.push(part as { type: string; data: unknown }) },
      undefined, undefined, (event) => events.push(event),
      { checkDeck: checkDeck as never },
    ) as unknown as Record<string, { execute: (input: unknown, opts: { toolCallId: string }) => Promise<string> }>
    const output = await tools.showDeck!.execute(
      { name: 'Sparks', format: 'standard', cards: [{ card_id: 'sv01-1', quantity: 4 }] },
      { toolCallId: 'deck-wired' },
    )
    return { output, writes, events, sent }
  } finally {
    globalThis.fetch = realFetch
    if (priorBase === undefined) delete process.env.DECKPAL_API_BASE
    else process.env.DECKPAL_API_BASE = priorBase
  }
}

const ok = async () => new Response(JSON.stringify(CHECKED), { status: 200, headers: { 'content-type': 'application/json' } })

test('showDeck renders a widget through the deck check exactly as api/chat.mjs wires it', async () => {
  const { output, writes, events } = await showDeckAsChatWiresIt(ok)
  assert.doesNotMatch(output, /deck check failed/, `showDeck did not render: ${output}`)
  assert.match(output, /4 cards · legal/)
  assert.equal(writes[0]?.type, 'data-decke-screen', 'no deck widget was drawn')
  assert.deepEqual(events.map((e) => e.phase), ['start', 'ok'])
})

test('the check goes out on the reader\'s own credential, to this deployment, past its protection', async () => {
  // The same client every other data tool reaches deckpal-api through: the
  // reader's JWT (so RLS and ownership counts are theirs), the host the
  // request came in on (so a preview checks against itself), and the self-hop
  // header (so a protected preview does not answer with its SSO page).
  const { sent } = await showDeckAsChatWiresIt(ok)
  assert.equal(sent.length, 1, 'expected exactly one call to deckpal-api')
  const [call] = sent
  assert.equal(call!.url, 'https://deckpal.test/api/decks/check')
  assert.equal(call!.method, 'POST')
  assert.equal(call!.headers.authorization, 'Bearer reader-jwt')
  assert.equal(call!.headers['x-vercel-protection-bypass'], 'bypass-token')
  assert.deepEqual(call!.body, { format: 'standard', cards: [{ card_id: 'sv01-1', quantity: 4 }] })
})

test('the reader pressing stop abandons a deck check still in flight', async () => {
  // What distinguishes the tools' client from a bare `makeApi`: it answers to
  // the turn's abort signal, so a stopped turn is not held open by a check
  // nobody is waiting for.
  const controller = new AbortController()
  const { output, writes } = await showDeckAsChatWiresIt(async () => {
    setTimeout(() => controller.abort(), 0)
    return await new Promise<Response>(() => {})
  }, controller)
  assert.match(output, /NOT SHOWN — the deck check failed: aborted/)
  assert.equal(writes.length, 0)
})
