/**
 * The browser half of the tool boundary.
 *
 * `CLIENT_TOOLS` is mirrored here rather than imported, because `deckpal-web`
 * does not depend on `deckpal-api` — the same arrangement `ROUTE_ALLOWLIST`
 * already has. A mirror with nothing checking it is a copy that drifts, so this
 * reads the server's list out of its source and compares.
 *
 * Reading source text rather than importing it is deliberate twice over:
 * importing `apps/api` from a web test would pull the AI SDK, zod and the whole
 * server tool graph into a suite that must keep running in CI with no build step
 * and no database — and `runUiTool`'s own branches touch `document` and
 * `window`, which this suite does not have. So the parts that need a DOM are
 * verified in the browser gates, and the parts that are just lists are verified
 * here, where a drift is caught the moment it is introduced rather than the next
 * time somebody asks Deck-E to go somewhere.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { CLIENT_TOOLS, isClientTool, routeAllowed } from '../uiTools'

const SERVER_TOOLS_SRC = fileURLToPath(
  new URL('../../../../../api/src/decke/tools.ts', import.meta.url),
)
const UI_TOOLS_SRC = fileURLToPath(new URL('../uiTools.ts', import.meta.url))

test('the mirrored CLIENT_TOOLS list matches the server’s', () => {
  const src = readFileSync(SERVER_TOOLS_SRC, 'utf8')
  const m = src.match(/export const CLIENT_TOOLS\s*=\s*\[([^\]]*)\]/)
  assert.ok(m, 'could not find CLIENT_TOOLS in apps/api/src/decke/tools.ts')
  const serverList = [...m[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!).sort()

  assert.deepEqual(
    [...CLIENT_TOOLS].sort(),
    serverList,
    'the browser filters incoming tool calls against its own copy of this list. ' +
      'A name here that is not on the server is dead code; a name on the server ' +
      'that is not here is a tool call the browser silently drops.',
  )
})

test('runUiTool has a case for every tool it advertises', () => {
  // Falling through to `default` answers "I do not know how to do X" — a tool
  // that is advertised to the model, forwarded to the browser, and then refuses
  // for the one reason the model cannot act on.
  const src = readFileSync(UI_TOOLS_SRC, 'utf8')
  for (const name of CLIENT_TOOLS) {
    assert.match(
      src,
      new RegExp(`case '${name}'`),
      `${name} is in CLIENT_TOOLS but runUiTool has no case for it`,
    )
  }
})

test('isClientTool refuses the server-executed tools and anything else', () => {
  assert.equal(isClientTool('flyTo'), true)
  assert.equal(isClientTool('goTo'), true)
  // These have a server `execute` and have ALREADY run by the time their chunk
  // reaches the browser. Forwarding one re-runs it here and contradicts the
  // output the server already posted for that call id.
  assert.equal(isClientTool('express'), false)
  assert.equal(isClientTool('showScreen'), false)
  // The bug this whole area was fixed for: slicing 'tool-input-available' at
  // 'tool-' yields exactly this string, which was then dispatched as a name.
  assert.equal(isClientTool('input-available'), false)
  assert.equal(isClientTool(undefined), false)
  assert.equal(isClientTool(null), false)
  assert.equal(isClientTool(''), false)
})

test('routeAllowed keeps /profile out, by both smuggled spellings', () => {
  assert.equal(routeAllowed('/profile'), false)
  assert.equal(routeAllowed('/profile/tokens'), false)
  assert.equal(routeAllowed('//evil.example'), false)
  assert.equal(routeAllowed('/\\evil.example'), false)
  assert.equal(routeAllowed('/series/mega-evolution/me05'), true)
  assert.equal(routeAllowed(42), false)
})
