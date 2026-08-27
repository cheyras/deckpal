/**
 * probe-first-paint — can a stalled auth endpoint still hold the app on a
 * blank page? (issue #75)
 *
 * ── THE BUG THIS ASSERTS AGAINST ─────────────────────────────────────────────
 *
 * `supabase.auth.getSession()` refreshes the token over the network whenever
 * the stored one is inside its 90 s expiry margin — which is every cold load
 * after a couple of hours away. `@supabase/auth-js` puts no `AbortSignal` and
 * no timeout on that fetch, so a request that never SETTLES (a socket stranded
 * by a network change, a sleep/resume, a captive portal, a stalled H2
 * connection) never settles. Three places awaited it before anything could
 * render:
 *
 *   • `main.tsx`'s index route, in `beforeLoad` — the router renders nothing
 *     until it resolves, and React's first commit has already wiped the inline
 *     "Loading DeckPal" state out of `#root`. A blank dark page, indefinitely.
 *   • `AuthGuard` — an infinite spinner on every private route.
 *   • `api.ts`'s `authHeaders()`, before EVERY request — so even the public
 *     catalog came up as chrome with no content.
 *
 * ── WHAT IT DOES ─────────────────────────────────────────────────────────────
 *
 * Reproduces exactly that condition and asserts the app renders anyway:
 *
 *   1. seeds a stored session whose access token expired an hour ago, so the
 *      client MUST refresh before it can answer;
 *   2. holds the refresh open forever — `page.route` on
 *      `/auth/v1/token?grant_type=refresh_token` that never fulfils, aborts or
 *      continues. That is what a stranded socket looks like to the page, and
 *      it never leaves the browser, so nothing reaches the real auth server;
 *   3. loads `/` and `/series` and waits for real content.
 *
 * Exits non-zero if either page is still blank at the budget. Against the code
 * before the fix, both hang forever and both fail.
 *
 * ── SAFETY (AGENTS.md B12) ───────────────────────────────────────────────────
 *
 * No sign-in, no writes, no real credential. The seeded session is a fake
 * expired blob in a throwaway browser profile's localStorage, and the one
 * request it provokes is intercepted before it leaves. Everything else this
 * probe touches is the public catalog, signed out.
 *
 *   node scripts/visual-harness/probe-first-paint.mjs
 *   node scripts/visual-harness/probe-first-paint.mjs --base http://127.0.0.1:5199
 *   node scripts/visual-harness/probe-first-paint.mjs --budget 8000
 *
 * `--supabase-url` is only needed if the probe cannot read it from the dev
 * server's own `/api/public-config`; it decides the localStorage key the
 * client looks under (`sb-<first hostname label>-auth-token`).
 */
import { resolvePlaywright } from './lib/resolve-playwright.mjs'
import { DESKTOP_PROFILE, mobileProfile } from './lib/devices.mjs'

const argv = process.argv.slice(2)
function flag(name, fallback) {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? fallback : argv[i + 1]
}

const BASE = (flag('base', 'http://127.0.0.1:5199') || '').replace(/\/+$/, '')
/**
 * How long first content may take with the auth endpoint hung.
 *
 * The app's own deadline is 4 s (`SESSION_DEADLINE_MS`), so this is that plus
 * room for the dev server to compile and the catalog query to answer. It is a
 * ceiling on a bug whose old value was "never", not a performance budget.
 */
const BUDGET_MS = Number(flag('budget', '12000'))

async function discoverSupabaseUrl() {
  const explicit = flag('supabase-url', '')
  if (explicit) return explicit
  const res = await fetch(`${BASE}/api/public-config`)
  if (!res.ok) throw new Error(`${BASE}/api/public-config returned HTTP ${res.status}`)
  const body = await res.json()
  if (!body.supabaseUrl) throw new Error('public-config carried no supabaseUrl')
  return body.supabaseUrl
}

/** supabase-js derives its storage key from the first label of the auth host. */
function storageKeyFor(supabaseUrl) {
  return `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`
}

const expiredSession = () => ({
  access_token: 'probe.expired.access-token',
  refresh_token: 'probe-expired-refresh-token',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) - 3600,
  user: { id: '00000000-0000-0000-0000-000000000000', aud: 'authenticated', role: 'authenticated' },
})

/**
 * What a visitor can actually SEE — and the per-route definition matters.
 *
 * `/` is the whole-page case: before the fix `#root` had zero children, so
 * "anything at all" is the right bar there.
 *
 * `/series` is NOT, and taking "anything at all" for it would let this probe
 * pass on the broken build: the nav chrome rendered fine, and it was the
 * CONTENT that never arrived, because `api.ts` awaited the same stalled read
 * before every request. So the bar for the catalog is the series COUNT, which
 * SeriesIndex renders as `{data?.series.length ?? 0} series` — literally "0
 * series" until the query answers, and a real number afterwards. (A link to a
 * series would have been the obvious check and is the wrong one: signed out,
 * the list collapses behind a "Show N series with no cards collected"
 * disclosure and there are no such links on screen at all.)
 */
const READY = {
  '/': () => {
    const root = document.getElementById('root')
    return !!root && root.childElementCount > 0
  },
  '/series': () => {
    const text = (document.body.innerText || '').replace(/\s+/g, ' ')
    return /[1-9]\d* series/.test(text) && !/Loading series/.test(text)
  },
}

