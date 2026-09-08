/**
 * The scanner is owner-only, and every door to it agrees about that.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * Why this is a source-reading test, and why that is the honest shape here
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * The thing being protected is not a function's return value — it is a PROPERTY
 * OF THE WHOLE APP: that no door to the scanner opens for a non-owner, and that
 * no surface a non-owner sees mentions it. There are six doors (a route guard, a
 * rail row, a header button, a mobile drawer row, Deck-E's navigation
 * allowlist, and the marketing page), they live in five files, and the failure
 * mode is somebody adding a seventh — or quietly deleting one guard while the
 * other five keep the test suite green.
 *
 * Rendering the router would check one door. Reading the sources checks that
 * the SET is closed, which is the property that actually matters, and it is the
 * same technique `character/host/__tests__/selfHostGate.test.ts` already uses
 * for the same kind of cross-file coupling — including its habit of making the
 * failure message the instruction.
 *
 * Every assertion below strips comments first. This file is surrounded by prose
 * about `notFound()` and `owner`, and a test that matched its own explanation
 * would pass a codebase where the gate had been deleted and only the comment
 * left behind.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** repo root, from apps/web/src/scan/ui/__tests__/ */
const ROOT = fileURLToPath(new URL('../../../../../../', import.meta.url))

/** Source with comments removed — a promise in prose is not a gate. */
function code(rel: string): string {
  return readFileSync(new URL(rel, `file://${ROOT}`), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const MAIN = 'apps/web/src/main.tsx'
const SHELL = 'apps/web/src/components/AppShell.tsx'

// ── 1 · the route guard ─────────────────────────────────────────────────────

/**
 * The exact three-branch shape `/design`, `/dev/decke` and `/dev/quad-labeler`
 * all use: dev open, self-host open, cloud asks the server, everything else
 * `notFound()`. Matched as a shape rather than as a string so reformatting is
 * allowed and removing a branch is not.
 */
function routeGuardFor(src: string, path: string): string {
  // The createRoute({...}) block whose `path` is this one, up to `component:`.
  const re = new RegExp(`path:\\s*'${path.replace(/\//g, '\\/')}'[\\s\\S]*?component:`, 'm')
  const m = re.exec(src)
  assert.ok(m, `no route declaring path: '${path}' in ${MAIN}`)
  return m[0]
}

test('/scan has a beforeLoad guard at all', () => {
  const guard = routeGuardFor(code(MAIN), '/scan')
  assert.match(
    guard,
    /beforeLoad:\s*async/,
    `the /scan route in ${MAIN} has no beforeLoad. It shipped open to the world before 2026-09-07 ` +
      'and the owner asked for it to be owner-only — if that has been reversed deliberately, this ' +
      'test and the API gate in apps/api/src/scan/router.ts both have to go with it.',
  )
})

test('/scan is gated on the SERVER-VERIFIED owner flag, not on being signed in', () => {
  const guard = routeGuardFor(code(MAIN), '/scan')
  assert.match(
    guard,
    /await\s+api\.me\(\)/,
    '/scan no longer asks the server who is calling. A client-side notion of "the owner" is a ' +
      'suggestion, not a gate — the identity lives in DESIGN_EDITOR_USER_ID, server-side, and ' +
      'nothing about it may reach this bundle.',
  )
  assert.match(guard, /me\.owner/, '/scan must read `owner`, the same flag /dev/decke reads')
})

test('/scan fails CLOSED: the guard ends in notFound(), and the catch falls through to it', () => {
  const guard = routeGuardFor(code(MAIN), '/scan')
  assert.match(
    guard,
    /catch\s*\{[^}]*\}\s*throw\s+notFound\(\)/,
    'the /scan guard no longer ends with `throw notFound()` after its catch. A guard that swallows ' +
      'a failed /me and RETURNS has opened the route to every signed-out visitor and every network ' +
      'blip — which is the direction an owner gate may never fail.',
  )
  // 404, not a redirect to /auth: a redirect tells the visitor a scanner exists
  // and that an account might get them in. Neither is true.
  assert.doesNotMatch(guard, /redirect\(/, 'the /scan guard must not redirect — it must look absent')
})

test('/scan opens for local dev and for self-host, exactly like every other owner-only route', () => {
  const guard = routeGuardFor(code(MAIN), '/scan')
  assert.match(guard, /import\.meta\.env\.DEV/, 'local dev must stay open or nobody can build the feature')
  assert.match(guard, /!isCloudMode/, 'self-host has one user behind their own auth proxy — it stays open')
})

test('the /scan guard is the same shape as /dev/decke — the precedent it was copied from', () => {
  const src = code(MAIN)
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim()
  const bodyOf = (path: string) => {
    const g = routeGuardFor(src, path)
    const m = /beforeLoad:\s*async\s*\(\)\s*=>\s*\{([\s\S]*)\}\s*,?\s*component:/.exec(g)
    assert.ok(m, `could not read the beforeLoad body for ${path}`)
    return norm(m[1]!)
  }
  assert.equal(
    bodyOf('/scan'),
    bodyOf('/dev/decke'),
    'the /scan guard has drifted from /dev/decke. They are deliberately identical: one owner gate, ' +
      'copied, so that a fix or a widening applies to both rather than to whichever one somebody ' +
      'remembered. If they must differ now, say why here and delete this assertion.',
  )
})

// ── 2 · the quad labeler keeps its gate AND its preview allowance ────────────

test('the quad labeler is still owner-only on production', () => {
  const guard = routeGuardFor(code(MAIN), '/dev/quad-labeler')
  assert.match(guard, /me\.owner/, '/dev/quad-labeler must still end at the owner flag on production')
  assert.match(
    guard,
    /catch\s*\{[^}]*\}\s*throw\s+notFound\(\)/,
    '/dev/quad-labeler must still fail closed to notFound()',
  )
})

test('the quad labeler keeps its *.vercel.app preview allowance — do not "tidy" this away', () => {
  const guard = routeGuardFor(code(MAIN), '/dev/quad-labeler')
  assert.match(
    guard,
    /hostname\.endsWith\(\s*'\.vercel\.app'\s*\)/,
    'the labeler lost its preview allowance. It is there because the owner labels signed in as QA ' +
      '(AGENTS.md B12) and the recorder it writes to is already non-production-unconditional ' +
      '(apps/api/src/dev/scanFlags.ts) — an owner-only gate here locked out the only person who ' +
      'uses the surface, measured as a "Not Found" in round 9. Production stays owner-only either way.',
  )
})

test('the SCANNER does not get the labeler’s preview allowance', () => {
  // Not an oversight — a decision. `/scan` was gated "exactly like Deck-E",
  // which is owner-only on every cloud deployment including previews. The
  // labeler needs QA to reach it; the scanner does not.
  const guard = routeGuardFor(code(MAIN), '/scan')
  assert.doesNotMatch(guard, /vercel\.app/, '/scan picked up a preview allowance it was not given')
})

// ── 3 · the nav ─────────────────────────────────────────────────────────────

test('the Scan Card nav row is marked ownerOnly', () => {
  const src = code(SHELL)
  const row = /\{[^{}]*to:\s*'\/scan'[^{}]*\}/.exec(src)
  assert.ok(row, `no /scan nav entry found in ${SHELL}`)
  assert.match(
    row[0],
    /ownerOnly:\s*true/,
    'the Scan Card row is no longer ownerOnly, so every signed-in visitor is offered a link to a ' +
      'route that answers Not Found.',
  )
})

test('BOTH nav surfaces filter the rows — the rail and the mobile drawer', () => {
  const src = code(SHELL)
  const uses = src.match(/visibleNav\(/g) ?? []
  assert.ok(
    uses.length >= 3,
    `visibleNav is called ${uses.length} times; expected at least 3 (its definition, the rail, the ` +
      'drawer). On a phone the drawer is the ONLY nav, so a filter applied to just the rail hides ' +
      'nothing where it matters most — that is issue #52 with a leak attached.',
  )
  assert.doesNotMatch(
    src,
    /\{NAV\.map\(/,
    'a nav surface is mapping the raw NAV array again instead of visibleNav(owner), which renders ' +
      'the owner-only rows for everybody.',
  )
})

test('an unknown owner status HIDES — undefined is not "show it for now"', () => {
  const src = code(SHELL)
  assert.match(
    src,
    /NAV\.filter\(\(item\)\s*=>\s*!item\.ownerOnly\s*\|\|\s*owner\s*===\s*true\)/,
    'visibleNav no longer requires `owner === true`. `undefined` means the /me answer has not ' +
      'arrived; treating it as truthy flashes the scanner row at every visitor for one tick, which ' +
      'tells them a scanner exists — the exact thing the gate removes.',
  )
})

test('the header camera button renders only for the owner, with no signed-out fallback', () => {
  const src = code(SHELL)
  assert.match(
    src,
    /owner === true && \(\s*<Link\s+to="\/scan"/,
    'the header Scan button is no longer wrapped in `owner === true`.',
  )
  assert.doesNotMatch(
    src,
    /to=\{signedIn === false \? '\/auth' : '\/scan'\}/,
    "the Scan button has gone back to sending signed-out visitors to the sign-up form. That was a " +
      'promise — "make an account and you can scan" — and it stopped being true when the route and ' +
      'the API both began refusing everyone but the owner.',
  )
})

// ── 4 · no other door, and no trace ─────────────────────────────────────────

test("Deck-E cannot walk somebody to /scan — he is entitled to more accounts than the scanner is", () => {
  for (const f of ['apps/api/src/decke/tools.ts', 'apps/web/src/character/host/uiTools.ts']) {
    const list = /ROUTE_ALLOWLIST[\s\S]*?\]/.exec(code(f))
    assert.ok(list, `no ROUTE_ALLOWLIST in ${f}`)
    assert.doesNotMatch(
      list[0],
      /'\/scan'/,
      `${f} still allows Deck-E to navigate to /scan. DECKE_ENTITLED_USER_IDS deliberately includes ` +
        'the QA account, which is NOT the owner, so he would be walking an entitled non-owner to a ' +
        'page that answers Not Found. Both lists mirror each other; change them together.',
    )
  }
})

test('the public marketing page no longer advertises the scanner', () => {
  const landing = code('apps/web/src/routes/Landing.tsx')
  assert.doesNotMatch(
    landing,
    /<ScanMockup/,
    'the card-scanner feature block is back on the landing page. That page is what SIGNED-OUT ' +
      'visitors see, and the scanner answers Not Found for every one of them — an advertisement for ' +
      'an unreachable feature is the trace the gate exists to remove.',
  )
  assert.doesNotMatch(landing, /eyebrow="Card scanner"/, 'the Card scanner feature block is back')
})

test('the crawler-facing metadata no longer promises a scanner', () => {
  const html = readFileSync(new URL('apps/web/index.html', `file://${ROOT}`), 'utf8')
  const metaAndLd = html
    .split('\n')
    .filter((l) => /content=|"description":/.test(l))
    .join('\n')
  assert.doesNotMatch(
    metaAndLd,
    /scanner/i,
    'index.html advertises a scanner to search engines and social crawlers again. Every reader who ' +
      'arrives from one of those is a non-owner, and the feature answers Not Found for them.',
  )
})
