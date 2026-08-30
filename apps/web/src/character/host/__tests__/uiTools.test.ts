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
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import {
  CLIENT_TOOLS,
  DECKE_REVEAL_EVENT,
  REVEAL_RETRY_MS,
  cardTileSelector,
  isClientTool,
  revealCardId,
  routeAllowed,
} from '../uiTools'

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

test('a card tile is addressable by ONE spelling, and that spelling only', () => {
  // The card tile is the only target that is allowed on its own authority
  // rather than by an ancestor `data-decke-landmark`, because the grid is
  // virtualized and the tile has no stable ancestor on three of the four pages
  // it renders on. What buys that exception is the strictness of the form: the
  // whole attribute name, the whole quoted id, and nothing else in the string.
  assert.equal(revealCardId('[data-decke-card="me05-084"]'), 'me05-084')
  assert.equal(revealCardId('[data-decke-card="swshp-SWSH001"]'), 'swshp-SWSH001')
  assert.equal(revealCardId(cardTileSelector('sv3pt5-151')), 'sv3pt5-151')

  // NOT a general CSS opening. Every one of these reaches for a tile, and every
  // one of them is a different capability from "name one card".
  assert.equal(revealCardId('[data-decke-card]'), null, 'any tile at all')
  assert.equal(revealCardId('[data-decke-card^="me05"]'), null, 'a prefix match')
  assert.equal(revealCardId('[data-decke-card="a"], .x'), null, 'a selector list')
  assert.equal(revealCardId('main [data-decke-card="a"]'), null, 'a descendant combinator')
  assert.equal(revealCardId('[data-decke-card="a"] img'), null, 'a child of a tile')
  assert.equal(revealCardId("[data-decke-card='a']"), null, 'single quotes')

  // The id cannot leave its own quoted value, which is what makes the single
  // `querySelector` downstream of this safe to hand a model-authored string.
  assert.equal(revealCardId('[data-decke-card="a"] [data-x="b"]'), null)
  assert.equal(revealCardId('[data-decke-card="a\\"]"]'), null)
  assert.equal(revealCardId('[data-decke-card="a b"]'), null)
  assert.equal(revealCardId('[data-decke-card=""]'), null)
  assert.equal(revealCardId(`[data-decke-card="${'x'.repeat(61)}"]`), null, 'unbounded length')
  assert.equal(revealCardId(undefined), null)
  assert.equal(revealCardId(42), null)
})

test('the near miss: two ordinary landmarks START with the tile attribute', () => {
  // `data-decke-card-grid` and `data-decke-card-image` are landmarks that have
  // been marked since Deck-E could point at anything, and both contain
  // `data-decke-card` as a prefix. A tile check written as a prefix match — or
  // a refusal written as `selector.includes('data-decke-card')` — would either
  // promote them to tiles or refuse two selectors the model is TOLD to use, and
  // the failure would look like Deck-E suddenly being unable to find the grid.
  const src = readFileSync(UI_TOOLS_SRC, 'utf8')
  assert.match(
    src,
    /data-decke-card\(\?!\[\\w-\]\)/,
    'the "is this about a tile" test must exclude a following `-` or word character',
  )
  assert.equal(revealCardId('[data-decke-card-grid]'), null)
  assert.equal(revealCardId('[data-decke-card-image]'), null)
  for (const near of ['[data-decke-card-grid]', '[data-decke-card-image]']) {
    assert.equal(
      /data-decke-card(?![\w-])/.test(near),
      false,
      `${near} must not read as a reach for a card tile`,
    )
  }
  assert.equal(/data-decke-card(?![\w-])/.test('[data-decke-card="me05-084"]'), true)
})

test('the reveal seam is one contract, named in one place', () => {
  // The event name and the retry interval are read by the set page, so they are
  // exported rather than inlined — a page listening for `decke:reveal` while the
  // host dispatches `deckeReveal` is a feature that silently does nothing, and
  // nothing in the type system would say so.
  assert.equal(DECKE_REVEAL_EVENT, 'decke:reveal')
  // Comfortably shorter than the 6 s cap on the wait it accompanies, so a page
  // that mounts late still gets asked several times before he gives up.
  assert.ok(REVEAL_RETRY_MS > 0 && REVEAL_RETRY_MS < 1000)
  const src = readFileSync(UI_TOOLS_SRC, 'utf8')
  assert.match(
    src,
    /window\.clearInterval\(asking\)/,
    'the repeated ask must be cleared when the wait ends, down every path',
  )
})

