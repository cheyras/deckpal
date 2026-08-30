import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const migrationUrl = new URL(
  '../../../../packages/db/src/migrations/053_family_rls.sql',
  import.meta.url,
)

test('family RLS expands reads without granting cross-owner writes', async () => {
  const sql = await readFile(migrationUrl, 'utf8')

  assert.match(sql, /^-- @supabase-only/m)
  for (const table of [
    'family',
    'family_member',
    'family_invitation',
    'collection_item',
    'collection_event',
    'user_profile',
  ]) {
    assert.match(sql, new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`, 'i'))
  }
  assert.match(sql, /collection_item_family_select[\s\S]*FOR SELECT[\s\S]*same_active_family/i)
  assert.match(sql, /collection_event_family_select[\s\S]*FOR SELECT[\s\S]*same_active_family/i)
  assert.doesNotMatch(sql, /collection_item_family_(?:insert|update|delete)/i)
  assert.doesNotMatch(sql, /FOR (?:INSERT|UPDATE|DELETE)[\s\S]{0,120}same_active_family/i)
})
