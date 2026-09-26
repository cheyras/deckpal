import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright'
import { buildWeb, serve, contextFor } from './support.mjs'
import { signIn } from './admin.mjs'

/**
 * UXC-04 (DECISIONS.md 2026-09-26): the showcase picker's "what do I own"
 * list used to be derived by paging the captured-species grid and then
 * fetching every one of those species individually — 1 + N requests on
 * EVERY /profile visit, N up to the size of the Pokédex (867 for the audit's
 * heavy persona), whether or not the picker was ever opened. GET /me/cards
 * replaced that fan-out with one bounded, paged query, loaded lazily.
 *
 * This locks the CONTRACT, not the fixed bug's old shape: a bare /profile
 * visit fires no /insights/pokedex/:id calls at all (the fan-out is gone,
 * not just slower), the banner's own /me/cards call is at most one request,
 * and opening the picker adds at most one more — "a couple" total, where the
 * old code made 1 + N.
 */

const USER = '10000000-0000-4000-8000-000000000002'
const PLACEHOLDER = { low: '/__fixture/card.svg', high: '/__fixture/card.svg' }
// 200 owned cards: comfortably more than the old N+1 fan-out would have
// wanted to make cheap, so a regression back to per-card requests would be
// obvious in the assertions below, not just slow.
const OWNED_CARDS = Array.from({ length: 200 }, (_, i) => ({
  cardId: 'fx-' + i,
  name: 'Fixture Card ' + i,
  images: PLACEHOLDER,
  quantity: 1,
  price: { market: 200 - i, currency: 'USD' },
}))

function fixture(rel: string, url: URL, req: { method: string }) {
  if (rel === '/__fixture/card.svg') {
    return { raw: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="280"/>', type: 'image/svg+xml' }
  }
  if (rel === '/api/me') {
    return { body: { username: 'fixture', owner: false, decke: false, permissions: [], roles: [], role: null, isOwner: false, accessRevision: 1, features: {}, adminReady: true } }
  }
  if (rel === '/api/insights/overview') {
    return {
      body: {
        trainer: { level: 3, uniqueCards: 200, totalCards: 400, intoLevel: 0, toNext: 5, nextLevelAt: 25, fraction: 0.2, uniqueMode: 'cards', uniquePairs: 200 },
        collectionValue: [{ currency: 'USD', total: 4321, totalMinor: 432100, pricedVariants: 200, quantity: 400 }],
        pokedex: { captured: 100, total: 1025, pct: 9.8 },
      },
    }
  }
  if (rel === '/api/me/showcase') return { body: { showcase: [] } }
  if (rel === '/api/me/cards') {
    const q = (url.searchParams.get('q') ?? '').toLowerCase()
    const pageSize = Number(url.searchParams.get('pageSize') ?? 48)
    const rows = q ? OWNED_CARDS.filter((c) => c.name.toLowerCase().includes(q)) : OWNED_CARDS
    return { body: { pagination: { page: 1, pageSize, total: rows.length, pageCount: Math.ceil(rows.length / pageSize) }, cards: rows.slice(0, pageSize) } }
  }
  // Every other /api/* call Profile.tsx's other, unrelated sections make
  // (tokens, features, decke sharing, credits, …) — a quiet empty 200 so
  // those widgets render their own empty states instead of throwing, and so
  // this test's `unexpected` assertion stays meaningful for what it actually
  // checks: the owned-cards path.
  if (rel.startsWith('/api/')) return { body: {} }
  return null
}

const isOwnedCardsPath = (p: string) => p === '/api/me/cards' || p.startsWith('/api/me/cards?')
const isPokedexDetailPath = (p: string) => /^\/api\/insights\/pokedex\/\d+/.test(p)

const scratch = mkdtempSync(path.join(os.tmpdir(), 'deckpal-profile-owned-cards-'))
const dist = path.join(scratch, 'dist')
let browser
try {
  // serve() binds its port before dist has content — buildWeb() writes into
  // it afterward — so the built bundle's baked-in Supabase URL can be the
  // server's own origin (the `sb-127-auth-token` localStorage key signIn()
  // plants only matches a build baked to a 127.0.0.1 origin).
  const server = await serve(dist, '', fixture)
  buildWeb(dist, true, server.origin)
  browser = await chromium.launch()
  const results: Record<string, unknown> = {}
  try {
    for (const width of [390, 1440]) {
      const { context, page } = await contextFor(browser, server, width)
      await signIn(context, USER)
      try {
        const startedAtLoad = server.requests.length
        await page.goto(server.origin + '/profile', { waitUntil: 'networkidle' })
        try {
          await page.getByRole('heading', { name: 'Showcase Cards' }).waitFor({ timeout: 5000 })
        } catch (e) {
          console.error('DEBUG url:', page.url())
          console.error('DEBUG body:', (await page.locator('body').innerText()).slice(0, 2000))
          console.error('DEBUG requests:', JSON.stringify(server.requests.slice(startedAtLoad)))
          console.error('DEBUG unexpected:', JSON.stringify(server.unexpected))
          throw e
        }
        const onLoad = server.requests.slice(startedAtLoad)
        const pokedexOnLoad = onLoad.filter(isPokedexDetailPath)
        const ownedOnLoad = onLoad.filter(isOwnedCardsPath)
        assert.equal(pokedexOnLoad.length, 0, `${width}px: a /profile visit must never fan out over species detail requests (UXC-04): ${JSON.stringify(onLoad)}`)
        assert.ok(ownedOnLoad.length <= 1, `${width}px: /profile should make at most one /me/cards request (the banner), got ${ownedOnLoad.length}: ${JSON.stringify(onLoad)}`)

        const startedAtPicker = server.requests.length
        await page.getByText('Add card', { exact: true }).first().click()
        await page.getByText('Pick a Showcase Card', { exact: false }).waitFor()
        await page.getByText('Loading your cards', { exact: false }).waitFor({ state: 'hidden' }).catch(() => {})
        await page.getByText('Fixture Card 0', { exact: true }).waitFor()
        const afterOpeningPicker = server.requests.slice(startedAtPicker)
        const ownedFromPicker = afterOpeningPicker.filter(isOwnedCardsPath)
        assert.ok(
          ownedFromPicker.length >= 1 && ownedFromPicker.length <= 1,
          `${width}px: opening the picker should make exactly one /me/cards request, got ${ownedFromPicker.length}: ${JSON.stringify(afterOpeningPicker)}`,
        )

        const totalForTheWholeFlow = ownedOnLoad.length + ownedFromPicker.length
        assert.ok(totalForTheWholeFlow <= 2, `${width}px: visiting Profile and opening the picker should be "a couple" of /me/cards requests, got ${totalForTheWholeFlow}`)
        results[width] = { ownedOnLoad: ownedOnLoad.length, ownedFromPicker: ownedFromPicker.length, pokedexOnLoad: pokedexOnLoad.length }
      } finally {
        await context.close()
      }
    }
  } finally {
    await server.close()
  }
  console.log('PASS Profile owned-cards request-count proof (UXC-04): ' + JSON.stringify(results))
} finally {
  await browser?.close()
  rmSync(scratch, { recursive: true, force: true })
}
