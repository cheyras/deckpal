// Pure tests for the fixture server's routing and seed page -- no build, no
// socket, no simulator. `createFixture()` and `parseArgs()` are the two
// exports server.mjs's `main()` calls; everything else (building the SPA,
// binding a port) is exercised for real in the README's manual runbook.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createFixture, parseArgs } from '../server.mjs'

function get(respondApi, pathname, { method = 'GET', body } = {}) {
  const url = new URL('http://127.0.0.1' + pathname)
  return respondApi(url.pathname, url, { method, body })
}

describe('parseArgs', () => {
  it('defaults to port 5310 and no rebuild', () => {
    assert.deepEqual(parseArgs([]), { port: 5310, rebuild: false })
  })
  it('reads --port and --rebuild', () => {
    assert.deepEqual(parseArgs(['--port', '5410', '--rebuild']), { port: 5410, rebuild: true })
  })
  it('rejects an unknown flag rather than silently ignoring it', () => {
    assert.throws(() => parseArgs(['--typo']), /Unknown argument: --typo/)
  })
  it('tolerates a leading -- (pnpm does not always strip the separator it documents)', () => {
    assert.deepEqual(parseArgs(['--', '--port', '5410']), { port: 5410, rebuild: false })
  })
  it('still rejects -- anywhere but the front, since that is not the separator case', () => {
    assert.throws(() => parseArgs(['--port', '5410', '--']), /Unknown argument: --/)
  })
  it('rejects a non-numeric or non-positive port', () => {
    assert.throws(() => parseArgs(['--port', 'nope']), /positive integer/)
    assert.throws(() => parseArgs(['--port', '0']), /positive integer/)
  })
})

