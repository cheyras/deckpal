/**
 * Three build gates on the 3D character's assets.
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
 * THREE: fail the build if `index.html` puts the 3D character on the critical
 * path. Gate ONE guards the service worker's door and guarded it well; issue #75
 * was the same 1.2 MB walking in through the other one. `character/decke/
 * cardSource.ts` imported nothing but `lib/api`, but it LIVED in the directory
 * that `vite.config.ts`'s chunk group selects on, and `character/host/chat/
 * useCardArt.ts` imported it statically. That one edge made the character chunk
 * a static import of the ENTRY chunk, so Vite wrote a `<link rel="modulepreload">`
 * for it into `index.html` — 361 kB gzipped of three.js fetched at high priority,
 * ahead of first paint, by every visitor including signed-out ones who cannot
 * open the route at all. Measured on production: 6.3 s to first content on a
 * throttled cold load, against 0.3 s once cached. The reporter called it "a blank
 * gray screen that wouldn't load for a while."
 *
 * So: anything `index.html` references directly — the entry `<script>` and every
 * `modulepreload` beside it — is fetched before the app can render, and must not
 * contain three.js. Same content check as gate ONE, different door. A `name`-
 * based rule would not have caught this one either, which is the whole lesson:
 * the payload was correctly named, correctly excluded from precache, and on the
 * critical path anyway.
 *
 * These are the same check from three directions: the first says an asset must
 * not ship to everyone via the service worker, the third says it must not ship to
 * everyone via the document, and the second says it must actually ship.
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
  // SELF-DIAGNOSING, because the place this fires is a build log somebody else
  // owns. Saying "one of five is missing" and stopping there costs a round trip
  // through a human to find out which five and what was actually there.
  console.error(`  referenced (${referenced.size}): ${[...referenced].sort().join(', ')}`)
  const dir = join(DIST, 'models', 'decke')
  console.error(
    `  ${dir} contains: ` +
      (existsSync(dir) ? readdirSync(dir).sort().join(', ') || '(empty)' : '(no such directory)'),
  )
  console.error(`  dist root: ${existsSync(DIST) ? readdirSync(DIST).sort().join(', ') : '(missing)'}\n`)
  process.exit(1)
}

// ---- gate three: the document's critical path must not carry the character --
//
// Everything `index.html` names directly is fetched before the app can render:
// the entry `<script type="module">` and every `<link rel="modulepreload">` Vite
// emits beside it for the entry's STATIC imports. A dynamic import produces no
// such link, which is exactly why the character is supposed to be dynamic — so a
// modulepreload for it is the signal that some static edge crept back in.
const HTML = join(DIST, 'index.html')
if (!existsSync(HTML)) {
  console.error(`check-precache: no index.html at ${HTML}`)
  process.exit(1)
}
const html = readFileSync(HTML, 'utf8')
const critical = [
  ...html.matchAll(/<script[^>]+src=["']([^"']+)["']/g),
  ...html.matchAll(/<link[^>]+rel=["']modulepreload["'][^>]+href=["']([^"']+)["']/g),
  // Attribute order is not guaranteed; catch href-before-rel too.
  ...html.matchAll(/<link[^>]+href=["']([^"']+)["'][^>]*rel=["']modulepreload["']/g),
].map((m) => m[1])

if (critical.length === 0) {
  console.error('check-precache: index.html references no scripts — has the build format changed?')
  process.exit(1)
}

const onCriticalPath = []
for (const ref of new Set(critical)) {
  if (!ref.endsWith('.js')) continue
  // `base` may be '/' or '/deckpal/'; resolve against dist by basename path.
  const rel = ref.replace(/^https?:\/\/[^/]+/, '').replace(/^\/+/, '')
  const file = existsSync(join(DIST, rel))
    ? join(DIST, rel)
    : join(DIST, 'assets', rel.split('/').pop())
  if (!existsSync(file)) continue
  const body = readFileSync(file, 'utf8')
  const hit = THREE_MARKERS.find((m) => body.includes(m))
  if (hit) {
    onCriticalPath.push(`${ref} (${Math.round(body.length / 1024)} kB) contains three.js ("${hit}")`)
  }
}

if (onCriticalPath.length) {
  console.error('\ncheck-precache FAILED: the 3D character is on the document critical path:\n')
  for (const p of onCriticalPath) console.error('  - ' + p)
  console.error(
    '\nindex.html fetches these before first paint, for every visitor, including\n' +
      'signed-out ones who cannot open the character at all (issue #75).\n' +
      '\nThis means something the ENTRY reaches statically now lands in the\n' +
      "character's chunk. The usual cause is a module that lives in\n" +
      '`src/character/decke/` — which `vite.config.ts` groups with three.js BY\n' +
      'DIRECTORY, not by what it imports — being imported statically from\n' +
      '`character/host/**` or a route. Find the static import and either make it\n' +
      'dynamic, or move the module out of `src/character/decke/` (see\n' +
      '`src/character/cardSource.ts`, which is out here for exactly this reason).\n',
  )
  process.exit(1)
}

console.log(
  `check-precache: ${urls.length} entries, no character payload; ` +
    `${referenced.size} character asset(s) present; ` +
    `${new Set(critical).size} critical-path script(s) clean. OK`,
)
