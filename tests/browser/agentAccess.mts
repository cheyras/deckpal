import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium, type Page } from 'playwright'
import { buildWeb, serve, contextFor } from './support.mjs'
import { signIn } from './admin.mjs'

/**
 * Profile → Agent access mints read-only personal access tokens (migration
 * 085, 2026-10-12). Builds the real cloud SPA, signs a fixture user in, and at
 * 1280 and 390px:
 *
 *  - the token list labels a read-only token "Read only" and a full one not;
 *  - New token offers the consent screen's choice, as a named radio group,
 *    with "Read and change" checked by default;
 *  - choosing Read only sends `scope: "read"`, and the new row is labelled;
 *  - leaving the default sends `scope: "full"`;
 *  - an API that ignores scope (older than 085) and mints full access anyway
 *    gets that token revoked at once, and its secret is never shown.
 *
 * Every request is answered by the local fixture below; an /api call it does
 * not name is a failure (support.mjs `serve`), and so is any mutation other
 * than POST /api/tokens and DELETE /api/tokens/:id.
 */

const USER = '10000000-0000-4000-8000-000000000003'
const SHOTS = process.env.DECKPAL_AGENT_ACCESS_SHOTS

interface Token {
  id: string
  name: string
  prefix: string
  createdAt: string
  lastUsedAt: string | null
  revokedAt: string | null
  expiresAt: string | null
  scope: 'full' | 'read'
  oauthClientId: null
  oauthRedirectUri: null
  redirect: null
  deckeImprovementRead: boolean
}

const token = (n: number, name: string, scope: 'full' | 'read'): Token => ({
  id: '20000000-0000-4000-8000-' + String(n).padStart(12, '0'),
  name,
  prefix: 'dsk_fixture' + (n % 10),
  createdAt: '2026-09-01T12:00:00Z',
  lastUsedAt: null,
  revokedAt: null,
  expiresAt: null,
  scope,
  oauthClientId: null,
  oauthRedirectUri: null,
  redirect: null,
  deckeImprovementRead: false,
})

const state = {
  tokens: [] as Token[],
  posts: [] as Record<string, unknown>[],
  deletes: [] as string[],
  /** An API older than 085: ignores `scope` and mints full access. */
  ignoreScope: false,
  next: 100,
}

function reset() {
  state.tokens = [token(1, 'Dashboard script', 'read'), token(2, 'Laptop', 'full')]
  state.posts = []
  state.deletes = []
  state.ignoreScope = false
}

function fixture(rel: string, url: URL, req: { method: string; body?: Record<string, unknown> }) {
  if (rel === '/api/tokens' && req.method === 'POST') {
    const body = req.body ?? {}
    state.posts.push(body)
    const scope = !state.ignoreScope && body.scope === 'read' ? 'read' : 'full'
    const created = { ...token(state.next++, String(body.name), scope), createdAt: '2026-09-12T18:00:00Z' }
    state.tokens.unshift(created)
    return { status: 201, body: { token: created, secret: 'dsk_fixtureSecretValueThatIsShownOnlyOnce' + state.next } }
  }
  const revoke = /^\/api\/tokens\/([0-9a-f-]{36})$/.exec(rel)
  if (revoke && req.method === 'DELETE') {
    state.deletes.push(revoke[1]!)
    const row = state.tokens.find((t) => t.id === revoke[1])
    if (!row) return { status: 404, body: { error: { code: 'not_found', message: 'No such token' } } }
    row.revokedAt = '2026-09-12T18:00:01Z'
    return { body: { token: row } }
  }
  if (rel === '/api/tokens') return { body: { tokens: state.tokens, canGrantDeckeImprovementRead: false } }
  if (rel === '/api/me') {
    return { body: { username: 'fixture', owner: false, decke: false, permissions: [], roles: [], role: null, isOwner: false, accessRevision: 1, features: {}, adminReady: true } }
  }
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
  // Profile's other, unrelated sections (features, Deck-E sharing, …): a quiet
  // empty 200 so they render their own empty states. The assertions below are
  // about /api/tokens alone.
  if (rel.startsWith('/api/')) return { body: {} }
  return null
}

const allowMutation = (pathname: string, method: string) =>
  (pathname === '/api/tokens' && method === 'POST') ||
  (/^\/api\/tokens\/[0-9a-f-]{36}$/.test(pathname) && method === 'DELETE') ||
  (pathname === '/api/me/billing/visit' && method === 'POST')

/** The list row for a token, by its name. */
const row = (page: Page, name: string) => page.locator('#agent-access li').filter({ has: page.getByText(name, { exact: true }) })

async function openForm(page: Page) {
  await page.locator('#agent-access').getByRole('button', { name: 'New token' }).click()
  const group = page.getByRole('group', { name: 'What it can do' })
  await group.waitFor()
  return group
}

