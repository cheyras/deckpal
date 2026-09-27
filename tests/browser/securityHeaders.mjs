import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { chromium, webkit } from 'playwright'
import { buildWeb, serve } from './support.mjs'
import { adminFixture, signIn } from './admin.mjs'

/**
 * SEC-03/SEC-14 regression: is the CSP this app actually ships (parsed live
 * out of vercel.json, not a hand-copied string that can drift from it) free
 * of violations across the real routes, in BOTH engines, signed out AND
 * signed in — and does it still allow the four things it has to allow
 * (Stripe's script, the scanner's camera, a real Supabase-shaped origin, the
 * service worker) while still refusing an arbitrary third party?
 *
 * Runs only for label === 'cloud': self-host has no vercel.json and gets its
 * headers from helmet instead (apps/api/src/index.ts), which is exercised by
 * the ordinary API test suite, not this one.
 */

const ROOT = path.resolve(import.meta.dirname, '../..')
const vercelConfig = JSON.parse(readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'))
const cspOf = (source) => vercelConfig.headers.find((h) => h.source === source).headers
  .find((h) => h.key === 'Content-Security-Policy').value
const GENERAL_CSP = cspOf('/((?!api/|dev/decke-compare$|assets/scan-harness-.*\\.html$).*)')
const DECKE_COMPARE_CSP = cspOf('/dev/decke-compare')
const SCAN_HARNESS_CSP = cspOf('/assets/scan-harness-(.*).html')
// Mirrors vercel.json's own per-path carve-out (see check-security-headers.mjs
// for why /dev/decke-compare needs a different frame-ancestors) rather than
// applying one CSP everywhere -- a route that would only be exercised
// correctly under its OWN real production header should get it here too.
// `mount` is always '' here (this check only runs for label === 'cloud').
const cspForPath = (mount) => (pathname) => pathname === mount + '/dev/decke-compare' ? DECKE_COMPARE_CSP
  : /^\/assets\/scan-harness-[^/]+\.html$/.test(pathname.slice(mount.length)) ? SCAN_HARNESS_CSP : GENERAL_CSP

// This crawl includes the Deck-E runtime and scanner/WASM path. Keep it serial
// after the other suites so their parallel builds cannot starve its short auth
// deadline and turn a fixture-only timing miss into a false product failure.
export function browserSuites({ browser, out, scratch, results, logs }) {
  return [{
    name: 'security-headers',
    serial: true,
    async run() {
      const dist = path.join(scratch, 'security-headers')
      const admin = adminFixture('')
      const originServer = await serve(dist, '', (rel, url, req) => admin.response(rel, url, req) ?? null)
      try {
        logs.push(await buildWeb(dist, true, originServer.origin))
        results.push(...await checkSecurityHeaders(browser, dist, '', 'cloud', admin, out))
      } finally {
        await originServer.close()
      }
    },
  }]
}

// Every navigation gets this before any app script runs, so a violation fired
// during first paint (the watchdog, the boot styles) is caught too, not just
// ones fired after React mounts.
const VIOLATION_RECORDER = `
  window.__cspViolations = []
  document.addEventListener('securitypolicyviolation', (e) => {
    window.__cspViolations.push(e.violatedDirective + ' blocked ' + (e.blockedURI || e.sourceFile || '(inline)'))
  })
`

async function violationsOn(page) {
  return page.evaluate(() => window.__cspViolations ?? [])
}

/** A generic 200 for any /api/* path the admin fixture doesn't model, so a
 * route with no dedicated fixture data still renders (an empty/error state
 * is fine) instead of the page hard-failing before it can request the
 * scripts, styles and images this check actually cares about. */
function withFallback(admin) {
  return (rel, url, req) => admin.response(rel, url, req) ?? (rel.startsWith('/api/') ? { body: {} } : null)
}

const ROUTES = ['/', '/lists', '/collection', '/decks', '/dex', '/insights', '/profile', '/series', '/scan',
  '/authorize?response_type=code&client_id=dscl_x&redirect_uri=https%3A%2F%2Fclaude.ai%2Fcb&code_challenge=abcdefghijklmnopqrstuvwxyzabcdefghijklmnopq&code_challenge_method=S256',
  // Both diagnostics.view-gated, but still real, shipping production routes:
  // /dev/decke-compare embeds a same-origin recursive <iframe> (needs
  // frame-src 'self') and /dev/scan-harness embeds a large classic inline
  // <script> via <iframe srcDoc> (needs its own script-src hash). Neither is
  // a synthetic edge case -- they are the two places this app actually uses
  // an inline script or a same-origin frame outside index.html.
  '/dev/decke-compare', '/dev/scan-harness']

// Takes an already-launched browser (one per engine, reused across every
// call in this file) rather than launching its own -- a Playwright BROWSER
// process is the expensive, contention-prone unit; a context is cheap. This
// check alone would otherwise launch upward of a dozen browser processes.
async function crawl(browser, server, mount, admin, actorLabel, signedIn) {
  const found = []
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' })
  try {
    // Planting the fixture Supabase session is what makes the app treat this
    // context as signed in at all -- without it every route (regardless of
    // admin.state.actor) renders the signed-out "Welcome back" screen, which
    // would have made the "signed-in-owner" crawl phase silently identical to
    // the signed-out one. Caught this empirically: checkCamera failed to find
    // a live stream at /scan until this was added, because /scan with no
    // session never reaches Scan.tsx at all.
    if (signedIn) await signIn(context)
    await context.addInitScript(VIOLATION_RECORDER)
    const consoleViolations = []
    for (const route of ROUTES) {
      const page = await context.newPage()
      page.on('console', (m) => { if (/content.security.policy|refused to/i.test(m.text())) consoleViolations.push(`${route}: ${m.text().slice(0, 200)}`) })
      await page.goto(server.origin + mount + route, { waitUntil: 'load', timeout: 20_000 }).catch((e) => found.push(`${route}: navigation error ${e.message.slice(0, 120)}`))
      await page.waitForTimeout(500)
      const v = await violationsOn(page)
      for (const violation of v) found.push(`${route} (${actorLabel}): ${violation}`)
      await page.close()
    }
    found.push(...consoleViolations)
  } finally {
    await context.close()
  }
  return found
}

/** Writes a tiny standalone fixture page (same pattern as admin-worker.mjs's
 * privacy.html) that probes specific allow/deny origins directly, rather
 * than depending on the full app happening to make the right request.
 *
 * The probe logic is an EXTERNAL same-origin file, not an inline <script> --
 * this page is served under the exact same strict CSP as everything else in
 * this check, and an inline script here would need its own hash for no
 * reason (it never ships), so it would just be blocked. Learned that the
 * hard way: the first version of this probe used an inline script and was
 * silently testing nothing, caught only because `window.__runProbe is not a
 * function` surfaced as a hard failure rather than a false pass.
 */
function writeProbePage(dist) {
  writeFileSync(path.join(dist, 'csp-probe.js'), `
    window.__probe = { events: [] }
    document.addEventListener('securitypolicyviolation', (e) => window.__probe.events.push(e.violatedDirective + ':' + e.blockedURI))
    function tag(kind, src) {
      return new Promise((resolve) => {
        const el = document.createElement(kind)
        el.onload = () => resolve('load')
        el.onerror = () => resolve('error')
        el.src = src
        document.body.appendChild(el)
        setTimeout(() => resolve('timeout'), 3000)
      })
    }
    window.__runProbe = async () => ({
      stripeScript: await tag('script', 'https://js.stripe.com/v3/'),
      evilScript: await tag('script', 'https://evil.example/x.js'),
      supabaseImg: await tag('img', 'https://fixture-project.supabase.co/storage/v1/object/public/card-art/x.webp'),
      evilImg: await tag('img', 'https://evil.example/y.webp'),
      events: window.__probe.events,
    })
  `)
  writeFileSync(path.join(dist, 'csp-probe.html'), '<!doctype html><title>CSP probe</title><script src="csp-probe.js"></script>')
}

async function checkAllowDenyProbe(browser, engineName, server) {
  const context = await browser.newContext()
  try {
    const page = await context.newPage()
    // Fulfill the two ALLOWED origins locally; never hit real network.
    await page.route('https://js.stripe.com/v3/', (route) => route.fulfill({ contentType: 'text/javascript', body: '/* stub */' }))
    await page.route('https://fixture-project.supabase.co/**', (route) => route.fulfill({
      contentType: 'image/webp',
      body: Buffer.from('RIFF....WEBPVP8 '), // not a valid webp; onload still fires for <img> on any image/* content-type in Chromium/WebKit's decoder-tolerant path is NOT guaranteed, so this checks the request was ALLOWED (not blocked by CSP) rather than that it decoded.
    }))
    // NOT checked: whether a 'request'/'requestfailed' event fires for the
    // blocked origins. Verified empirically (both engines, via a throwaway
    // debug page) that this is not a portable signal -- Chromium fires
    // 'request' then 'requestfailed' with errorText 'csp' for a CSP-blocked
    // fetch, but WebKit fires neither; it only ever reaches the element's
    // onerror handler and the DOM securitypolicyviolation event. Those two
    // are what both engines agree on, so they are what this asserts on.
    await page.goto(server.origin + '/csp-probe.html')
    const result = await page.evaluate(() => window.__runProbe())
    assert.equal(result.stripeScript, 'load', 'script-src must allow https://js.stripe.com/v3/ (Stripe.js)')
    assert.equal(result.evilScript, 'error', 'script-src must block an arbitrary third-party script host')
    assert.equal(result.evilImg, 'error', 'img-src must block an arbitrary third-party image host')
    assert.ok(result.events.some((e) => e.includes('evil.example') && e.includes('x.js')), 'blocking the evil script must be visible as a securitypolicyviolation, not a silent no-op')
    assert.ok(result.events.some((e) => e.includes('evil.example') && e.includes('y.webp')), 'blocking the evil image must be visible as a securitypolicyviolation, not a silent no-op')
    // supabaseImg's onload/onerror outcome depends on whether the stubbed
    // bytes decode as an image (engine-specific); what this asserts is CSP
    // reach, so check that directly: fixture-project.supabase.co must never
    // appear in the violation list.
    assert.ok(!result.events.some((e) => e.includes('fixture-project.supabase.co')), 'img-src/connect-src must allow a real Supabase-shaped origin (https://*.supabase.co)')
    return { case: 'csp-allow-deny-probe', engine: engineName, stripeScriptAllowed: true, supabaseOriginAllowed: true, evilScriptBlocked: true, evilImgBlocked: true }
  } finally { await context.close() }
}

async function checkCamera(server, mount) {
  const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] })
  try {
    const context = await browser.newContext()
    await signIn(context)
    await context.grantPermissions(['camera'], { origin: server.origin })
    await context.addInitScript(VIOLATION_RECORDER)
    const page = await context.newPage()
    await page.goto(server.origin + mount + '/scan', { waitUntil: 'load' })
    // useCamera() (apps/web/src/scan/ui/camera.ts) starts on mount; give the
    // fake device + onnx wasm engine a real budget to come up.
    const gotStream = await page.waitForFunction(() => {
      const v = document.querySelector('video')
      return !!(v && v.srcObject)
    }, { timeout: 15_000 }).then(() => true).catch(() => false)
    await page.locator('[data-scan-engine-status="ready"]').waitFor({ state: 'attached', timeout: 30_000 })
    const violations = await violationsOn(page)
    await context.close()
    assert.ok(gotStream, '/scan never reached a live camera stream -- either a real regression or the fake device/permission setup is wrong, either way this check is not proving what it claims to')
    assert.deepEqual(violations, [], 'CSP violations while the scanner camera + onnx engine were running')
    return { case: 'scan-camera', gotFakeCameraStream: gotStream, cspViolations: violations }
  } finally { await browser.close() }
}