async function visibleContent(page, path) {
  try {
    return await probe(page, path)
  } catch (err) {
    // A client-side redirect can destroy the execution context mid-evaluate
    // (`/` → `/series` is one). That is the app WORKING; poll again.
    if (/Execution context was destroyed|Target closed|frame was detached/i.test(String(err))) {
      return { ok: false, children: -1, booting: false, stuck: false, chars: 0, text: '', path }
    }
    throw err
  }
}

function probe(page, path) {
  return page.evaluate(
    ([p, readySource]) => {
      const root = document.getElementById('root')
      if (!root) return { ok: false, children: -1, booting: false, stuck: false, chars: 0, text: '', path: p }
      const booting = !!document.getElementById('boot')
      const stuck = !!document.getElementById('boot-stuck')
      const text = (document.body.innerText || '').replace(/\s+/g, ' ').trim()
      // eslint-disable-next-line no-new-func
      const ready = new Function(`return (${readySource})`)()
      return {
        ok: !booting && !stuck && text.length > 0 && !!ready(),
        children: root.childElementCount,
        booting,
        stuck,
        chars: text.length,
        text: text.slice(0, 70),
        path: location.pathname,
      }
    },
    [path, READY[path].toString()],
  )
}

async function run(browser, { label, ...profile }, path, supabaseUrl, results) {
  const context = await browser.newContext(profile)

  // (1) A session that is present and stale — the state that forces a refresh.
  await context.addInitScript(
    ([key, value]) => {
      try {
        localStorage.setItem(key, value)
      } catch {
        /* storage disabled — the probe cannot run, the assert below will say so */
      }
    },
    [storageKeyFor(supabaseUrl), JSON.stringify(expiredSession())],
  )

  const page = await context.newPage()

  // (2) The stall. No fulfil, no abort, no continue — the request simply never
  // completes, which is precisely the failure mode auth-js cannot time out of.
  let stalledRequests = 0
  await page.route('**/auth/v1/token**', () => {
    stalledRequests += 1
  })

  const started = Date.now()
  await page.goto(`${BASE}${path}`, { waitUntil: 'commit' })

  let state = await visibleContent(page, path)
  while (!state.ok && Date.now() - started < BUDGET_MS) {
    await page.waitForTimeout(150)
    state = await visibleContent(page, path)
  }
  const elapsed = Date.now() - started

  results.push({
    profile: label,
    path,
    ok: state.ok,
    elapsed,
    stalledRequests,
    state,
  })
  const verdict = state.ok ? 'PASS' : 'FAIL'
  console.log(
    `  ${verdict}  ${label.padEnd(8)} ${path.padEnd(8)} ` +
      `${String(elapsed).padStart(6)}ms  stalled-refreshes=${stalledRequests}  ` +
      `root-children=${state.children} text-chars=${String(state.chars).padStart(5)} ` +
      `boot=${state.booting} stuck=${state.stuck}`,
  )

  await context.close()
}

const { chromium, devices } = await resolvePlaywright()
const supabaseUrl = await discoverSupabaseUrl()

// Same two viewports every other gate in this harness uses: Verification
// Standard 1 asks for desktop AND phone, and this defect could plausibly have
// differed between them (the reporter saw it on both Chrome and iOS Safari).
const PROFILES = [
  { label: 'desktop', ...DESKTOP_PROFILE },
  { label: 'mobile', ...mobileProfile(devices) },
]

console.log('probe-first-paint')
console.log(`  base           ${BASE}`)
console.log(`  auth endpoint  ${supabaseUrl} (token refresh held open, never answered)`)
console.log(`  storage key    ${storageKeyFor(supabaseUrl)} (session expired 1h ago)`)
console.log(`  budget         ${BUDGET_MS}ms\n`)

const browser = await chromium.launch()
const results = []
try {
  for (const profile of PROFILES) {
    // `/` is the route that went fully blank (its beforeLoad awaited the read);
    // `/series` is the public catalog, which came up as chrome with no content
    // because every api.ts request awaited it too. Both, or the probe is only
    // testing half the blast radius.
    for (const path of ['/', '/series']) {
      await run(browser, profile, path, supabaseUrl, results)
    }
  }
} finally {
  await browser.close()
}

const failed = results.filter((r) => !r.ok)
const noStall = results.filter((r) => r.stalledRequests === 0)

console.log('')
if (noStall.length === results.length) {
  console.error(
    'INCONCLUSIVE: no token refresh was ever attempted, so nothing was stalled and\n' +
      'this proved nothing. The seeded session did not take — check --supabase-url\n' +
      'against what the app was actually built with.',
  )
  process.exit(2)
}
if (failed.length > 0) {
  console.error(
    `FAIL: ${failed.length}/${results.length} loads never rendered within ${BUDGET_MS}ms with the\n` +
      'auth endpoint hung. First paint is blocked on an unbounded auth read — issue #75.\n' +
      'See apps/web/src/lib/sessionDeadline.ts.',
  )
  process.exit(1)
}
console.log(
  `PASS: ${results.length}/${results.length} loads rendered with the auth endpoint hung.\n` +
    'First paint is not blocked by the auth-session read.',
)
