/**
 * Deck-E's deck widget, saving a revision as a new VERSION of the reader's deck.
 *
 * The audit (2026-10-10): Deck-E shows every revised deck with `showDeck`, and
 * the widget's Save could only make a NEW deck. "Make a v2 of my Dragapult deck
 * based on my results", saved from the widget, became a second deck; the
 * version history and the battle logs stayed on the first. Now `showDeck` can
 * carry the deck it revises (server-checked), and the widget offers "Save as
 * new version" first, with a version note, and a separate copy second.
 *
 * Real `DeckeChat` and `DeckeScreen` (the test-only fixture entry), real
 * `api.saveDeck`/`api.importDeck` fetches, answered by this fixture server —
 * which rejects every `/api` call it was not told about, so a save that went
 * to the wrong route fails here rather than passing. Run at 1440 and 390 in
 * Chromium, and at 390 in WebKit.
 *
 * Run directly: `node --import tsx tests/browser/deckeDeckWidget.mjs`.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, webkit } from 'playwright'
import { ROOT, WEB, run, isolatedEnv, serve, contextFor } from './support.mjs'

const CARD_SVG = (fill) => 'data:image/svg+xml,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="63" height="88"><rect width="63" height="88" rx="3" fill="${fill}"/></svg>`)
const CARDS = {
  'sv06-130': ['Dragapult ex', '#5b4b8a'], 'sv06-129': ['Drakloak', '#6b5b9a'], 'sv06-128': ['Dreepy', '#7b6baa'],
  'sv04.5-085': ['Iono', '#b05a7a'], 'sv01-166': ['Arven', '#a0663a'], 'sv02-185': ['Iono (PAL)', '#b06a8a'],
  'sv06-163': ['Rare Candy', '#3b6f8f'], 'sv04-160': ['Counter Catcher', '#3b7f6f'], 'sve-006': ['Psychic Energy', '#4b4f9f'],
}
const DECK_ID = '4d1c2b9e-0000-4000-8000-0000000000aa'

const sections = [
  { title: 'Pokémon', count: 10, cards: [
    { id: 'sv06-130', name: 'Dragapult ex', quantity: 3, owned: 3 },
    { id: 'sv06-129', name: 'Drakloak', quantity: 3, owned: 2 },
    { id: 'sv06-128', name: 'Dreepy', quantity: 4, owned: 4 },
  ] },
  { title: 'Trainer', count: 40, cards: [
    { id: 'sv04.5-085', name: 'Iono', quantity: 4, owned: 4 },
    { id: 'sv01-166', name: 'Arven', quantity: 4, owned: 1 },
    { id: 'sv06-163', name: 'Rare Candy', quantity: 4, owned: 4 },
    { id: 'sv04-160', name: 'Counter Catcher', quantity: 28, owned: 0 },
  ] },
  { title: 'Energy', count: 10, cards: [{ id: 'sve-006', name: 'Psychic Energy', quantity: 10, owned: 10 }] },
]
const deckBlock = (extra = {}) => ({
  kind: 'deck', name: 'Dragapult ex v2', format: 'standard', total: 60, legal: true, issues: [], owned: 28,
  missingCostUsd: 14.5, sections, ptcgl: 'Pokémon: 10\n3 Dragapult ex TWM 130\n', ...extra,
})
const REVISION = deckBlock({
  base: { id: DECK_ID, name: 'Dragapult ex' },
  versionNote: 'Fourth Iono over Counter Catcher after two Gardevoir losses',
})
const message = (id, block) => [
  { id: 'u-' + id, role: 'user', parts: [{ kind: 'text', id: 'u-' + id + '-t', text: 'Make a v2 of my Dragapult deck based on my results.' }] },
  { id: 'a-' + id, role: 'assistant', parts: [
    { kind: 'text', id: 'a-' + id + '-t', text: 'Here is v2. The Iono count is the change that matters.' },
    { kind: 'screen', id: 'a-' + id + '-s', spec: { title: block.name, blocks: [block] } },
  ] },
]

/** The fixture's API: the catalogue cards the widget draws, and the two saves. */
function deckWidgetApi(state) {
  return (rel, url, req) => {
    if (rel === '/deckpal/api/me') return { body: { username: 'Browser Reader', owner: false, decke: false } }
    if (rel === '/deckpal/api/decke/history') return { body: { ok: true, recorded: false } }
    const id = rel.match(/^\/deckpal\/api\/cards\/([^/]+)$/)?.[1]
    if (id && CARDS[id]) return { body: { card: { cardId: id, name: CARDS[id][0], images: { low: CARD_SVG(CARDS[id][1]), high: CARD_SVG(CARDS[id][1]) } } } }
    if (rel === '/deckpal/api/decks/save' && req.method === 'POST') {
      state.saves.push(req.body)
      return state.saveReply()
    }
    if (rel === '/deckpal/api/decks/import' && req.method === 'POST') {
      state.imports.push(req.body)
      return { status: 201, body: { deck: { id: 'deck-new-1', name: req.body.name }, import: { unresolvedLines: [] } } }
    }
    return null
  }
}
const allowMutation = (pathname, method) => method === 'POST'
  && /^\/deckpal\/api\/(decks\/save|decks\/import|decke\/history)$/.test(pathname)