async function shot(page: Page, name: string) {
  if (!SHOTS) return
  mkdirSync(SHOTS, { recursive: true })
  await page.locator('#agent-access').scrollIntoViewIfNeeded()
  await page.locator('#agent-access').screenshot({ path: path.join(SHOTS, name) })
}

const scratch = mkdtempSync(path.join(os.tmpdir(), 'deckpal-agent-access-'))
const dist = path.join(scratch, 'dist')
let browser
try {
  // serve() binds its port before dist has content, so the build's baked-in
  // Supabase URL can be the server's own origin (what signIn()'s storage key
  // expects); see profileOwnedCards.mts.
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
        await page.goto(server.origin + '/profile#agent-access', { waitUntil: 'networkidle' })
        const section = page.locator('#agent-access')
        await section.getByText('Connect an AI assistant').waitFor()

        // The list: a read-only token says so; a full one does not.
        await row(page, 'Dashboard script').getByText('Read only', { exact: true }).waitFor()
        assert.equal(await row(page, 'Laptop').getByText('Read only', { exact: true }).count(), 0, `${width}px: a full token is not labelled read-only`)

        // The form: the consent screen's two choices, Read and change by default.
        const group = await openForm(page)
        const full = group.getByRole('radio', { name: /^Read and change/ })
        const read = group.getByRole('radio', { name: /^Read only/ })
        assert.equal(await group.getByRole('radio').count(), 2, `${width}px: exactly two choices`)
        assert.equal(await full.isChecked(), true, `${width}px: Read and change is the default`)
        assert.equal(await read.isChecked(), false)
        await group.getByText('See and update your collection, decks, lists and battle logs.').waitFor()
        await group.getByText('See them, but change nothing.').waitFor()
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${width}px: no sideways scroll`)
        await shot(page, `agent-access-form-${width}.png`)

        // Read only, by keyboard: the radios are one native group.
        await full.focus()
        await page.keyboard.press('ArrowDown')
        assert.equal(await read.isChecked(), true, `${width}px: arrow keys move to Read only`)
        await page.getByLabel('Token name').fill('Claude on my laptop')
        await shot(page, `agent-access-form-read-${width}.png`)
        await section.getByRole('button', { name: 'Create token' }).click()
        await section.getByText('Copy “Claude on my laptop” now', { exact: false }).waitFor()
        assert.deepEqual(state.posts.at(-1), { name: 'Claude on my laptop', scope: 'read', deckeImprovementRead: false })
        await row(page, 'Claude on my laptop').getByText('Read only', { exact: true }).waitFor()
        await shot(page, `agent-access-created-read-${width}.png`)

        // The default sends full, and the form comes back reset to it.
        await section.getByRole('button', { name: 'Dismiss token' }).click()
        const again = await openForm(page)
        assert.equal(await again.getByRole('radio', { name: /^Read and change/ }).isChecked(), true, `${width}px: the choice resets to the default`)
        await page.getByLabel('Token name').fill('Desktop')
        await section.getByRole('button', { name: 'Create token' }).click()
        await section.getByText('Copy “Desktop” now', { exact: false }).waitFor()
        assert.deepEqual(state.posts.at(-1), { name: 'Desktop', scope: 'full', deckeImprovementRead: false })
        assert.equal(await row(page, 'Desktop').getByText('Read only', { exact: true }).count(), 0)

        // An API that ignores scope: the full-access secret is never shown, and it is revoked.
        await section.getByRole('button', { name: 'Dismiss token' }).click()
        state.ignoreScope = true
        const third = await openForm(page)
        await third.getByText('Read only', { exact: true }).click()
        await page.getByLabel('Token name').fill('Old server')
        await section.getByRole('button', { name: 'Create token' }).click()
        await section.getByText('can’t make read-only tokens yet', { exact: false }).waitFor()
        const minted = state.tokens.find((t) => t.name === 'Old server')!
        assert.deepEqual(state.deletes, [minted.id], `${width}px: the full token minted in its place is revoked`)
        assert.equal(await section.getByText('Copy “Old server” now', { exact: false }).count(), 0, `${width}px: its secret is never shown`)
        assert.equal(await page.getByText(/dsk_fixtureSecret/).count(), 0)
        await shot(page, `agent-access-old-server-${width}.png`)

        assert.deepEqual(server.unexpected, [], `${width}px: unexpected browser requests or page errors`)
        results[width] = { posts: state.posts.map((p) => p.scope), deletes: state.deletes.length }
      } finally {
        await context.close()
      }
    }
  } finally {
    await server.close()
  }
  console.log('PASS Agent access read-only tokens (085): ' + JSON.stringify(results))
} finally {
  await browser?.close()
  rmSync(scratch, { recursive: true, force: true })
}
