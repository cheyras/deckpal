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
  return results
}
