/**
 * `POST /decks/save` with `newVersion` — the deck widget's "Save as new
 * version" — refused before it can touch anything.
 *
 * What it WRITES (the forced bump, nothing-to-version, printings kept, battle
 * logs left where they were) needs real Postgres and is proved in
 * `src/__integration__/reach.mjs`. This file pins the refusals, against a fake
 * client that records every statement, so "nothing was written" is a list of
 * SQL rather than a hope.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type pg from 'pg'
import type { Request, Response } from 'express'
import { rlsStore } from '../../db.js'
import { decksRouter } from '../../routes/decks.js'
import { ApiError } from '../../http.js'

const reader = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const someoneElsesDeck = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

async function save(body: Record<string, unknown>) {
  const sqls: string[] = []
  const client = {
    async query(sql: string) {
      sqls.push(sql)
      // The reader's own decks only: the route's user filter (and RLS under
      // it) means another account's deck is simply not found.
      if (/FROM deck WHERE id = \$1 AND user_id = \$2 AND deleted_at IS NULL/.test(sql)) return { rows: [] }
      throw new Error(`Unexpected query: ${sql.slice(0, 120)}`)
    },
  } as unknown as pg.PoolClient
  const route = decksRouter.stack.find((layer) => layer.route?.path === '/save')
  const handler = route?.route?.stack[0]?.handle
  assert.ok(handler, 'POST /save is registered')
  const error = await rlsStore.run(client, () => new Promise<unknown>((resolve) => {
    const req = { body, user: { id: reader } } as unknown as Request
    const res = {
      setHeader() { return this },
      status() { return this },
      json() { resolve(undefined); return this },
    } as unknown as Response
    handler(req, res, (err: unknown) => resolve(err))
  }))
  return { error: error as ApiError | undefined, sqls }
}

const cards = [{ cardId: 'sv01-1', quantity: 4 }]

test('newVersion without a deck is refused: a new deck starts at v1', async () => {
  const { error, sqls } = await save({ name: 'Fresh', cards, newVersion: true })
  assert.equal(error?.status, 400)
  assert.match(error?.message ?? '', /newVersion needs deckId/)
  assert.deepEqual(sqls, [], 'nothing is read or written')
})

test('newVersion must be a boolean', async () => {
  const { error, sqls } = await save({ deckId: someoneElsesDeck, cards, newVersion: 'yes' })
  assert.equal(error?.status, 400)
  assert.match(error?.message ?? '', /newVersion must be true or false/)
  assert.deepEqual(sqls, [])
})

test('a version of a deck the reader does not own is a 404, and nothing is written', async () => {
  const { error, sqls } = await save({ deckId: someoneElsesDeck, cards, newVersion: true, versionNote: 'mine now' })
  assert.equal(error?.status, 404)
  assert.equal(sqls.length, 1, 'one ownership read, no batch, no write')
  assert.match(sqls[0]!, /^SELECT updated_at::text AS updated_at FROM deck WHERE id = \$1 AND user_id = \$2 AND deleted_at IS NULL$/)
})