async function set(page, patch) {
  await page.evaluate((p) => window.fixture.set(p), patch)
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
}

/** Sideways overflow: the page, and anything in the widget past the panel's right edge. */
function sideways(page) {
  return page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"][aria-label="Chat with Deck-E"]')
    const scroller = document.scrollingElement
    const right = dialog ? dialog.getBoundingClientRect().right : innerWidth
    const past = [...document.querySelectorAll('[data-decke-deck], [data-decke-deck] *')]
      .filter((el) => el.getBoundingClientRect().right > right + 0.5)
      .slice(0, 4).map((el) => `${el.tagName.toLowerCase()} → ${Math.round(el.getBoundingClientRect().right)} > ${Math.round(right)}`)
    return { page: scroller.scrollWidth - scroller.clientWidth, past }
  })
}

export async function checkDeckWidget(browser, server, out, engine, width, state) {
  const results = []
  const tag = engine + '-' + width
  const { context, page } = await contextFor(browser, server, width)
  try {
    await page.goto(server.origin + '/fixture.html', { waitUntil: 'networkidle' })
    const panel = page.getByRole('dialog', { name: 'Chat with Deck-E' })
    await panel.waitFor({ state: 'visible' })
    // Desktop hands the composer focus a beat after opening; let that land
    // before the widget's own focus is measured.
    await page.waitForTimeout(400)

    // ── 1. A revision of the reader's deck ─────────────────────────────────
    await set(page, { messages: message('rev', REVISION) })
    const widget = panel.locator('[data-decke-deck]')
    await widget.waitFor()
    await widget.getByText('Saves as the next version of', { exact: false }).waitFor()
    assert.equal(await widget.locator('span.font-semibold', { hasText: 'Dragapult ex' }).count(), 1, 'the deck it writes onto is named')
    const note = widget.getByRole('textbox', { name: /Version note/ })
    assert.equal(await note.inputValue(), REVISION.versionNote, 'his suggested note is there to edit')
    const primary = widget.getByRole('button', { name: 'Save as new version' })
    const separate = widget.getByRole('button', { name: 'Save as a separate deck' })
    await primary.waitFor()
    await separate.waitFor()
    assert.equal(await widget.getByRole('button', { name: 'Save to my decks' }).count(), 0, 'a revision does not lead with a new deck')
    assert.deepEqual(await sideways(page), { page: 0, past: [] }, tag + ': the revision widget scrolls sideways')
    await widget.screenshot({ path: path.join(out, 'decke-deck-widget-revision-' + tag + '.png') })

    // Keyboard: the note, then Tab to the save, which shows a ring.
    await note.click()
    await note.fill('')
    await page.keyboard.type('Fourth Iono after two Gardevoir losses')
    await page.keyboard.press('Tab')
    // Safari's default Tab skips buttons (a reader setting turns it on);
    // there, the button is reached the way that setting would reach it.
    if (engine === 'webkit' && !(await primary.evaluate((el) => el === document.activeElement))) await primary.focus()
    const ring = await primary.evaluate((el) => {
      const s = getComputedStyle(el)
      return { focused: el.matches(':focus-visible'), style: s.outlineStyle, width: s.outlineWidth }
    })
    assert.deepEqual(ring, { focused: true, style: 'solid', width: '2px' }, tag + ': the save has no visible keyboard focus')
    await widget.screenshot({ path: path.join(out, 'decke-deck-widget-focus-' + tag + '.png') })

    // A refusal the API worded for a person is shown in its words; the button offers the retry.
    state.saveReply = () => ({ status: 400, body: { error: { code: 'bad_request',
      message: 'sv06-129 is in this deck as 2 printings, so changing its count would have to guess which one. Nothing was saved; change that card in the deck editor, or leave its count as it is.' } } })
    await page.keyboard.press('Enter')
    const alert = widget.getByRole('alert')
    await alert.getByText('is in this deck as 2 printings', { exact: false }).waitFor()
    assert.match(await alert.innerText(), /^Couldn't save this version\. sv06-129 is in this deck as 2 printings/)
    await widget.getByRole('button', { name: 'Try saving again' }).waitFor()
    assert.equal(state.imports.length, 0, 'a failed version save never falls back to making a deck')

    // The retry lands as v3 of the reader's own deck.
    state.saveReply = () => ({ status: 200, body: { deck: { id: DECK_ID, name: 'Dragapult ex', version: 3 }, bumped: true, replayed: false } })
    await widget.getByRole('button', { name: 'Try saving again' }).focus()
    await page.keyboard.press('Enter')
    await widget.getByRole('status').getByText('Saved v3 of “Dragapult ex” · 60 cards').waitFor()
    const open = widget.getByRole('button', { name: 'Open in deck builder' })
    await open.waitFor()
    await page.waitForFunction(() => document.activeElement?.textContent === 'Open in deck builder')
    assert.equal(await widget.getByRole('textbox').count(), 0, 'the note goes once the version is saved')
    assert.equal(await separate.count(), 0, 'one save per widget')
    const sent = state.saves.at(-1)
    assert.deepEqual(sent, {
      deckId: DECK_ID,
      cards: sections.flatMap((s) => s.cards.map((c) => ({ cardId: c.id, quantity: c.quantity }))),
      versionNote: 'Fourth Iono after two Gardevoir losses',
      newVersion: true,
    })
    assert.equal(state.imports.length, 0, 'a version save never makes a deck')
    const saved = await page.evaluate(() => window.fixture.events.savedDecks.at(-1))
    assert.deepEqual(saved, { id: DECK_ID, name: 'Dragapult ex', total: 60, version: { number: 3, changed: true } })
    await page.keyboard.press('Enter')
    assert.deepEqual(await page.evaluate(() => window.fixture.events.openedDecks.at(-1)), DECK_ID)
    assert.deepEqual(await sideways(page), { page: 0, past: [] }, tag + ': the saved widget scrolls sideways')
    await widget.screenshot({ path: path.join(out, 'decke-deck-widget-saved-version-' + tag + '.png') })
    results.push({ case: 'decke-deck-widget-version', engine, width, keyboard: true, focusRing: true, refusalShown: true })

    // ── 2. The same revision, kept as a separate deck instead ──────────────
    await set(page, { messages: message('copy', REVISION) })
    await panel.locator('[data-decke-deck]').getByRole('button', { name: 'Save as a separate deck' }).click()
    await panel.locator('[data-decke-deck]').getByRole('button', { name: 'Open in deck builder' }).waitFor()
    assert.equal(state.imports.length, 1)
    assert.equal(state.imports[0].name, 'Dragapult ex v2')
    assert.equal(state.saves.length, 2, 'the separate copy does not touch the deck it revises')
    results.push({ case: 'decke-deck-widget-separate-copy', engine, width })

    // ── 3. A brand-new deck: exactly what it always was ───────────────────
    await set(page, { messages: message('new', deckBlock({ name: 'Dragapult ex' })) })
    const fresh = panel.locator('[data-decke-deck]')
    await fresh.getByRole('button', { name: 'Save to my decks' }).waitFor()
    assert.equal(await fresh.getByRole('textbox').count(), 0, 'a new deck has no version note')
    assert.equal(await fresh.getByRole('button', { name: /new version|separate deck/ }).count(), 0)
    assert.equal(await fresh.getByText('Saves as the next version', { exact: false }).count(), 0)
    assert.deepEqual(await sideways(page), { page: 0, past: [] }, tag + ': the new-deck widget scrolls sideways')
    await fresh.screenshot({ path: path.join(out, 'decke-deck-widget-new-' + tag + '.png') })
    await fresh.getByRole('button', { name: 'Save to my decks' }).click()
    await fresh.getByRole('button', { name: 'Open in deck builder' }).waitFor()
    assert.equal(state.imports.length, 2)
    assert.equal(state.saves.length, 2)
    assert.deepEqual(await page.evaluate(() => window.fixture.events.savedDecks.at(-1)), { id: 'deck-new-1', name: 'Dragapult ex', total: 60 })
    results.push({ case: 'decke-deck-widget-new-deck', engine, width })
    await page.screenshot({ path: path.join(out, 'decke-deck-widget-page-' + tag + '.png') })
  } finally {
    await context.close()
  }
  return results
}

async function main({ browser: borrowed, out = path.resolve(process.env.TEST_ARTIFACT_DIR ?? path.join(ROOT, '.cache/browser-tests')), logs = [] } = {}) {
  fs.mkdirSync(out, { recursive: true })
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'deckpal-deck-widget-'))
  const dist = path.join(scratch, 'dist')
  const results = []
  let browser = borrowed
  try {
    logs.push(await run(process.execPath, [path.join(WEB, 'node_modules/vite/bin/vite.js'), 'build',
      '--config', path.join(ROOT, 'tests/browser/vite.config.mjs'), '--outDir', dist], { env: isolatedEnv() }))
    const state = { saves: [], imports: [], saveReply: () => ({ status: 500, body: {} }) }
    const server = await serve(dist, '', deckWidgetApi(state), 'fixture.html', { allowMutation })
    try {
      browser ??= await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
        ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) })
      for (const width of [1440, 390]) {
        Object.assign(state, { saves: [], imports: [] })
        results.push(...await checkDeckWidget(browser, server, out, 'chromium', width, state))
      }
      const safari = await webkit.launch({ headless: true, ...(process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE_PATH
        ? { executablePath: process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE_PATH } : {}) })
      try {
        Object.assign(state, { saves: [], imports: [] })
        results.push(...await checkDeckWidget(safari, server, out, 'webkit', 390, state))
      } finally { await safari.close() }
      assert.deepEqual(server.unexpected, [], 'deck widget: unexpected network/error events')
    } finally { await server.close() }
  } finally {
    if (!borrowed) await browser?.close()
    fs.rmSync(scratch, { recursive: true, force: true })
  }
  return results
}

export function browserSuites({ browser, out, results, logs }) {
  return [{
    name: 'decke-deck-widget',
    async run() { results.push(...await main({ browser, out, logs })) },
  }]
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((results) => {
    console.log('PASS deck widget versions:', JSON.stringify(results))
  }, (error) => {
    console.error(error.stack ?? String(error))
    process.exitCode = 1
  })
}
