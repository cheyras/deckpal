// A browser-initiated request cannot authenticate against this API.
//
// ── THE BUG THIS PINS ──────────────────────────────────────────────────────
//
// The harvest grid shipped with `<img src={api.scanFlagFileUrl(id, 'png')}>`
// and an `<a href>` to the same route for the JSON. Both are 403 on production
// and always would have been: `/dev/scan-flags/*` sits behind
// `labelerOnlyInProduction`, which reads the VERIFIED JWT subject, and an
// `<img>` or a link navigation sends cookies — never the `Authorization:
// Bearer` header `lib/api.ts` authenticates with. Every thumbnail in the view
// rendered as a broken image, and nothing in the type system or the build could
// have said so: the URL was a perfectly good string.
//
// It is a source-text test for the same reason `scannerGate.test.ts` is one:
// what has to hold is a property of the CODE ("no element loads a gated path by
// URL"), and there is no runtime seam where that could be observed short of a
// browser signed in as an entitled account.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const LABELER_DIR = fileURLToPath(new URL('..', import.meta.url))

function sources(): Array<{ name: string; text: string }> {
  return fs
    .readdirSync(LABELER_DIR)
    .filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'))
    .map((f) => ({ name: f, text: fs.readFileSync(path.join(LABELER_DIR, f), 'utf8') }))
}

test('no element loads a gated API path by URL', () => {
  // The gated prefix. `BASE` is '/api' in cloud, so any literal or template
  // that puts `/dev/scan-flags` into a `src=` or `href=` is the defect.
  const offenders: string[] = []
  for (const { name, text } of sources()) {
    const lines = text.split('\n')
    lines.forEach((line, i) => {
      const isAttr = /\b(src|href)=\{?/.test(line)
      if (!isAttr) return
      if (!/dev\/scan-flags|scanFlagFileUrl/.test(line)) return
      offenders.push(`${name}:${i + 1}  ${line.trim()}`)
    })
  }
  assert.deepEqual(
    offenders,
    [],
    'a src=/href= is pointing at the gated scan-flags route. A browser-initiated ' +
      'request sends no Authorization header, so it 403s. Fetch it with ' +
      '`api.scanFlagBlob` and hand the element a blob: URL instead.',
  )
})

test('the URL helper that invited it is gone', () => {
  // Keeping `scanFlagFileUrl` around would leave the mistake one autocomplete
  // away, and its only correct use — a request that can carry a bearer token —
  // is what `scanFlagBlob` already does.
  const api = fs.readFileSync(fileURLToPath(new URL('../../../lib/api.ts', import.meta.url)), 'utf8')
  // A DECLARATION, not a mention: the comment on `scanFlagBlob` names the old
  // helper on purpose, because "this used to be a URL and that could never
  // work" is the most useful thing that file can tell the next reader.
  assert.ok(
    !/^\s*scanFlagFileUrl\s*:/m.test(api),
    'scanFlagFileUrl is declared again — remove it, use scanFlagBlob',
  )
  assert.ok(/^\s*scanFlagBlob\s*:/m.test(api), 'scanFlagBlob is the authenticated replacement and must exist')
})

test('the harvest fetches its frames through the authenticated client', () => {
  const harvest = fs.readFileSync(path.join(LABELER_DIR, 'QuadHarvest.tsx'), 'utf8')
  assert.match(harvest, /api\.scanFlagBlob\(/, 'the harvest must go through scanFlagBlob')
  assert.match(
    harvest,
    /revokeObjectURL/,
    'every blob URL it mints must be revoked — a long harvest otherwise pins every frame it has shown',
  )
})
