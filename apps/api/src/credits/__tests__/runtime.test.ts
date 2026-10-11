import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Queryable } from '@deckpal/db'
import { requestAccessStore, type Access } from '../../admin/access.js'
import { beginMeteredCredits } from '../runtime.js'

const access: Access = {
  ready: true,
  suspended: false,
  permissions: ['decke.use'],
  roles: [],
}

test('beginMeteredCredits sends the optional hold multiplier and leaves the default call unchanged', async () => {
  const calls: Array<{ sql: string; args: unknown[] | undefined }> = []
  const db = {
    query: async (sql: string, args?: unknown[]) => {
      calls.push({ sql, args })
      return { rows: [{ data: { allowed: true, heldCredits: 200 } }] }
    },
  } as unknown as Queryable

  await requestAccessStore.run(new Map([['reader', Promise.resolve(access)]]), async () => {
    await beginMeteredCredits(db, 'reader', 'request-standard')
    await beginMeteredCredits(db, 'reader', 'request-deep', { holdMultiplier: 8 })
  })

  assert.deepEqual(calls, [
    {
      sql: 'SELECT public.decke_metered_begin($1) AS data',
      args: ['request-standard'],
    },
    {
      sql: 'SELECT public.decke_metered_begin($1,$2) AS data',
      args: ['request-deep', 8],
    },
  ])
})
