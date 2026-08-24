/**
 * THE CHAT HISTORY, IN THE REAL PANEL, AGAINST THE REAL BACKEND.
 *
 * `/dev/chat-ui` photographs every state of the dropdown and the viewer with
 * fixtures, which is what a gallery is for and is not the same claim as "it
 * works". This is the other half: the actual `DeckeChat` header, the actual
 * `deckeHistoryList` call, an actual conversation opened from an actual row.
 *
 * ── WHAT IT MEASURES, AND WHY MEASURING IS THE POINT ─────────────────────────
 *
 * The header now holds four things where it held three, and a flex child's
 * default `min-width: auto` means the first symptom of "too many" is a WRAP
 * rather than an overflow. This reads the header's real height and every child's
 * real rect at both widths, so "it fits" is a number rather than an impression —
 * the panel's own notes record four wrong guesses from reading CSS and one
 * correct answer from a query.
 *
 *   PLAYWRIGHT_MODULE=… node scripts/visual-harness/probe-chat-history.mjs \
 *     --base http://localhost:5204
 *
 * Exits non-zero if the header wraps, if the dropdown falls off a screen edge,
 * or if opening a real conversation does not produce a read-only record.
 *
 * ── IT SPENDS NO CREDIT ──────────────────────────────────────────────────────
 *
 * `/api/chat` is fulfilled with a canned stream so the live transcript is
 * non-empty — the archive has to be entered FROM a real conversation for the
 * "back to chat" half to mean anything.
 *
 * ── `--stub`, AND WHY IT IS NOT THE DEFAULT ──────────────────────────────────
 *
 * By default the history endpoints are NOT stubbed and this runs against
 * whatever the backend really serves. On 2026-08-23 that produced the most
 * useful line this script has printed:
 *
 *     Couldn't load your history. / No such route
 *
 * `/api/decke/history` exists in the working tree and is **not deployed**, so
 * against the live backend the feature's failure state is the ONLY state
 * reachable. That is worth finding, and it is worth being the default, because
 * a probe that stubs by default would have reported a working feature.
 *
 * `--stub` fulfils the two GETs with a realistic payload — a conversation that
 * spanned a deploy, one that did not, and one with no build at all — so the
 * real components can be driven through the states the server cannot serve yet.
 * It is a stub and the output says so on every line it affects.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { resolvePlaywright } from './lib/resolve-playwright.mjs'
import { signIn, bypassHeaders, qaAccount, openDeckE, unlockDeckE, HOME_PATH } from './lib/session.mjs'
import { stripDevChrome } from './lib/dev-chrome.mjs'

const argv = process.argv.slice(2)
const arg = (n, d) => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d
}
const BASE = arg('base', 'http://localhost:5204')
const OUT = resolve(arg('out', '.visual-harness/chat-history'))
const STUB = argv.includes('--stub')

/** Realistic rows, shaped exactly as `routes/deckeHistory.ts` returns them. */
const iso = (d, h, m) => new Date(Date.UTC(2026, 7, d, h, m)).toISOString()
const STUB_LIST = {
  conversations: [
    { id: '11111111-1111-4111-a111-111111111111', title: 'how many pitch black cards am I missing?', turns: 3, startedAt: iso(23, 17, 40), updatedAt: iso(23, 18, 2), buildPrMin: 77, buildPrMax: 78, buildSha: '2f9a1c3aa11bb22cc33dd44ee55ff66aa77bb88c' },
    { id: '22222222-2222-4222-a222-222222222222', title: 'build me a Gardevoir deck for standard', turns: 2, startedAt: iso(23, 13, 12), updatedAt: iso(23, 13, 30), buildPrMin: 78, buildPrMax: 78, buildSha: '2f9a1c3aa11bb22cc33dd44ee55ff66aa77bb88c' },
    { id: '33333333-3333-4333-a333-333333333333', title: 'take me to the shrouded fable set', turns: 1, startedAt: iso(22, 21, 5), updatedAt: iso(22, 21, 6), buildPrMin: null, buildPrMax: null, buildSha: null },
  ],
}
const STUB_ONE = {
  id: '11111111-1111-4111-a111-111111111111',
  title: 'how many pitch black cards am I missing?',
  startedAt: iso(23, 17, 40),
  turns: [
    { seq: 0, asked: 'how many pitch black cards am I missing?', answered: "You're at **12 of 214** in Pitch Black, so 202 to go.", tools: [{ name: 'set_progress', phase: 'ok', title: 'Checked set completion', summary: 'Pitch Black — 12 of 214' }], buildPr: 77, buildSha: 'aa11bb22cc33dd44ee55ff66aa77bb88cc99dd00', at: iso(23, 17, 40) },
    { seq: 1, asked: 'which ones are worth the most?', answered: 'The alt-art Charizard ex leads it, then Gardevoir ex.', tools: [{ name: 'collection_value', phase: 'partial', title: 'Priced your collection', summary: 'Timed out after 180 of 604 cards' }], buildPr: 78, buildSha: '2f9a1c3aa11bb22cc33dd44ee55ff66aa77bb88c', at: iso(23, 17, 52) },
    { seq: 2, asked: 'actually plan me a deck around it', answered: '', tools: [{ name: 'plan_deck', phase: 'start', title: 'Building a deck list', summary: '' }, { name: 'deck_strategy', phase: 'unknown', title: 'Writing a strategy guide', summary: '' }], buildPr: 78, buildSha: '2f9a1c3aa11bb22cc33dd44ee55ff66aa77bb88c', at: iso(23, 18, 2) },
  ],
}

