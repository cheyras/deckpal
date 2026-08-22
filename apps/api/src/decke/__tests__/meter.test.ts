/**
 * The meter's arithmetic and its refusal, without a database.
 *
 * The statement itself is verified against Postgres by the deployed gate; what
 * is worth pinning here is everything that decides WHETHER a request is allowed
 * before Postgres is consulted, plus the two env-parsing traps this codebase
 * has already been bitten by once.
 */
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import {
  DEFAULT_MAX_DEEP_CALLS_PER_DAY,
  DEFAULT_MAX_TURNS_PER_DAY,
  capFor,
  chargeSql,
  maxDeepCallsPerDay,
  maxTurnsPerDay,
  refusalText,
  verdictFrom,
} from '../meter.js'

const KEYS = ['DECKE_MAX_TURNS_PER_DAY', 'DECKE_MAX_DEEP_CALLS_PER_DAY'] as const
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]))
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

test('no row returned means refused — that IS the check', () => {
  // The `ON CONFLICT … DO UPDATE … WHERE` clause is the comparison, so being
  // over cap is expressed as "nothing was updated, so nothing came back". A
  // caller that treats an empty result as an error rather than as a refusal
  // turns every limit into a 500.
  assert.deepEqual(verdictFrom([], 120), { allowed: false, used: 120, cap: 120 })
  assert.deepEqual(verdictFrom([{ used: 1 }], 120), { allowed: true, used: 1, cap: 120 })
  assert.deepEqual(verdictFrom([{ used: 120 }], 120), { allowed: true, used: 120, cap: 120 })
})

test('an empty environment variable falls through to the default', () => {
  // `Number('')` is 0, and a cap of 0 shuts the feature off for everybody. An
  // empty `DECKE_MAX_TURNS_PER_DAY=` line in a dashboard is the easiest thing
  // in the world to leave behind. `apps/api/src/db.ts` carries the same warning
  // about `PGPOOL_MAX_API` for the same reason.
  process.env.DECKE_MAX_TURNS_PER_DAY = ''
  assert.equal(maxTurnsPerDay(), DEFAULT_MAX_TURNS_PER_DAY)
  process.env.DECKE_MAX_TURNS_PER_DAY = '   '
  assert.equal(maxTurnsPerDay(), DEFAULT_MAX_TURNS_PER_DAY)
  delete process.env.DECKE_MAX_TURNS_PER_DAY
  assert.equal(maxTurnsPerDay(), DEFAULT_MAX_TURNS_PER_DAY)
})

test('a deliberate zero IS respected, because turning a tier off is legitimate', () => {
  // The distinction that matters: ABSENT falls back, ZERO does not. Otherwise
  // there is no way to switch the expensive tier off without a code change.
  process.env.DECKE_MAX_DEEP_CALLS_PER_DAY = '0'
  assert.equal(maxDeepCallsPerDay(), 0)
  assert.equal(capFor('deep_calls'), 0)
})

test('a garbage value falls back rather than resolving to something arbitrary', () => {
  process.env.DECKE_MAX_TURNS_PER_DAY = 'lots'
  assert.equal(maxTurnsPerDay(), DEFAULT_MAX_TURNS_PER_DAY)
  process.env.DECKE_MAX_TURNS_PER_DAY = '-5'
  assert.equal(maxTurnsPerDay(), DEFAULT_MAX_TURNS_PER_DAY)
})

test('the two tiers are capped separately, and the deep one is much tighter', () => {
  delete process.env.DECKE_MAX_TURNS_PER_DAY
  delete process.env.DECKE_MAX_DEEP_CALLS_PER_DAY
  // ~250x the price per call justifies the gap; one cap over both would have to
  // be sized for one of them and would be wrong for the other.
  assert.ok(DEFAULT_MAX_TURNS_PER_DAY > DEFAULT_MAX_DEEP_CALLS_PER_DAY * 5)
  assert.equal(capFor('chat_turns'), DEFAULT_MAX_TURNS_PER_DAY)
  assert.equal(capFor('deep_calls'), DEFAULT_MAX_DEEP_CALLS_PER_DAY)
})

test('the tier reaches the SQL as a column name, and only a known one can', () => {
  // The tier is interpolated rather than bound, because a column cannot be a
  // bind parameter. This function is reachable from `api/chat.mjs`, which is
  // JavaScript and where the union type checks nothing at all — so the runtime
  // guard is the actual control.
  assert.match(chargeSql('chat_turns'), /SET chat_turns = u\.chat_turns \+ 1/)
  assert.match(chargeSql('deep_calls'), /SET deep_calls = u\.deep_calls \+ 1/)
  assert.throws(() => chargeSql('chat_turns; DROP TABLE decke_usage' as never), /unknown meter tier/)
  assert.throws(() => chargeSql('' as never), /unknown meter tier/)
  assert.throws(() => chargeSql(undefined as never), /unknown meter tier/)
})

test('the day is UTC, not the connection’s timezone', () => {
  // `CURRENT_DATE` is a property of the server, so a cap could reset at a
  // different hour for an instance in another region — which reads to a user as
  // the limit being applied inconsistently.
  for (const tier of ['chat_turns', 'deep_calls'] as const) {
    assert.match(chargeSql(tier), /now\(\) AT TIME ZONE 'utc'/)
    assert.equal(/CURRENT_DATE/.test(chargeSql(tier)), false)
  }
})

test('the refusal is a sentence he can say, and it names the number', () => {
  const chat = refusalText('chat_turns', 120)
  assert.match(chat, /120/)
  // Not an error code, not an apology for working correctly.
  assert.equal(/error|failed|sorry/i.test(chat), false)

  const deep = refusalText('deep_calls', 10)
  assert.match(deep, /10/)
  // The deep refusal must point at what still works, or a reader concludes the
  // whole character is broken when only the expensive tier is spent.
  assert.match(deep, /look up/)
})