test('the addressable-card audit: exactly one component carries the tile address', () => {
  // The same tripwire the clickable audit is, for the same reason. This
  // attribute is what makes an element reachable WITHOUT a landmark ancestor,
  // so marking a new thing with it widens what Deck-E can point at by exactly
  // that thing — and unlike a landmark, there is no wrapper in a route file to
  // notice in review. Adding an entry here is meant to be a deliberate act.
  const root = fileURLToPath(new URL('../../../', import.meta.url))
  assert.deepEqual(
    markedAddressableFiles(root),
    [
      // ONE file, since 2026-08-29. The address used to sit on CardTile and on
      // TableView separately, because each built its own `<Link>` — and those
      // two copies of "where does clicking a card go" had already drifted (the
      // tile opened a scroll-preserving sheet where the row navigated away, and
      // the binder slot rendered no link at all on a list page). Both now render
      // `CardLink`, which owns the destination AND the address, so a card is
      // addressable in exactly the places it is clickable, by construction.
      //
      // A SHRINKING list is as much a reason to look as a growing one: if this
      // ever reports zero, `data-decke-card` has been dropped and every "take me
      // to that card" silently stops resolving.
      'components/CardLink.tsx',
    ],
    'the set of addressable-card components changed. This attribute makes an ' +
      'element a flyTo/highlight target with no landmark ancestor required, so ' +
      'a new entry widens what Deck-E can point at by exactly that thing — ' +
      'confirm it is a card link, then add it here. An entry DISAPPEARING is ' +
      'worse: it means cards stopped being addressable at all.',
  )
})

test('click is advertised, and the two attributes are kept distinct', () => {
  // `click` is the one tool whose authorisation is a SECOND attribute. If
  // `resolveClickTarget` ever checked only the landmark, every element he can
  // point at would become an element he can press — including the price block,
  // the completion bar, and whatever sits next to a quantity stepper.
  assert.equal(isClientTool('click'), true)
  const src = readFileSync(UI_TOOLS_SRC, 'utf8')
  assert.match(src, /data-decke-clickable/, 'the pressable attribute is not checked at all')
  assert.match(
    src,
    /closest<HTMLElement>\('\[data-decke-clickable\]'\)/,
    'clicking must require its own attribute, not reuse the landmark',
  )
})

test('the clickable audit: every marked control is listed here on purpose', () => {
  // THE POINT OF THIS TEST is that it fails when someone marks something new.
  // The runtime cannot inspect what a React onClick does, so "never a write" is
  // a property of the marking discipline rather than a control — and a
  // discipline with nothing checking it is a preference. A new entry here is a
  // deliberate act with a reviewer attached.
  //
  // The evidence that this is needed: the spec that designed the click tool
  // listed the quantity stepper and the add-card control as clickable in its
  // own table. Both are writes. It caught itself.
  //
  // IT SCANS THE WHOLE OF `src`, and that is the correction. It used to read
  // `routes/` non-recursively, which let the single most important element to
  // mark — the sidebar nav in `components/AppShell.tsx` — be marked without the
  // audit ever noticing. An audit with a blind spot over the highest-value
  // target is worse than none, because it reports "reviewed" about a file it
  // never opened. Entries are recorded as paths relative to `src` so the list
  // says WHERE, not just which basename.
  const root = fileURLToPath(new URL('../../../', import.meta.url))
  const marked = markedClickableFiles(root)

  assert.deepEqual(
    marked,
    [
      // The sidebar nav rows. Bare `<Link to={item.to}>`, no `onClick`, and
      // every `to` in `NAV` is on the route allowlist — pinned below, because
      // that `to` is a variable and a seventh entry would inherit the marking.
      'components/AppShell.tsx',
      // The "Additional Variants" disclosure. `setShowAdditional(!x)` and
      // nothing else; the quantity steppers it reveals are writes and stay
      // unmarked — revealing a control is not operating it.
      'routes/CardDetail.tsx',
      // The set rows. Bare `<Link>` to `/series/<slug>/<setId>`, no handler.
      'routes/SeriesDetail.tsx',
      // Two: the series cards (bare `<Link>` to `/series/<slug>`), and the
      // "show the series you have not collected" disclosure, whose handler is
      // `setShowOthers(true)` and nothing else.
      'routes/SeriesIndex.tsx',
    ],
    'a control was marked pressable without updating this audit. Read its onClick: ' +
      'if it writes, navigates somewhere off the allowlist, or touches auth, it must not be ' +
      'marked. If it is genuine navigation or disclosure, add it here deliberately.',
  )
})

