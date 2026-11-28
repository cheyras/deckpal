/**
 * Build gate: the JavaScript every visitor must download before first paint
 * stays inside a budget.
 *
 * Until PERF-01 (2026-09-26) `main.tsx` imported every page statically, so the
 * scripts `index.html` loads up front — the entry chunk plus everything it
 * modulepreloads — carried the admin panel, the scanner, Stripe's payment UI
 * and Deck-E's chat host to every visitor of every page: 364 kB gzipped as this
 * gate counts it. Pages are `lazyRoute` chunks now, and it is about 200 kB.
 *
 * Nothing about the new layout enforces itself. One static import of a page, or
 * of a heavy feature, from anything the shell reaches puts it straight back into
 * the entry, and the build succeeds regardless — the same shape as issue #75,
 * where the character walked onto the critical path through a door no gate was
 * watching. `check-precache.mjs` gate THREE keeps three.js out of these scripts
 * by content; this keeps everything else honest by weight, because a regression
 * here has no single marker to look for.
 *
 * THE NUMBER IS A DECISION, NOT A MEASUREMENT. If a change legitimately grows
 * the shell past it, raise it in the same commit and say why in DECISIONS.md.
 * If it did not mean to, the listing below names the file that grew.
 *
 *   node scripts/check-critical-path.mjs [distDir]
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const BUDGET_KB = 230

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = resolve(process.argv[2] || join(HERE, '..', 'dist'))
const HTML = join(DIST, 'index.html')
if (!existsSync(HTML)) {
  console.error(`check-critical-path: no index.html at ${HTML}`)
  process.exit(1)
}

const html = readFileSync(HTML, 'utf8')
const refs = new Set(
  [
    ...html.matchAll(/<script[^>]+src=["']([^"']+)["']/g),
    ...html.matchAll(/<link[^>]+rel=["']modulepreload["'][^>]+href=["']([^"']+)["']/g),
    ...html.matchAll(/<link[^>]+href=["']([^"']+)["'][^>]*rel=["']modulepreload["']/g),
  ]
    .map((m) => m[1])
    .filter((ref) => ref.endsWith('.js')),
)
if (refs.size === 0) {
  console.error('check-critical-path: index.html references no scripts — has the build format changed?')
  process.exit(1)
}

const rows = []
for (const ref of refs) {
  const name = ref.split('/').pop()
  const file = join(DIST, 'assets', name)
  if (!existsSync(file)) {
    console.error(`check-critical-path: index.html names ${ref}, which is not in the build`)
    process.exit(1)
  }
  rows.push({ name, kb: gzipSync(readFileSync(file)).length / 1024 })
}
rows.sort((a, b) => b.kb - a.kb)
const total = rows.reduce((sum, r) => sum + r.kb, 0)
const listing = rows.map((r) => `  ${r.kb.toFixed(1).padStart(7)} kB  ${r.name}`).join('\n')

if (total > BUDGET_KB) {
  console.error(
    `\ncheck-critical-path FAILED: ${total.toFixed(1)} kB gzipped before first paint, ` +
      `over the ${BUDGET_KB} kB budget:\n\n${listing}\n\n` +
      'Every visitor downloads and parses these before seeing anything. The usual\n' +
      'cause is a static import of a page or a heavy feature from something the\n' +
      'shell reaches — register the page with `lazyRoute()` in main.tsx instead.\n' +
      'If the growth is intended, raise BUDGET_KB here and log why in DECISIONS.md.\n',
  )
  process.exit(1)
}

console.log(`check-critical-path: ${rows.length} script(s), ${total.toFixed(1)} kB gzipped (budget ${BUDGET_KB} kB). OK`)
