/**
 * Does vercel.json actually ship the security headers SEC-03/SEC-14 called for?
 *
 * The Vercel static layer serves this app's HTML documents directly — no
 * Express, no helmet — so `vercel.json`'s `headers` array is the ONLY place a
 * CSP, frame-ancestors or nosniff can be attached to them (DECISIONS.md
 * 2026-09-26, "deckpal.app's HTML ships with no CSP..."). A JSON config file
 * has no type system, so a future edit that loosens a directive, drops a
 * header, or points `frame-ancestors` somewhere other than `'none'` would
 * look just as clean as this one and nothing would catch it. This is that
 * catch — same spirit as check-redirects.mjs, parsing the real config and
 * running real assertions against it rather than eyeballing a diff.
 *
 * It also guards the two pieces of this policy that can silently drift out
 * from under it:
 *
 * 1. The inline first-paint watchdog script in `apps/web/index.html`, and
 *    `apps/web/src/routes/dev/scan-harness.html`'s single classic <script>,
 *    are both covered by a `sha256-` source in `script-src` (not
 *    `'unsafe-inline'`) -- the watchdog's own
 *    comment says it MUST stay inline (a watchdog that needs a request of its
 *    own cannot cover a failure to fetch, so moving it to a static file would
 *    reintroduce the exact "blank page, no explanation" bug, #75, it exists
 *    to prevent). The scan harness is a separate iframe document with its
 *    own policy so OpenCV can use JavaScript code generation without relaxing
 *    the parent page. A hash that no longer matches its script doesn't error at build time -- it
 *    just silently blocks the script in every real browser. So this
 *    recomputes both hashes from the live files on every run.
 *
 * 2. The two diagnostic routes have their own response policies:
 *    `/dev/decke-compare` (diagnostics.view-gated, but a real shipping route)
 *    renders a same-origin recursive `<iframe src={window.location.pathname}
 *    ?frame=...}>` to compare the shipped Deck-E model against a candidate --
 *    `frame-ancestors 'none'` on that page's OWN response would refuse that
 *    self-framing (a document's frame-ancestors governs who may frame IT,
 *    independent of frame-src, which only governs what a page may itself
 *    embed), so it carries its own headers rule with `frame-ancestors 'self'`
 *    / `X-Frame-Options: SAMEORIGIN` instead. Everything else about that
 *    rule's CSP must stay identical to the general one -- this asserts that
 *    directly (a diff, not two independent copies of every assertion), so a
 *    future edit to one can't quietly drift from the other. The scan harness
 *    asset needs JavaScript code generation for its shipped OpenCV embind
 *    wrapper and `frame-ancestors 'self'` to sit in the app's iframe.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const vercelConfig = JSON.parse(readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'))

function headersByKey(rule) {
  return Object.fromEntries(rule.headers.map((h) => [h.key, h.value]))
}
function cspDirectives(cspValue) {
  return Object.fromEntries(
    cspValue.split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
      const [name, ...rest] = d.split(/\s+/)
      return [name, rest.join(' ')]
    }),
  )
}

// ── Locate both rules ─────────────────────────────────────────────────────────
const general = vercelConfig.headers.find((h) => h.source === '/((?!api/|dev/decke-compare$|assets/scan-harness-).*)')
assert.ok(general, 'vercel.json must protect every app document and leave the two special responses to their own rules')
const deckeCompare = vercelConfig.headers.find((h) => h.source === '/dev/decke-compare')
assert.ok(deckeCompare, 'vercel.json must have a dedicated headers rule for /dev/decke-compare (its own same-origin recursive iframe needs frame-ancestors \'self\', not \'none\')')
const scanHarness = vercelConfig.headers.find((h) => h.source === '/assets/scan-harness-(.*).html')
assert.ok(scanHarness, 'vercel.json must have a dedicated headers rule for the hashed OpenCV harness document')

const generalHeaders = headersByKey(general)
const deckeCompareHeaders = headersByKey(deckeCompare)
const scanHarnessHeaders = headersByKey(scanHarness)
for (const [label, byKey] of [['general', generalHeaders], ['/dev/decke-compare', deckeCompareHeaders], ['/dev/scan-harness', scanHarnessHeaders]]) {
  for (const key of ['Content-Security-Policy', 'X-Frame-Options', 'X-Content-Type-Options', 'Referrer-Policy', 'Permissions-Policy']) {
    assert.ok(byKey[key], `${label} headers rule is missing ${key}`)
  }
}

// ── The general rule's source pattern ────────────────────────────────────────
// The same "parse the real regex, don't trust the string" approach
// check-redirects.mjs uses, because a hand-tightened lookahead is exactly the
// kind of thing that silently rots.
const match = /^\/\((.+)\)$/.exec(general.source)
assert.ok(match, `source "${general.source}" is not the expected /(<pattern>) shape`)
const re = new RegExp(`^${match[1]}$`)
for (const p of ['', 'lists', 'collection', 'authorize', 'scan', 'mcp', 'register', 'token', '.well-known/oauth-authorization-server', 'dev/scan-harness']) {
  assert.ok(re.test(p), `general headers source must still match ordinary path "/${p}"`)
}
// Bare "/api" (no trailing slash) matches no rewrite and falls through to the
// SPA shell, so it is correctly an HTML document and correctly NOT excluded
// here -- only "/api/<something>", which the /api/(.*) rewrite sends to the
// serverless function (and which already gets helmet's headers there), must
// be excluded. /dev/decke-compare is excluded too -- it has its own rule.
for (const p of ['api/', 'api/health', 'api/decks/123/pdf', 'dev/decke-compare', 'assets/scan-harness-abc.html']) {
  assert.ok(!re.test(p), `general headers source must exclude "/${p}"`)
}

// ── Content-Security-Policy directives (general rule) ────────────────────────
const generalCsp = cspDirectives(generalHeaders['Content-Security-Policy'])

assert.equal(generalCsp['default-src'], "'self'", 'default-src must be locked to self')
assert.equal(generalCsp['object-src'], "'none'", 'object-src must be none (no plugins)')
assert.match(generalCsp['frame-ancestors'], /'none'/, 'frame-ancestors must be none -- this is the clickjacking fix (SEC-03)')
assert.match(generalCsp['base-uri'], /'self'/, 'base-uri must be locked to self')
assert.match(generalCsp['form-action'], /'self'/, 'form-action must be locked to self')
// Never allow the two directives that make a hash/nonce policy pointless.
for (const name of ['script-src', 'style-src']) {
  assert.ok(!/'unsafe-eval'/.test(generalCsp[name] ?? ''), `${name} must not carry 'unsafe-eval'`)
}
assert.ok(!/'unsafe-inline'/.test(generalCsp['script-src'] ?? ''), "script-src must not carry 'unsafe-inline' -- it ships sha256 hashes instead")

// Every plain (no type/src) inline <script> this app ships must have its
// sha256 hash present in script-src, recomputed from the live file on every
// run rather than eyeballed once and forgotten.
const inlineScriptSources = [
  { file: 'apps/web/index.html', label: 'first-paint watchdog', extract: (html) => [...html.matchAll(/<script>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).find((s) => s.includes('first-paint-watchdog')) },
  { file: 'apps/web/src/routes/dev/scan-harness.html', label: 'scan-harness bakeoff tool', extract: (html) => /<script>([\s\S]*)<\/script>/i.exec(html)?.[1] },
]
for (const { file, label, extract } of inlineScriptSources) {
  const content = extract(readFileSync(path.join(ROOT, file), 'utf8'))
  assert.ok(content, `${file} must still have its inline <script> (${label})`)
  const liveHash = `sha256-${createHash('sha256').update(content, 'utf8').digest('base64')}`
  assert.ok(
    generalCsp['script-src'].includes(`'${liveHash}'`),
    `script-src's sha256 hash for ${file} (${label}) is stale: the live script hashes to '${liveHash}', but vercel.json's script-src is "${generalCsp['script-src']}". ` +
      'Either that script changed (recompute and update vercel.json) or the CSP drifted -- either way, ship the new hash together with the file that changed.',
  )
}

// ── The other headers (general rule) ─────────────────────────────────────────
assert.equal(generalHeaders['X-Frame-Options'], 'DENY', 'X-Frame-Options must be DENY (belt-and-suspenders with frame-ancestors)')
assert.equal(generalHeaders['X-Content-Type-Options'], 'nosniff')
assert.match(generalHeaders['Referrer-Policy'], /strict-origin-when-cross-origin/)

const generalPermissions = generalHeaders['Permissions-Policy']
// The scanner (camera) and its shipping voice-annotation input (microphone)
// must stay allowed for the app's own origin -- this is the one header on
// this rule where "more locked down" is not simply "more correct".
assert.match(generalPermissions, /camera=\(self\)/, 'camera must stay allowed on self for the scanner')
assert.match(generalPermissions, /microphone=\(self\)/, 'microphone must stay allowed on self for scanner voice input')
assert.match(generalPermissions, /geolocation=\(\)/, 'geolocation is unused; keep it denied')

// ── /dev/decke-compare must match the general rule EXACTLY except for the
// two headers its self-framing needs loosened ──────────────────────────────
const deckeCompareCsp = cspDirectives(deckeCompareHeaders['Content-Security-Policy'])
for (const name of Object.keys(generalCsp)) {
  if (name === 'frame-ancestors') continue
  assert.equal(deckeCompareCsp[name], generalCsp[name], `/dev/decke-compare's CSP directive "${name}" has drifted from the general rule's -- only frame-ancestors is meant to differ`)
}
assert.match(deckeCompareCsp['frame-ancestors'], /'self'/, "/dev/decke-compare needs frame-ancestors 'self' for its own same-origin recursive iframe")
assert.ok(!/'none'/.test(deckeCompareCsp['frame-ancestors']), "/dev/decke-compare's frame-ancestors must not be 'none' -- that would refuse its own self-framing")
for (const key of ['X-Content-Type-Options', 'Referrer-Policy', 'Permissions-Policy']) {
  assert.equal(deckeCompareHeaders[key], generalHeaders[key], `/dev/decke-compare's ${key} has drifted from the general rule's`)
}
assert.equal(deckeCompareHeaders['X-Frame-Options'], 'SAMEORIGIN', "/dev/decke-compare needs X-Frame-Options: SAMEORIGIN to match its frame-ancestors 'self' (DENY would still refuse the self-framing older browsers ignoring frame-ancestors need)")

// OpenCV's shipped embind wrapper calls new Function() while registering its
// bindings. Keep that exception on the permission-gated diagnostic route only.
const scanHarnessCsp = cspDirectives(scanHarnessHeaders['Content-Security-Policy'])
for (const name of Object.keys(generalCsp)) {
  const expected = name === 'script-src' ? generalCsp[name].replace("'wasm-unsafe-eval'", "'wasm-unsafe-eval' 'unsafe-eval'")
    : name === 'frame-ancestors' ? "'self'" : generalCsp[name]
  assert.equal(scanHarnessCsp[name], expected, `the scan harness asset's ${name} changed beyond its scoped exceptions`)
}
for (const key of ['X-Content-Type-Options', 'Referrer-Policy', 'Permissions-Policy']) {
  assert.equal(scanHarnessHeaders[key], generalHeaders[key], `/dev/scan-harness's ${key} has drifted from the general rule`)
}
assert.equal(scanHarnessHeaders['X-Frame-Options'], 'SAMEORIGIN', 'the same-origin iframe needs X-Frame-Options: SAMEORIGIN')

console.log('check-security-headers: CSP and security headers consistent across general, Deck-E comparison and scan harness routes. OK')