async function checkScanHarnessOpenCv(browser, server, mount, admin, out) {
  admin.state.actor = 'owner'
  admin.state.signedOut = false
  admin.state.permissions = ['devtools.access', 'diagnostics.view']
  const context = await browser.newContext()
  await signIn(context)
  await context.addInitScript(VIOLATION_RECORDER)
  const page = await context.newPage()
  try {
    const documentResponse = await page.goto(server.origin + mount + '/devtools', { waitUntil: 'load' })
    assert.ok(!documentResponse?.headers()['content-security-policy']?.includes("'unsafe-eval'"),
      'the Dev tools page must retain the strict app policy')
    const harnessAsset = page.waitForResponse(response => /\/assets\/scan-harness-[^/]+\.html$/.test(new URL(response.url()).pathname))
    await page.getByRole('link', { name: /Scanner harness/ }).click()
    const assetResponse = await harnessAsset
    assert.ok(assetResponse.headers()['content-security-policy']?.includes("'unsafe-eval'"),
      'the harness iframe must receive its own OpenCV policy after client-side navigation')
    const frame = page.frameLocator('iframe[title="Card-detector harness"]')
    await frame.locator('[data-tab="live"]').click()
    await frame.locator('#engineOpenCv').click()
    await page.waitForFunction(() => {
      const doc = document.querySelector('iframe[title="Card-detector harness"]')?.contentDocument
      const button = doc?.getElementById('engineOpenCv')
      return button?.classList.contains('active') && !button.disabled &&
        !button.textContent.includes('loading') && !doc.getElementById('liveErr')?.textContent
    }, null, { timeout: 45_000 })
    assert.deepEqual(await violationsOn(page), [], 'CSP violations while OpenCV initialized in the scan harness')
    assert.deepEqual(await frame.locator('body').evaluate(() => window.__cspViolations ?? []), [],
      'CSP violations inside the scan harness iframe')
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.screenshot({ path: path.join(out, 'scan-harness-1440.png') })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: path.join(out, 'scan-harness-390.png') })
    return { case: 'scan-harness-opencv', initialized: true }
  } finally {
    await context.close()
    admin.state.permissions = []
  }
}

