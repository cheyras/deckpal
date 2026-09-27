import assert from 'node:assert/strict'
import path from 'node:path'
import { webkit } from 'playwright'
import { ROOT, WEB, run, buildWeb, isolatedEnv, serve, contextFor } from './support.mjs'
import { appResponses, announcement, checkUpcoming } from './upcoming.mjs'
import { checkNestedRouteRecovery, checkRouteSplit } from './routeSplit.mjs'
import { adminFixture, checkAdmin, checkInsights } from './admin.mjs'
import { checkServiceWorkerPrivacy } from './admin-worker.mjs'
import { checkFeedback } from './feedback.mjs'
import { chatAllowMutation, chatApi, checkChat, checkDeckeStates } from './chat.mjs'
import { checkOffline } from './offline.mjs'
import { writesFixture, checkWrites } from './writes.mjs'
import { checkAuthReturn } from './authReturn.mjs'
import { checkHeicUnderSelfHostCsp } from './labelerHeic.mjs'
import { queueFixture, checkQueue } from './queue.mjs'
import { checkDeployAssets } from '../../scripts/check-deploy-assets.mjs'

// Each returned suite owns its dist, fixture server, and browser contexts.
// Admin fixture state is shared only by checks within the same label suite.
export function browserSuites({ browser, out, scratch, results, assets, logs }) {
  function labelSuite(label, mount) {
    return {
      name: label,
      async run() {
        const dist = path.join(scratch, label)
        let scenario = 'active'
        const admin = adminFixture(mount)
        const writes = writesFixture(mount, admin)
        const queue = queueFixture(mount)
        let adminActive = false, writesActive = false, queueActive = false
        const server = await serve(dist, mount,
          (rel, url, req) => queueActive && (rel.startsWith('/api/dev/scan-queue') || rel.startsWith('/api/dev/scan-flags')) ? queue.response(rel, url, req) : writesActive ? writes.response(rel, url, req) : adminActive ? admin.response(rel, url, req) : appResponses(scenario, rel),
          'index.html', { allowMutation: (pathname, method) => pathname.endsWith('/api/client-errors') && method === 'POST'
            || admin.allowMutation(pathname, method) || (writesActive && writes.allowMutation(pathname, method)) || (queueActive && queue.allowMutation(pathname, method)) })
        try {
          logs.push(await buildWeb(dist, label === 'cloud', server.origin))
          assets.push({ label, ...await checkDeployAssets(dist) })
          if (label === 'selfhost') results.push(await checkHeicUnderSelfHostCsp(browser, dist))
          results.push(...await checkUpcoming(browser, server, mount, label, out))
          results.push(...await checkRouteSplit(browser, server, mount, label, out))
          for (scenario of ['expired', 'catalogued']) {
            const { context, page } = await contextFor(browser, server, 390)
            try {
              await page.goto(server.origin + mount + '/series/' + announcement.seriesSlug, { waitUntil: 'networkidle' })
              await page.getByRole('heading', { name: 'Browser Series', exact: true }).waitFor()
              assert.equal(await page.getByRole('group', { name: announcement.name + ' — coming soon', exact: true }).count(), 0)
              await page.getByText(scenario === 'catalogued' ? '3 sets' : '2 sets', { exact: true }).waitFor()
              results.push({ case: 'upcoming-suppression', label, scenario, placeholderAbsent: true })
            } finally { await context.close() }
          }
          adminActive = true
          results.push(await checkNestedRouteRecovery(browser, server, mount, label))
          results.push(...await checkAdmin(browser, server, mount, label, out, admin))
          results.push(...await checkInsights(browser, server, mount, label, out, admin))
          results.push(...await checkFeedback(browser, server, mount, label, out, admin))
          results.push(await checkServiceWorkerPrivacy(browser, dist, mount, label))
          queueActive = true
          results.push(...await checkQueue(browser, server, mount, label, out, queue))
          queueActive = false
          if (label === 'cloud') {
            writesActive = true
            results.push(...await checkWrites(browser, server, mount, label, out, writes, admin))
          }
          assert.deepEqual(server.unexpected, [], label + ': unexpected network/error events')
        } finally { await server.close() }
      },
    }
  }

  return [
    {
      name: 'typecheck',
      async run() {
        // This entry lives outside apps/web/src and has its own typecheck.
        logs.push(await run(process.execPath, [path.join(ROOT, 'node_modules/typescript/bin/tsc'),
          '--noEmit', '-p', path.join(ROOT, 'tests/browser/tsconfig.json')]))
      },
    },
    labelSuite('selfhost', '/deckpal'),
    labelSuite('cloud', ''),
    {
      name: 'authreturn',
      async run() {
        results.push(...await checkAuthReturn(browser, path.join(scratch, 'authreturn'), out))
      },
    },
    {
      name: 'chat',
      async run() {
        const fixtureDist = path.join(scratch, 'chat')
        logs.push(await run(process.execPath, [path.join(WEB, 'node_modules/vite/bin/vite.js'), 'build',
          '--config', path.join(ROOT, 'tests/browser/vite.config.mjs'), '--outDir', fixtureDist],
          { env: isolatedEnv() }))
        const server = await serve(fixtureDist, '', chatApi, 'fixture.html', { allowMutation: chatAllowMutation })
        try {
          results.push(...await checkChat(browser, server, out))
          results.push(...await checkOffline(browser, server, out))
          results.push(...await checkDeckeStates(browser, server, out, 'chromium'))
          const safari = await webkit.launch({ headless: true, ...(process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE_PATH
            ? { executablePath: process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE_PATH } : {}) })
          try { results.push(...await checkDeckeStates(safari, server, out, 'webkit')) } finally { await safari.close() }
          assert.deepEqual(server.unexpected, [], 'Rendered chat fixture: unexpected network/error events')
        } finally { await server.close() }
      },
    },
  ]
}
