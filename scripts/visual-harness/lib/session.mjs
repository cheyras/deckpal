/**
 * A signed-in browser session, for looking at surfaces that are behind auth.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 *
 * `run-visual-smoke.mjs` says in its own header that it *"runs entirely signed
 * out"*, and it photographs the public landing page. That was the right scope
 * for proving the harness works. It is the wrong scope for proving anything
 * about Deck-E, because every chat surface is behind `AuthGuard` AND behind an
 * entitlement check — so a signed-out harness can produce a screenshot of the
 * chat only by producing a screenshot of something else.
 *
 * Until this module existed, "verified visually" about a chat surface was a
 * claim nobody was in a position to make. That is the specific gap it closes.
 *
 * ── B12, WHICH IS THE REASON FOR EVERY DECISION BELOW ────────────────────────
 *
 * `pnpm dev` proxies to the LIVE deckpal.app backend. A session opened here is
 * a real session against real data, so it is opened as the QA account from
 * `.qa-account` and never as the owner's — the same rule, for the same reason,
 * that `scripts/decke-gates.mjs` follows. Two consequences worth stating out
 * loud rather than leaving to be discovered:
 *
 *   - There is no "read-only mode" here. A screenshot is read-only; the SESSION
 *     is not. Anything a scene does with the mouse can write.
 *   - `.qa-account` is gitignored and absent from a fresh clone on purpose.
 *     Failing loudly with an explanation beats degrading to signed-out and
 *     photographing a login page, which looks superficially like a result.
 *
 * ── RELATIONSHIP TO `scripts/decke-gates.mjs` ────────────────────────────────
 *
 * The sign-in flow, the bypass header and the entitlement unlock are the same
 * three problems that file already solved, and this is a deliberate second
 * implementation rather than an extraction: `decke-gates.mjs` is a single
 * self-contained script that a developer copies to a machine and runs, and
 * carving its middle out into a shared library would make the gate suite — the
 * project's verification standard — depend on this newer harness. The newer
 * thing takes the dependency.
 *
 * Every fact copied here is one whose drift FAILS LOUDLY: a changed aria-label
 * or a changed sign-in form times out with the selector in the message. None of
 * them can drift quietly into a wrong-but-passing result.
 */
import { readFileSync } from 'node:fs'

/**
 * The QA credential. Throws with an explanation rather than returning null,
 * because every caller's only sane response to "no account" is to stop.
 */
export function qaAccount(path = '.qa-account') {
  let raw
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    throw new Error(
      `${path} is missing. It is gitignored by design; get it from the maintainer. ` +
        'Visual verification of a signed-in surface must not run as the owner — see AGENTS.md B12.',
    )
  }
  const get = (k) => raw.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim()
  const email = get('QA_EMAIL')
  const password = get('QA_PASSWORD')
  if (!email || !password) throw new Error(`${path} is missing QA_EMAIL or QA_PASSWORD`)
  return {
    email,
    password,
    userId: get('QA_USER_ID'),
    fixtureSet: get('QA_FIXTURE_SET'),
    fixtureOwned: Number(get('QA_FIXTURE_OWNED')) || null,
  }
}

/**
 * The Vercel deployment-protection bypass, for running against a preview.
 *
 * Absent, this returns `{}` and everything works — correct for `deckpal.app`
 * and for a local dev server. Against a preview WITHOUT it, the failure does
 * not look like a missing header: every request 302s to Vercel's SSO page, so
 * sign-in times out looking for an email field that is not there and the run
 * reads as "the product is broken". `decke-gates.mjs` has the long version.
 *
 * It must go on the CONTEXT, not the page: `extraHTTPHeaders` there is the only
 * place that covers subresources and XHR as well as the document.
 */
export function bypassHeaders({
  explicit = process.env.VERCEL_BYPASS,
  path = '.vercel-bypass',
} = {}) {
  let token = explicit
  if (!token) {
    try {
      token = readFileSync(path, 'utf8').match(/^VERCEL_BYPASS=(.*)$/m)?.[1]?.trim() || null
    } catch {
      token = null
    }
  }
  return token ? { 'x-vercel-protection-bypass': token } : {}
}