async function checkDecke(browser, server, mount, admin) {
  admin.state.actor = 'owner'
  admin.state.signedOut = false
  admin.state.permissions = ['decke.use']
  const context = await browser.newContext()
  await signIn(context)
  await context.addInitScript(VIOLATION_RECORDER)
  const page = await context.newPage()
  try {
    // The launcher button is app chrome (character/host/DeckeHost.tsx's
    // LAUNCHER_SELECTOR), present once decke:true comes back from /api/me --
    // open it and let its runtime chunk + assets (glb, env map, SDF atlas) load.
    // `getAccess()` (lib/access.ts) reads the session through its own 4s
    // deadline (authSession.ts) before the entitlement check even fires, and
    // once that read stalls it "remembers" being stalled for 30s and will not
    // retry within the same page -- so under real CPU contention (this repo's
    // shared dev machine; PR-PROTOCOL.md's heavy.sh exists because of exactly
    // this) a single page load can genuinely miss the deadline once, on
    // schedule, with no bug involved. A FRESH navigation resets every one of
    // `access.ts`'s module-level variables (a new page = a new JS realm), so
    // retrying the whole `goto` is the correct unit of retry here -- waiting
    // longer on the same page load would not help once the stall memo is set.
    const bubble = page.locator('button[aria-label="Chat with Deck-E"]')
    let appeared = false
    for (let attempt = 1; attempt <= 3 && !appeared; attempt++) {
      await page.goto(server.origin + mount + '/lists', { waitUntil: 'load' })
      appeared = await bubble.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false)
    }
    // This check exercises the CSP, not pointer hit-testing. Hovering the
    // launcher starts an asynchronous warm that can move or rename the button
    // while Playwright waits for a stable click target on a busy CI runner.
    // Invoke the same button handler and require the real dialog to appear.
    if (appeared) await bubble.evaluate(button => button.click())
    const opened = appeared && await page.getByRole('dialog', { name: 'Chat with Deck-E' })
      .waitFor({ state: 'visible', timeout: 15_000 }).then(() => true).catch(() => false)
    if (opened) await page.waitForTimeout(1500)
    const violations = await violationsOn(page)
    assert.ok(opened, 'the Deck-E launcher or dialog did not appear at /lists with decke.use granted, after 3 fresh attempts')
    assert.deepEqual(violations, [], 'CSP violations while Deck-E\'s runtime chunk and character assets were loading')
    return { case: 'decke-open', opened, cspViolations: violations }
  } finally {
    await context.close()
    admin.state.permissions = []
  }
}

