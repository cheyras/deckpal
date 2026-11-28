/**
 * The home page (`/`) and /features, signed out, in the cloud build, at 390
 * and 1440 (redesign, 2026-11-27).
 *
 * What this pins, and why each part:
 *   1. Both pages render for a visitor with NO session, with one h1 each, and
 *      fit the phone: no sideways scroll at 390px.
 *   2. axe finds nothing at WCAG 2.2 AA (the same tags as `a11y.mjs`).
 *   3. The hero video slot holds its 16:9 box (1:1 at 390 when the film has a
 *      phone cut, with the square poster and film). While no film is configured
 *      (landing/heroVideo.ts) it asks for no media at all; once one is, it
 *      fetches only the configured same-origin files and plays muted inline.
 *   4. The card orbit is paused while off screen and runs while on it (it is
 *      the page's one continuous animation, and must cost nothing scrolled
 *      away). Under reduced motion it has no animation and every looping mock
 *      sits on its finished frame.
 *   5. The detail the home page links to is really there: "See each step in
 *      detail" lands on /features, and the comparison link lands on /connect.
 *
 * The fixture server answers the boot-time `/api/public-config`, the catalog
 * totals from `/api/series`, and card art from the object store. Anything else
 * fails the suite through `server.unexpected`.
 */
import assert from 'node:assert/strict'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { buildWeb, serve, contextFor } from './support.mjs'
import { HERO_VIDEO, heroSourcesFor } from '../../apps/web/src/routes/landing/heroVideo.ts'

const AXE_SRC = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8')
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']
const PUBLIC_CONFIG = { mode: 'cloud', bugReportsPublic: true, defaults: { skin: 'premium', topbar: 'cover' } }
const SERIES = { series: [{ slug: 'mega-evolution', tcgdexId: 'me', name: 'Mega Evolution', firstReleaseOn: '2025-09-25',
  sortOrder: 20, setCount: 205, cardCount: 21290, repSetId: 'me01', repHasLogo: true, repHasSymbol: true }] }
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')
function respond(rel) {
  if (rel === '/api/public-config') return { body: PUBLIC_CONFIG }
  if (rel === '/api/series') return { body: SERIES }
  if (/^\/api\/cards\/[a-z0-9.]+-\d+[a-z]?$/i.test(rel)) return { body: { card: {}, variants: [] } }
  if (rel.startsWith('/storage/v1/object/public/card-art/')) return { raw: PIXEL, type: 'image/png' }
  return null
}

export function browserSuites({ browser, out, scratch, results }) {
  return [{
    name: 'landing',
    async run() {
      const dist = path.join(scratch, 'landing')
      const server = await serve(dist, '', respond)
      try {
        await buildWeb(dist, true, server.origin)
        results.push(...await checkLanding(browser, server, out))
        assert.deepEqual(server.unexpected, [], 'landing: unexpected network/error events')
      } finally { await server.close() }
    },
  }]
}

async function walk(page) {
  const total = await page.evaluate(() => document.documentElement.scrollHeight)
  for (let y = 0; y < total; y += 500) {
    await page.evaluate((v) => window.scrollTo(0, v), y)
    await page.waitForTimeout(60)
  }
  await page.evaluate(() => window.scrollTo(0, 0))
  // Off screen, every mock settles on its finished frame; its staggered fades
  // take about a second, and axe reads a half-faded label as low contrast.
  await page.waitForTimeout(1500)
}

async function axe(page, label) {
  await page.addScriptTag({ content: AXE_SRC })
  const r = await page.evaluate(async (tags) => window.axe.run(document, { runOnly: { type: 'tag', values: tags } }), AXE_TAGS)
  const violations = r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, first: v.nodes[0]?.target?.join(' ') }))
  assert.deepEqual(violations, [], `${label}: axe found ${violations.length} violation(s): ${JSON.stringify(violations)}`)
}

