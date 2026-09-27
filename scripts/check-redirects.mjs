/**
 * Does the deckscout.io -> deckpal.app redirect actually cover every path?
 *
 * From 2026-08-19 (commit b9731af) to 2026-09-26 that redirect carved out five
 * paths -- /mcp, /api, /register, /token, /.well-known/* -- with a negative
 * lookahead, because a cross-origin redirect drops the `Authorization`
 * header and would have turned any MCP connector or API client still pointed
 * at deckscout.io into a silent stream of 401s. Now that Chey's own
 * claude.ai connector has moved to deckpal.app/mcp, the carve-out is gone and
 * `vercel.json`'s `source` for that rule is a bare `.*` -- but a JSON config
 * has no type system, so a future edit that reintroduces a carve-out (or
 * narrows the match some other way) would look just as clean as this one and
 * nothing would catch it. This is that catch.
 *
 * It parses the actual regex text out of the live `source` string and runs it
 * as real JS RegExp against sample paths, rather than asserting on the string
 * itself -- a test that only checked "the string is exactly X" would pass on
 * any functionally-different rewrite of the same intent and fail on a
 * harmless reformatting. Vercel's named path parameter `:path(<pattern>)`
 * captures the *entire* remaining path against `<pattern>`; extracting that
 * pattern and anchoring it with `^...$` reproduces exactly what Vercel matches.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const vercelConfig = JSON.parse(readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'))

const rule = vercelConfig.redirects.find((r) =>
  (r.has ?? []).some((h) => h.type === 'host' && h.value === 'deckscout.io'),
)
assert.ok(rule, 'vercel.json must have a redirect scoped to host deckscout.io')
assert.equal(rule.destination, 'https://deckpal.app/:path', 'must redirect to the matching deckpal.app path')
assert.equal(rule.permanent, true, 'must be a permanent (308) redirect -- SEO and cached clients depend on this')

const match = /^\/:path\((.+)\)$/.exec(rule.source)
assert.ok(match, `source "${rule.source}" is not the expected /:path(<pattern>) shape`)
const pattern = match[1]

// The whole point of folding these five in: no exception syntax survives.
assert.ok(!pattern.includes('(?!'), `source pattern still contains a negative-lookahead carve-out: ${pattern}`)

const re = new RegExp(`^${pattern}$`)

const mustRedirect = [
  '', // bare "/"
  'mcp',
  'mcp/',
  'mcp/some-tool-call',
  'api',
  'api/health',
  'api/collection/variants',
  'register',
  'token',
  '.well-known/oauth-authorization-server',
  '.well-known/oauth-protected-resource',
  '.well-known/apple-developer-merchantid-domain-association',
  // ordinary app routes, unaffected by the carve-out either way
  'pokedex',
  'collection/123',
]

let failed = 0
for (const p of mustRedirect) {
  if (re.test(p)) {
    console.log(`  ok   /${p} redirects`)
  } else {
    console.error(`  FAIL /${p} does NOT match the deckscout.io redirect rule`)
    failed++
  }
}

if (failed) {
  console.error(`\ncheck-redirects: ${failed} of ${mustRedirect.length} path(s) are not covered by the deckscout.io redirect.`)
  process.exit(1)
}
console.log(`check-redirects: deckscout.io redirect covers all ${mustRedirect.length} sampled paths, no carve-out. OK`)
