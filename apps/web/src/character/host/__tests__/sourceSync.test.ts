/**
 * The mirrors that have to agree by hand, checked so they cannot quietly stop.
 *
 * `deckpal-web` does not depend on `deckpal-api`, so three lists that describe
 * one protocol live in two packages and are kept in step by whoever remembers:
 *
 *   • the server's `BLOCK_KINDS` and `DeckeScreen`'s `switch`;
 *   • the block schema's fields and `DeckeScreen`'s `Block` type;
 *   • `showScreen`'s sibling — the engine command `op` enum in `tools.ts` and
 *     `WireCommand` in `useDeckeChat.ts`.
 *
 * DECISIONS.md 2026-08-21 recorded the first and third as "real extension
 * hazards", fail-closed (an unknown kind renders nothing, an unknown op is
 * ignored) and "worth a shared type when either list next changes". Adding
 * `group` and `table` is that change, so this file is the answer to it.
 *
 * WHY A TEXT COMPARISON AND NOT A SHARED TYPE. A shared type is the better
 * answer in the abstract and the wrong one here twice over. Putting these enums
 * in `packages/` would make the browser bundle depend on a package whose other
 * half is the AI SDK, zod and the server tool graph — and `packages/**` is
 * shared surface that a change to one character's vocabulary has no business
 * touching. Generating the union at build time would put a codegen step between
 * a clone and a running app, which `CLAUDE.md` currently promises there isn't.
 * `uiTools.test.ts` already set the precedent for the third option — read the
 * server's source AS TEXT and compare — and it has the property that matters:
 * the drift is caught the moment it is introduced, in a suite that runs in CI
 * with no build step and no database, rather than the next time somebody asks
 * Deck-E for a panel and gets a blank one.
 *
 * The cost is honest and worth naming: these regexes are coupled to how those
 * two files are FORMATTED. If one is reshaped, the assertion that finds nothing
 * fails loudly with the reason rather than passing vacuously — every extraction
 * below asserts it found something before it compares.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const SCREENS_SRC = fileURLToPath(
  new URL('../../../../../api/src/decke/screens.ts', import.meta.url),
)
const TOOLS_SRC = fileURLToPath(new URL('../../../../../api/src/decke/tools.ts', import.meta.url))
const RENDERER_SRC = fileURLToPath(new URL('../DeckeScreen.tsx', import.meta.url))
const CHAT_SRC = fileURLToPath(new URL('../useDeckeChat.ts', import.meta.url))

const screens = readFileSync(SCREENS_SRC, 'utf8')
const tools = readFileSync(TOOLS_SRC, 'utf8')
const renderer = readFileSync(RENDERER_SRC, 'utf8')
const chat = readFileSync(CHAT_SRC, 'utf8')

/**
 * The file with its prose taken out.
 *
 * Needed because this codebase's comments say the words the assertions look
 * for — `DeckeScreen`'s own header explains at length that nothing there reaches
 * `dangerouslySetInnerHTML` or a `src`, which is exactly the sentence a naive
 * grep for those words finds. Stripping comments first means the test reads the
 * CODE's claim rather than the comment's, which is the only one worth checking.
 */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

/** The quoted strings inside `export const <name> = [ … ]`. */
function constList(src: string, name: string): string[] {
  const m = src.match(new RegExp(`export const ${name}\\s*=\\s*\\[([^\\]]*)\\]`))
  assert.ok(m, `could not find ${name} — has the declaration been reshaped?`)
  const list = [...m[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!)
  assert.ok(list.length, `${name} parsed as empty, which cannot be right`)
  return list
}

/** The keys declared at one level of indentation inside a `{ … }` literal. */
function keysIn(src: string, opener: string): string[] {
  const start = src.indexOf(opener)
  assert.ok(start >= 0, `could not find "${opener}" — has the declaration been reshaped?`)
  const end = src.indexOf('\n}', start)
  assert.ok(end > start, `could not find the end of "${opener}"`)
  const keys = [...src.slice(start, end).matchAll(/^ {2}(\w+)\??:/gm)].map((m) => m[1]!)
  assert.ok(keys.length, `"${opener}" parsed as having no keys, which cannot be right`)
  return keys
}

test('the renderer has a case for every kind the server will send', () => {
  const kinds = constList(screens, 'BLOCK_KINDS').sort()
  const cases = [...code(renderer).matchAll(/case '(\w+)':?/g)].map((m) => m[1]!).sort()
  assert.deepEqual(
    cases,
    kinds,
    'a kind on the server with no case here renders NOTHING — the model composes a ' +
      'panel, the tool reports success, and the reader sees a gap. A case here with ' +
      'no kind on the server is dead code the model can never reach.',
  )
})

test('the renderer knows every field a block can arrive with', () => {
  // A field the server accepts and the renderer's `Block` type omits is a prop
  // the model is invited to send and that silently does nothing — the same
  // failure as a missing case, one level down.
  const schemaFields = [
    ...new Set([
      'kind',
      ...keysIn(screens, 'const leafFields = {'),
      ...keysIn(screens, 'const blockSchema = leafBlockSchema.extend({'),
    ]),
  ].sort()
  const rendererFields = keysIn(renderer, 'type Block = {').sort()
  assert.deepEqual(rendererFields, schemaFields)
})

test('a group is one level deep on both sides of the wire', () => {
  // The server cannot express a nested group (a column is typed as a LEAF
  // block) and says so again in `validateBlock`. The renderer is the third
  // place the same rule has to hold, because it is the only one that would
  // actually recurse.
  const leaves = constList(screens, 'LEAF_BLOCK_KINDS')
  assert.ok(!leaves.includes('group'), 'a group column must not be able to hold a group')
  assert.match(
    code(renderer),
    /dense \? null :/,
    'DeckeScreen must refuse to draw a group inside a group, whatever reaches it',
  )
})

test('nothing in the renderer can turn a model string into markup or a URL', () => {
  // The constraint that does not move: he picks components and content, never
  // markup, styling, class names, URLs or layout. `cardGrid` draws real art
  // now, and it does it by handing a catalog ID to `artForIds` and using the
  // URLs the APP's own endpoint returns — which is why there is still no `src`
  // or `href` written anywhere in this file.
  const body = code(renderer)
  assert.doesNotMatch(body, /dangerouslySetInnerHTML/)
  assert.doesNotMatch(body, /\bsrc=/, 'card art goes through CardImage, not a src set here')
  assert.doesNotMatch(body, /\bhref=/)
  assert.doesNotMatch(body, /new URL\(|https?:\/\//)
})

test('the engine command ops match between the server and the browser', () => {
  // The other list DECISIONS.md 2026-08-21 flagged. An op the server can emit
  // that `WireCommand` does not name is not a type error anywhere — the object
  // arrives, the union is a lie, and whether it does anything depends on a
  // switch further down.
  const m = tools.match(/op:\s*z[\s\S]{0,60}?\.enum\(\[([^\]]*)\]\)/)
  assert.ok(m, 'could not find the command op enum in apps/api/src/decke/tools.ts')
  const serverOps = [...m[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!).sort()

  const w = chat.match(/type WireCommand = \{[\s\S]{0,40}?op:\s*([^\n]+)/)
  assert.ok(w, 'could not find WireCommand’s op union in useDeckeChat.ts')
  const clientOps = [...w[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!).sort()

  assert.ok(serverOps.length, 'the server op enum parsed as empty')
  assert.deepEqual(clientOps, serverOps)
})