test('every sidebar route a marked nav row can reach is on the allowlist', () => {
  // ── WHAT THIS CHECKS, AND WHAT IT HONESTLY CANNOT ────────────────────────
  //
  // It does NOT check that a marked element never writes. That property is
  // semantic — it depends on what a React `onClick` closure does, transitively,
  // through hooks this suite has no way to evaluate — and every static
  // approximation of it we could write here would either pass on a real write
  // or fail on the two disclosures already audited above. A test that cannot
  // fail on the thing it names is worse than no test, so the write rule stays
  // where the code says it is: the marking discipline, reviewed per addition,
  // with the audit list above as the tripwire.
  //
  // What IS statically checkable is the OTHER navigation rule, and it is the
  // one with a moving part. `AppShell.tsx` marks `<Link to={item.to}>` inside a
  // loop over `NAV`, so the destination is a variable: every one is allowlisted
  // today, and a seventh entry pointing anywhere else — `/profile`, which mints
  // API tokens, being the obvious one — would inherit the pressable marking
  // with nothing to notice. Every other marked element in this app names its
  // route as a literal in the same JSX as the marking, where a reviewer reading
  // the diff sees it. This one does not, so it gets a test.
  //
  // `resolveClickTarget` refuses an off-allowlist `href` at press time as well.
  // This is the earlier of the two: red at commit rather than a refusal at run
  // time that only shows up if somebody asks Deck-E to press the thing.
  const src = readFileSync(
    fileURLToPath(new URL('../../../components/AppShell.tsx', import.meta.url)),
    'utf8',
  )
  const m = src.match(/const NAV: NavItem\[\] = \[([\s\S]*?)\n\]/)
  assert.ok(m, 'could not find the NAV array in components/AppShell.tsx')
  // One NAV entry per line. A row carrying `deckeReachable: false` renders as a
  // plain `<Link>` with no `data-decke-*` marking (its route subtree is
  // sensitive — `/family` holds `/family/admin`), so Deck-E cannot press it and
  // its `to` is deliberately NOT required on the allowlist.
  const routes = m[1]!
    .split('\n')
    .filter((line) => /\bto:\s*'[^']*'/.test(line) && !/\bdeckeReachable:\s*false\b/.test(line))
    .map((line) => line.match(/\bto:\s*'([^']*)'/)![1]!)

  // A finder that finds nothing passes vacuously, which reads exactly like
  // "every route is fine". Pin the count so a rename of NAV or a switch to
  // double quotes fails loudly instead of silently approving.
  assert.ok(routes.length >= 5, `found only ${routes.length} nav routes; the matcher is broken`)
  for (const route of routes) {
    assert.ok(
      routeAllowed(route),
      `NavRow marks its <Link> data-decke-clickable, so Deck-E may press this row — but ` +
        `${route} is not on ROUTE_ALLOWLIST. Either the route belongs on the allowlist, or ` +
        `this nav row must not be pressable.`,
    )
  }
})