export async function checkLanding(browser, server, out) {
  const results = []
  for (const width of [390, 1440]) {
    // Full motion for the orbit check; contextFor defaults to reduced motion.
    const { context, page } = await contextFor(browser, server, width, { reducedMotion: 'no-preference' })
    const media = []
    const posters = []
    page.on('request', (r) => {
      if (r.resourceType() === 'media') media.push(r.url())
      const m = new URL(r.url()).pathname.match(/^\/marketing\/landing\/(hero(?:-square)?)-\d+\./)
      if (m) posters.push(m[1])
    })
    try {
      await page.goto(server.origin + '/', { waitUntil: 'networkidle' })
      await page.getByRole('heading', { level: 1 }).waitFor()
      assert.equal(new URL(page.url()).pathname, '/', `${width}: a signed-out visitor must stay on /`)
      assert.equal(await page.getByRole('heading', { level: 1 }).count(), 1, `${width}: one h1`)

      // Phone-width visitors get the 1:1 cut when there is one (HERO_PHONE_MEDIA is max-width 640px).
      const phone = width === 390 && !!HERO_VIDEO.phone
      const ratio = phone ? 1 : 16 / 9
      const slot = await page.locator('.hm-video').boundingBox()
      assert.ok(slot && Math.abs(slot.width / slot.height - ratio) < 0.02, `${width}: the video slot is ${phone ? '1:1' : '16:9'} (${slot?.width}x${slot?.height})`)
      const poster = await page.locator('.hm-video-poster img').evaluate((i) => i.currentSrc)
      assert.equal(poster.includes('/hero-square-'), phone, `${width}: the poster is the ${phone ? 'square' : '16:9'} still (${poster})`)
      // The LCP still: the preload hint and the <picture> agree, so only this viewport's poster is fetched.
      assert.deepEqual([...new Set(posters)], [phone ? 'hero-square' : 'hero'], `${width}: poster stills fetched: ${posters.join(', ')}`)
      assert.ok(slot.y < (width === 390 ? 844 : 900), `${width}: the video slot starts above the fold (y=${slot.y})`)

      const ring = (sel) => page.evaluate((s) => {
        const stage = document.querySelector('.hm-orbit-stage')
        return { play: stage.hasAttribute('data-play'), state: getComputedStyle(stage.querySelector(s)).animationPlayState }
      }, sel)
      assert.deepEqual(await ring('.hm-ring'), { play: false, state: 'paused' }, `${width}: the orbit runs while off screen`)
      await page.locator('#catalog').scrollIntoViewIfNeeded()
      await page.waitForFunction(() => document.querySelector('.hm-orbit-stage')?.hasAttribute('data-play'), null, { timeout: 3000 })
      assert.equal((await ring('.hm-ring')).state, 'running', `${width}: the orbit does not turn on screen`)

      await walk(page)
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      assert.ok(overflow <= 0, `${width}: the home page scrolls sideways by ${overflow}px`)
      await axe(page, `${width} home`)
      if (HERO_VIDEO.sources.length === 0) assert.deepEqual(media, [], `${width}: no film is configured, so no media may be requested`)
      else {
        // The film is same-origin (the CSP's media-src is 'self'), and only the configured files are fetched.
        // Only this viewport's cut: a phone never pays for the 16:9 film, nor a laptop for the square one.
        const allowed = new Set(heroSourcesFor(HERO_VIDEO, phone).map((s) => s.src))
        for (const url of media) assert.ok(allowed.has(new URL(url).pathname), `${width}: unexpected media request ${url}`)
        // It is attached after load and plays muted and inline, so a visitor sees it without pressing play.
        await page.locator('.hm-video').scrollIntoViewIfNeeded()
        await page.waitForFunction(() => { const v = document.querySelector('.hm-video-film'); return v && v.muted && !v.paused }, null, { timeout: 15000 })
      }
      await page.screenshot({ path: path.join(out, `landing-home-${width}.png`), fullPage: true })

      await page.getByRole('link', { name: 'See each step in detail' }).click()
      await page.getByRole('heading', { level: 1, name: 'How DeckPal works' }).waitFor()
      assert.equal(new URL(page.url()).pathname, '/features')
      await walk(page)
      const fOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      assert.ok(fOverflow <= 0, `${width}: /features scrolls sideways by ${fOverflow}px`)
      await axe(page, `${width} features`)
      await page.screenshot({ path: path.join(out, `landing-features-${width}.png`), fullPage: true })

      await page.goto(server.origin + '/', { waitUntil: 'networkidle' })
      await page.getByRole('link', { name: 'See which apps work on which plan' }).click()
      await page.getByRole('heading', { level: 1, name: 'Connect your AI to DeckPal' }).waitFor()
      assert.equal(new URL(page.url()).pathname, '/connect')
      results.push({ case: 'landing-home-features', label: 'cloud', width, signedOut: true, axeViolations: 0 })
    } catch (error) {
      await page.screenshot({ path: path.join(out, `landing-${width}-failure.png`), fullPage: true }).catch(() => {})
      throw error
    } finally {
      await context.close()
    }
  }

  // Reduced motion: still orbit, finished mocks.
  const { context, page } = await contextFor(browser, server, 390)
  try {
    await page.goto(server.origin + '/', { waitUntil: 'networkidle' })
    await page.locator('#tune').scrollIntoViewIfNeeded()
    const rm = await page.evaluate(() => ({
      ring: getComputedStyle(document.querySelector('.hm-ring')).animationName,
      unfinished: [...document.querySelectorAll('.hm-mock')].filter((m) =>
        [1, 2, 3, 4, 5].some((i) => m.querySelector(`.hm-s${i}`) && !m.hasAttribute(`data-s${i}`))).length,
    }))
    assert.equal(rm.ring, 'none', 'reduced motion: the orbit must not animate')
    assert.equal(rm.unfinished, 0, 'reduced motion: every mock shows its finished frame')
    results.push({ case: 'landing-reduced-motion', label: 'cloud', width: 390 })
  } finally {
    await context.close()
  }
  return results
}
