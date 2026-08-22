/**
 * Deck-E's verification gates, run headless against a real browser.
 *
 * ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────
 *
 * `AGENTS.md`: "Verify the artifact, not the report. A 'done' you did not
 * verify is a guess," and "type-checks and tests verify code correctness, not
 * feature correctness."
 *
 * Skipping that gate is the entire reason Deck-E shipped as a character who
 * narrated journeys the browser was never told to take. Every unit test in this
 * repo passed the whole time. The wire guard was never exercised by any of them
 * because none of them ran a browser, and a stream chunk that matches no branch
 * is not an error — it is silence.
 *
 * So the gates are a program. Not a checklist someone works through by hand and
 * reports on, because the report is the thing that was wrong last time.
 *
 * ── WHAT IT ASSERTS, AND WHAT IT REFUSES TO ACCEPT ───────────────────────────
 *
 * A gate fails if the answer is RIGHT BUT UNVERIFIED. "He said he went to
 * /decks" is not evidence; `page.url()` is. "He looked it up" is not evidence;
 * a `tool-` part in the follow-up request body is.
 *
 * That is why this hooks the network rather than reading the transcript. The
 * transcript is the model's account of what happened, which is precisely the
 * witness under suspicion.
 *
 * Usage:
 *   node scripts/decke-gates.mjs --base http://127.0.0.1:5210 --gate 1
 *   node scripts/decke-gates.mjs --base https://deckpal.app --all --headed
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'

/**
 * Playwright, from wherever it actually is.
 *
 * DELIBERATELY NOT A DEPENDENCY OF THIS REPO. CI installs with a frozen
 * lockfile on every push and runs no browser; adding Playwright there would
 * make every build pay for a tool only the gates use. `.qa-account` already
 * documents a Playwright flow for this project on the same assumption — that it
 * is a verification tool an operator has, not something the product ships.
 *
 * So: use it if it resolves, and otherwise take an explicit path rather than
 * guessing. `PLAYWRIGHT_MODULE` should point at a `playwright` package
 * directory, e.g. one from `npm install playwright` in a scratch folder.
 */
const { chromium } = await (async () => {
  try {
    return await import('playwright')
  } catch (err) {
    const explicit = process.env.PLAYWRIGHT_MODULE
    if (!explicit) {
      console.error(
        [
          'playwright is not installed and PLAYWRIGHT_MODULE is unset.',
          '  npm install playwright   (anywhere)',
          '  PLAYWRIGHT_MODULE=/path/to/node_modules/playwright node scripts/decke-gates.mjs …',
        ].join('\n'),
      )
      throw err
    }
    // `require`, not `import`. Playwright's entry point is CommonJS, and ESM
    // named-export detection does not run for a bare file URL — so
    // `import(fileURL)` resolves to a namespace whose `chromium` is undefined,
    // which then fails as "Cannot read properties of undefined (reading
    // 'launch')" three frames away from the actual cause.
    return createRequire(import.meta.url)(join(explicit, 'index.js'))
  }
})()

// ── Arguments ────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback
}
const flag = (name) => argv.includes(`--${name}`)

const BASE = (arg('base', 'http://127.0.0.1:5210')).replace(/\/$/, '')
const HEADED = flag('headed')
const ONLY = arg('gate', null)
const SHOTS = arg('shots', join(process.cwd(), '.gate-shots'))
const WIDTH = Number(arg('width', 1440))
const HEIGHT = Number(arg('height', 960))

mkdirSync(SHOTS, { recursive: true })

// ── The QA account ───────────────────────────────────────────────────────────
//
// From `.qa-account`, which is gitignored and is the credential this project
// keeps precisely so that verification never runs as the owner (B12). Two of
// the later gates WRITE; running those as the owner would put real collection
// data at risk to prove a feature works, which is the trade B12 forbids.

function qaAccount() {
  let raw
  try {
    raw = readFileSync('.qa-account', 'utf8')
  } catch {
    throw new Error(
      '.qa-account is missing. It is gitignored by design; get it from the ' +
        'maintainer. Verification must not run as the owner — see AGENTS.md B12.',
    )
  }
  const get = (k) => raw.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim()
  const email = get('QA_EMAIL')
  const password = get('QA_PASSWORD')
  if (!email || !password) throw new Error('.qa-account is missing QA_EMAIL or QA_PASSWORD')
  return { email, password, userId: get('QA_USER_ID') }
}