async function checkServiceWorkerRegistration(browser, server, mount, admin) {
  const context = await browser.newContext({ serviceWorkers: 'allow' })
  try {
    // /dev/decke-compare needs diagnostics.view to render its comparison
    // panes at all -- see the check below, which reuses this same context.
    admin.state.actor = 'owner'
    admin.state.signedOut = false
    admin.state.permissions = ['diagnostics.view']
    await signIn(context)
    await context.addInitScript(VIOLATION_RECORDER)
    const page = await context.newPage()
    await page.goto(server.origin + mount + '/', { waitUntil: 'load' })
    const registered = await page.evaluate(async (mount) => {
      const reg = await navigator.serviceWorker.register(mount + '/sw.js')
      await navigator.serviceWorker.ready
      return !!reg.active || !!reg.installing || !!reg.waiting
    }, mount).catch((e) => `error: ${e.message}`)
    const violations = await violationsOn(page)
    assert.equal(registered, true, `service worker registration did not reach an active/installing/waiting state: ${registered}`)
    assert.deepEqual(violations, [], 'CSP violations while registering the service worker')

    // Astra review (2026-09-26): a NavigationRoute always serves the ONE
    // precached shell regardless of which path was navigated to, so an
    // active, CONTROLLING worker could silently override /dev/decke-compare's
    // own frame-ancestors 'self' with the shell's frame-ancestors 'none' --
    // sw.ts denylists that one path from the shell route specifically so it
    // falls through to a real network fetch instead. Reload first so the now-
    // active worker actually takes control of this page's navigations (a
    // worker doesn't control the page that registered it until the next load).
    await page.reload({ waitUntil: 'load' })
    const controlled = await page.evaluate(() => !!navigator.serviceWorker.controller)
    assert.ok(controlled, 'the service worker never took control of the page -- the decke-compare exception below would prove nothing without this')
    await page.goto(server.origin + mount + '/dev/decke-compare', { waitUntil: 'load' })
    await page.waitForTimeout(1500)
    const deckeCompareViolations = await violationsOn(page)
    const paneFrames = page.frames().filter((frame) => frame.url().includes('/dev/decke-compare?frame='))
    for (const frame of paneFrames) {
      await frame.waitForLoadState('load')
      await frame.locator('canvas').waitFor({ state: 'attached', timeout: 10_000 })
    }
    assert.deepEqual(deckeCompareViolations, [], "/dev/decke-compare's frame-ancestors 'self' exception was overridden by the service worker's cached shell (frame-ancestors 'none')")
    assert.ok(paneFrames.length > 0, '/dev/decke-compare loaded no comparison iframe documents -- diagnostics.view may not be wired the way this check assumes')

    const harnessAsset = page.waitForResponse(response => /\/assets\/scan-harness-[^/]+\.html$/.test(new URL(response.url()).pathname))
    await page.goto(server.origin + mount + '/dev/scan-harness', { waitUntil: 'load' })
    const harnessResponse = await harnessAsset
    assert.ok(harnessResponse.headers()['content-security-policy']?.includes("'unsafe-eval'"),
      'the active service worker replaced the harness iframe response and lost its OpenCV exception')

    // The fixture server may serve its own fallback here, but the active
    // worker must leave both missing built-asset navigations to the network.
    // vercel.json's rewrite guard then makes them 404 in production.
    for (const asset of ['scan-harness-anything.html', 'index-abc123.html']) {
      const response = await page.goto(server.origin + mount + '/assets/' + asset, { waitUntil: 'load' })
      assert.ok(response && !response.fromServiceWorker(), `service worker served the cached app shell for missing /assets/${asset}`)
    }

    return { case: 'service-worker-registration', registered, controlled, deckeCompareUnderActiveWorker: { violations: deckeCompareViolations, panes: paneFrames.length }, scanHarnessPolicyPreserved: true }
  } finally {
    await context.close()
    admin.state.permissions = []
  }
}

