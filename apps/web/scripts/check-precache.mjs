/**
 * Two build gates on the 3D character's assets.
 *
 * ONE: fail the build if the service worker would precache the 3D character.
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
 * TWO: fail the build if an asset the character fetches by a literal path is not
 * in the output at all. `.gitignore` carries a blanket `**\/*.webp` for the
 * fetched card-image cache, and it swallowed the card back: `git add -A`
 * reported nothing, the commit looked complete, the LOCAL build worked because
 * the file was still on disk, and it 404'd only in production. A build from a
 * fresh clone — which is what CI and Vercel both are — would have had the file
 * missing from `dist` and said nothing, because nothing was looking.
 *
 * These are the same check from two directions: the first says an asset must not
 * ship to everyone, the second says it must actually ship.
 *
 *   node scripts/check-precache.mjs [distDir]
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs'
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

// ---- gate two: the assets the runtime asks for by name must exist ----------
//
// Read from the SOURCE rather than listed here, so adding an asset to the
// character cannot forget to add it to this check. Anything of the shape
// `'models/decke/<file>'` in the character's own directory counts.
const CHARACTER_SRC = join(HERE, '..', 'src', 'character', 'decke')
const referenced = new Set()
// Matched ANYWHERE in the text, not only inside a complete string literal: most
// of these are written as `${baseUrl}models/decke/decke.glb`, so a pattern that
// insisted on an opening quote would have found the one asset that happens not
// to be and missed the five that are.
const ASSET = /models\/decke\/[\w-]+\.[a-z0-9]+/gi
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__') walk(full)
      continue
    }
    if (!entry.name.endsWith('.ts')) continue
    for (const m of readFileSync(full, 'utf8').matchAll(ASSET)) referenced.add(m[0])
  }
}
if (existsSync(CHARACTER_SRC)) walk(CHARACTER_SRC)
// `.md` is documentation that ships beside the assets, not something fetched.
for (const r of [...referenced]) if (r.endsWith('.md')) referenced.delete(r)

const missing = [...referenced].filter((rel) => !existsSync(join(DIST, rel)))
if (missing.length) {
  console.error('\ncheck-precache FAILED: assets the character fetches are not in the build:\n')
  for (const m of missing) console.error(`  - ${m}`)
  console.error(
    '\nThe runtime asks for these by name, so a missing one is a 404 in ' +
      'production and nowhere else. Check .gitignore — a blanket rule for the ' +
      'image cache has swallowed one of these before.\n',
  )
  process.exit(1)
}

console.log(
  `check-precache: ${urls.length} entries, no character payload; ` +
    `${referenced.size} character asset(s) present. OK`,
)