// ── Reporting ────────────────────────────────────────────────────────────────

const results = []
let failures = 0

function record(n, title, passed, detail) {
  results.push({ n, title, passed, detail })
  if (!passed) failures++
  const mark = passed ? 'PASS' : 'FAIL'
  console.log(`\n[gate ${n}] ${mark} — ${title}`)
  for (const line of String(detail).split('\n')) console.log(`         ${line}`)
}

/**
 * Assert, but keep going.
 *
 * A gate suite that stops at the first failure tells you one thing per run,
 * and each run costs a sign-in and a model turn. Collecting them means one run
 * answers "what is broken", not "what broke first".
 */
function check(cond, message) {
  if (!cond) throw new Error(message)
}

// ── Harness ──────────────────────────────────────────────────────────────────

/**
 * Everything a gate needs: a signed-in page, and a record of what actually went
 * over the wire.
 *
 * `chatPosts` is the load-bearing part. Each entry is one request to
 * `/api/chat` with its parsed body, so a gate can ask "did leg 2 carry a
 * `tool-goTo` output" — a question the transcript cannot answer honestly,
 * because the transcript is written by the thing being tested.
 */
/**
 * Launch a browser, preferring the one already on this machine.
 *
 * `channel: 'chrome'` uses the installed Google Chrome rather than Playwright's
 * pinned build. That is the better default here twice over: it is what a reader
 * will actually be running, and it avoids a ~100 MB download whose only purpose
 * is to be a slightly different Chrome. `--channel bundled` forces Playwright's
 * own, which is what you want if you are chasing a version-specific rendering
 * difference.
 *
 * SwiftShader because headless has no GPU and the character is a three.js
 * scene — without it the canvas silently never draws, which would make every
 * visual gate fail for a reason that has nothing to do with the code under
 * test.
 */
async function launchBrowser() {
  const args = ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage']
  const wanted = arg('channel', 'chrome')
  if (wanted !== 'bundled') {
    try {
      return await chromium.launch({ headless: !HEADED, channel: wanted, args })
    } catch (err) {
      console.log(`  (no '${wanted}' channel: ${String(err.message).slice(0, 90)}; using bundled)`)
    }
  }
  return chromium.launch({ headless: !HEADED, args })
}

