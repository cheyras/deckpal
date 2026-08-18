/**
 * Fail the build if the service worker would precache the 3D character.
 *
 * The PWA precache is EAGER: `globPatterns` matches every `**\/*.js`, so anything
 * it lists is downloaded by every visitor on first load whether they can reach
 * it or not. `/dev/decke` ships to production but is owner-only, and its chunk
 * is ~945 kB of three.js plus 5.6 MB of assets. Exactly this already happened
 * once — the route was dev-only, unreachable, and precached anyway.
 *
 * `vite.config.ts` excludes it by NAME (`assets/Decke-*.js`), and a name is a
 * fragile thing to depend on: rename the route file, or add a second lazy route
 * that imports three, and rollup emits a shared chunk under a different name
 * that silently walks back into the manifest. So this checks the CONTENT
 * instead — if a precached script contains three.js, the exclusion has stopped
 * working, whatever the file is called.
 *
 *   node scripts/check-precache.mjs [distDir]
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = resolve(process.argv[2] || join(HERE, '..', 'dist'))
const SW = join(DIST, 'sw.js')

if (!existsSync(SW)) {
  console.error(`check-precache: no service worker at ${SW}`)
  process.exit(1)
}

const sw = readFileSync(SW, 'utf8')

// The injected manifest is a list of {url, revision} pairs. Pull the urls out
// without trying to parse the whole bundle.
const urls = [...sw.matchAll(/["']url["']\s*:\s*["']([^"']+)["']/g)].map((m) => m[1])
if (urls.length === 0) {
  console.error('check-precache: found no precache manifest entries — has the sw format changed?')
  process.exit(1)
}

/** Substrings that only appear in three.js. Cheap, and specific enough. */
const THREE_MARKERS = ['WebGLRenderer', 'PerspectiveCamera', 'BufferGeometry']

const problems = []

for (const url of urls) {
  const clean = url.replace(/^\//, '').split('?')[0]

  if (clean.startsWith('models/')) {
    problems.push(`${url} — character assets must never be precached`)
    continue
  }
  if (!clean.endsWith('.js')) continue

  const file = join(DIST, clean)
  if (!existsSync(file)) continue
  const body = readFileSync(file, 'utf8')
  const hit = THREE_MARKERS.find((m) => body.includes(m))
  if (hit) {
    const kb = Math.round(body.length / 1024)
    problems.push(
      `${url} (${kb} kB) contains three.js ("${hit}") — the character chunk has ` +
        `re-entered the precache. Check globIgnores in vite.config.ts; the chunk ` +
        `has probably been renamed or merged into a shared one.`,
    )
  }
}

if (problems.length) {
  console.error('\ncheck-precache FAILED:\n')
  for (const p of problems) console.error('  - ' + p)
  console.error(
    '\nEvery visitor would download this on first load, for a route only the ' +
      'owner can open.\n',
  )
  process.exit(1)
}

console.log(`check-precache: ${urls.length} entries, no character payload. OK`)
