import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const migrationUrl = new URL(
  '../../../../packages/db/src/migrations/052_family.sql',
  import.meta.url,
)

test('migration 052 defines the invitation-only family boundary', async () => {
  const sql = await readFile(migrationUrl, 'utf8')

  assert.match(sql, /CREATE TABLE family\s*\(/i)
  assert.match(sql, /CREATE TABLE family_member\s*\(/i)
  assert.match(sql, /CREATE TABLE family_invitation\s*\(/i)
  assert.match(sql, /CHECK\s*\(role IN \('admin',\s*'member'\)\)/i)
  assert.match(sql, /CHECK\s*\(status IN \('invited',\s*'active',\s*'disabled'\)\)/i)
  assert.match(sql, /CHECK\s*\(status IN \('pending',\s*'accepted',\s*'revoked',\s*'expired'\)\)/i)
  assert.match(sql, /UNIQUE\s*\(user_id\)/i)
  assert.match(sql, /REFERENCES app_user\(id\)/i)
  assert.match(sql, /same_active_family\s*\(a UUID, b UUID\)/i)
  assert.doesNotMatch(sql, /ALTER\s+(?:TABLE|FUNCTION).*\b0(?:0[1-9]|[1-4][0-9]|5[01])_/i)
})