async function withSignedInPage(fn) {
  const { email, password } = qaAccount()
  const browser = await launchBrowser()
  const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT } })
  const page = await context.newPage()

  const chatPosts = []
  const consoleErrors = []

  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().includes('/api/chat')) {
      let body = null
      try {
        body = JSON.parse(req.postData() ?? 'null')
      } catch {
        /* a body we cannot parse is itself worth seeing */
      }
      chatPosts.push({ url: req.url(), body, raw: req.postData(), req, finished: false })
    }
  })
  page.on('response', async (res) => {
    if (res.request().method() === 'POST' && res.url().includes('/api/chat')) {
      const entry = chatPosts[chatPosts.length - 1]
      if (entry) entry.status = res.status()
    }
  })
  // `requestfinished` — NOT `response` — is what marks a leg actually over.
  // `/api/chat` streams SSE; `response` fires the moment headers arrive, while
  // the model is still talking. `requestfinished` fires only once the whole
  // body has been read, which for a stream means the connection closed —
  // i.e. the turn (or this leg of it) is done. `waitForChatSettled` below
  // depends on this to know when to stop waiting.
  page.on('requestfinished', (req) => {
    if (req.method() !== 'POST' || !req.url().includes('/api/chat')) return
    const entry = chatPosts.find((p) => p.req === req)
    if (entry) entry.finished = true
  })
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text())
  })
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`))

  try {
    await signIn(page, email, password)
    return await fn({ page, chatPosts, consoleErrors, context })
  } finally {
    await browser.close()
  }
}

/**
 * Sign in.
 *
 * The `.last()` on the Sign in button is not superstition: "Sign in" is also
 * the name of the mode TAB above the form, so a plain match hits the tab, which
 * is already selected, and the form is never submitted — a failure that looks
 * exactly like bad credentials. `.qa-account` documents this; it is repeated
 * here because the next person to touch it will not have read that file.
 */
async function signIn(page, email, password) {
  await page.goto(`${BASE}/auth`, { waitUntil: 'domcontentloaded' })
  await page.getByLabel(/email/i).fill(email)
  await page.getByLabel(/password/i).fill(password)
  await page.getByRole('button', { name: /^sign in$/i }).last().click()
  await page.waitForURL((u) => !u.pathname.startsWith('/auth'), { timeout: 30_000 })
}

/**
 * Open the chat panel.
 *
 * The button is a cheap 2D stand-in that warms the 6.6 MB runtime on hover or
 * touch intent, so this hovers first and then clicks — the same sequence a
 * person performs, and the one the loader was designed around.
 *
 * The real selectors (there is no `data-decke-button`, and the button carries
 * no visible "Deck-E" text — it is an icon-only chip): `DeckeButton.tsx` gives
 * the button `aria-label="Chat with Deck-E"`, and `DeckeChat.tsx` gives the
 * composer `aria-label="Message Deck-E"` on an `<input>` with NO `type`
 * attribute at all (so `input[type="text"]` — the original guess — matches
 * nothing; the browser's implicit default type is irrelevant to a CSS
 * attribute selector). Composer visibility does not wait on the 6.6 MB
 * runtime: `DeckeChat` renders unconditionally once `chatOpen` flips, so this
 * resolves in well under a second in practice.
 */
async function openDeckE(page) {
  const button = page.getByRole('button', { name: 'Chat with Deck-E' })
  await button.waitFor({ state: 'visible', timeout: 30_000 })
  await button.hover()
  await button.click()
  const composer = page.getByLabel('Message Deck-E')
  await composer.waitFor({ state: 'visible', timeout: 45_000 })
  return composer
}

/**
 * Wait until a turn (and any follow-up legs) has actually finished, by
 * watching the wire rather than the DOM.
 *
 * The obvious DOM signal does not exist: `DeckeChat.tsx`'s composer `<input>`
 * is never `disabled` — only the SEND BUTTON is (`disabled={busy ||
 * !draft.trim()}`), and since `submit()` clears the draft immediately, that
 * button reads disabled both while busy AND once idle with an empty box. So
 * there is no reliable "he's done" bit to poll in the DOM at all.
 *
 * What IS reliable is exactly what this harness already exists to trust: the
 * wire. A turn is "settled" once every `/api/chat` POST that has started has
 * also `finished` (its SSE stream closed — see the `requestfinished` listener
 * above, which for a streamed response only fires once the body is fully
 * read) AND nothing new has happened for `quietMs` — long enough for a
 * follow-up leg to have started if the model was going to send one.
 */
async function waitForChatSettled(chatPosts, { quietMs = 900, timeoutMs = 25_000 } = {}) {
  const start = Date.now()
  let lastCount = -1
  let lastFinished = -1
  let lastChange = Date.now()
  while (Date.now() - start < timeoutMs) {
    const count = chatPosts.length
    const finished = chatPosts.filter((p) => p.finished).length
    if (count !== lastCount || finished !== lastFinished) {
      lastCount = count
      lastFinished = finished
      lastChange = Date.now()
    }
    if (count > 0 && finished === count && Date.now() - lastChange >= quietMs) return
    await new Promise((r) => setTimeout(r, 100))
  }
}

/** Say something to him, and wait until the turn has actually finished. */
async function say(page, composer, text, chatPosts, { settleMs = 25_000 } = {}) {
  await composer.fill(text)
  await composer.press('Enter')
  await waitForChatSettled(chatPosts, { timeoutMs: settleMs })
}

const shot = (page, name) => page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: false })

/** Every `tool-…` part carried in any leg of a turn, with its output. */
function toolPartsFrom(chatPosts) {
  const out = []
  for (const post of chatPosts) {
    for (const m of post.body?.messages ?? []) {
      for (const p of m.parts ?? []) {
        if (typeof p?.type === 'string' && p.type.startsWith('tool-')) {
          out.push({ name: p.type.slice('tool-'.length), state: p.state, input: p.input, output: p.output })
        }
      }
    }
  }
  return out
}

// ── The gates ────────────────────────────────────────────────────────────────

const GATES = {}

/**
 * Gate 1 — "Go to my decks".
 *
 * PR 1. The browser must actually navigate, and a `goTo` tool RESULT must exist
 * in the follow-up request. Both halves matter and they fail independently:
 * before PR 1 the model emitted the call every time and the browser dropped it,
 * so the URL never changed and no follow-up was ever sent. A gate that checked
 * only the URL would also pass if the model happened to say the right thing
 * while a human clicked the link.
 */
GATES[1] = {
  title: '"Go to my decks" navigates, and the follow-up carries a goTo result',
  async run() {
    return withSignedInPage(async ({ page, chatPosts, consoleErrors }) => {
      await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
      const composer = await openDeckE(page)
      await shot(page, 'gate1-before')

      await say(page, composer, 'Go to my decks', chatPosts)
      await shot(page, 'gate1-after')

      const url = page.url()
      const tools = toolPartsFrom(chatPosts)
      const goTo = tools.find((t) => t.name === 'goTo')

      const detail = [
        `legs (POSTs to /api/chat): ${chatPosts.length}`,
        `final url: ${url}`,
        `tool parts replayed: ${tools.map((t) => `${t.name}=${JSON.stringify(t.output)}`).join(', ') || '(none)'}`,
        consoleErrors.length ? `console errors: ${consoleErrors.slice(0, 3).join(' | ')}` : 'console: clean',
      ].join('\n')

      check(chatPosts.length >= 2, 'no follow-up leg was sent — the browser ran no client tool')
      check(goTo, 'no goTo tool result reached the follow-up request')
      check(goTo.output?.ok === true, `goTo was refused: ${JSON.stringify(goTo.output)}`)
      check(/\/decks/.test(url), `browser did not navigate to /decks (still ${url})`)
      return detail
    })
  },
}

/**
 * Gate 2 — the endpoint refuses an account that is not entitled.
 *
 * PR 2. Deliberately NOT a browser gate: the whole point is that the browser's
 * own gate is irrelevant, so this must be the shape of the attack — a bare HTTP
 * request with a valid JWT for an ordinary account.
 *
 * Run with `--expect-refusal` once the deployment has the entitlement list set
 * WITHOUT the QA account on it. With QA entitled (the normal configuration for
 * every other gate) a 200 here is correct, and this gate reports that rather
 * than failing, because a suite that cannot be configured is a suite people
 * stop running.
 */
GATES[2] = {
  title: 'POST /api/chat is gated server-side, not in the browser',
  async run() {
    const { email, password } = qaAccount()
    const cfg = await (await fetch(`${BASE}/api/public-config`)).json()
    const auth = await fetch(`${cfg.supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: cfg.supabaseAnonKey, 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    const { access_token: jwt } = await auth.json()
    check(jwt, 'could not sign the QA account in against Supabase')

    const res = await fetch(`${BASE}/api/chat`, {
      method: 'POST',
      headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', parts: [{ type: 'text', text: 'say the single word: probe' }] }],
        route: '/',
        landmarks: [],
      }),
    })
    const text = (await res.text()).slice(0, 400)
    const health = await (await fetch(`${BASE}/api/health`)).json().catch(() => ({}))

    const detail = [
      `status: ${res.status}`,
      `deckeEntitlement: ${JSON.stringify(health.deckeEntitlement ?? '(absent — old build)')}`,
      `deckeLimits: ${JSON.stringify(health.deckeLimits ?? '(absent — old build)')}`,
      `body: ${text.replace(/\n/g, ' ').slice(0, 200)}`,
    ].join('\n')

    if (flag('expect-refusal')) {
      check(res.status === 403, `expected 403 for a non-entitled account, got ${res.status}`)
    } else {
      // The interesting failure is 500. A refusal must be cheap and legible.
      check(res.status !== 500, 'the endpoint 500s rather than refusing cleanly')
      check(
        health.deckeEntitlement,
        'this deployment predates server-side entitlement — /health has no deckeEntitlement',
      )
    }
    return detail
  },
}

// ── Run ──────────────────────────────────────────────────────────────────────

const chosen = ONLY ? [Number(ONLY)] : Object.keys(GATES).map(Number)

console.log(`Deck-E gates — base ${BASE}, viewport ${WIDTH}x${HEIGHT}, headless=${!HEADED}`)
console.log(`screenshots → ${SHOTS}`)

for (const n of chosen) {
  const gate = GATES[n]
  if (!gate) {
    console.log(`\n[gate ${n}] SKIP — not implemented yet`)
    continue
  }
  try {
    const detail = await gate.run()
    record(n, gate.title, true, detail)
  } catch (err) {
    record(n, gate.title, false, err?.message ?? String(err))
  }
}

writeFileSync(join(SHOTS, 'results.json'), JSON.stringify(results, null, 2))
console.log(`\n${results.length - failures}/${results.length} gates passed`)
process.exit(failures ? 1 : 0)