const REPLY = 'You have **12 of 214** in Pitch Black. Here is the short version of what is missing.'

const WIDTHS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844, isMobile: true },
]

const { chromium } = await resolvePlaywright()
mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch()
const report = []
const fails = []

for (const w of WIDTHS) {
  const ctx = await browser.newContext({
    viewport: { width: w.width, height: w.height },
    deviceScaleFactor: 2,
    isMobile: !!w.isMobile,
    hasTouch: !!w.isMobile,
    extraHTTPHeaders: bypassHeaders(),
  })
  const page = await ctx.newPage()
  await page.route('**/api/chat', async (route) => {
    const body =
      REPLY.match(/.{1,40}/g)
        .map((d) => `data: ${JSON.stringify({ type: 'text-delta', delta: d })}\n\n`)
        .join('') + 'data: [DONE]\n\n'
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
      body,
    })
  })

  if (STUB) {
    await page.route('**/api/decke/history**', async (route) => {
      const url = route.request().url()
      const one = /\/decke\/history\/[^/?]+/.test(url)
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(one ? STUB_ONE : STUB_LIST),
      })
    })
  }

  await signIn(page, BASE, qaAccount())
  await unlockDeckE(page)
  await page.goto(`${BASE}${HOME_PATH}`, { waitUntil: 'domcontentloaded' })
  const composer = await openDeckE(page)
  await page.waitForTimeout(4500)
  await composer.fill('how many pitch black cards am I missing?')
  await composer.press('Enter')
  await page.waitForTimeout(2000)
  await stripDevChrome(page)

  const dir = `${OUT}/${w.name}`
  mkdirSync(dir, { recursive: true })

  // ── 1. THE HEADER, CLOSED ────────────────────────────────────────────────
  const header = await page.evaluate(() => {
    const h = document.querySelector('[aria-label="Chat with Deck-E"] > header')
    if (!h) return { error: 'no chat header' }
    const box = (e) => e.getBoundingClientRect().toJSON()
    return {
      header: box(h),
      children: [...h.children].map((c) => ({
        tag: c.tagName.toLowerCase(),
        text: (c.textContent || '').trim().slice(0, 20),
        ...box(c),
      })),
      // ── HOW TALL THIS ROW IS *SUPPOSED* TO BE ──────────────────────────
      //
      // The first version of this check said "24px of Fraunces plus 18px of
      // padding = 42, anything taller has wrapped", and it failed at BOTH
      // widths on a header that plainly had not wrapped: the ✕ is a 38px hit
      // target and has always been what sets this row's height. The instrument
      // was wrong and the layout was right — which is the third time in this
      // pass a confident tool has produced a confident wrong answer.
      //
      // The honest test for a wrap is that the row is no taller than its
      // tallest child plus its own padding.
      oneLine: Math.max(...[...h.children].map((c) => c.getBoundingClientRect().height)) + 18,
    }
  })
  if (header.error) {
    fails.push(`${w.name}: ${header.error}`)
    await ctx.close()
    continue
  }
  await page.locator('[aria-label="Chat with Deck-E"] > header').screenshot({ path: `${dir}/header.png` })

  // ── 2. THE DROPDOWN, OPEN ────────────────────────────────────────────────
  const trigger = page.getByRole('button', { name: /^History/ })
  await trigger.click()
  await page.waitForTimeout(1200)
  await page.screenshot({ path: `${dir}/dropdown.png` })

  const sheet = await page.evaluate(() => {
    const t = [...document.querySelectorAll('button')].find((b) => /^History/.test(b.textContent || ''))
    const id = t?.getAttribute('aria-controls')
    const p = id ? document.getElementById(id) : null
    if (!p) return { error: 'the dropdown did not open' }
    const r = p.getBoundingClientRect()
    const rows = [...p.querySelectorAll('li')].map((li) => (li.textContent || '').replace(/\s+/g, ' ').trim())
    return { rect: r.toJSON(), rows, vw: window.innerWidth, expanded: t.getAttribute('aria-expanded') }
  })

  // ── 2b. THE DELETE MUST BE REACHABLE, FULL STOP ─────────────────────────
  //
  // It used to fade in on hover, which is the standard pattern for a list and
  // is unverifiable here: a DOM query on the touch profile reported every ✕ at
  // opacity 1 and the photograph of the same page showed one of them, and
  // `Emulation.setEmulatedMedia` will not force the `hover` feature to settle
  // it. A destructive control whose visibility cannot be stated with confidence
  // is not one to ship behind a condition — the safety is the second press, not
  // the hiding — so it is always visible now and this asserts that, at both
  // widths, with no media query in the answer.
  // Skipped when the list is empty, which is not the same as broken: against a
  // backend without these routes there are no rows to carry a control, and
  // reporting "no delete control" there would blame the wrong thing.
  const touchDelete = sheet.error || sheet.rows.length === 0
    ? null
    : await page.evaluate(() => {
        const bs = [...document.querySelectorAll('li button[aria-label^="Delete"]')]
        if (!bs.length) return { error: 'no delete control in the row' }
        return {
          count: bs.length,
          min: Math.min(...bs.map((b) => Number(getComputedStyle(b).opacity))),
          width: Math.min(...bs.map((b) => Math.round(b.getBoundingClientRect().width))),
          hoverHover: matchMedia('(hover: hover)').matches,
          coarse: matchMedia('(pointer: coarse)').matches,
        }
      })

  // ── 3. A REAL CONVERSATION, OPENED ───────────────────────────────────────
  let record = { skipped: 'no conversations in this account' }
  if (!sheet.error && sheet.rows.length > 0) {
    // The first row's OPEN control. The delete beside it is the second button
    // in the row, so `.first()` is the one that opens rather than the one that
    // asks to remove — which is a distinction worth being explicit about in a
    // script that runs against a real account.
    await page.locator('li button').first().click()
    await page.waitForTimeout(2500)
    await stripDevChrome(page)
    await page.screenshot({ path: `${dir}/record.png` })
    record = await page.evaluate(() => {
      const panel = document.querySelector('[aria-label="Chat with Deck-E"]')
      const back = [...panel.querySelectorAll('button')].find(
        (b) => (b.textContent || '').trim() === 'Back to chat',
      )
      return {
        readOnlyBanner: /SAVED CHAT|Saved chat/i.test(panel.textContent || ''),
        // THE WHOLE POINT: there must be no way to type.
        inputs: panel.querySelectorAll('textarea, input').length,
        backToChat: !!back,
        // ── NOTHING MAY RUN OFF THE RIGHT EDGE OF THE COLUMN ──────────────
        //
        // Found by looking, then measured: a tool row carrying
        // `decke-shift w-full` was drawn from 128 to 486 in a column ending at
        // 374 — one whole gutter past the screen, with its own text clipped
        // mid-word. `w-full` is `width: 100%`, and a percentage width does not
        // subtract the element's own margin, so every shifted element with an
        // explicit full width overflowed by exactly the amount it was shifted.
        //
        // It is asserted here rather than trusted to a class name because the
        // fix lives in one CSS rule and the symptom lives at one viewport: a
        // unit test cannot see it, and a screenshot only shows it when a row
        // happens to be long enough.
        overflow: (() => {
          // ── THE RIGHT COLUMN, AND THE FIRST VERSION PICKED THE WRONG ONE ──
          //
          // `querySelector('[class*="max-w-[760px]"]')` returned the HEAD BAND,
          // which shares the measure and contains nine elements and no
          // `.decke-shift` at all. So the check reported "0 elements past the
          // edge" — truthfully, about a band that could never have any — and
          // came back GREEN when the CSS fix it exists to guard was removed.
          //
          // Four elements on this surface carry the 760px measure. The one this
          // is about is the one holding the shifted content, so that is what it
          // asks for, and it fails loudly rather than falling back if the
          // layout ever stops having one.
          const cols = [...panel.querySelectorAll('[class*="max-w-[760px]"]')]
          const col = cols.find((c) => c.querySelector('.decke-shift'))
          if (!col) return { error: `no shifted column among ${cols.length} measures — the check cannot see anything` }
          const cs = getComputedStyle(col)
          const right = col.getBoundingClientRect().right - parseFloat(cs.paddingRight)
          const over = []
          for (const el of col.querySelectorAll('*')) {
            const r = el.getBoundingClientRect()
            if (r.width > 0 && r.right > right + 1) {
              over.push({ cls: el.className.toString().slice(0, 48), by: Math.round(r.right - right) })
            }
          }
          // What the rule ACTUALLY resolved to, so a run that reports no
          // overflow can be told apart from a run whose stylesheet never
          // arrived. A green result with `cap: "none"` is the tooling lying.
          const probe = document.createElement('ul')
          probe.className = 'decke-shift w-full'
          col.appendChild(probe)
          const cap = getComputedStyle(probe).maxWidth
          const probeRight = probe.getBoundingClientRect().right
          probe.remove()
          return { right: Math.round(right), over: over.slice(0, 5), cap, probeRight: Math.round(probeRight), scanned: col.querySelectorAll('*').length }
        })(),
        stamps: [...panel.querySelectorAll('span')]
          .map((s) => (s.textContent || '').trim())
          .filter((t) => /^#\d+(→\d+)?$/.test(t)),
        turns: panel.querySelectorAll('ul > li').length,
      }
    })
    // And back out again, which must restore the live conversation.
    await page.getByRole('button', { name: 'Back to chat' }).click()
    await page.waitForTimeout(800)
    record.liveComposerBack = await page.locator('[data-decke-composer] textarea').count()
  }

  report.push({ width: w.name, header, sheet, record, touchDelete })
  await ctx.close()
}

