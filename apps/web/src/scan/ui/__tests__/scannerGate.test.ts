/**
 * Execute the production capability decision, then verify each scanner entrance
 * is wired to it. Actual SPA browser journeys cover both modes, navigation and
 * revocation; these tests catch a weakened guard or a mismatched capability.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { hasVerifiedPermission, requireVerifiedCapability, type CapabilitySnapshot } from '../../../lib/capabilities'

const ROOT = fileURLToPath(new URL('../../../../../../', import.meta.url))
function code(rel: string): string {
  return readFileSync(new URL(rel, 'file://' + ROOT), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}
const MAIN = 'apps/web/src/main.tsx', SHELL = 'apps/web/src/components/AppShell.tsx'
function routeGuardFor(src: string, path: string): string {
  const start = src.indexOf("path: '" + path + "'")
  assert.ok(start >= 0, 'Missing route ' + path)
  const end = src.indexOf('component:', start)
  assert.ok(end > start, 'Missing route component for ' + path)
  return src.slice(start, end)
}
const verified = (permissions: string[]): CapabilitySnapshot => ({ ready: true, permissions })
const notFound = { isNotFound: true }
const guard = (access: CapabilitySnapshot, permission = 'scanner.use') =>
  requireVerifiedCapability(permission, async () => access, () => notFound)

test('an explicit scanner capability opens the production route decision', async () => {
  await guard(verified(['scanner.use']))
  await guard(verified(['scanner.use', 'scanner.label']))
})
test('ordinary and signed-out verified accounts are denied', async () => {
  await assert.rejects(guard(verified([])), error => error === notFound)
})
test('labeler permission grants training tools but never the scanner', async () => {
  const labeler = verified(['scanner.label'])
  await guard(labeler, 'scanner.label')
  await assert.rejects(guard(labeler), error => error === notFound)
})
test('scanner access does not implicitly grant labeling or diagnostics', async () => {
  const scanner = verified(['scanner.use'])
  await assert.rejects(guard(scanner, 'scanner.label'), error => error === notFound)
  await assert.rejects(guard(scanner, 'diagnostics.view'), error => error === notFound)
})
test('unknown access fails closed even if an old capability is present', async () => {
  await assert.rejects(guard({ ready: false, permissions: ['scanner.use'] }), /Cannot verify account access/)
})
test('verification failure is unavailable, never a settled grant or not-found denial', async () => {
  await assert.rejects(guard({ ...verified(['scanner.use']), error: '503' }), /Cannot verify account access/)
  const unavailable = new Error('identity request failed')
  await assert.rejects(requireVerifiedCapability('scanner.use', async () => { throw unavailable }, () => notFound), error => error === unavailable)
})
test('revocation and suspension clear a previously granted capability on the next check', async () => {
  let access = verified(['scanner.use'])
  const load = async () => access
  await requireVerifiedCapability('scanner.use', load, () => notFound)
  access = verified([])
  await assert.rejects(requireVerifiedCapability('scanner.use', load, () => notFound), error => error === notFound)
})
test('role labels and legacy owner flags cannot grant a capability', async () => {
  const legacy = { ...verified([]), owner: true, labeler: true, roles: [{ name: 'Super administrator' }] }
  await assert.rejects(guard(legacy), error => error === notFound)
})
test('all scanner and diagnostics routes use their precise server capability with no preview shortcut', () => {
  const src = code(MAIN)
  for (const [path, permission] of [
    ['/scan', 'scanner.use'], ['/dev/quad-labeler', 'scanner.label'],
    ['/dev/quad-harvest', 'scanner.label'], ['/design', 'design.view'],
    ['/dev/decke', 'diagnostics.view'], ['/dev/chat-ui', 'diagnostics.view'],
    ['/dev/decke-compare', 'diagnostics.view'], ['/dev/scan-harness', 'diagnostics.view'],
  ]) {
    const route = routeGuardFor(src, path!)
    assert.match(route, new RegExp("beforeLoad:\\s*\\(\\)\\s*=>\\s*requireCapability\\('" + permission + "'\\)"), path + ' must await its shared capability guard')
    assert.doesNotMatch(route, /import\.meta|preview|isCloudMode|\.owner|\.labeler/, path + ' must have no deployment or legacy flag bypass')
  }
  assert.match(src, /requireCapability\s*=\s*\(permission: string\)\s*=>\s*requireVerifiedCapability\(permission, getAccess, notFound\)/)
  const access = code('apps/web/src/lib/access.ts')
  assert.match(access, /const me = await api\.me\(\)/)
  assert.match(access, /permissions: me\.permissions \?\? \[\]/)
  assert.match(access, /return hasVerifiedPermission\(access, key\)/)
  assert.doesNotMatch(code('apps/web/src/lib/capabilities.ts'), /import\.meta|preview|isCloudMode/)
})
test('permission matching is exact; unrelated capabilities never expose the scanner', () => {
  assert.equal(hasVerifiedPermission(verified(['scanner.label', 'decke.use', 'admin.access']), 'scanner.use'), false)
  assert.equal(hasVerifiedPermission(verified(['scanner.use']), 'scanner.use'), true)
})
test('scanner navigation is shared, permission filtered and hidden for empty access', () => {
  const src = code(SHELL)
  const row = /\{[^{}]*to: '\/scan'[^{}]*\}/.exec(src)
  assert.ok(row, 'Missing scanner navigation row')
  assert.match(row[0], /permission: 'scanner\.use'/)
  assert.match(src, /NAV\.filter\(\(item\)\s*=>\s*!item\.permission\s*\|\|\s*permissions\.includes\(item\.permission\)\)/)
  assert.equal((src.match(/visibleNav\(permissions\)\.map/g) ?? []).length, 2, 'Both rail and mobile drawer must filter the shared NAV')
  assert.doesNotMatch(src, /\{NAV\.map\(/, 'No navigation surface may render unfiltered rows')
  assert.match(src, /permissions\.includes\('scanner\.use'\) && \(\s*<Link\s+to="\/scan"/)
  assert.doesNotMatch(src, /to=\{signedIn === false \? '\/auth' : '\/scan'\}/)
})
test('live scanner revocation protects already mounted pages as well as navigation', () => {
  const src = code(MAIN)
  assert.match(src, /'\/scan': 'scanner\.use'/)
  assert.match(src, /const access = useAccess\(\)/)
  assert.match(src, /permission && \(!access\.ready \|\| !access\.permissions\.includes\(permission\)\)/)
})

// ── 4 · no other door, and no trace ─────────────────────────────────────────

test("Deck-E cannot walk somebody to /scan — Deck-E access does not grant scanner access", () => {
  for (const f of ['apps/api/src/decke/tools.ts', 'apps/web/src/character/host/uiTools.ts']) {
    const list = /ROUTE_ALLOWLIST[\s\S]*?\]/.exec(code(f))
    assert.ok(list, `no ROUTE_ALLOWLIST in ${f}`)
    assert.doesNotMatch(
      list[0],
      /'\/scan'/,
      `${f} still allows Deck-E to navigate to /scan. decke.use can be assigned to ` +
        'accounts without scanner.use, so this would offer a scanner-ineligible user a ' +
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
    'index.html advertises a scanner to search engines and social crawlers again. An ordinary reader who ' +
      'arrives from one of those has no scanner capability, and the feature answers Not Found.',
  )
})
