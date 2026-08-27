/**
 * Build gate: nothing in `apps/web/src` may write an API base path literal.
 *
 * DeckPal ships two deployments that disagree about where the API lives —
 * `/api` on Vercel, `/deckpal/api` on a self-host behind nginx. `src/lib/api.ts`
 * settles that in one place (`const BASE = isCloudMode ? … : …`) and every
 * feature is supposed to reach the API through it.
 *
 * `PurchaseSetMenu.tsx` did not. It hand-rolled
 *
 *     fetch(`/deckpal/api/sets/${setId}/massentry?${params}`)
 *
 * which is correct on self-host and, on cloud, a path `vercel.json` has no
 * rewrite for. Vercel's catch-all sends it to `/index.html`, so the request came
 * back **HTTP 200 with `text/html`** — `res.ok` true, `res.json()` throwing, and
 * on WebKit the entire user-visible error was "The string did not match the
 * expected pattern." The feature was dead for every cloud user from the day it
 * shipped and the bug report it eventually produced (issue #113) named neither
 * the path nor the reason. Issue #89 is the same defect seen from the code side.
 *
 * A type checker cannot see this: the literal is a well-typed string, and both
 * halves of the app compile whichever prefix you write. The mistake is cheap to
 * make (it reads as obviously correct next to a self-host nginx config), silent
 * in dev if dev happens to match, and expensive to diagnose. So it is checked
 * mechanically, on every build, which is where CI runs it.
 *
 * WHAT IS FLAGGED: a string literal in `src/**` that starts a path with the
 * self-host prefix `/deckpal/api` or the cloud prefix `/api/`. Both directions
 * are the same bug — one breaks cloud, the other breaks self-host — and a rule
 * that only knew about the prefix that bit us once would let the mirror image
 * through.
 *
 * WHAT IS NOT: `src/lib/api.ts`, which owns the decision; anything under a
 * `__tests__/` directory; and the narrow, deliberate exceptions in ALLOWED
 * below, each of which has to state its reason here to exist.
 *
 *   node scripts/check-api-base.mjs [srcDir]
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = resolve(process.argv[2] || join(HERE, '..', 'src'))

/**
 * Files permitted to name an API base directly, and why.
 *
 * Keep this list SHORT and keep the reasons here. An entry is a promise that
 * the file has thought about both deployments; it is not a way to silence the
 * check for a file that simply has not.
 */
const ALLOWED = new Map([
  [
    'lib/api.ts',
    'owns the base-path decision — this is the file everything else is supposed to go through',
  ],
  [
    // Deck-E's chat is a Vercel Edge/Node function (`api/chat.mjs`), NOT a route
    // on the Express API, so it has no `/deckpal/api` twin to switch to and
    // cannot go through lib/api.ts's BASE. The feature is cloud-only in
    // practice; see `character/host/entitlement.ts`. Flagged here rather than
    // pattern-excused so the exception is visible if that ever changes.
    'character/host/useDeckeChat.ts',
    'targets the Vercel function api/chat.mjs, which exists only on the cloud deployment',
  ],
])

/**
 * A quoted path literal starting with `/deckpal/api…` (self-host) or `/api/…`
 * (cloud), in a position where a value goes: after `(`, `=`, `,`, `:`, `?`, or
 * at the start of its own line.
 *
 * The position requirement is what separates a URL from PROSE. Both of those
 * prefixes get written in backticks all over this codebase's explanations —
 * including in a JSX paragraph in `DeckeChat.tsx` that tells the reader the
 * server "refuses `/api/chat` for anyone else" — and a rule that flagged those
 * would be turned off within a week. Stripping comments is not enough on its
 * own: that particular sentence is a JSX text node, not a comment.
 */
const OFFENDER = /(?:^\s*|[(=,:?]\s*)(['"`])(\/deckpal\/api\b|\/api\/)/

/** Every .ts/.tsx under `dir`, minus test directories. */
function sources(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry !== '__tests__' && entry !== 'node_modules') sources(full, out)
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

const files = sources(SRC)
const findings = []
for (const file of files) {
  const rel = relative(SRC, file).split(sep).join('/')
  if (ALLOWED.has(rel)) continue
  const text = readFileSync(file, 'utf8')
  // `\r?\n`, not `\n`. On a CRLF checkout — which this repo produces on Windows
  // — splitting on `\n` alone leaves a trailing `\r` on every line, `\r` is a
  // line terminator to the regex engine, and any rule anchored with `$` then
  // silently never matches. That exact mistake made an earlier draft of the
  // comment strip below a no-op, and a build gate that quietly stops checking
  // is worse than no gate.
  const lines = text.split(/\r?\n/)
  for (const [i, line] of lines.entries()) {
    // Comments explain this seam constantly (including in this file's own
    // neighbours); it is the CODE that must not carry the literal.
    const code = line.replace(/\/\/.*/, '')
    if (!/^\s*\*/.test(line) && OFFENDER.test(code)) {
      findings.push(`  ${rel}:${i + 1}  ${line.trim()}`)
    }
  }
}

if (findings.length) {
  console.error('\ncheck-api-base FAILED: hardcoded API base path in apps/web/src:\n')
  console.error(findings.join('\n'))
  console.error(
    '\nThe API prefix differs by deployment (/api on cloud, /deckpal/api on\n' +
      'self-host). A literal is right in one of them and, in the other, resolves\n' +
      'to the SPA fallback — HTTP 200 with HTML, which passes `res.ok` and dies\n' +
      'in the JSON parser with a message that names nothing. That is issue #89,\n' +
      'and issue #113 is what the person on the other end saw.\n\n' +
      'Fix: add a method to `src/lib/api.ts` and call that. It owns BASE, the\n' +
      'Authorization header, and the 401 refresh — all three of which a\n' +
      'hand-rolled fetch also silently skips.\n',
  )
  process.exit(1)
}

console.log(`check-api-base: ${files.length} source files, no hardcoded API base. OK`)
