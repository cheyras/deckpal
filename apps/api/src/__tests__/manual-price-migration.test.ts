import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const schema = readFileSync(new URL('../../../../packages/db/src/migrations/056_family_manual_price.sql', import.meta.url), 'utf8')
const rls = readFileSync(new URL('../../../../packages/db/src/migrations/057_family_manual_price_rls.sql', import.meta.url), 'utf8')

test('manual family prices are isolated from automatic market prices', () => {
  assert.match(schema, /CREATE TABLE family_price_suggestion/)
  assert.match(schema, /amount_minor INTEGER NOT NULL CHECK \(amount_minor > 0\)/)
  assert.match(schema, /REFERENCES card_variant\(id\)/)
  assert.match(schema, /pending','approved','rejected','superseded/)
  assert.match(schema, /WHERE status = 'approved'/)
  assert.doesNotMatch(schema, /INSERT INTO price_current|UPDATE price_current/)
})

test('only the proposer, active family, and admin receive scoped visibility', () => {
  assert.match(rls, /proposed_by = \(SELECT auth\.uid\(\)\)/)
  assert.match(rls, /status = 'approved'/)
  assert.match(rls, /is_family_admin/)
  assert.doesNotMatch(rls, /FOR UPDATE/)
})

test('price moderation binds the supplied actor to the authenticated session', () => {
  assert.match(schema, /current_setting\('request\.jwt\.claims', true\)/)
  assert.match(schema, /session_actor IS NULL OR session_actor <> p_actor/)
  assert.match(schema, /moderation_actor_mismatch/)
})
