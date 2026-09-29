/**
 * The tool boundary, asserted rather than assumed.
 *
 * `CLIENT_TOOLS` is a hand-written list that has to agree with a structural
 * property of `buildTools()` — "which tools have no server-side `execute`" —
 * and nothing but this test connects the two. Getting it wrong is not a type
 * error and not a runtime error: a client tool missing from the list is
 * silently dropped by the browser's filter and he narrates a journey that never
 * happened, which is the exact failure this whole area was fixed for.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { buildTools, CLIENT_TOOLS, COSMETIC_TOOLS, SERVER_TOOLS, isAllowedRoute } from '../tools.js'
import { ROUTE_SHAPE_LINES } from '../prompt.js'
import { createGrounding } from '../grounding.js'
import type { Queryable } from '@deckpal/db'

/** `buildTools` only ever calls `write`; nothing here needs a real stream. */
const noopWriter = { write: () => {} }

test('CLIENT_TOOLS is exactly the set of tools with no server-side execute', () => {
  const tools = buildTools(noopWriter) as Record<string, { execute?: unknown }>
  const forwarded = Object.entries(tools)
    .filter(([, t]) => typeof t.execute !== 'function')
    .map(([name]) => name)
    .sort()

  assert.deepEqual(
    forwarded,
    [...CLIENT_TOOLS].sort(),
    'a tool with no `execute` is forwarded to the browser whether or not it is ' +
      'listed. If this fails, the browser is either dropping a real client tool ' +
      'or re-running a server one.',
  )
})

test('SERVER_TOOLS is exactly the set of tools that DO have an execute', () => {
  const tools = buildTools(noopWriter) as Record<string, { execute?: unknown }>
  const executed = Object.entries(tools)
    .filter(([, t]) => typeof t.execute === 'function')
    .map(([name]) => name)
    .sort()

  // A deepEqual and not a per-name spot check, which is what this used to be.
  // The spot check proved each named tool has an execute; it could not notice a
  // NEW server tool that nobody listed — and `COSMETIC_TOOLS` below is the union
  // of the two halves, so an unlisted half is a hole in the union.
  assert.deepEqual(
    executed,
    [...SERVER_TOOLS].sort(),
    'a tool with an `execute` runs on the server whether or not it is listed. ' +
      'Without an execute it would be forwarded to a browser that cannot run it.',
  )
})

test('ask_to_share_chat draws one transient choice only when SQL allows it', async () => {
  const writes: Array<{ type: string; data: unknown; transient?: boolean }> = []
  const db = { query: async () => ({ rows: [{ data: { allowed: true } }] }) } as unknown as Queryable
  const tools = buildTools(
    { write: (part) => writes.push(part) }, undefined, undefined, undefined,
    { db, userId: 'user', conversationId: 'conversation' },
  ) as unknown as Record<string, { execute: (input: unknown) => Promise<string> }>
  const output = await tools.ask_to_share_chat!.execute({ reason: 'failure' })
  assert.match(output, /Share \/ No thanks buttons/)
  assert.deepEqual(writes, [{
    type: 'data-decke-consent', data: { conversationId: 'conversation', reason: 'failure' }, transient: true,
  }])
})

test('ask_to_share_chat draws nothing on refusal or can_ask error, including unsaved first turns', async () => {
  for (const query of [
    async () => ({ rows: [{ data: { allowed: false, reason: 'prompts_disabled' } }] }),
    async () => { throw Object.assign(new Error('Conversation is unavailable'), { code: 'P0002' }) },
  ]) {
    const writes: unknown[] = []
    const tools = buildTools(
      { write: (part) => writes.push(part) }, undefined, undefined, undefined,
      { db: { query } as unknown as Queryable, userId: 'user', conversationId: 'conversation' },
    ) as unknown as Record<string, { execute: (input: unknown) => Promise<string> }>
    assert.equal(await tools.ask_to_share_chat!.execute({ reason: 'frustrated' }), "Don't ask about sharing in this chat.")
    assert.deepEqual(writes, [])
  }
})

test('showDeck checks and writes a deck screen with the contracted summary', async () => {
  const writes: Array<{ type: string; data: unknown }> = []
  const events: Array<{ phase: string; name: string; summary?: string }> = []
  const tools = buildTools(
    { write: (part) => writes.push(part as { type: string; data: unknown }) },
    undefined,
    undefined,
    (event) => events.push(event),
    { checkDeck: async () => ({
      format: 'standard', total: 60, legal: true, issues: [], evolution_gaps: [], owned: 42,
      missing_cost_usd: 18.25, ptcgl: 'Pokémon: 1\n4 Pikachu SVI 1\n',
      lines: [{ card_id: 'sv01-1', name: 'Pikachu', supertype: 'Pokémon', quantity: 60, owned: 42, unit_price_usd: 1, resolved: true }],
    }) },
  ) as unknown as Record<string, { execute: (input: unknown, opts: { toolCallId: string }) => Promise<string> }>
  const output = await tools.showDeck!.execute({
    name: 'Sparks', format: 'standard', cards: [{ card_id: 'sv01-1', quantity: 4 }],
  }, { toolCallId: 'deck-1' })
  assert.match(output, /60 cards · legal · own 42\/60 · missing cost about \$18\.25/)
  assert.match(output, /Save button.*Do not list its cards again/)
  assert.equal(writes[0]?.type, 'data-decke-screen')
  assert.deepEqual(events.map((event) => event.phase), ['start', 'ok'])
  assert.equal(events[1]?.summary, 'Showed "Sparks" · 60 cards')
})

