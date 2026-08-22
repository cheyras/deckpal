/**
 * The gate that decides who, and the meter that decides how much.
 *
 * Both are read from environment variables, which is the category of code this
 * project has a written contract about (B11) because a gate that silently
 * resolved to "nobody" went unnoticed for four days. So the cases below are not
 * "does the happy path work" — they are the ways a deployment can be
 * misconfigured, and what each one does.
 */
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'

const ENV_KEYS = [
  'SUPABASE_MODE',
  'DESIGN_EDITOR_USER_ID',
  'DECKE_ENTITLED_USER_IDS',
  'DECKE_MAX_TURNS_PER_DAY',
  'DECKE_MAX_DEEP_CALLS_PER_DAY',
] as const

const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

/**
 * Both modules read `process.env` per call rather than caching at import, so a
 * fresh import is not needed — but `SUPABASE_MODE` IS captured at module load
 * in `entitlement.ts` (it is a deployment shape, not a tunable), so the cloud
 * cases import it fresh with the variable already set.
 */
async function cloudEntitlement() {
  process.env.SUPABASE_MODE = '1'
  return import(`../entitlement.js?cloud=${Math.random()}`)
}

test('cloud: with nothing configured, nobody gets in', async () => {
  delete process.env.DESIGN_EDITOR_USER_ID
  delete process.env.DECKE_ENTITLED_USER_IDS
  const e = await cloudEntitlement()

  assert.equal(e.isDeckeEntitled('any-user-at-all'), false)
  assert.equal(e.deckeEntitlementStatus(), 'nobody')
  // And it SAYS so at boot. Failing closed is right; failing closed silently is
  // the thing B11 exists to prevent.
  assert.match(e.deckeEntitlementWarning() ?? '', /refuse EVERY account/)
})

test('cloud: the owner is always in, and is not required to be on the list', async () => {
  process.env.DESIGN_EDITOR_USER_ID = 'owner-uuid'
  delete process.env.DECKE_ENTITLED_USER_IDS
  const e = await cloudEntitlement()

  assert.equal(e.isDeckeEntitled('owner-uuid'), true)
  assert.equal(e.isDeckeEntitled('someone-else'), false)
  assert.equal(e.deckeEntitlementStatus(), 'owner-only')
  assert.equal(e.deckeEntitlementWarning(), null)
})

test('cloud: the list is what lets a gate account exist without being the owner', async () => {
  // This is the whole reason the gate is a list. The QA account is deliberately
  // an ordinary user, and two of the plan's browser gates WRITE — so they may
  // not be run as the owner (B12). Without this, they could not be run at all.
  process.env.DESIGN_EDITOR_USER_ID = 'owner-uuid'
  process.env.DECKE_ENTITLED_USER_IDS = '87567e27-0e51-4baa-b0d5-04fc51041288'
  const e = await cloudEntitlement()

  assert.equal(e.isDeckeEntitled('87567e27-0e51-4baa-b0d5-04fc51041288'), true)
  assert.equal(e.isDeckeEntitled('owner-uuid'), true)
  assert.equal(e.isDeckeEntitled('a-third-party'), false)
  assert.equal(e.deckeEntitlementStatus(), 'owner-plus-list')
  assert.equal(e.deckeEntitledCount(), 1)
})

test('cloud: the list tolerates the way people actually paste lists', async () => {
  process.env.DESIGN_EDITOR_USER_ID = 'owner-uuid'
  process.env.DECKE_ENTITLED_USER_IDS = ' a , b ,, c,'
  const e = await cloudEntitlement()

  assert.equal(e.isDeckeEntitled('a'), true)
  assert.equal(e.isDeckeEntitled('b'), true)
  assert.equal(e.isDeckeEntitled('c'), true)
  // An empty segment must not become an entitled empty user id, which is what
  // an unauthenticated caller would arrive with if anything upstream ever let
  // one through.
  assert.equal(e.isDeckeEntitled(''), false)
  assert.equal(e.deckeEntitledCount(), 3)
})

test('/health never reports who, only whether and how many', async () => {
  process.env.DESIGN_EDITOR_USER_ID = 'owner-uuid'
  process.env.DECKE_ENTITLED_USER_IDS = 'secret-user-a,secret-user-b'
  const e = await cloudEntitlement()

  // `/health` is unauthenticated. A status and a count are safe; a list of user
  // UUIDs is not, and the only way to be sure is for the function that feeds
  // health to be incapable of returning one.
  const status: string = e.deckeEntitlementStatus()
  assert.equal(status.includes('secret-user'), false)
  assert.equal(typeof e.deckeEntitledCount(), 'number')
})

test('self-host: one user behind their own proxy, so the gate is not the answer', async () => {
  delete process.env.SUPABASE_MODE
  const e = await import(`../entitlement.js?selfhost=${Math.random()}`)
  assert.equal(e.isDeckeEntitled('whoever'), true)
  assert.equal(e.deckeEntitlementStatus(), 'self-host')
})
