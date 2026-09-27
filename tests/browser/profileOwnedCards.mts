import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
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
const BOARD = process.env.DECKPAL_PROFILE_BOARD_DIR
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

function fixture(rel: string, url: URL) {
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
  if (rel === '/api/me/credits') return { body: { enabled: true, balance: 0, debt: 0, purchaseHold: false, lowAt: 100, prices: {}, packs: [], purchasesEnabled: false } }
  if (rel === '/api/me/billing/history') return { body: { kind: url.searchParams.get('kind'), items: [], nextCursor: null, billingAccountPresent: false } }
  if (rel === '/api/me/billing' || rel === '/api/me/billing/visit') return { body: { available: false, mode: 'unconfigured', prompt: { due: null } } }
  if (rel === '/api/tokens') return { body: { tokens: [] } }
  if (rel === '/api/me/cards') {
    const q = (url.searchParams.get('q') ?? '').toLowerCase()
    const page = Number(url.searchParams.get('page') ?? 1)
    const pageSize = Number(url.searchParams.get('pageSize') ?? 48)
    const rows = q ? OWNED_CARDS.filter((c) => c.name.toLowerCase().includes(q)) : OWNED_CARDS
    return { body: { pagination: { page, pageSize, total: rows.length, pageCount: Math.ceil(rows.length / pageSize) }, cards: rows.slice((page - 1) * pageSize, page * pageSize) } }
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
  const server = await serve(dist, '', fixture, 'index.html', {
    allowMutation: (pathname: string, method: string) => pathname === '/api/me/billing/visit' && method === 'POST',
  })
  await buildWeb(dist, true, server.origin)
  browser = await chromium.launch()
  const results: Record<string, unknown> = {}
  try {
    for (const width of [390, 1440]) {
      const { context, page } = await contextFor(browser, server, width)
      await signIn(context, USER)
      try {
        const startedAtLoad = server.requests.length
        await page.goto(server.origin + '/profile', { waitUntil: 'networkidle' })
        await page.getByRole('heading', { name: 'Showcase Cards' }).waitFor()
        const onLoad = server.requests.slice(startedAtLoad)
        const pokedexOnLoad = onLoad.filter(isPokedexDetailPath)
        const ownedOnLoad = onLoad.filter(isOwnedCardsPath)
        assert.equal(pokedexOnLoad.length, 0, `${width}px: a /profile visit must never fan out over species detail requests (UXC-04): ${JSON.stringify(onLoad)}`)
        assert.ok(ownedOnLoad.length <= 1, `${width}px: /profile should make at most one /me/cards request (the banner), got ${ownedOnLoad.length}: ${JSON.stringify(onLoad)}`)

        const startedAtPicker = server.requests.length
        await page.getByText('Add card', { exact: true }).first().click()
        await page.getByText('Pick a Showcase Card', { exact: false }).waitFor()
        await page.getByText('Fixture Card 0', { exact: true }).waitFor()
        await page.waitForTimeout(250)
        const search = page.getByPlaceholder('Search your cards…')
        const searchContainer = search.locator('xpath=..')
        await page.getByRole('heading', { name: 'Pick a Showcase Card' }).click()
        await search.evaluate((input) => (input as HTMLInputElement).blur())
        await page.waitForTimeout(50)
        assert.equal(await search.evaluate((input) => input.matches(':focus')), false, `${width}px: capture the picker in its unfocused state`)
        assert.equal(await search.evaluate((input) => getComputedStyle(input).outlineStyle), 'none', `${width}px: the unfocused search input must not draw its own outline`)
        assert.equal(await searchContainer.evaluate((container) => getComputedStyle(container).outlineStyle), 'none', `${width}px: the unfocused search container must not draw a focus ring`)
        if (BOARD) {
          mkdirSync(BOARD, { recursive: true })
          await page.screenshot({ path: `${BOARD}/after-picker-${width}.png` })
        }

        // Return focus to the input using the keyboard so :focus-visible is
        // active, then prove its ring belongs to the rounded container.
        await search.focus()
        await page.keyboard.press('Tab')
        await page.keyboard.press('Shift+Tab')
        assert.equal(await search.evaluate((input) => input.matches(':focus-visible')), true, `${width}px: search should have keyboard-visible focus`)
        const focusStyle = await search.evaluate((input) => getComputedStyle(input).outlineStyle)
        const containerFocus = await searchContainer.evaluate((container) => {
          const style = getComputedStyle(container)
          return {
            skin: document.documentElement.dataset.skin,
            outlineStyle: style.outlineStyle,
            outlineWidth: style.outlineWidth,
            outlineColor: style.outlineColor,
            outlineOffset: style.outlineOffset,
            boxShadow: style.boxShadow,
            tokenColor: (() => {
              const probe = document.createElement('span')
              probe.style.color = 'var(--color-action-primary-strong)'
              document.body.append(probe)
              const color = getComputedStyle(probe).color
              probe.remove()
              return color
            })(),
          }
        })
        assert.equal(focusStyle, 'none', `${width}px: focused input must not draw an inner outline`)
        assert.equal(containerFocus.outlineStyle, 'solid', `${width}px: keyboard focus must show a ring on the rounded container`)
        assert.equal(containerFocus.outlineOffset, '2px', `${width}px: container ring must use the app's 2px offset`)
        if (containerFocus.skin === 'premium') {
          assert.equal(containerFocus.outlineWidth, '1px', `${width}px: premium container ring must use the app's 1px treatment`)
          assert.notEqual(containerFocus.boxShadow, 'none', `${width}px: premium container ring must include the app's accent halo`)
        } else {
          assert.equal(containerFocus.outlineWidth, '2px', `${width}px: standard container ring must use the app's 2px treatment`)
          assert.equal(containerFocus.outlineColor, containerFocus.tokenColor, `${width}px: standard container ring must use the action-primary-strong token`)
        }
        if (BOARD) await page.screenshot({ path: `${BOARD}/after-picker-focused-${width}.png` })

        const afterOpeningPicker = server.requests.slice(startedAtPicker)
        const ownedFromPicker = afterOpeningPicker.filter(isOwnedCardsPath)
        assert.equal(
          ownedFromPicker.length, 1,
          `${width}px: opening the picker should make exactly one /me/cards request, got ${ownedFromPicker.length}: ${JSON.stringify(afterOpeningPicker)}`,
        )
        assert.equal(afterOpeningPicker.filter(isPokedexDetailPath).length, 0, `${width}px: opening the picker must not fetch species details`)
        assert.deepEqual(server.unexpected, [], `${width}px: unexpected browser requests or page errors`)

        const totalForTheWholeFlow = ownedOnLoad.length + ownedFromPicker.length
        assert.ok(totalForTheWholeFlow <= 2, `${width}px: visiting Profile and opening the picker should be "a couple" of /me/cards requests, got ${totalForTheWholeFlow}`)
        assert.equal(await page.getByText('Fixture Card 48', { exact: true }).count(), 0, `${width}px: the second page must wait for the collector`)
        const startedAtMore = server.requests.length
        await page.getByRole('button', { name: 'Load more cards' }).click()
        await page.getByText('Fixture Card 48', { exact: true }).waitFor()
        const afterLoadingMore = server.requests.slice(startedAtMore)
        assert.equal(afterLoadingMore.filter(isOwnedCardsPath).length, 1, `${width}px: Load more should fetch one next page`)
        assert.equal(afterLoadingMore.filter(isPokedexDetailPath).length, 0, `${width}px: Load more must not fetch species details`)
        assert.deepEqual(server.unexpected, [], `${width}px: unexpected browser requests or page errors after Load more`)
        results[width] = { ownedOnLoad: ownedOnLoad.length, ownedFromPicker: ownedFromPicker.length, ownedFromLoadMore: 1, pokedexOnLoad: pokedexOnLoad.length }
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