/**
 * Let the QA account see Deck-E.
 *
 * Deck-E is entitled per-user (`DECKE_ENTITLED_USER_IDS`), and the QA account
 * may or may not be on that list on the deployment under test. This rewrites
 * the CLIENT's view of `/api/me` so the button renders.
 *
 * READ THIS BEFORE TRUSTING A SCREENSHOT TAKEN UNDER IT. It is a lie told to
 * the browser, and it is a narrower lie than it looks:
 *
 *   - It changes what the client DRAWS. It does not change what the server
 *     ALLOWS. If `/api/chat` refuses this account the panel opens and the turn
 *     fails, which is a visible honest failure, not a laundered pass.
 *   - It only rewrites a SUCCESSFUL `/api/me`. The app calls it once before the
 *     session exists and gets a 401; rewriting that would set `fired` on every
 *     run and turn the warning into noise nobody reads by the third run.
 *   - It leaves an already-entitled response completely alone, so a run where
 *     the account is genuinely entitled is not shimmed at all — and `fired()`
 *     tells you which run you had.
 *
 * The returned `fired()` must be reported in whatever output the run produces.
 * An unreported shim is the difference between a tool and a way to fool
 * yourself.
 */
export async function unlockDeckE(context) {
  let fired = false
  await context.route('**/api/me', async (route) => {
    const res = await route.fetch()
    // `ok()` with the parentheses — on a Playwright APIResponse it is a METHOD,
    // and `!res.ok` is `!aFunction`, which is always false.
    if (!res.ok()) return route.fulfill({ response: res })
    let body = null
    try {
      body = await res.json()
    } catch {
      return route.fulfill({ response: res })
    }
    if (body?.decke === true || body?.owner === true) return route.fulfill({ response: res })
    fired = true
    return route.fulfill({ response: res, json: { ...body, owner: true } })
  })
  return { fired: () => fired }
}

/**
 * Sign in through the real form.
 *
 * The `.last()` is not superstition: "Sign in" is also the name of the mode TAB
 * above the form, so a plain match hits the tab, which is already selected, the
 * form is never submitted, and the failure looks exactly like bad credentials.
 */
export async function signIn(page, base, { email, password }) {
  await page.goto(`${base}/auth`, { waitUntil: 'domcontentloaded' })
  await page.getByLabel(/email/i).fill(email)
  await page.getByLabel(/password/i).fill(password)
  await page.getByRole('button', { name: /^sign in$/i }).last().click()
  await page.waitForURL((u) => !u.pathname.startsWith('/auth'), { timeout: 30_000 })
}

/**
 * Open the chat panel the way a person does — warm, then click.
 *
 * The button is a 2D stand-in that warms the character runtime on pointer
 * intent, so hovering first is not politeness: it is the sequence the loader
 * was designed around, and once the idle auto-load is gone it is the only thing
 * that starts a load on desktop.
 *
 * Selectors, because neither element is guessable: the button is icon-only with
 * `aria-label="Chat with Deck-E"`, and the composer is an `<input>` with NO
 * `type` attribute, labelled "Message Deck-E" — so `input[type="text"]` matches
 * nothing at all.
 *
 * `warm: false` skips the hover, which is how a scene photographs the cold
 * tap-and-wait path instead of the warmed one.
 */
export async function openDeckE(page, { warm = true, timeout = 45_000 } = {}) {
  const button = page.getByRole('button', { name: 'Chat with Deck-E' })
  await button.waitFor({ state: 'visible', timeout: 30_000 })
  if (warm) await button.hover()
  await button.click()
  const composer = page.getByLabel('Message Deck-E')
  await composer.waitFor({ state: 'visible', timeout })
  return composer
}

/**
 * Where a signed-in run starts, and it is NOT `/`.
 *
 * `DeckeHost` renders nothing on chromeless routes and the marketing landing is
 * one of them, so a run starting at `/` waits out its timeout for a button that
 * is deliberately absent. A signed-in `/` happens to redirect to `/series`,
 * which is why starting there worked by accident — an accident is not a place
 * to start every scene from.
 */
export const HOME_PATH = '/series'