test('showDeck falls back to ids when checking is absent or throws', async () => {
  const writes: Array<{ data: unknown }> = []
  const grounding = createGrounding()
  grounding.observe('sv01-1')
  const tools = buildTools(
    { write: (part) => writes.push(part as { data: unknown }) }, grounding, undefined, undefined,
    { checkDeck: async () => { throw new Error('offline') } },
  ) as unknown as Record<string, { execute: (input: unknown, opts: { toolCallId: string }) => Promise<string> }>
  const output = await tools.showDeck!.execute({ name: 'Draft', format: 'standard', cards: [{ card_id: 'sv01-1', quantity: 4 }] }, { toolCallId: 'deck-2' })
  assert.match(output, /4 cards · could not be checked · own 0\/4 · missing cost unavailable/)
  const payload = writes[0]?.data as { screen: { blocks: Array<{ legal: null; sections: Array<{ cards: Array<{ name: string }> }> }> } }
  assert.equal(payload.screen.blocks[0]?.legal, null)
  assert.equal(payload.screen.blocks[0]?.sections[0]?.cards[0]?.name, 'sv01-1')
})

test('showDeck writes no screen and reports ids omitted by its check', async () => {
  const writes: unknown[] = []
  const events: Array<{ phase: string; summary?: string }> = []
  const tools = buildTools(
    { write: (part) => writes.push(part) }, undefined, undefined, (event) => events.push(event),
    { checkDeck: async () => ({
      format: 'standard', total: 4, legal: null, issues: ['unresolved'], evolution_gaps: [], owned: 0,
      missing_cost_usd: null, ptcgl: '',
      lines: [{ card_id: null, name: 'Invented', supertype: 'Unknown', quantity: 4, owned: 0, unit_price_usd: null, resolved: false }],
    }) },
  ) as unknown as Record<string, { execute: (input: unknown, opts: { toolCallId: string }) => Promise<string> }>
  const output = await tools.showDeck!.execute(
    { name: 'Bad', cards: [{ card_id: 'fake-999', quantity: 4 }] }, { toolCallId: 'deck-bad' },
  )
  assert.match(output, /^\[\[NO_WORK\]\] NOT SHOWN.*fake-999/)
  assert.equal(writes.length, 0)
  assert.deepEqual(events.map((event) => event.phase), ['start', 'error'])
  assert.equal(events.at(-1)?.summary, "Couldn't show that deck — some cards weren't verified")
})

test('showDeck rejects a checked result whose displayed quantities do not equal total', async () => {
  const writes: unknown[] = []
  const tools = buildTools(
    { write: (part) => writes.push(part) }, undefined, undefined, undefined,
    { checkDeck: async () => ({
      format: 'standard', total: 60, legal: true, issues: [], evolution_gaps: [], owned: 4,
      missing_cost_usd: 0, ptcgl: '',
      lines: [{ card_id: 'sv01-1', name: 'Pikachu', supertype: 'Pokémon', quantity: 4, owned: 4, unit_price_usd: 1, resolved: true }],
    }) },
  ) as unknown as Record<string, { execute: (input: unknown, opts: { toolCallId: string }) => Promise<string> }>
  const output = await tools.showDeck!.execute(
    { name: 'Partial', cards: [{ card_id: 'sv01-1', quantity: 4 }] }, { toolCallId: 'deck-partial' },
  )
  assert.match(output, /^\[\[NO_WORK\]\] NOT SHOWN.*4\/60 cards/)
  assert.equal(writes.length, 0)
})

/**
 * The union, and the thing that reads it.
 *
 * `narration.ts` strips leaked tool syntax from the reader's speech bubble and
 * derives its tag alternation from `COSMETIC_TOOLS`. Before that derivation the
 * list was written out by hand and went stale the day `journey` and `escort`
 * were added: two of the nine tools could be emitted as prose and reach the
 * reader untouched, with nothing failing to say so (issue #90).
 *
 * The two assertions above already pin each half against the property that
 * decides it. This pins the union against the registry itself, so the failure
 * message names the real problem — "a tool exists that the leak filter has
 * never heard of" — rather than leaving it to be inferred from a halves test.
 */
test('COSMETIC_TOOLS is every tool buildTools exposes — the list the leak filter uses', () => {
  const tools = buildTools(noopWriter) as Record<string, unknown>

  assert.deepEqual(
    Object.keys(tools).sort(),
    [...COSMETIC_TOOLS].sort(),
    'a tool missing from COSMETIC_TOOLS is a tool `narration.ts` will not strip ' +
      'when the model writes it out as prose instead of calling it.',
  )
  assert.equal(
    new Set(COSMETIC_TOOLS).size,
    COSMETIC_TOOLS.length,
    'a duplicate would be harmless in the regex and confusing everywhere else',
  )
})