await browser.close()

for (const r of report) {
  const n = (x) => Number(x).toFixed(0).padStart(6)
  console.log(`\n── ${r.width} ────────────────────────────────────────────────`)
  console.log(`header   height ${n(r.header.header.height)}  (one line = ${r.header.oneLine})`)
  for (const c of r.header.children) {
    console.log(`  ${c.tag.padEnd(6)} ${String(c.text).padEnd(14)} x ${n(c.x)} → ${n(c.x + c.width)}   h ${n(c.height)}`)
  }
  if (r.header.header.height > r.header.oneLine + 2) {
    fails.push(`${r.width}: the header is ${r.header.header.height.toFixed(0)}px — it wrapped`)
  }

  if (r.sheet.error) {
    fails.push(`${r.width}: ${r.sheet.error}`)
  } else {
    const s = r.sheet.rect
    console.log(`dropdown left ${n(s.left)}  right ${n(s.right)}  width ${n(s.width)}   viewport ${r.sheet.vw}`)
    console.log(`         ${r.sheet.rows.length} row(s)`)
    for (const row of r.sheet.rows.slice(0, 6)) console.log(`           ${row}`)
    if (s.left < 0 || s.right > r.sheet.vw) {
      fails.push(`${r.width}: the dropdown runs off the screen (${s.left.toFixed(0)}…${s.right.toFixed(0)} in ${r.sheet.vw})`)
    }
  }

  const td = r.touchDelete
  if (td) {
    if (td.error) {
      fails.push(`${r.width}: ${td.error}`)
    } else {
      console.log(`delete   ${td.count} control(s), min opacity ${td.min}, min width ${td.width}px   (hover:hover ${td.hoverHover}, pointer:coarse ${td.coarse})`)
      if (td.min < 1) fails.push(`${r.width}: a delete control is at opacity ${td.min} — it cannot be seen`)
      if (td.width < 24) fails.push(`${r.width}: a delete control is ${td.width}px wide — it cannot be hit`)
    }
  }

  if (r.record.skipped) {
    console.log(`record   SKIPPED — ${r.record.skipped}`)
  } else {
    console.log(`record   read-only banner ${r.record.readOnlyBanner}   inputs ${r.record.inputs}   back ${r.record.backToChat}`)
    console.log(`         build stamps: ${r.record.stamps.join(', ') || '(none)'}`)
    console.log(`         composer restored on the way back: ${r.record.liveComposerBack}`)
    if (!r.record.readOnlyBanner) fails.push(`${r.width}: the record does not say it is read only`)
    if (r.record.inputs !== 0) fails.push(`${r.width}: the record has ${r.record.inputs} input(s) — you can type into a transcript`)
    if (!r.record.backToChat) fails.push(`${r.width}: no way back to the live chat`)
    const o = r.record.overflow
    if (o && o.error) {
      fails.push(`${r.width}: overflow check is blind — ${o.error}`)
    } else if (o) {
      console.log(`         column right edge ${o.right}; ${o.over.length} of ${o.scanned} element(s) past it`)
      console.log(`         .decke-shift max-width resolves to ${o.cap}; a bare probe ends at ${o.probeRight}`)
      for (const e of o.over) console.log(`           +${e.by}px  ${e.cls}`)
      if (o.over.length) {
        fails.push(`${r.width}: ${o.over.length} element(s) run off the right edge of the record, worst +${Math.max(...o.over.map((e) => e.by))}px`)
      }
    }
    if (r.record.liveComposerBack !== 1) fails.push(`${r.width}: the live composer did not come back`)
  }
}

writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2))
console.log(`\nShots under ${OUT}`)
if (fails.length) {
  console.log('\nFAILED:')
  for (const f of fails) console.log(`  ✗ ${f}`)
  process.exit(1)
}
console.log('\nAll checks passed. Now go and look at the PNGs — this proves geometry, not craft.')
