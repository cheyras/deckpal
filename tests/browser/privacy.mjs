/**
 * The privacy page (`/privacy`) — signed out, in the cloud build, at 1280 and 390.
 *
 * What this pins, and why each part:
 *   1. The page renders for a visitor with NO session. Both places that link to
 *      it — the landing footer and the sign-up form — are read by people who
 *      have no account yet, so a privacy page behind AuthGuard would bounce
 *      exactly the readers it exists for to /auth.
 *   2. It fits the phone: no horizontal scroll at 390px, where the processor
 *      list is the likeliest thing to overflow.
 *   3. axe finds nothing at WCAG 2.2 AA (the same tags as `a11y.mjs`).
 *   4. Both entry points actually arrive: the footer's "Privacy" link and the
 *      sign-up form's "how it handles your data" link each land on the page.
 *   5. The "On this page" links move the reader to their section. The router
 *      scrolls to the top after every render it commits, so an in-page anchor
 *      that silently snapped back to the top is a real way for this to break.
 *
 * The page is static copy, so the fixture server answers exactly one API path,
 * the boot-time `/api/public-config` every page asks for. Any other request
 * the page starts making later fails this suite through `server.unexpected`
 * instead of passing unnoticed.
 */
import assert from 'node:assert/strict'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { buildWeb, serve, contextFor } from './support.mjs'

const AXE_SRC = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8')
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']
const HEADING = 'Privacy at DeckPal'
// Every page asks for the deployment's display defaults at boot (lib/settingsSync.ts);
// this is what production answered on 2026-09-27, minus its Supabase fields.
const PUBLIC_CONFIG = { mode: 'cloud', bugReportsPublic: true, defaults: { skin: 'premium', topbar: 'cover' } }

export function browserSuites({ browser, out, scratch, results, logs }) {
  return [{
    name: 'privacy',
    async run() {
      const dist = path.join(scratch, 'privacy')
      const server = await serve(dist, '', (rel) => rel === '/api/public-config' ? { body: PUBLIC_CONFIG } : null)
      try {
        logs.push(await buildWeb(dist, true, server.origin))
        results.push(...await checkPrivacy(browser, server, out))
        assert.deepEqual(server.unexpected, [], 'privacy: unexpected network/error events')
      } finally { await server.close() }
    },
  }]
}

async function openPrivacy(page, server) {
  await page.goto(server.origin + '/privacy', { waitUntil: 'networkidle' })
  await page.getByRole('heading', { level: 1, name: HEADING }).waitFor()
}

export async function checkPrivacy(browser, server, out) {
  const results = []
  for (const width of [1280, 390]) {
    const { context, page } = await contextFor(browser, server, width)
    try {
      await openPrivacy(page, server)
      assert.equal(new URL(page.url()).pathname, '/privacy', `${width}: a signed-out visitor must stay on /privacy`)
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      assert.ok(overflow <= 0, `${width}: the page scrolls sideways by ${overflow}px`)
      await page.addScriptTag({ content: AXE_SRC })
      const axeResult = await page.evaluate(
        async (tags) => window.axe.run(document, { runOnly: { type: 'tag', values: tags } }),
        AXE_TAGS,
      )
      const violations = axeResult.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length }))
      assert.deepEqual(violations, [], `${width}: axe found ${violations.length} violation(s) — ${JSON.stringify(violations)}`)
      await page.screenshot({ path: path.join(out, `privacy-${width}.png`), fullPage: true })

      // Every "On this page" entry must bring its own heading into view.
      const toc = page.getByRole('navigation', { name: 'On this page' })
      const entries = await toc.getByRole('link').all()
      assert.ok(entries.length >= 5, `${width}: expected the section index, found ${entries.length} entries`)
      for (const entry of entries) {
        const id = (await entry.getAttribute('href'))?.replace(/^#/, '')
        assert.ok(id, `${width}: a section link has no target`)
        await entry.click()
        // In view, not merely scrolled somewhere: the last sections cannot
        // reach the top of a tall window, so "fully visible" is the test.
        await page.waitForFunction((target) => {
          const box = document.getElementById(target)?.getBoundingClientRect()
          return !!box && box.top >= 0 && box.bottom <= window.innerHeight
        }, id, { timeout: 3000 })
      }
      results.push({ case: 'privacy-page', label: 'cloud', width, signedOut: true, axeViolations: 0, sections: entries.length })

      await page.goto(server.origin + '/', { waitUntil: 'networkidle' })
      await page.getByRole('contentinfo').getByRole('link', { name: 'Privacy', exact: true }).click()
      await page.getByRole('heading', { level: 1, name: HEADING }).waitFor()
      assert.equal(new URL(page.url()).pathname, '/privacy')
      results.push({ case: 'privacy-footer-link', label: 'cloud', width })

      await page.goto(server.origin + '/auth?mode=signup', { waitUntil: 'networkidle' })
      await page.getByRole('heading', { level: 1, name: 'Create your account' }).waitFor()
      await page.getByRole('link', { name: 'how it handles your data' }).click()
      await page.getByRole('heading', { level: 1, name: HEADING }).waitFor()
      assert.equal(new URL(page.url()).pathname, '/privacy')
      results.push({ case: 'privacy-signup-link', label: 'cloud', width })
    } catch (error) {
      await page.screenshot({ path: path.join(out, `privacy-${width}-failure.png`), fullPage: true }).catch(() => {})
      throw error
    } finally {
      await context.close()
    }
  }
  return results
}