test('the route allowlist keeps /profile out, by both spellings', () => {
  // `/profile` mints API tokens. This is the control, not the prompt line.
  assert.equal(isAllowedRoute('/profile'), false)
  assert.equal(isAllowedRoute('/profile/tokens'), false)
  // Protocol-relative and backslash smuggling, both parsed as `//host` by
  // browsers.
  assert.equal(isAllowedRoute('//evil.example'), false)
  assert.equal(isAllowedRoute('/\\evil.example'), false)
  assert.equal(isAllowedRoute('/series/mega-evolution/me05'), true)
})

test('click delegates write confirmation to the platform', () => {
  const click = buildTools(noopWriter).click as { description?: string }
  assert.match(click.description ?? '', /call its write tool; the platform asks the reader automatically/)
  assert.doesNotMatch(click.description ?? '', /ask first/)
})

test('a dot segment cannot walk an allowed prefix somewhere else (SEC-12)', () => {
  // Each of these passed the raw prefix match as "under /decks" or "under
  // /series" and resolved to a page off the list — `/profile` mints tokens.
  for (const path of [
    '/decks/../profile',
    '/decks/%2e%2e/profile',
    '/decks/%2E%2E/profile',
    '/decks/.%2e/profile',
    '/decks/./../admin',
    '/series/../devtools',
    '/decks/..',
    '/lists/.',
    '/decks/..%2fprofile',
    '/decks/%5c..%5cprofile',
    '/decks/x\u0000/profile',
    '/decks/x\n/profile',
  ]) {
    assert.equal(isAllowedRoute(path), false, `${JSON.stringify(path)} must be refused`)
  }
  // The shapes he is actually given still pass, query and all.
  assert.equal(isAllowedRoute('/decks/6f1c2a9e-2b7d-4a44-9d0e-1c2b3a4d5e6f'), true)
  assert.equal(isAllowedRoute('/series/mega-evolution/me05/013'), true)
  assert.equal(isAllowedRoute('/search?q=../profile'), true)
})

test('the browser mirror normalises with the same rule and the same list', () => {
  // `routeAllowed` in the browser is the check nearest the navigation, and a
  // mirror that drifted would pass every server test while the page that
  // actually moves the reader kept the old hole. Source pins, because the web
  // module cannot be loaded from this package.
  const own = readFileSync(new URL('../tools.ts', import.meta.url), 'utf8')
  const web = readFileSync(
    new URL('../../../../web/src/character/host/uiTools.ts', import.meta.url),
    'utf8',
  )
  const rule = (src: string) => src.match(/function isNormalPath[\s\S]*?\n\}/)?.[0].split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
  assert.ok(rule(own), 'isNormalPath is gone from tools.ts')
  assert.equal(rule(web), rule(own), 'the browser and the server normalise routes differently')
  assert.match(web, /routeAllowed[\s\S]{0,400}isNormalPath\(clean\) &&/, 'routeAllowed no longer normalises')
  const list = (src: string, re: RegExp) => [...(src.match(re)?.[1] ?? '').matchAll(/'(\/[a-z]+)'/g)].map((m) => m[1]).sort()
  assert.deepEqual(
    list(web, /const ROUTE_ALLOWLIST = \[([^\]]*)\]/),
    list(own, /const ROUTE_ALLOWLIST = \[([\s\S]*?)\] as const/),
    'the two route allowlists no longer agree',
  )
})

/**
 * The two route lists have to agree, and only this connects them.
 *
 * `ROUTE_ALLOWLIST` (tools.ts) says what may be navigated to; `ROUTE_SHAPES`
 * (prompt.ts) is what the model is TOLD it may navigate to, and it exists
 * because the allowlist alone reads as an enumeration of destinations rather
 * than of prefixes — which is why "Take me to it" stopped at /series instead of
 * /series/mega-evolution/me05 (spec §13.2 gate 5).
 *
 * A shape naming a prefix the guard refuses would not fail a build or a type
 * check. It would fail one turn later, in a browser, as a route the model was
 * invited to build and is then refused — which is indistinguishable, to the
 * reader, from Deck-E simply not going anywhere.
 */
test('every route shape he is shown is a route he is actually allowed', () => {
  for (const line of ROUTE_SHAPE_LINES) {
    const shape = line.split(' — ')[0]!
    // `<seriesSlug>` etc. are placeholders; a concrete sample exercises the
    // same prefix match a real path would.
    const sample = shape.replace(/<[^>]+>/g, 'sample')
    assert.equal(
      isAllowedRoute(sample),
      true,
      `the prompt offers "${shape}", which isAllowedRoute refuses as "${sample}"`,
    )
  }
})

test('the shapes cover the set page the series slug was added for', () => {
  // §7.1 added the slug to search_cards/get_card/set_progress for exactly one
  // purpose. If this shape ever goes missing, that change buys nothing again.
  assert.ok(
    ROUTE_SHAPE_LINES.some((l) => l.startsWith('/series/<seriesSlug>/<setId> ')),
    'nothing tells him where a set lives',
  )
})