describe('createFixture seed page', () => {
  it('plants a fake session under the 127-derived storage key and bounces to /lists', () => {
    const { respondApi } = createFixture()
    const seed = get(respondApi, '/__seed')
    assert.equal(seed.type, 'text/html')
    assert.match(seed.raw, /localStorage\.setItem\('sb-127-auth-token'/)
    assert.match(seed.raw, /location\.replace\('\/lists'\)/)
    // The session's `sub` must be the same user id every other fixture route answers as, or a
    // page that cross-checks `/api/me`'s id against the JWT's `sub` would treat itself as signed
    // out even though the seed script "succeeded."
    assert.match(seed.raw, /10000000-0000-4000-8000-000000000002/)
  })
})

describe('createFixture never reaches a real backend', () => {
  it('serves the bug-report route locally and says so, rather than proxying it', () => {
    const { respondApi } = createFixture()
    const response = get(respondApi, '/api/bugs', { method: 'POST', body: { title: 'x' } })
    assert.equal(response.body.saved, 'fixture')
    assert.match(response.body.note, /never contacts GitHub/)
  })
  it('404s the service worker so no real one can install over the fixture', () => {
    const { respondApi } = createFixture()
    const response = get(respondApi, '/sw.js')
    assert.equal(response.status, 404)
  })
})

describe('createFixture lists routes', () => {
  it('GET /api/lists returns the one seeded fixture list', () => {
    const { respondApi } = createFixture()
    const response = get(respondApi, '/api/lists')
    assert.equal(response.body.lists.length, 1)
    assert.equal(response.body.lists[0].name, 'My Simulator List')
  })
  it('POST /api/lists creates a list that a later GET of its id returns', () => {
    const { respondApi } = createFixture()
    const created = get(respondApi, '/api/lists', { method: 'POST', body: { name: 'New List' } })
    assert.equal(created.body.list.name, 'New List')
    const fetched = get(respondApi, '/api/lists/' + created.body.list.id)
    assert.equal(fetched.body.list.name, 'New List')
  })
  it('GET of a nonexistent list id 404s instead of returning a fixture default', () => {
    const { respondApi } = createFixture()
    const response = get(respondApi, '/api/lists/does-not-exist')
    assert.equal(response.status, 404)
  })
  it('delete moves a list to Recently Deleted, and restore moves it back', () => {
    // Astra's finding: a delete that reports success without changing this fixture's own
    // state meant ListDetail's post-delete navigation showed the list right back where it
    // started, and the Recently Deleted / restore flow could never be exercised at all.
    const { respondApi } = createFixture()
    assert.equal(get(respondApi, '/api/lists').body.lists.length, 1)
    assert.equal(get(respondApi, '/api/lists?deleted=true').body.lists.length, 0)
    const deleted = get(respondApi, '/api/lists/list-1', { method: 'DELETE' })
    assert.equal(deleted.body.deleted, 'list-1')
    assert.equal(get(respondApi, '/api/lists').body.lists.length, 0, 'deleted list must leave the active list')
    const recentlyDeleted = get(respondApi, '/api/lists?deleted=true').body.lists
    assert.equal(recentlyDeleted.length, 1)
    assert.equal(recentlyDeleted[0].id, 'list-1')
    const restored = get(respondApi, '/api/lists/list-1/restore', { method: 'POST' })
    assert.equal(restored.body.list.id, 'list-1')
    assert.equal(get(respondApi, '/api/lists').body.lists.length, 1, 'restored list must return to the active list')
    assert.equal(get(respondApi, '/api/lists?deleted=true').body.lists.length, 0)
  })
  it('deleting or restoring a nonexistent list id 404s', () => {
    const { respondApi } = createFixture()
    assert.equal(get(respondApi, '/api/lists/does-not-exist', { method: 'DELETE' }).status, 404)
    assert.equal(get(respondApi, '/api/lists/does-not-exist/restore', { method: 'POST' }).status, 404)
  })
  it('adding then removing an item keeps itemCount in sync AND the item actually renders', () => {
    // Astra's finding: itemCount alone is not enough -- ListDetail.tsx refetches GET
    // /api/lists/:id after every mutation and renders from `items`, so a fixture that
    // only bumps the counter makes a successful add look identical to a silently
    // broken one (the grid stays empty either way).
    const { respondApi } = createFixture()
    const add = get(respondApi, '/api/lists/list-1/items', { method: 'POST', body: { cardVariantId: 9001 } })
    assert.equal(add.body.list.itemCount, 1)
    const afterAdd = get(respondApi, '/api/lists/list-1')
    assert.equal(afterAdd.body.items.length, 1)
    assert.equal(afterAdd.body.items[0].itemId, add.body.itemId)
    assert.equal(afterAdd.body.items[0].cardId, 'sim1-001')
    assert.equal(afterAdd.body.items[0].name, 'Simuchu')
    assert.deepEqual(afterAdd.body.items[0].ownership, {
      totalQuantity: 0, requiredCount: 1, ownedRequired: 0, have: false, need: true, dupe: false,
    })
    const remove = get(respondApi, '/api/lists/list-1/items/' + add.body.itemId, { method: 'DELETE' })
    assert.equal(remove.body.list.itemCount, 0)
    const afterRemove = get(respondApi, '/api/lists/list-1')
    assert.equal(afterRemove.body.items.length, 0)
  })
  it('a static list item shows its stored quantity without claiming the card is owned', () => {
    const { respondApi } = createFixture()
    const list = get(respondApi, '/api/lists', { method: 'POST', body: { name: 'Binder', kind: 'static' } }).body.list
    get(respondApi, '/api/lists/' + list.id + '/items', { method: 'POST', body: { cardVariantId: 9001, staticQuantity: 2 } })
    const item = get(respondApi, '/api/lists/' + list.id).body.items[0]
    assert.equal(item.staticQuantity, 2)
    assert.deepEqual(item.ownership, {
      totalQuantity: 2, requiredCount: 1, ownedRequired: 0, have: false, need: true, dupe: true,
    })
  })
  it('rejects a cardVariantId that does not resolve to a fixture card', () => {
    const { respondApi } = createFixture()
    const response = get(respondApi, '/api/lists/list-1/items', { method: 'POST', body: { cardVariantId: 424242 } })
    assert.equal(response.status, 400)
  })
  it('a new list starts with an empty item store, not undefined', () => {
    const { respondApi } = createFixture()
    const created = get(respondApi, '/api/lists', { method: 'POST', body: { name: 'New List' } })
    const detail = get(respondApi, '/api/lists/' + created.body.list.id)
    assert.deepEqual(detail.body.items, [])
  })
  it('a dynamic list dedupes a repeated add by variant instead of creating a second row', () => {
    // Real rule (apps/api/src/routes/lists.ts): (list_id, card_variant_id) is unique on a
    // dynamic list; a repeat add reports alreadyPresent and changes nothing. Only a static
    // list allows duplicates. Without this, two taps on the same search result built up a
    // collection state (2 rows, itemCount 2) the real app can never produce.
    const { respondApi } = createFixture()
    assert.equal(get(respondApi, '/api/lists/list-1').body.list.kind, 'dynamic')
    const first = get(respondApi, '/api/lists/list-1/items', { method: 'POST', body: { cardVariantId: 9002 } })
    assert.equal(first.body.alreadyPresent, false)
    assert.equal(first.body.list.itemCount, 1)
    const second = get(respondApi, '/api/lists/list-1/items', { method: 'POST', body: { cardVariantId: 9002 } })
    assert.equal(second.body.alreadyPresent, true)
    assert.equal(second.body.itemId, first.body.itemId, 'the repeat reports the SAME item, not a new one')
    assert.equal(second.body.list.itemCount, 1, 'itemCount must not double-count a dedup')
    assert.equal(get(respondApi, '/api/lists/list-1').body.items.length, 1)
  })
  it('a static list allows the same variant twice (distinct physical copies)', () => {
    const { respondApi } = createFixture()
    const list = get(respondApi, '/api/lists', { method: 'POST', body: { name: 'Binder', kind: 'static' } }).body.list
    const first = get(respondApi, '/api/lists/' + list.id + '/items', { method: 'POST', body: { cardVariantId: 9001, staticQuantity: 1 } })
    const second = get(respondApi, '/api/lists/' + list.id + '/items', { method: 'POST', body: { cardVariantId: 9001, staticQuantity: 1 } })
    assert.equal(first.body.alreadyPresent, false)
    assert.equal(second.body.alreadyPresent, false)
    assert.notEqual(second.body.itemId, first.body.itemId)
    assert.equal(second.body.list.itemCount, 2)
  })
  it('PATCH itemOrder reorders the stored items, not just the list summary', () => {
    // Astra's finding: this used to Object.assign(list, {itemOrder: [...]}) -- stamping a
    // nonexistent field onto the summary -- while listItems stayed in insertion order, so
    // ListDetail's optimistic reorder reverted itself on the next refetch.
    const { respondApi } = createFixture()
    const a = get(respondApi, '/api/lists/list-1/items', { method: 'POST', body: { cardVariantId: 9001 } }).body.itemId
    const b = get(respondApi, '/api/lists/list-1/items', { method: 'POST', body: { cardVariantId: 9002 } }).body.itemId
    const c = get(respondApi, '/api/lists/list-1/items', { method: 'POST', body: { cardVariantId: 9003 } }).body.itemId
    assert.deepEqual(get(respondApi, '/api/lists/list-1').body.items.map((i) => i.itemId), [a, b, c])
    get(respondApi, '/api/lists/list-1', { method: 'PATCH', body: { itemOrder: [c, a, b] } })
    const reordered = get(respondApi, '/api/lists/list-1').body.items
    assert.deepEqual(reordered.map((i) => i.itemId), [c, a, b])
    assert.deepEqual(reordered.map((i) => i.position), [0, 1, 2])
    assert.equal(get(respondApi, '/api/lists/list-1').body.list.itemOrder, undefined, 'itemOrder is not a real ListSummary field')
  })
})

describe('createFixture card search', () => {
  it('an empty query returns the whole fake catalog', () => {
    const { respondApi } = createFixture()
    const response = get(respondApi, '/api/search')
    assert.equal(response.body.cards.length, 5)
  })
  it('filters by name, case-insensitively', () => {
    const { respondApi } = createFixture()
    const response = get(respondApi, '/api/search?q=fixture')
    assert.deepEqual(response.body.cards.map((c) => c.cardId), ['sim1-002'])
  })
})

describe('createFixture card detail (the add-card flow depends on this)', () => {
  it('serves a primary variant for every searchable card, end to end into a list', () => {
    // Astra found this gap: ListDetail's "Add" reads api.card(cardId).variants before it can
    // mutate at all, so a search result with no matching detail stub fails silently and the
    // add-card flow can never be exercised in the simulator.
    const { respondApi } = createFixture()
    const search = get(respondApi, '/api/search')
    for (const card of search.body.cards) {
      const detail = get(respondApi, '/api/cards/' + card.cardId)
      assert.equal(detail.body.card.cardId, card.cardId)
      const primary = detail.body.variants.find((v) => v.isPrimary)
      assert.ok(primary, card.cardId + ' has no primary variant')
      const added = get(respondApi, '/api/lists/list-1/items', { method: 'POST', body: { cardVariantId: primary.variantId } })
      assert.equal(added.body.list.itemCount > 0, true)
    }
  })
  it('cardId matches what the real app reconstructs from set + number, for every catalog card', () => {
    // Astra's finding: CardLink navigates by `number` and CardDetail rebuilds the id as
    // `${set}-${number}`; a fixture cardId that doesn't equal that formula 404s on every
    // search-result click-through even though the search row itself displayed fine.
    const { respondApi } = createFixture()
    for (const card of get(respondApi, '/api/search').body.cards) {
      assert.equal(card.cardId, card.set.setId + '-' + card.number)
      assert.equal(get(respondApi, '/api/cards/' + card.set.setId + '-' + card.number).status ?? 200, 200)
    }
  })
  it('404s a card id that was never in the fixture catalog', () => {
    const { respondApi } = createFixture()
    const response = get(respondApi, '/api/cards/sim1-99')
    assert.equal(response.status, 404)
  })
})

describe('createFixture falls through to the shared admin fixture, then a safe default', () => {
  it('answers /api/me from the admin fixture as the signed-in non-owner user', () => {
    const { respondApi } = createFixture()
    const response = get(respondApi, '/api/me')
    assert.equal(response.body.owner, false)
    assert.equal(response.body.id, '10000000-0000-4000-8000-000000000002')
  })
  it('an unrecognized /api/* path gets a JSON 404 rather than malformed success data', () => {
    const { respondApi } = createFixture()
    for (const path of ['/api/totally-unknown-route', '/api/sets/sim1', '/api/cards/sim1-001/legality']) {
      const response = get(respondApi, path)
      assert.equal(response.status, 404)
      assert.equal(typeof response.body.error, 'string')
    }
  })
  it('a non-API unknown path falls through to null (the static file server\'s job)', () => {
    const { respondApi } = createFixture()
    assert.equal(get(respondApi, '/some/spa/route'), null)
  })
})
