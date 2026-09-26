import assert from 'node:assert/strict'
import path from 'node:path'
import { contextFor } from './support.mjs'
import { signIn } from './admin.mjs'

// Collection, list and deck writes against a server that is slow, reorders its
// answers, fails, or is unreachable (quality audit QUAL-02 and QUAL-06; UX audit
// UXC-02 and UXC-08). Every case asserts what the person SEES — the count on the
// control, the toast, the inline error — and what the fake server ended up
// holding, because a UI that looks right over a wrong database is the bug.
//
// Fictional set/list/deck; the account, settings and chrome come from the admin
// fixture, which this one delegates everything else to.

const USER = '10000000-0000-4000-8000-000000000002'
const SET = 'fx1', LIST = 'writes-list', DECK = 'writes-deck'
const IMG = '/__fixture/writes-card.svg'
const NOW = '2026-09-12T18:00:00Z'
const NAMES = ['Fixturemon', 'Stubbicoon', 'Mockipom']

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const ok = body => ({ body, headers: { 'Cache-Control': 'no-store, private' } })

export function writesFixture(mount, admin) {
  const state = {}
  const reset = () => Object.assign(state, {
    owned: {},                                   // variantId → quantity
    list: [0, 1, 2].map(i => ({ itemId: 'item-' + i, i })),
    listName: 'Trade binder',
    deck: [{ i: 0, quantity: 1 }, { i: 1, quantity: 2 }],
    fail: false,
    latency: () => 0,                            // ms for the next write, by call
    writes: [], inflight: 0, maxInflight: 0, setReads: 0,
  })
  reset()

  const variantsOf = i => [
    { variantId: 100 + i * 2, kind: 'normal', displayName: 'Normal', tier: 'standard' },
    { variantId: 101 + i * 2, kind: 'reverse', displayName: 'Reverse Holofoil', tier: 'standard' },
  ]
  const qty = v => state.owned[v] ?? 0
  const ownership = i => {
    const total = variantsOf(i).reduce((n, v) => n + qty(v.variantId), 0)
    return { totalQuantity: total, requiredCount: 1, ownedRequired: total > 0 ? 1 : 0, have: total > 0, need: total === 0, dupe: total > 1 }
  }
  const goal = (owned, total) => ({ owned, total, pct: Math.round((owned / total) * 1000) / 10, totalQuantity: Object.values(state.owned).reduce((a, b) => a + b, 0) })
  const progress = () => {
    const owned = NAMES.filter((_, i) => ownership(i).have).length
    const pairs = NAMES.flatMap((_, i) => variantsOf(i)).filter(v => qty(v.variantId) > 0).length
    return { complete: { ...goal(owned, 3), setLevel: owned ? 1 : 0 }, master: goal(pairs, 6), grandmaster: goal(pairs, 6) }
  }
  const row = i => ({
    cardId: `${SET}-00${i + 1}`, number: `00${i + 1}`, numberSort: `00${i + 1}`, name: NAMES[i], category: 'Pokemon',
    rarity: 'Common', artist: null, variantCount: 2, images: { low: IMG, high: IMG }, price: { market: 0.5, currency: 'USD' },
    ownership: ownership(i), standardVariants: variantsOf(i).map(v => ({ ...v, quantity: qty(v.variantId) })),
  })
  const setDetail = () => ({
    set: { setId: SET, slug: SET, name: 'Fixture Set', series: { slug: 'fx', name: 'Fixture Series', tcgdexId: 'fx' }, releasedOn: '2026-08-01',
      isPromo: false, printedCount: 3, secretCount: 0, cardCountTotal: 3, images: { logoUrl: null, symbolUrl: null, backgroundUrl: null },
      marketValueUsd: 1.5, mostExpensiveCard: null },
    progress: progress(), query: {}, pagination: { page: 1, pageSize: 250, total: 3, pageCount: 1 }, cards: NAMES.map((_, i) => row(i)),
  })
  const listDetail = () => ({
    list: { id: LIST, kind: 'dynamic', name: state.listName, description: null, visibility: 'private', isFavorite: false, coverRender: '',
      pocketSize: null, itemCount: state.list.length, progress: null, marketValueUsd: null, coverImage: null, coverImages: [], rule: null,
      ruleEvaluatedAt: null, createdAt: NOW, updatedAt: NOW },
    items: state.list.map(({ itemId, i }, position) => ({ ...row(i), itemId, position, itemKind: 'card', variantId: 100 + i * 2,
      variant: { kind: 'normal', displayName: 'Normal', tier: 'standard', isPrimary: true }, setName: 'Fixture Set', seriesSlug: 'fx', setId: SET,
      staticQuantity: null, ownedQuantity: 0 })),
  })
  const deckDetail = () => {
    const cards = state.deck.map(({ i, quantity }) => ({ ...row(i), variantId: 100 + i * 2, variant: { kind: 'normal', displayName: 'Normal', tier: 'standard', isPrimary: true },
      section: 'pokemon', stage: null, regulationMark: 'H', setId: SET, setCode: 'FXS', setName: 'Fixture Set', seriesSlug: 'fx', quantity, owned: 0, have: false }))
    const total = cards.reduce((n, c) => n + c.quantity, 0)
    return {
      deck: { id: DECK, name: 'Fixture Deck', description: null, formatCode: 'standard', formatName: 'Standard', glcType: null, isFavorite: false, coverRender: '',
        coverImage: null, version: 1, totalCount: total, valueUsd: total * 0.5, legal: false, createdAt: NOW, updatedAt: NOW, strategyMd: null },
      counts: { total, pokemon: total, trainer: 0, energy: 0, distinctNames: cards.length }, cards,
      validation: { format: 'standard', format_data_checked_at: '2026-09-01', legal: false, counts: { total, pokemon: total, trainer: 0, energy: 0, distinct_names: cards.length, unresolved: 0 },
        violations: [], warnings: [] },
      cardRefs: {}, glcTypes: ['fire', 'water'],
    }
  }

  // A write: counted, overlapped-or-not, delayed on the fixture's schedule, then
  // either failed or applied. `maxInflight` is how the tests prove serialisation.
  const write = async (rel, method, apply) => {
    state.writes.push(method + ' ' + rel)
    state.inflight++
    state.maxInflight = Math.max(state.maxInflight, state.inflight)
    await sleep(state.latency(state.writes.length))
    state.inflight--
    if (state.fail) return { status: 500, body: { error: { message: 'Fixture write failed' } } }
    return ok(apply())
  }

  const response = async (rel, url, req = { method: 'GET' }) => {
    const { method, body } = req
    if (rel === IMG || /\/sets\/fx1\/(?:logo|symbol)\.webp$/.test(rel)) {
      return { raw: '<svg xmlns="http://www.w3.org/2000/svg" width="245" height="342"><rect width="245" height="342" rx="12" fill="#64748b"/></svg>', type: 'image/svg+xml' }
    }
    if (rel === '/api/sets/' + SET && method === 'GET') { state.setReads++; return ok(setDetail()) }
    const variant = rel.match(/^\/api\/collection\/variants\/(\d+)$/)
    if (variant && method === 'PATCH') {
      const id = Number(variant[1]), i = Math.floor((id - 100) / 2)
      return write(rel, method, () => {
        const before = qty(id)
        state.owned[id] = body.quantity
        return { variantId: id, quantity: body.quantity, delta: body.quantity - before, isFirstAcquisition: false, setId: SET, progress: progress(),
          card: { cardId: row(i).cardId, variants: variantsOf(i).map(v => ({ variantId: v.variantId, quantity: qty(v.variantId) })), ownership: ownership(i) } }
      })
    }
    if (rel === '/api/lists/' + LIST) {
      if (method === 'GET') return ok(listDetail())
      if (method === 'PATCH') return write(rel, method, () => { state.listName = body.name ?? state.listName; return { list: listDetail().list } })
    }
    const item = rel.match(/^\/api\/lists\/writes-list\/items\/(item-\d)$/)
    if (item && method === 'DELETE') {
      return write(rel, method, () => { state.list = state.list.filter(x => x.itemId !== item[1]); return { deleted: item[1], list: listDetail().list } })
    }
    if (rel === '/api/decks/' + DECK && method === 'GET') return ok(deckDetail())
    if (rel === `/api/decks/${DECK}/logs`) return ok({ version: null, logs: [], totals: { wins: 0, losses: 0, ties: 0, total: 0 }, pagination: { page: 1, pageSize: 20, total: 0, pageCount: 0 } })
    const deckCard = rel.match(/^\/api\/decks\/writes-deck\/cards\/fx1-00(\d)$/)
    if (deckCard && method === 'PATCH') {
      const i = Number(deckCard[1]) - 1
      return write(rel, method, () => {
        state.deck = state.deck.filter(r => r.i !== i || body.quantity > 0).map(r => r.i === i ? { ...r, quantity: body.quantity } : r)
        return deckDetail()
      })
    }
    return admin.response(rel, url, req)
  }
  const allowMutation = (pathname, method) => {
    const rel = pathname.slice(mount.length)
    return (method === 'PATCH' && (/^\/api\/collection\/variants\/\d+$/.test(rel) || rel === '/api/lists/' + LIST || /^\/api\/decks\/writes-deck\/cards\/fx1-00\d$/.test(rel)))
      || (method === 'DELETE' && /^\/api\/lists\/writes-list\/items\/item-\d$/.test(rel))
  }
  return { state, reset, response, allowMutation }
}