export async function checkSecurityHeaders(chromiumBrowser, dist, mount, label, admin, out) {
  if (label !== 'cloud') return []
  writeProbePage(dist)
  const results = []

  // One webkit instance for the whole check (chromium reuses the caller's
  // already-launched `chromiumBrowser` -- see the file-level comment on
  // `crawl` for why instance reuse matters here).
  const webkitBrowser = await webkit.launch()
  const server = await serve(dist, mount, withFallback(admin), 'index.html', { csp: cspForPath(mount) })
  try {
    // The Deck-E access check has a short auth deadline. Run it before the
    // camera and OpenCV WASM probes consume memory in this browser process.
    results.push(await checkDecke(chromiumBrowser, server, mount, admin))
    admin.state.signedOut = true
    admin.state.actor = 'signed-out'
    admin.state.permissions = []
    const signedOutChromium = await crawl(chromiumBrowser, server, mount, admin, 'signed-out', false)
    const signedOutWebkit = await crawl(webkitBrowser, server, mount, admin, 'signed-out', false)

    admin.state.signedOut = false
    admin.state.actor = 'owner'
    // decke.use unlocks the character bubble (checkDecke below), scanner.use
    // is what actually mounts Scan.tsx's camera UI at /scan rather than a
    // gate, and diagnostics.view is what /dev/decke-compare and
    // /dev/scan-harness require to render their iframes for real.
    admin.state.permissions = ['decke.use', 'scanner.use', 'diagnostics.view']
    const signedInChromium = await crawl(chromiumBrowser, server, mount, admin, 'signed-in-owner', true)
    const signedInWebkit = await crawl(webkitBrowser, server, mount, admin, 'signed-in-owner', true)

    const allCrawlViolations = [...signedOutChromium, ...signedOutWebkit, ...signedInChromium, ...signedInWebkit]
    assert.deepEqual(allCrawlViolations, [], 'CSP violations found while crawling every route')
    results.push({
      case: 'csp-route-crawl', routes: ROUTES.length, engines: ['chromium', 'webkit'], actors: ['signed-out', 'signed-in-owner'],
      violations: allCrawlViolations.length,
    })

    results.push(await checkAllowDenyProbe(chromiumBrowser, 'chromium', server))
    results.push(await checkAllowDenyProbe(webkitBrowser, 'webkit', server))
    results.push(await checkCamera(server, mount))
    results.push(await checkScanHarnessOpenCv(chromiumBrowser, server, mount, admin, out))
    results.push(await checkServiceWorkerRegistration(chromiumBrowser, server, mount, admin))
  } finally {
    await server.close()
    await webkitBrowser.close()
  }
  return results
}
