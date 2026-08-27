/**
 * Build gate: the auth-session read must stay bounded.
 *
 * Issue #75 was an indefinite grey screen on cold load. The mechanism was one
 * unbounded await: `supabase.auth.getSession()` refreshes the token over the
 * network whenever the stored one is inside its 90 s expiry margin (or past
 * it), and `@supabase/auth-js` puts no `AbortSignal` and no timeout on that
 * fetch. A refresh that never settles never settles — and `main.tsx`'s index
 * route awaited it in `beforeLoad`, so the router rendered nothing, forever.
 * `api.ts` awaited it before every request, so even the public catalog came up
 * as chrome with no content.
 *
 * The fix put a deadline on the read. This gate is what keeps it there. It is
 * modelled on `check-precache.mjs`, and for the same reason that file gives:
 * the failure was not that one call site forgot a timeout, it was that nothing
 * made a missing timeout VISIBLE. A bound that any call site can opt out of
 * silently is not a bound.
 *
 * THE RULE: `auth.getSession()` and `auth.refreshSession()` may be called from
 * exactly one module, `src/lib/authSession.ts`, which is where the deadline
 * lives. Everything else goes through `readSession()` /
 * `refreshSessionBounded()`.
 *
 * Comments are stripped before matching, so the several files that *discuss*
 * `supabase.auth.getSession()` in prose (and should keep doing so) do not trip
 * it. String literals are not stripped — a call spelled through a string would
 * be a deliberate evasion, and the gate should notice.
 *
 *   node scripts/check-auth-deadlines.mjs [srcDir]
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = resolve(process.argv[2] || join(HERE, '..', 'src'))

/** The one module allowed to hold the raw client calls. */
const OWNER = join(SRC, 'lib', 'authSession.ts')

const BANNED = [
  { pattern: /\bauth\s*\.\s*getSession\s*\(/, use: 'readSession() from lib/authSession' },
  {
    pattern: /\bauth\s*\.\s*refreshSession\s*\(/,
    use: 'refreshSessionBounded() from lib/authSession',
  },
  // The mutating calls. None of these is awaited before first paint, so none of
  // them can produce issue #75's grey screen — which is why the first pass left
  // them alone. But auth-js puts no `AbortSignal` and no timeout on ANY of its
  // fetches, so a stalled one leaves a button spinning with no error a reader
  // can act on. Sign-out is the one that matters most: the action whose whole
  // point is to stop being signed in, on a machine that may not be yours, must
  // be able to tell you it did not happen.
  {
    pattern: /\bauth\s*\.\s*signInWithPassword\s*\(/,
    use: 'signInWithPasswordBounded() from lib/authSession',
  },
  { pattern: /\bauth\s*\.\s*signUp\s*\(/, use: 'signUpBounded() from lib/authSession' },
  {
    pattern: /\bauth\s*\.\s*resetPasswordForEmail\s*\(/,
    use: 'resetPasswordForEmailBounded() from lib/authSession',
  },
  {
    pattern: /\bauth\s*\.\s*updateUser\s*\(/,
    use: 'updatePasswordBounded() from lib/authSession',
  },
  { pattern: /\bauth\s*\.\s*signOut\s*\(/, use: 'signOutBounded() from lib/authSession' },
]

/** Remove line and block comments. Crude, and deliberately so — it only has to
 *  be right about code, and a false positive here is a loud build failure with
 *  the offending line printed, not a silent wrong answer. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue
      yield* walk(full)
    } else if (/\.(ts|tsx)$/.test(entry)) {
      yield full
    }
  }
}

const failures = []
for (const file of walk(SRC)) {
  if (resolve(file) === OWNER) continue
  const stripped = stripComments(readFileSync(file, 'utf8'))
  const lines = stripped.split('\n')
  for (const { pattern, use } of BANNED) {
    lines.forEach((line, i) => {
      if (pattern.test(line)) {
        failures.push({ file: relative(SRC, file), line: i + 1, text: line.trim(), use })
      }
    })
  }
}

if (failures.length > 0) {
  console.error('\nAUTH DEADLINE GATE FAILED — an unbounded auth-session read is back.\n')
  for (const f of failures) {
    console.error(`  ${f.file}:${f.line}`)
    console.error(`    ${f.text}`)
    console.error(`    → use ${f.use} instead.\n`)
  }
  console.error(
    'Why: @supabase/auth-js puts no timeout on the token refresh that these calls\n' +
      'can trigger, so a stalled network holds them open forever. Issue #75 was that\n' +
      'hang reaching first paint. See src/lib/sessionDeadline.ts.\n',
  )
  process.exit(1)
}

console.log('auth deadline gate: ok — every auth-session read goes through lib/authSession.ts')