export async function checkWrites(browser, server, mount, label, out, fixture, admin) {
  const { state } = fixture, results = []
  Object.assign(admin.state, { actor: 'ordinary', permissions: [], signedOut: false, feedbackMatrix: false })
  for (const width of [1280, 390]) {
    fixture.reset()
    const { context, page } = await contextFor(browser, server, width)
    await signIn(context, USER)
    try {
      const go = route => page.goto(server.origin + mount + route, { waitUntil: 'networkidle' })
      const shot = name => page.screenshot({ path: path.join(out, `${label}-writes-${name}-${width}.png`) })
      // Failures are announced assertively; the visible toast carries the buttons.
      const said = text => page.getByRole('alert').filter({ hasText: text }).first()
      const toastShowing = () => page.getByRole('button', { name: 'Dismiss', exact: true }).count()
      const settle = async () => { while (state.inflight) await sleep(25); await sleep(150) }
      const fresh = () => Object.assign(state, { writes: [], maxInflight: 0 })

      // ── Collection counters (set grid) ────────────────────────────────────
      await go('/series/fx/fx1')
      const counter = page.locator('.px-card-counters').first().getByRole('button').first()
      const owned = async () => Number((await counter.getAttribute('aria-label')).match(/: (\d+) owned/)[1])
      const readsBefore = state.setReads
      fresh(); state.latency = () => 500
      // UXC-02: taps made while a write is saving used to hit a disabled button.
      for (let n = 1; n <= 3; n++) { await counter.click(); assert.equal(await owned(), n, 'every tap shows at once') }
      await settle()
      assert.equal(await owned(), 3)
      assert.equal(state.owned[100], 3, 'the server holds the last intent')
      assert.ok(state.writes.length < 3, `three taps coalesced into ${state.writes.length} writes`)
      assert.equal(state.maxInflight, 1, 'one collection write in flight at a time')
      assert.equal(state.setReads, readsBefore, 'the answer is applied, not refetched: no set re-download per tap')
      // Remove: right-click is the counter's -1.
      await counter.click({ button: 'right' })
      await settle()
      assert.equal(await owned(), 2)
      assert.equal(state.owned[100], 2)

      // QUAL-02: a failed write rolls back and says so, with a Retry that works.
      state.latency = () => 150; state.fail = true
      await counter.click()
      assert.equal(await owned(), 3)
      await said("Couldn't change Fixturemon (Normal) to 3 in your collection.").waitFor()
      assert.equal(await owned(), 2, 'rolled back to what the server holds')
      await shot('collection-failed')
      state.fail = false
      await page.getByRole('button', { name: 'Retry', exact: true }).click()
      await settle()
      assert.equal(await owned(), 3)
      assert.equal(state.owned[100], 3)
      assert.equal(await toastShowing(), 0, 'the retried save leaves no message behind')

      // Offline: counters stay disabled, as before this change.
      await context.setOffline(true)
      await page.waitForFunction(() => !navigator.onLine)
      assert.equal(await counter.isDisabled(), true)
      await context.setOffline(false)
      await page.waitForFunction(() => navigator.onLine)
      results.push({ case: 'writes-collection', label, width, coalesced: true, rollback: true, retry: true })

      // ── List: remove and edit ─────────────────────────────────────────────
      await go('/lists/' + LIST)
      const removeButtons = page.getByRole('button', { name: /^Remove / })
      await removeButtons.first().waitFor()
      state.fail = true; state.latency = () => 300
      // The remove control is hover-revealed on the tile; its handler is what is under test.
      await page.getByRole('button', { name: 'Remove Fixturemon', exact: true }).dispatchEvent('click')
      assert.equal(await removeButtons.count(), 2, 'removed at once')
      await said("Couldn't remove Fixturemon from “Trade binder”.").waitFor()
      assert.equal(await removeButtons.count(), 3, 'back after the failure')
      await shot('list-remove-failed')
      await page.getByRole('button', { name: 'Dismiss', exact: true }).click()

      await page.getByRole('button', { name: 'Edit list', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'Edit List', exact: true })
      await dialog.getByPlaceholder('My Charizard chase list').fill('Show binder')
      await dialog.getByRole('button', { name: 'Save', exact: true }).click()
      await dialog.getByRole('alert').filter({ hasText: "Couldn't save your changes to “Trade binder”." }).waitFor()
      assert.equal(await dialog.isVisible(), true, 'the form stays open with what was typed')
      assert.equal(await dialog.getByPlaceholder('My Charizard chase list').inputValue(), 'Show binder')
      await shot('list-edit-failed')
      state.fail = false
      await dialog.getByRole('button', { name: 'Save', exact: true }).click()
      await dialog.waitFor({ state: 'hidden' })
      await page.getByRole('heading', { name: 'Show binder', exact: true }).waitFor()
      assert.equal(state.listName, 'Show binder')
      results.push({ case: 'writes-list', label, width, removeRollback: true, editInline: true })

      // ── Deck quantity ──────────────────────────────────────────────────────
      await go('/decks/' + DECK)
      const plus = page.getByRole('button', { name: 'Increase', exact: true }).first()
      const copies = async () => Number(await plus.locator('xpath=preceding-sibling::span[1]').innerText())
      // QUAL-06: each later request answers FASTER, so unserialised writes would
      // land out of order and an older count would overwrite a newer one.
      fresh(); state.latency = n => Math.max(50, 700 - n * 200)
      for (let n = 2; n <= 5; n++) { await plus.click(); assert.equal(await copies(), n) }
      await settle()
      assert.equal(await copies(), 5, 'settles on the last tap, not a stale answer')
      assert.equal(state.deck.find(r => r.i === 0).quantity, 5)
      assert.equal(state.maxInflight, 1, 'deck writes never overlap')
      assert.ok(state.writes.length <= 4)

      state.fail = true; state.latency = () => 150
      await plus.click()
      await said("Couldn't change Fixturemon to 6 in “Fixture Deck”.").waitFor()
      assert.equal(await copies(), 5)
      await shot('deck-failed')
      state.fail = false
      await page.getByRole('button', { name: 'Retry', exact: true }).click()
      await settle()
      assert.equal(await copies(), 6)
      assert.equal(state.deck.find(r => r.i === 0).quantity, 6)

      // Offline, a deck edit is attempted and explained rather than silently lost.
      await context.setOffline(true)
      await page.waitForFunction(() => !navigator.onLine)
      await plus.click()
      await said("Couldn't change Fixturemon to 7 in “Fixture Deck”. You're offline.").waitFor()
      assert.equal(await copies(), 6)
      await shot('deck-offline')
      await context.setOffline(false)
      results.push({ case: 'writes-deck', label, width, ordered: true, rollback: true, retry: true, offline: true })
    } finally { await context.close() }
  }
  return results
}
