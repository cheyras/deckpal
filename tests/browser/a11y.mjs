/**
 * A11y regression gate — axe-core against a handful of key routes at 390px.
 *
 * This does NOT replace a full accessibility audit (see DECISIONS.md and the
 * fix/accessibility-pass PR for that). It exists so the specific defects that
 * pass fixed — the icon-only "copy link" button with no name (A11Y-01), the
 * disabled binder-view `<select>` with no name (A11Y-06) — cannot silently
 * come back, and so any FUTURE `button-name`/`select-name`/`image-alt`-shaped
 * regression on these routes fails CI instead of waiting for the next manual
 * audit. `runOnly` matches the audit's own methodology (WCAG 2.2 AA).
 *
 * axe-core is injected as a page script (`axe.min.js`, from the `axe-core`
 * devDependency) rather than imported as a module — Playwright's page context
 * has no bundler, so `page.addScriptTag({ content: ... })` with the raw UMD
 * build is the simplest thing that works, and it is the same technique the
 * original audit used.
 */
import assert from 'node:assert/strict'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { webkit } from 'playwright'
import { contextFor } from './support.mjs'
import { signIn } from './admin.mjs'

const AXE_SRC = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8')
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']

/** Routes worth a permanent axe check: the admin shell (real nav/header
 *  chrome — A11Y-02/03/05's surface; already exercised elsewhere in this
 *  fixture via `checkAdmin`, so it is known to render cleanly here) and two
 *  signed-in creation forms (A11Y-08's surface). Deliberately small — this is
 *  a regression gate on fixed defects, not a re-run of the full audit.
 *
 *  NOT `/series/:slug`: with the admin fixture active it always renders
 *  `UpcomingSetRow`'s "Coming Soon" placeholder card, whose
 *  `bg-surface-tertiary/60` composites text-muted down to ~3.99:1 — a
 *  pre-existing contrast gap in a component this pass never touched, not a
 *  regression in anything A11Y-01..11 fixed. Flagged rather than fixed here;
 *  a route this check doesn't need isn't worth carrying that false failure. */
function routesFor(mount) {
  return [
    { case: 'a11y-admin', path: '/admin', signIn: true },
    { case: 'a11y-lists', path: '/lists', signIn: true },
    { case: 'a11y-decks', path: '/decks', signIn: true },
  ].map((r) => ({ ...r, path: mount + r.path }))
}

