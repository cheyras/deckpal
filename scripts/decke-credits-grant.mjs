/**
 * Put credits on an account, and say what happened.
 *
 * ── WHY THIS IS A SCRIPT AND NOT A PASTED SQL SNIPPET ────────────────────────
 *
 * Granting credits is writing money into a live database, and the three ways to
 * get it wrong are all quiet:
 *
 *  1. **Running it before the tables exist.** `DECKE_CREDITS_ENABLED` fails OPEN
 *     by design — a missing table means every turn is served unmetered with a
 *     log line nobody reads. So this checks for the tables first and refuses
 *     with the command to run, rather than half-working.
 *  2. **Replacing a balance instead of adding to it.** `SET balance = $2` looks
 *     identical to `SET balance = b.balance + $2` in review and destroys
 *     whatever was left. This uses the shared `GRANT_BALANCE_SQL` from
 *     `credits.ts`, which is the statement the tests pin.
 *  3. **Granting twice.** A re-run with the same `--ref` is a constraint
 *     violation, not free money — migration 041 puts a partial unique index on
 *     `decke_credit_event.ref` for exactly this. The default ref is derived
 *     from the reason and the day, so running this script twice in one day by
 *     accident is refused and running it deliberately tomorrow is not.
 *
 * ── ORDER MATTERS AND IT IS NOT THE OBVIOUS ONE ──────────────────────────────
 *
 *     1. migrate    (creates the tables, every balance at ZERO)
 *     2. grant      (this script)
 *     3. flag       (DECKE_CREDITS_ENABLED=true, then redeploy)
 *
 * Setting the flag first makes Deck-E unavailable to every account at once,
 * including the owner's, because 041 starts everybody on nothing.
 *
 *   set -a && . ./.env.prod && set +a
 *   node scripts/decke-credits-grant.mjs --email you@example.com --credits 2000
 *   node scripts/decke-credits-grant.mjs --qa --credits 2000
 *   node scripts/decke-credits-grant.mjs --email a@b.com --show     # read only
 *
 * `--show` writes nothing and is the right way to check a balance.
 */
import { readFileSync } from 'node:fs'
import pg from 'pg'
import {
  BALANCE_SQL,
  COST,
  GRANT_BALANCE_SQL,
  GRANT_LOG_SQL,
  LOW_BALANCE,
  deepCost,
} from '../apps/api/dist/decke/credits.js'

const argv = process.argv.slice(2)
const arg = (n, d) => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d
}
const has = (n) => argv.includes(`--${n}`)

const SHOW = has('show')
const CREDITS = Number(arg('credits', '2000'))
const REASON = arg('reason', 'manual_grant')

/** Emails to act on: `--email` one or more times, plus `--qa` for the QA account. */
const emails = []
for (let i = 0; i < argv.length; i++) if (argv[i] === '--email' && argv[i + 1]) emails.push(argv[i + 1])
if (has('qa')) {
  const qa = readFileSync(new URL('../.qa-account', import.meta.url), 'utf8')
  const e = qa.match(/^QA_EMAIL=(.*)$/m)?.[1]?.trim()
  if (!e) throw new Error('.qa-account has no QA_EMAIL')
  emails.push(e)
}
if (emails.length === 0) {
  console.error('nothing to do — pass --email <address> and/or --qa')
  process.exit(2)
}
if (!SHOW && (!Number.isFinite(CREDITS) || CREDITS <= 0 || !Number.isInteger(CREDITS))) {
  console.error(`--credits must be a positive whole number, got ${JSON.stringify(arg('credits', '2000'))}`)
  process.exit(2)
}

const url = process.env.DATABASE_URL
if (!url) {
  console.error('no DATABASE_URL — load the environment first:\n  set -a && . ./.env.prod && set +a')
  process.exit(2)
}
const client = new pg.Client({
  connectionString: url,
  ...(process.env.PGSSLMODE === 'disable' ? {} : { ssl: { rejectUnauthorized: false } }),
})
await client.connect()

// Say WHICH database, before touching it. Two shells with two env files loaded
// look identical, and "I granted credits on the wrong database" is a sentence
// nobody should have to say.
const where = await client.query('SELECT current_database() AS db, inet_server_addr() AS host')
console.log(`database: ${where.rows[0].db} @ ${where.rows[0].host ?? 'local'}\n`)

const tables = await client.query(
  `SELECT to_regclass('public.decke_credit_balance') AS bal,
          to_regclass('public.decke_credit_event')   AS ev`,
)
if (!tables.rows[0].bal || !tables.rows[0].ev) {
  console.error('the credit tables do not exist yet. Run the migrations first:\n')
  console.error('  set -a && . ./.env.prod && set +a && pnpm --filter @deckpal/db migrate\n')
  console.error('Then re-run this. Order matters: migrate -> grant -> flag.')
  await client.end()
  process.exit(1)
}

let failed = 0
for (const email of emails) {
  const u = await client.query('SELECT id FROM app_user WHERE lower(email) = lower($1)', [email])
  const id = u.rows[0]?.id
  if (!id) {
    console.error(`  ✗ ${email} — no such account`)
    failed++
    continue
  }

  if (SHOW) {
    const b = await client.query(BALANCE_SQL, [id])
    const bal = Number(b.rows[0]?.balance ?? 0)
    console.log(`  ${email}: ${bal} credits${bal <= LOW_BALANCE ? '  (LOW — the panel will say so)' : ''}`)
    continue
  }

  // THE EVENT FIRST. Its `ref` carries the idempotency, so a duplicate grant
  // fails HERE — before the balance moves — rather than after.
  const ref = arg('ref', `${REASON}:${email}:${new Date().toISOString().slice(0, 10)}`)
  try {
    await client.query('BEGIN')
    await client.query(GRANT_LOG_SQL, [id, CREDITS, REASON, ref])
    const res = await client.query(GRANT_BALANCE_SQL, [id, CREDITS])
    await client.query('COMMIT')
    console.log(`  ✓ ${email}  +${CREDITS}  ->  ${res.rows[0].balance} credits`)
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    if (e?.code === '23505') {
      console.error(`  ✗ ${email} — already granted with ref "${ref}". Pass --ref <something-else> to grant again.`)
    } else {
      console.error(`  ✗ ${email} — ${e?.code ?? e?.message}`)
    }
    failed++
  }
}

console.log(`\nfor reference — what things cost:`)
console.log(`  a conversational turn   ${COST.chat_turn} credit`)
console.log(`  an analysis call        ${deepCost('analyze_collection')} credits`)
console.log(`  a deck plan             ${deepCost('plan_deck')} credits`)
console.log(`  "low" starts at         ${LOW_BALANCE} credits (the panel shows a chip at or below this)`)

await client.end()
process.exit(failed > 0 ? 1 : 0)
