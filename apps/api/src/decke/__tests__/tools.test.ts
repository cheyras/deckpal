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
import { test } from 'node:test'
import { buildTools, CLIENT_TOOLS, COSMETIC_TOOLS, SERVER_TOOLS, isAllowedRoute } from '../tools.js'
import { ROUTE_SHAPE_LINES } from '../prompt.js'

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