export async function checkA11y(browser, server, mount, label, out) {
  const results = []
  for (const route of routesFor(mount)) {
    const { context, page } = await contextFor(browser, server, 390)
    try {
      if (route.signIn) await signIn(context)
      await page.goto(server.origin + route.path, { waitUntil: 'networkidle' })
      await page.addScriptTag({ content: AXE_SRC })
      const axeResult = await page.evaluate(
        async (tags) => window.axe.run(document, { runOnly: { type: 'tag', values: tags } }),
        AXE_TAGS,
      )
      const violations = axeResult.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length }))
      assert.deepEqual(violations, [], `${route.case} (${label}): axe found ${violations.length} violation(s) — ${JSON.stringify(violations)}`)
      results.push({ case: route.case, label, violations: 0 })
    } catch (error) {
      await page.screenshot({ path: path.join(out, `${label}-${route.case}-a11y-failure.png`), fullPage: true })
      throw error
    } finally {
      await context.close()
    }
  }
  if (label === 'cloud') {
    const safari = await webkit.launch({ headless: true })
    try {
      for (const [engine, candidate] of [['chromium', browser], ['webkit', safari]]) {
        for (const width of [1440, 390]) {
          const { context, page } = await contextFor(candidate, server, width)
          try {
            await signIn(context)
            await page.goto(server.origin + '/lists', { waitUntil: 'networkidle' })
            await page.keyboard.press('Tab')
            const firstStop = await page.evaluate(() => {
              const link = document.querySelector('a[href="#main"]')
              const rect = link?.getBoundingClientRect()
              return {
                isSkipLink: document.activeElement === link,
                visible: !!rect && rect.width > 0 && rect.height > 0 &&
                  document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === link,
                top: rect?.top,
                bottom: rect?.bottom,
                headingTop: document.querySelector('#main h1')?.getBoundingClientRect().top,
                background: link && getComputedStyle(link).backgroundColor,
                mainExists: !!document.getElementById('main'),
              }
            })
            assert.equal(firstStop.isSkipLink, true, `${engine} ${width}: the skip link must be the first Tab stop`)
            assert.equal(firstStop.visible, true, `${engine} ${width}: the focused skip link must be unobscured`)
            assert.equal(firstStop.mainExists, true, `${engine} ${width}: #main must exist`)
            assert.notEqual(firstStop.background, 'rgba(0, 0, 0, 0)', `${engine} ${width}: the focused link needs an opaque face`)
            if (width === 390) {
              assert.ok(firstStop.top >= 64, `${engine}: the phone header must not cover the skip link`)
              assert.ok(firstStop.headingTop >= firstStop.bottom, `${engine}: the skip link must not cover the page heading`)
            }
            await page.keyboard.press('Enter')
            assert.equal(await page.evaluate(() => document.activeElement?.id), 'main', `${engine} ${width}: Enter must focus main`)
            assert.equal(await page.locator('#main').getAttribute('tabindex'), '-1')
            assert.equal(await page.locator('#main').evaluate((el) => getComputedStyle(el).outlineStyle), 'none',
              `${engine} ${width}: the landmark itself must not gain a page-sized outline`)
            await page.keyboard.press('Tab')
            assert.equal(await page.evaluate(() => document.querySelector('#main')?.contains(document.activeElement) && document.activeElement?.id !== 'main'),
              true, `${engine} ${width}: the next Tab must stay inside main`)
            await page.locator('a[href="#main"]').evaluate((link) => link.click())
            assert.equal(await page.evaluate(() => document.activeElement?.id), 'main', `${engine} ${width}: clicking the link must focus main`)
            results.push({ case: 'a11y-skip-link', label, engine, width, first: true, enteredMain: true })
            if (width === 390) {
              await page.getByRole('button', { name: 'Menu' }).click()
              const drawer = page.getByRole('dialog', { name: 'Navigation' })
              await drawer.getByRole('button', { name: 'Close navigation' }).waitFor()
              await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Close navigation')
              for (let step = 0; step < 5; step++) {
                await page.keyboard.press('Tab')
                assert.equal(await page.evaluate(() => document.querySelector('#mobile-nav-drawer')?.contains(document.activeElement)),
                  true, `${engine}: forward Tab ${step + 1} must stay inside navigation`)
                if (step === 0) assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'A',
                  `${engine}: the first forward Tab must reach the profile link`)
              }
              await page.keyboard.press('Shift+Tab')
              assert.equal(await page.evaluate(() => document.querySelector('#mobile-nav-drawer')?.contains(document.activeElement)),
                true, `${engine}: backward Tab must stay inside navigation`)
              results.push({ case: 'a11y-drawer-tab', label, engine, width, stayedInside: true })
              await page.setViewportSize({ width: 1440, height: 900 })
              await page.waitForFunction(() => !document.querySelector('#mobile-nav-drawer'))
              await page.waitForFunction(() => !!document.activeElement?.closest('aside'))
              await page.evaluate(() => { window.__desktopStart = document.activeElement })
              await page.keyboard.press('Tab')
              assert.equal(await page.evaluate(() => document.activeElement !== window.__desktopStart),
                true, `${engine}: resizing to desktop must release the drawer trap for the next Tab`)
              results.push({ case: 'a11y-drawer-resize', label, engine, from: 390, to: 1440, focusMovedToSidebar: true })
            }
          } finally { await context.close() }
        }
      }
    } finally { await safari.close() }
    const decke = await contextFor(browser, server, 390)
    try {
      await signIn(decke.context)
      await decke.page.goto(server.origin + '/lists', { waitUntil: 'networkidle' })
      await decke.page.getByRole('button', { name: 'Menu' }).click()
      await decke.page.getByRole('dialog', { name: 'Navigation' }).waitFor()
      await decke.page.locator('button[aria-label="Chat with Deck-E"]').click()
      await decke.page.waitForFunction(() => !document.querySelector('#mobile-nav-drawer'))
      assert.notEqual(await decke.page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Menu',
        'opening Deck-E must not return focus to the drawer trigger')
      results.push({ case: 'a11y-drawer-to-chat', label, drawerClosed: true, focusStayedOutOfMenu: true })
    } finally { await decke.context.close() }
    const reverse = await contextFor(browser, server, 390)
    try {
      await signIn(reverse.context)
      await reverse.page.route('**/api/me/credits', async route => {
        const response = await route.fetch()
        await route.fulfill({ response, json: { ...await response.json(), balance: 10 } })
      })
      await reverse.page.goto(server.origin + '/lists', { waitUntil: 'networkidle' })
      await reverse.page.locator('button[aria-label="Chat with Deck-E"]').click()
      const chat = reverse.page.getByRole('dialog', { name: 'Chat with Deck-E' })
      await chat.waitFor()
      const draft = 'Keep this draft while I check the menu'
      await chat.getByRole('textbox', { name: 'Message Deck-E' }).fill(draft)
      await reverse.page.getByRole('button', { name: 'Menu' }).click()
      const drawer = reverse.page.getByRole('dialog', { name: 'Navigation' })
      await drawer.waitFor()
      assert.equal(await chat.getAttribute('inert'), '', 'opening the menu must make the chat panel inert')
      await reverse.page.keyboard.press('Shift+Tab')
      assert.equal(await reverse.page.evaluate(() => document.querySelector('#mobile-nav-drawer')?.contains(document.activeElement)),
        true, 'Shift+Tab must remain in the drawer after chat is minimised')
      await reverse.page.waitForTimeout(4200)
      assert.equal(await reverse.page.evaluate(() => document.querySelector('#mobile-nav-drawer')?.contains(document.activeElement)),
        true, 'focus must remain in the menu after Deck-E’s retirement deadline')
      assert.equal(await chat.getAttribute('inert'), '', 'the chat must remain open and inert past the retirement deadline')
      await drawer.getByRole('button', { name: 'Close navigation' }).click()
      await reverse.page.waitForFunction(() => !document.querySelector('#mobile-nav-drawer'))
      await reverse.page.waitForFunction(() =>
        document.querySelector('[role="dialog"][aria-label="Chat with Deck-E"]')?.hasAttribute('inert') === false)
      assert.equal(await chat.getAttribute('inert'), null, 'closing the menu must reveal the same chat')
      assert.equal(await chat.getByRole('textbox', { name: 'Message Deck-E' }).inputValue(), draft,
        'opening the menu must preserve the reader’s unsent message')
      results.push({ case: 'a11y-chat-to-drawer', label, chatInert: true, focusStayedInDrawer: true, draftPreservedAfterDelay: true })
    } finally { await reverse.context.close() }
    const { context, page } = await contextFor(browser, server, 390)
    try {
      await signIn(context)
      const live = 'body > [role="status"][aria-live="polite"]'
      await page.goto(server.origin + '/admin', { waitUntil: 'networkidle' })
      await page.waitForFunction((selector) => document.querySelector(selector)?.textContent === 'Administration — Overview', live)
      const adminTabs = page.getByRole('navigation', { name: 'Administration sections' })
      await adminTabs.getByRole('link', { name: 'Users' }).click()
      await page.waitForFunction((selector) => document.querySelector(selector)?.textContent === 'Administration — Users', live)
      assert.equal(await page.locator('h1').textContent(), 'Administration', 'the visible h1 stays shared across admin pages')
      await adminTabs.getByRole('link', { name: 'Roles' }).click()
      await page.waitForFunction((selector) => document.querySelector(selector)?.textContent === 'Administration — Roles', live)
      results.push({ case: 'a11y-shared-heading-routes', label, announcements: ['Administration — Overview', 'Administration — Users', 'Administration — Roles'] })
      await page.goto(server.origin + '/lists', { waitUntil: 'networkidle' })
      await page.waitForFunction((selector) => document.querySelector(selector)?.textContent === 'My Lists', live)
      const repeatedWrites = await page.evaluate(async (selector) => {
        const region = document.querySelector(selector)
        let writes = 0
        const observer = new MutationObserver((records) => { writes += records.length })
        observer.observe(region, { childList: true, characterData: true, subtree: true })
        const probe = document.createElement('span')
        document.getElementById('root').appendChild(probe)
        await new Promise((resolve) => setTimeout(resolve, 50))
        probe.remove()
        await new Promise((resolve) => setTimeout(resolve, 50))
        observer.disconnect()
        return writes
      }, live)
      assert.equal(repeatedWrites, 0, 'unrelated page mutations must not rewrite the live region')
      await page.waitForTimeout(4200)
      await page.evaluate(() => { document.querySelector('h1').textContent = 'Late fixture heading' })
      await page.waitForFunction((selector) => document.querySelector(selector)?.textContent === 'Late fixture heading', live)
      results.push({ case: 'a11y-route-announcer', label, repeatedWrites, lateHeading: true })
      await page.getByRole('button', { name: 'Menu' }).click()
      await page.getByRole('button', { name: 'Close navigation' }).waitFor()
      await page.waitForTimeout(50)
      await page.evaluate(() => {
        const dialog = document.createElement('div')
        dialog.setAttribute('role', 'dialog')
        dialog.setAttribute('aria-modal', 'true')
        dialog.innerHTML = '<button id="overlaid-back">Back</button><input id="overlaid-field">'
        document.body.appendChild(dialog)
        dialog.querySelector('#overlaid-field').focus()
      })
      await page.keyboard.press('Shift+Tab')
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'overlaid-back',
        'the drawer must not pull focus out of a dialog opened above it')
      results.push({ case: 'a11y-stacked-dialog', label, backwardFocusStayedInTopDialog: true })
    } finally { await context.close() }
  }
  if (label === 'cloud') {
    const { context, page } = await contextFor(browser, server, 390)
    const art = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="140"/%3E'
    const cards = [
      { cardId: 'fixture-a-1', number: '1', name: 'Pikachu', set: { setId: 'fixture-a', name: 'Alpha Set' } },
      { cardId: 'fixture-b-1', number: '1', name: 'Pikachu', set: { setId: 'fixture-b', name: 'Beta Set' } },
    ]
    try {
      await signIn(context)
      await page.route(/\/api\/search\?/, route => route.fulfill({ json: {
        pagination: { page: 1, pageSize: 60, total: 2, pageCount: 1 },
        cards: cards.map(card => ({ ...card, category: 'Pokemon', rarity: 'Common', artist: null,
          series: { slug: 'fixture', name: 'Fixture Series' }, variantCount: 0,
          images: { low: art, high: art }, price: null })),
      } }))
      await page.route(/\/api\/cards\/fixture-[ab]-1$/, route => {
        const card = cards.find(item => route.request().url().endsWith(item.cardId))
        return route.fulfill({ json: { card: { ...card, printedTotal: 100, category: 'Pokemon', rarity: 'Common', artist: null,
          hp: null, stage: null, evolvesFrom: null, retreat: null, regulationMark: null, releasedOn: null,
          set: { ...card.set, slug: card.set.setId, logoUrl: null, symbolUrl: null },
          series: { slug: 'fixture', name: 'Fixture Series', tcgdexId: 'fixture' },
          images: { low: art, high: art }, types: [], subtypes: [], tags: [], attacks: [], abilities: [],
          weaknesses: [], resistances: [], species: [] }, variants: [] } })
      })
      await page.route(/\/sets\/fixture-[ab]\/symbol\.webp$/, route => route.fulfill({
        contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"/>',
      }))
      await page.goto(server.origin + '/search?q=Pikachu', { waitUntil: 'networkidle' })
      const live = 'body > [role="status"][aria-live="polite"]'
      await page.waitForFunction((selector) => document.querySelector(selector)?.textContent === 'Search', live)
      await page.locator('input[placeholder^="Search every card"]').fill('Raichu')
      await page.waitForURL(/\/search\?q=Raichu/)
      await page.waitForTimeout(4200)
      assert.equal(await page.locator('h1').textContent(), 'Search')
      assert.equal(await page.locator(live).textContent(), 'Search',
        'a query-only search change must not replace the page heading with the generic site title')
      results.push({ case: 'a11y-search-query-announcement', label, announcement: 'Search' })
      await page.locator('input[placeholder^="Search every card"]').fill('Pikachu')
      await page.waitForURL(/\/search\?q=Pikachu/)
      for (const [cardId, expected] of [
        ['fixture-a-1', 'Pikachu — Alpha Set #001'],
        ['fixture-b-1', 'Pikachu — Beta Set #001'],
      ]) {
        await page.locator(`[data-decke-card="${cardId}"]`).click()
        await page.waitForFunction(([selector, value]) => document.querySelector(selector)?.textContent === value, [live, expected])
        assert.equal(await page.locator('h1').textContent(), 'Pikachu', 'both card pages intentionally share the visible h1')
        if (cardId === 'fixture-a-1') await page.goBack({ waitUntil: 'networkidle' })
      }
      results.push({ case: 'a11y-same-name-cards', label, announcements: ['Pikachu — Alpha Set #001', 'Pikachu — Beta Set #001'] })
    } finally { await context.close() }
  }
  return results
}
