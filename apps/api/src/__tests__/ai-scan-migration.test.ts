import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const migrationUrl = new URL(
  '../../../../packages/db/src/migrations/054_family_ai_scan.sql',
  import.meta.url,
)

test('migration 054 defines atomic, Malaysia-day AI scan quota', async () => {
  const sql = await readFile(migrationUrl, 'utf8')
  assert.match(sql, /default_daily_limit\s+SMALLINT\s+NOT NULL DEFAULT 5/i)
  assert.match(sql, /Asia\/Kuala_Lumpur/i)
  assert.match(sql, /status IN \('reserved',\s*'succeeded',\s*'failed'\)/i)
  assert.match(sql, /request_id\s+UUID\s+NOT NULL UNIQUE/i)
  assert.match(sql, /input_tokens[^\n]*CHECK \(input_tokens >= 0\)/i)
  assert.match(sql, /output_tokens[^\n]*CHECK \(output_tokens >= 0\)/i)
  assert.match(sql, /estimated_cost_microusd[^\n]*CHECK \(estimated_cost_microusd >= 0\)/i)
  assert.match(sql, /pg_advisory_xact_lock/i)
  assert.match(sql, /CREATE FUNCTION reserve_ai_scan/i)
  assert.match(sql, /CREATE FUNCTION finish_ai_scan/i)
  assert.match(sql, /CREATE FUNCTION fail_ai_scan/i)
  assert.doesNotMatch(sql, /image|base64|blob|storage_url/i)
})