test('the audit detector sees the markings a lazier one would miss', () => {
  // The old detector was `/^\s*data-decke-clickable\s*$/` per line: an attribute
  // alone on its own line, and nothing else. That is one of four ways to write
  // the same marking, so three of them were invisible to it — a discipline that
  // can be escaped by reformatting is not a discipline. These fixtures pin the
  // detector itself, because a test whose finder is broken passes by finding
  // nothing, which reads exactly like "nobody marked anything".
  const dir = mkdtempSync(join(tmpdir(), 'decke-audit-'))
  try {
    mkdirSync(join(dir, 'nested'), { recursive: true })
    // Four spellings that ARE markings.
    writeFileSync(join(dir, 'a.tsx'), '<button data-decke-clickable onClick={go} />')
    writeFileSync(join(dir, 'b.tsx'), '<button\n  data-decke-clickable\n/>')
    writeFileSync(join(dir, 'c.tsx'), '<button data-decke-clickable={true} />')
    writeFileSync(join(dir, 'nested', 'd.tsx'), '<a\tdata-decke-clickable>x</a>')
    // Four that are NOT: a selector, a line comment, a block comment, and a
    // longer attribute that merely starts with the same characters.
    writeFileSync(join(dir, 'e.tsx'), "const s = '[data-decke-clickable]'")
    writeFileSync(join(dir, 'f.tsx'), '// data-decke-clickable is a second authorisation\n<b />')
    writeFileSync(join(dir, 'g.tsx'), '/* data-decke-clickable\n   spans lines */\n<b />')
    writeFileSync(join(dir, 'h.tsx'), '<button data-decke-clickable-reason="nav" />')
    // A `.ts` file cannot carry a JSX attribute, and `uiTools.ts` legitimately
    // names the attribute in a selector. Extension filtering is what keeps that
    // out without an exclusion list that would have to be maintained.
    writeFileSync(join(dir, 'i.ts'), "el.closest('[data-decke-clickable]')")

    assert.deepEqual(markedClickableFiles(dir), [
      'a.tsx',
      'b.tsx',
      'c.tsx',
      'nested/d.tsx',
    ])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

/**
 * Every `.tsx` file under `root` that MARKS an element pressable, as paths
 * relative to `root`, sorted.
 *
 * "Marks" means the attribute in JSX attribute position. The distinction that
 * matters is between a MARKING and a MENTION: `uiTools.ts` queries
 * `'[data-decke-clickable]'`, `tools.ts` and `SeriesIndex.tsx` both explain the
 * attribute in prose, and none of those authorise anything. So comments are
 * stripped first, a preceding `[` or word character disqualifies a match, and a
 * trailing `-` does too — `data-decke-clickable-reason` would otherwise read as
 * a marking.
 */
function markedClickableFiles(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '__tests__') continue
        walk(join(dir, entry.name), rel)
        continue
      }
      if (!entry.name.endsWith('.tsx')) continue
      if (marksClickable(readFileSync(join(dir, entry.name), 'utf8'))) out.push(rel)
    }
  }
  walk(root, '')
  return out.sort()
}

function marksClickable(src: string): boolean {
  return /(^|[^\w[-])data-decke-clickable(?![\w-])/.test(stripComments(src))
}

/**
 * Every `.tsx` file under `root` that gives an element Deck-E's CARD ADDRESS.
 *
 * The same marking-versus-mention distinction `markedClickableFiles` draws, and
 * here the mentions genuinely outnumber the markings: `GridView.tsx` and
 * `SetDetail.tsx` both BUILD `[data-decke-card="…"]` to look a tile up, and a
 * leading `[` is what tells those apart from a JSX attribute. The trailing
 * guard is the load-bearing half — `data-decke-card-grid` and
 * `data-decke-card-image` are ordinary landmarks and must not be listed here.
 */
function markedAddressableFiles(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '__tests__') continue
        walk(join(dir, entry.name), rel)
        continue
      }
      if (!entry.name.endsWith('.tsx')) continue
      const src = stripComments(readFileSync(join(dir, entry.name), 'utf8'))
      if (/(^|[^\w[-])data-decke-card(?![\w-])/.test(src)) out.push(rel)
    }
  }
  walk(root, '')
  return out.sort()
}

/** Block comments, then line comments — `://` spared so a URL survives. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}
