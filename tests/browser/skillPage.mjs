/**
 * The playbooks page (`/skill`, 2026-10-14) — signed out, in the cloud build, at 1280 and 390.
 *
 * What this pins:
 *   1. It renders for a visitor with no session: people read it before connecting anything.
 *   2. The texts come from `GET /api/playbooks` (the same strings the `playbook` tool returns) and render as headings,
 *      lists and tables, with the index first and a section per playbook the index links to.
 *   3. The pointer skill downloads: the link is `/skill/deckpal-skill.zip`, and the build serves a real zip there.
 *   4. It fits the phone (no sideways scroll) and axe finds nothing at WCAG 2.2 AA.
 *   5. /connect links to it.
 *
 * The fixture answers `/api/public-config` (every page asks at boot) and `/api/playbooks`; anything else fails the
 * suite through `server.unexpected`.
 */
import assert from 'node:assert/strict'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { buildWeb, serve, contextFor } from './support.mjs'

const AXE_SRC = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8')
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']
const PUBLIC_CONFIG = { mode: 'cloud', bugReportsPublic: true, defaults: { skin: 'premium', topbar: 'cover' } }
const PLAYBOOKS = {
  index: '# DeckPal coach: rules for every job\n\nBefore your first DeckPal tool call for a job, call `playbook` with the job\'s name.\n\n| The player... | Read |\n|---|---|\n| asks a rules question | rules |\n| pastes a log | battle-log |',
  playbooks: [
    { name: 'battle-log', text: '# Log a game\n\n1. **Log it.** Call `add_battle_log` with `log`.\n2. Report the battle number.' },
    { name: 'rules', text: '# Rules questions\n\n1. Call `rules_lookup` with `query` and `cards`.\n2. Then `get_card` for each card.' },
  ],
}
function respond(rel) {
  if (rel === '/api/public-config') return { body: PUBLIC_CONFIG }
  if (rel === '/api/playbooks') return { body: PLAYBOOKS }
  return null
}

export function browserSuites({ browser, out, scratch, results, logs }) {
  return [{
    name: 'skill-page',
    async run() {
      const dist = path.join(scratch, 'skill-page')
      const server = await serve(dist, '', respond)
      try {
        logs.push(await buildWeb(dist, true, server.origin))
        results.push(...await checkSkillPage(browser, server, out))
        assert.deepEqual(server.unexpected, [], 'skill-page: unexpected network/error events')
      } finally { await server.close() }
    },
  }]
}

export async function checkSkillPage(browser, server, out) {
  const results = []
  for (const width of [1280, 390]) {
    const { context, page } = await contextFor(browser, server, width)
    try {
      await page.goto(server.origin + '/skill', { waitUntil: 'networkidle' })
      await page.getByRole('heading', { level: 1, name: 'DeckPal playbooks' }).waitFor()
      assert.equal(new URL(page.url()).pathname, '/skill', `${width}: a signed-out visitor stays on /skill`)
      // The index and each playbook, rendered from markdown.
      await page.getByRole('heading', { name: 'DeckPal coach: rules for every job' }).waitFor()
      await page.getByRole('heading', { name: 'Log a game' }).first().waitFor()
      await page.getByRole('heading', { name: 'Rules questions' }).first().waitFor()
      assert.ok(await page.getByRole('table').count() >= 1, `${width}: the index's routing table renders`)
      // The contents link to each section.
      const contents = page.getByRole('navigation', { name: 'Playbooks' })
      for (const name of ['battle-log', 'rules']) {
        assert.equal(await contents.locator(`a[href="#${name}"]`).count(), 1, `${width}: contents link to ${name}`)
        assert.equal(await page.locator(`section#${name}`).count(), 1, `${width}: section ${name}`)
      }
      // The pointer skill: a real zip at the link.
      const href = await page.getByRole('link', { name: 'Download the DeckPal skill' }).getAttribute('href')
      assert.equal(href, '/skill/deckpal-skill.zip')
      const zip = await page.request.get(server.origin + href)
      assert.equal(zip.status(), 200)
      const bytes = await zip.body()
      assert.equal(bytes.subarray(0, 2).toString('latin1'), 'PK', `${width}: the download is a zip`)
      assert.ok(bytes.includes(Buffer.from('deckpal/SKILL.md')), `${width}: it holds deckpal/SKILL.md`)

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      assert.ok(overflow <= 0, `${width}: the page scrolls sideways by ${overflow}px`)
      await page.addScriptTag({ content: AXE_SRC })
      const axeResult = await page.evaluate(async (tags) => window.axe.run(document, { runOnly: { type: 'tag', values: tags } }), AXE_TAGS)
      const violations = axeResult.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length }))
      assert.deepEqual(violations, [], `${width}: axe found ${violations.length} violation(s) — ${JSON.stringify(violations)}`)
      await page.screenshot({ path: path.join(out, `skill-page-${width}.png`), fullPage: true })
      results.push({ case: 'skill-page', label: 'cloud', width, signedOut: true, axeViolations: 0 })

      // /connect links here.
      await page.goto(server.origin + '/connect', { waitUntil: 'networkidle' })
      await page.getByRole('link', { name: 'Read the playbooks your AI follows with these tools' }).click()
      await page.getByRole('heading', { level: 1, name: 'DeckPal playbooks' }).waitFor()
      results.push({ case: 'skill-page-from-connect', label: 'cloud', width })
    } catch (error) {
      await page.screenshot({ path: path.join(out, `skill-page-${width}-failure.png`), fullPage: true }).catch(() => {})
      throw error
    } finally {
      await context.close()
    }
  }
  return results
}
