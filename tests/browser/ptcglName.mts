import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium, type Page } from 'playwright'
import { buildWeb, serve, contextFor } from './support.mjs'
import { signIn } from './admin.mjs'

/**
 * Profile → PTCG Live name (migration 086, 2026-10-13). Builds the real cloud SPA, signs a fixture user in, and at 1280
 * and 390px:
 *
 *  - a name learned from logged games shows, with the "filled in from your logged games" hint;
 *  - Save is disabled until the name changes; saving sends `ptcglName` and the hint goes (it is now typed);
 *  - Clear sends `ptcglName: null` and empties the field;
 *  - nothing scrolls sideways.
 *
 * Every request is answered by the fixture below; the only mutation allowed is PATCH /api/me/settings.
 */

const USER = '10000000-0000-4000-8000-000000000004'
const SHOTS = process.env.DECKPAL_PTCGL_NAME_SHOTS

const state = {
  name: 'cheyras' as string | null,
  source: 'auto' as 'auto' | 'manual' | null,
  patches: [] as Record<string, unknown>[],
}

function reset() {
  state.name = 'cheyras'
  state.source = 'auto'
  state.patches = []
}

const settings = () => ({
  defaultGoal: 'complete', displayCurrency: 'USD', pricingEnabled: true, showCollectionValue: true, binderPocketSize: 9,
  binderStackVariants: true, binderAdditionalVariants: 'inline', deckeHidden: false, deckeSharePrompts: true,
  deckeShareAll: false, skin: null, topbar: null, seriesSortKey: 'recency', seriesSortDir: 'desc', seriesGroupOwned: true,
  ptcglName: state.name, ptcglNameSource: state.source,
})

function fixture(rel: string, url: URL, req: { method: string; body?: Record<string, unknown> }) {
  if (rel === '/api/me/settings' && req.method === 'PATCH') {
    const body = req.body ?? {}
    state.patches.push(body)
    const name = typeof body.ptcglName === 'string' ? body.ptcglName.trim() : ''
    state.name = name || null
    state.source = name ? 'manual' : null
    return { body: { settings: settings() } }
  }
  if (rel === '/api/me/settings') return { body: { settings: settings() } }
  if (rel === '/api/me') {
    return { body: { username: 'fixture', owner: false, decke: false, permissions: [], roles: [], role: null, isOwner: false, accessRevision: 1, features: {}, adminReady: true } }
  }
  if (rel === '/api/tokens') return { body: { tokens: [], canGrantDeckeImprovementRead: false } }
  if (rel === '/api/insights/overview') {
    return {
      body: {
        trainer: { level: 1, uniqueCards: 0, totalCards: 0, intoLevel: 0, toNext: 5, nextLevelAt: 5, fraction: 0, uniqueMode: 'cards', uniquePairs: 0 },
        collectionValue: [],
        pokedex: { captured: 0, total: 1025, pct: 0 },
      },
    }
  }
  if (rel === '/api/me/showcase') return { body: { showcase: [] } }
  if (rel === '/api/me/cards') return { body: { pagination: { page: 1, pageSize: 48, total: 0, pageCount: 0 }, cards: [] } }
  if (rel === '/api/me/credits') return { body: { enabled: true, balance: 0, debt: 0, purchaseHold: false, lowAt: 100, prices: {}, packs: [], purchasesEnabled: false } }
  if (rel === '/api/me/billing/history') return { body: { kind: url.searchParams.get('kind'), items: [], nextCursor: null, billingAccountPresent: false } }
  if (rel === '/api/me/billing' || rel === '/api/me/billing/visit') return { body: { available: false, mode: 'unconfigured', prompt: { due: null } } }
  // Profile's other, unrelated sections: a quiet empty 200 so they render their own empty states.
  if (rel.startsWith('/api/')) return { body: {} }
  return null
}

const allowMutation = (pathname: string, method: string) =>
  (pathname === '/api/me/settings' && method === 'PATCH') || (pathname === '/api/me/billing/visit' && method === 'POST')

async function shot(page: Page, name: string) {
  if (!SHOTS) return
  mkdirSync(SHOTS, { recursive: true })
  await page.locator('#ptcgl-name').scrollIntoViewIfNeeded()
  await page.locator('#ptcgl-name').screenshot({ path: path.join(SHOTS, name) })
}

const scratch = mkdtempSync(path.join(os.tmpdir(), 'deckpal-ptcgl-name-'))
const dist = path.join(scratch, 'dist')
let browser
try {
  const server = await serve(dist, '', fixture, 'index.html', { allowMutation })
  await buildWeb(dist, true, server.origin)
  browser = await chromium.launch()
  const results: Record<string, unknown> = {}
  try {
    for (const width of [1280, 390]) {
      reset()
      const { context, page } = await contextFor(browser, server, width)
      await signIn(context, USER)
      try {
        await page.goto(server.origin + '/profile#ptcgl-name', { waitUntil: 'networkidle' })
        const section = page.locator('#ptcgl-name')
        const field = section.getByLabel('Your PTCG Live screen name')
        await section.getByText('Filled in from your logged games', { exact: false }).waitFor()
        assert.equal(await field.inputValue(), 'cheyras', `${width}px: the learned name shows`)
        const save = section.getByRole('button', { name: 'Save name' })
        assert.equal(await save.isDisabled(), true, `${width}px: nothing to save until it changes`)
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${width}px: no sideways scroll`)
        await shot(page, `ptcgl-name-auto-${width}.png`)

        await field.fill('  ChEyRaS_main  ')
        await save.click()
        await section.getByRole('status').filter({ hasText: 'Saved.' }).waitFor()
        assert.deepEqual(state.patches.at(-1), { ptcglName: 'ChEyRaS_main' }, `${width}px: the typed name is sent trimmed`)
        assert.equal(await section.getByText('Filled in from your logged games', { exact: false }).count(), 0, `${width}px: a typed name has no learned hint`)
        await shot(page, `ptcgl-name-saved-${width}.png`)

        await section.getByRole('button', { name: 'Clear' }).click()
        await section.getByRole('status').filter({ hasText: 'Cleared.' }).waitFor()
        assert.deepEqual(state.patches.at(-1), { ptcglName: null }, `${width}px: Clear sends null`)
        assert.equal(await field.inputValue(), '', `${width}px: the field is empty after Clear`)

        assert.deepEqual(server.unexpected, [], `${width}px: unexpected browser requests or page errors`)
        results[width] = { patches: state.patches.length }
      } finally {
        await context.close()
      }
    }
  } finally {
    await server.close()
  }
  console.log('PASS Profile PTCG Live name (086): ' + JSON.stringify(results))
} finally {
  await browser?.close()
  rmSync(scratch, { recursive: true, force: true })
}
