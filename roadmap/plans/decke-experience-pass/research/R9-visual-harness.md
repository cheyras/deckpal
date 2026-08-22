# R9 — Visual-verification harness for the Deck-E rework

Status: **WORKING**, proven end-to-end against the live dev server. Not a repo
dependency, not wired into CI, follows the existing `scripts/decke-gates.mjs`
pattern rather than starting a second one.

## 0. Course correction this doc reflects

The first pass added `@playwright/test` to `apps/web/package.json` and let
`pnpm install` write it into `pnpm-lock.yaml`. That was wrong: it reverses a
documented decision already sitting in this repo (`scripts/decke-gates.mjs`'s
header) that Playwright must NOT be a repo dependency, because CI runs
`pnpm install --frozen-lockfile` on every push and never touches a browser —
adding it there taxes every build for a tool only an operator runs by hand.

Fixed: `apps/web/package.json` and `pnpm-lock.yaml` were reverted with
`git checkout`, then `pnpm install` was re-run at the root to prune the
now-orphaned `node_modules` entries pnpm had already materialized (git
checkout alone does not touch `node_modules`). Verified clean:

```
$ git diff apps/web/package.json pnpm-lock.yaml
(empty)
$ git status --short
 M .gitignore
?? scripts/visual-harness/
```

The harness now resolves Playwright the same way `decke-gates.mjs` does (see
§2), and lives at `scripts/visual-harness/` next to it rather than under
`apps/web/e2e/` — reasoning in §1.

## 1. What already exists, and what this harness adds

`scripts/decke-gates.mjs` (2562 lines, pre-existing, not written by this task)
is a real, working Playwright-driven verification suite for Deck-E. Read in
full before building this. It:

- Resolves Playwright dynamically (`import('playwright')`, falling back to
  `PLAYWRIGHT_MODULE`) — exactly the policy this harness now mirrors.
- Signs in as the QA account (`.qa-account`) and drives a signed-in,
  entitled Deck-E session (`unlockDeckE` rewrites one boolean in one `/api/me`
  response so a non-owner QA account can see the character in the browser —
  it does not touch the server-side gate, which gate 2 verifies independently
  over bare HTTP).
- Hooks the network (`instrument()`): captures every `/api/chat` request body,
  streams the SSE response, and reconstructs which tools the model actually
  called (`wireTools`) — because "he said he did X" and "a `tool-` part with
  that name is on the wire" are different claims, and the whole suite exists
  because a previous pass shipped on the strength of the former.
- Has 17 numbered gates asserting specific product behaviors: navigation
  ("go to my decks" actually navigates + replays a tool result), server-side
  entitlement enforcement, factual grounding (tool calls backing an answer),
  the signed-approval round trip for writes, concurrent sessions, etc.
- Takes plain viewport screenshots (`shot()`, `fullPage: false`, one fixed
  1440×960 viewport for the whole run) as evidence attached to a gate's
  pass/fail verdict — a debugging aid, not a thing judged on its own.
- Has ZERO device emulation (no mobile viewport, no `deviceScaleFactor`, no
  touch/UA emulation — confirmed by grep, no `devices[`/`isMobile`/`iPhone`
  anywhere in the file), ZERO video capture, ZERO contact sheets, ZERO PWA/
  standalone/safe-area emulation, and no full-page screenshots.

**What it verifies:** did the agent do the right thing, provably, on the wire.
**What it cannot verify:** what anything looked like, on any device, while
moving. That gap is this harness.

This harness (`scripts/visual-harness/`) adds, and duplicates nothing above:

1. **Mobile device emulation** — real iPhone 14 Pro viewport/DSR/touch/UA via
   Playwright's `devices` map, run in Chromium (`defaultBrowserType` in that
   descriptor says `webkit`; Chromium honors the viewport/UA/touch fields
   anyway when applied to a `newContext()`, which is what cross-browser device
   emulation always was — see limitations §6 for what that does NOT prove).
2. **Full-page screenshots**, not just viewport — needed for anything below
   the fold (the FAQ section used as this run's proof interaction is one).
3. **Video of an interaction** + a **contact-sheet** helper that tiles N
   evenly-spaced frames into one PNG via ffmpeg, specifically so a vision
   model — which cannot watch a `.webm` — can judge motion (entry/exit
   animation, a character turning, a panel sliding) from a single image.
4. **iOS-standalone-PWA + safe-area emulation.** New capability, not present
   anywhere in `decke-gates.mjs`. See §5 — this directly answers the
   coordinator's ask about the chat overlay's missing safe-area padding.
5. **A written JSON diagnostics log** (console + failed network requests) per
   page, not just an in-memory array read back inside one gate's assertion.
6. **A timing-report helper** (`TimingReport`) for click-to-visual-change and
   similar measurements, written to JSON rather than only printed.

Everything here is read-only and signed-out (§3), which is the other reason it
does not just become gate 18 in `decke-gates.mjs`: that file signs in and
exercises Deck-E; this one deliberately never does, so it can be run against
`deckpal.app` itself with zero write risk and no QA-account dependency at all
(the smoke run below used a local dev server only because that's what was
running, not because it has to be).

## 2. Where it lives, and how Playwright resolves

**Code:** `scripts/visual-harness/` — a sibling of `decke-gates.mjs`, not
`apps/web/e2e/`. This is operator-run tooling (nothing under `apps/web`'s own
`package.json` scripts calls it, and it must not be), so it belongs with the
other operator scripts rather than inside the package whose build/typecheck
CI actually runs.

```
scripts/visual-harness/
  lib/
    resolve-playwright.mjs   — dynamic Playwright resolution (mirrors decke-gates.mjs)
    devices.mjs              — DESKTOP_PROFILE, mobileProfile(devices)
    screenshot.mjs           — captureScreenshots(), captureViewport()
    video.mjs                — recordInteraction()
    contact-sheet.mjs        — buildContactSheet() (shells out to ffmpeg/ffprobe)
    diagnostics.mjs          — attachDiagnostics() (console + failed requests → JSON)
    timing.mjs               — TimingReport class
    pwa-emulation.mjs        — applyStandaloneShim(), applySafeAreaInsets()
  run-visual-smoke.mjs        — the end-to-end proof script (§4)
```

**Playwright itself is NOT installed anywhere in this repo.** `apps/web/
package.json` and `pnpm-lock.yaml` are untouched — verified in §0. Resolution
mirrors `decke-gates.mjs` exactly (`scripts/visual-harness/lib/
resolve-playwright.mjs`, extracted so both scripts share one policy instead of
two copies that could drift):

```js
try {
  return await import('playwright')      // works if resolvable from cwd
} catch {
  // otherwise require an explicit PLAYWRIGHT_MODULE, CJS require (not import
  // — Playwright's entry point is CommonJS and ESM named-export detection
  // does not run for a bare file URL)
  return createRequire(import.meta.url)(join(process.env.PLAYWRIGHT_MODULE, 'index.js'))
}
```

**Exact commands used for this task** (redo-able on a fresh machine):

```bash
# 1. Install `playwright` into a SCRATCH folder, not the repo.
mkdir -p /path/to/scratch/playwright-scratch && cd /path/to/scratch/playwright-scratch
npm init -y
npm install playwright@1.62.1     # pinned to match the already-cached Chromium revision

# 2. Confirm the Chromium binary resolves (installed by a PRIOR unrelated
#    Playwright install on this machine, at %LOCALAPPDATA%\ms-playwright,
#    which is a shared, version-keyed cache independent of any node_modules —
#    see the friction note below).
node -e "require('./node_modules/playwright').chromium.launch().then(b=>{console.log(b.version());b.close()})"
# → 151.0.7922.34  (no download; already cached)

# 3. Run the harness against a dev server, pointing PLAYWRIGHT_MODULE at the
#    scratch install:
cd /path/to/deckpal
PLAYWRIGHT_MODULE=/path/to/scratch/playwright-scratch/node_modules/playwright \
  node scripts/visual-harness/run-visual-smoke.mjs --base http://localhost:5200
```

**Windows-specific friction encountered, and how each was resolved:**

- **A first attempt DID add Playwright as an `apps/web` devDependency** (`pnpm
  --filter deckpal-web add -D @playwright/test`) before this was recognized as
  wrong per `decke-gates.mjs`'s header. Reverting the tracked files
  (`git checkout`) was not enough — `pnpm` had already materialized
  `node_modules/@playwright/test` and related `.pnpm` store entries that
  `git checkout` cannot see. Fix: `pnpm install` at the root, which reconciled
  `node_modules` back to the (reverted) lockfile and removed the resolvable
  package trees. Orphaned content-addressed blobs remain in pnpm's `.pnpm`
  store (harmless, not resolvable by Node, pnpm garbage-collects it on its own
  schedule) — not worth an unsolicited `pnpm store prune`.
- **Chromium was already cached** at `%LOCALAPPDATA%\ms-playwright\
  chromium-1234\` from a prior install on this machine, so no ~200 MB browser
  download happened during this task at all — installing `playwright` (or
  `@playwright/test`) into any location on the same machine at a matching
  pinned version reuses that cache rather than re-downloading. This means the
  download-failure path in the task brief ("if the browser download fails,
  say so and stop") was never exercised here; if a genuinely fresh machine
  needs a first-time download, run `npx playwright install chromium` from the
  scratch folder and expect ~150–200 MB over the network.
- **Cross-drive video move.** The Playwright-recorded `.webm` lands under the
  OS temp dir (`C:\Users\...\AppData\Local\Temp\...`), and this repo is
  checked out on `E:`. `fs.renameSync` refuses a cross-device move on Windows
  (`EXDEV: cross-device link not permitted`) rather than falling back to a
  copy — Node does not do that for you. Fixed in `lib/video.mjs`: copy +
  unlink instead of rename.
- **Landing's FAQ accordion opens item 0 by default.** The first attempt at
  the proof interaction clicked `button[aria-expanded]).first()` and then
  waited for `aria-expanded === "true"` — but that button started at `"true"`
  already, so the click (which collapsed it) never satisfied the predicate
  and the run timed out. Not a Windows or Playwright issue, just a wrong
  assumption about the page's initial state, worth recording because it is
  exactly the kind of thing that looks like a harness bug and isn't. Fixed by
  targeting `.nth(1)` (starts closed).

## 3. Safety — read-only, signed-out, verified

`run-visual-smoke.mjs`'s header states this explicitly and it was followed:
every capture in the proof run happened against `http://localhost:5200`
(local dev server, `pnpm dev` — itself proxying to `https://deckpal.app`,
AGENTS.md B12) with **no sign-in, no writes, no `/api/bugs`**. The only click
performed anywhere is a client-side FAQ accordion toggle on the public landing
page — no network write, no navigation to an authenticated route. Every
screenshot in the proof run (§4) visibly shows the amber
`LIVE DATA · deckpal.app · signed out` ribbon
(`apps/web/src/components/DevBackendRibbon.tsx`), which is on every screenshot
in this app on purpose for exactly this reason.

**The QA account (`.qa-account`) was NOT used and is not read by anything in
this harness.** A human must authorize its use before any spec signs in — and
if that happens, `decke-gates.mjs`'s own `signIn()`/`qaAccount()`/
`unlockDeckE()` machinery is almost certainly what a signed-in visual spec
should reuse rather than reimplementing, since it already solves "open Deck-E
signed in as QA, entitled, instrumented."

## 4. The harness API

All helpers are plain ESM functions/classes, framework-agnostic (no
`@playwright/test` test-runner assumed — a script imports them and drives
`chromium.launch()` itself, matching `decke-gates.mjs`'s style).

### `lib/resolve-playwright.mjs`

```ts
async function resolvePlaywright(): Promise<{ chromium, firefox, webkit, devices, ... }>
```
Resolves the `playwright` package per §2. Throws with an actionable message if
neither `import('playwright')` nor `PLAYWRIGHT_MODULE` works.

### `lib/devices.mjs`

```ts
const DESKTOP_PROFILE: { viewport: {width:1440,height:900}, deviceScaleFactor: 2 }
function mobileProfile(devices, name = 'iPhone 14 Pro'): BrowserContextOptions
```

### `lib/screenshot.mjs`

```ts
async function captureScreenshots(page, dir, name): Promise<{ viewport: string, fullPage: string }>
async function captureViewport(page, dir, name): Promise<string>
```
Writes `<dir>/<name>.viewport.png` and `<dir>/<name>.fullpage.png`.

### `lib/video.mjs`

```ts
async function recordInteraction(
  browser,
  { contextOptions, size?, dir, name, keepOpenFor? },
  interact: (page, context) => Promise<void>,
): Promise<{ path: string }>
```
Owns the full lifecycle: creates a fresh context with `recordVideo` set (video
recording cannot be turned on for an already-open page), runs `interact`,
closes the page/context to finalize the file, then copies the result to
`<dir>/<name>.webm` (copy+unlink, not rename — see the cross-drive note in
§2). `keepOpenFor` (ms) pads a short settle time after `interact` returns so
the last visible frame of an animation isn't clipped.

### `lib/contact-sheet.mjs`

```ts
async function buildContactSheet(
  videoPath, outPath,
  { frames = 9, tileWidth = 320, ffmpegPath?, ffprobePath? } = {},
): Promise<{ path, frames, columns, rows, durationSec }>
```
`ffprobe`s the duration, computes `fps = frames / duration`, and runs
`ffmpeg -vf "fps=…,scale=…,tile=COLSxROWS" -frames:v 1` to produce one PNG
grid (`columns = ceil(sqrt(frames))`). Defaults point at the WinGet ffmpeg
install path from the task brief; override with `FFMPEG_PATH`/`FFPROBE_PATH`
env vars or the options object.

### `lib/diagnostics.mjs`

```ts
function attachDiagnostics(page): {
  consoleMessages: object[],
  failedRequests: object[],
  writeLog(logPath: string): string,
}
```
Distinguishes network-level failures (`requestfailed` — DNS, abort, CORS)
from HTTP-level failures (status ≥ 400) — different bugs, kept as different
`kind` values in the log rather than merged into one bucket.

### `lib/timing.mjs`

```ts
class TimingReport {
  mark(label): number
  measure(label, fromLabel, toLabel?): number         // ms
  add(label, ms): number
  async timeUntil(label, page, act, predicate, { arg?, timeoutMs? }): Promise<number>
  save(reportPath): string                             // writes JSON, returns the path
}
```

### `lib/pwa-emulation.mjs` — the standalone/safe-area emulation

```ts
async function applyStandaloneShim(page): Promise<void>       // call BEFORE navigation
async function applySafeAreaInsets(page, insets?): Promise<CDPSession>
const IPHONE_14_PRO_PORTRAIT_INSETS = { top: 47, bottom: 34, left: 0, right: 0 }
```
See §5 for what these do and what was verified.

### Copy-pasteable example spec

```js
import { resolvePlaywright } from './lib/resolve-playwright.mjs'
import { mobileProfile } from './lib/devices.mjs'
import { captureScreenshots } from './lib/screenshot.mjs'
import { recordInteraction } from './lib/video.mjs'
import { buildContactSheet } from './lib/contact-sheet.mjs'
import { attachDiagnostics } from './lib/diagnostics.mjs'
import { applySafeAreaInsets, applyStandaloneShim, IPHONE_14_PRO_PORTRAIT_INSETS } from './lib/pwa-emulation.mjs'

const { chromium, devices } = await resolvePlaywright()
const browser = await chromium.launch()

const context = await browser.newContext({ ...mobileProfile(devices) })
const page = await context.newPage()
await applyStandaloneShim(page)                          // before navigation
await applySafeAreaInsets(page, IPHONE_14_PRO_PORTRAIT_INSETS)
const diag = attachDiagnostics(page)

await page.goto('http://localhost:5199', { waitUntil: 'networkidle' })
await captureScreenshots(page, '.visual-harness/my-spec/mobile', 'chat-open')
diag.writeLog('.visual-harness/my-spec/mobile/console-network.json')
await context.close()

// Video + contact sheet of an interaction, in its own context:
const { path: videoPath } = await recordInteraction(
  browser,
  { contextOptions: { ...mobileProfile(devices) }, dir: '.visual-harness/my-spec/mobile', name: 'my-interaction' },
  async (page) => {
    await page.goto('http://localhost:5199', { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: 'Chat with Deck-E' }).click() // example only — read-only/signed-out actions only
  },
)
await buildContactSheet(videoPath, '.visual-harness/my-spec/mobile/my-interaction.contact-sheet.png', { frames: 9 })

await browser.close()
```

## 5. iOS-standalone-PWA and safe-area emulation — investigated as requested

Verified directly via a raw Chrome DevTools Protocol session
(`page.context().newCDPSession(page)`), on Chromium 151.0.7922.34 (bundled
with Playwright 1.62.1):

### `env(safe-area-inset-*)` — WORKS

```js
await session.send('Emulation.setSafeAreaInsetsOverride', {
  insets: { top: 47, topMax: 47, bottom: 34, bottomMax: 34, left: 0, leftMax: 0, right: 0, rightMax: 0 },
})
```

This is a real, undocumented-here CDP capability. Confirmed twice: once
against a synthetic `data:` URL (`getComputedStyle` on a
`padding-top: env(safe-area-inset-top, 999px)` probe element returned `47px`,
not the `999px` fallback), and again — more importantly — against the actual
live DeckPal landing page in the proof run:

```json
{ "displayModeStandalone": true, "navigatorStandalone": true,
  "safeAreaInsetTop": "47px", "safeAreaInsetBottom": "34px" }
```

(`.visual-harness/smoke/mobile/pwa-safe-area-probe.json`, produced by
`run-visual-smoke.mjs` injecting a probe `<div>` into the real page and
reading its computed style back — not a mocked value.)

**Parameter-shape gotcha, worth recording because it cost real time getting
here:** the field is a single `insets` OBJECT with `top`/`topMax`/`bottom`/
`bottomMax`/`left`/`leftMax`/`right`/`rightMax` — NOT an array of
`{ edge, size }` entries. That shape (`{ insets: [{edge:'top', size:47}] }`)
returns `Invalid parameters` despite looking like the more natural CDP
convention.

**Why this matters concretely:** `apps/web/src/components/AppShell.tsx`
already sets `paddingTop: 'env(safe-area-inset-top)'` etc. directly (lines
359, 371, 430–432) in its own inline styles — DeckPal's real safe-area
handling is built on exactly this CSS primitive, so this override is
sufficient to visually verify it, INCLUDING catching an element that is
missing a safe-area rule it should have (e.g. the chat overlay the
coordinator flagged) — something ordinary Chromium, where these insets are
always `0` because it has no notch, cannot exercise at all.

### `display-mode: standalone` (CDP media-feature override) — DOES NOT WORK

```js
await session.send('Emulation.setEmulatedMedia', {
  features: [{ name: 'display-mode', value: 'standalone' }],
})
```

Accepted with no error, but has **no effect**: verified that
`window.matchMedia('(display-mode: standalone)').matches` stayed `false`
both immediately after the call and after a full page reload. Chromium's CSS
engine does not honor this feature name through this CDP method in this
build. This is a genuine, plainly-stated limitation — there is no known
Chromium override for a real `@media (display-mode: standalone)` CSS rule.

**This does not currently cost anything for DeckPal**, because the app has
exactly one standalone-detection call, and it is JS-level, not CSS:
`apps/web/src/components/PwaUi.tsx:15` —
`window.matchMedia('(display-mode: standalone)').matches`. `grep -r
"display-mode" apps/web/src --include=*.css` found zero CSS media queries
using it. So `applyStandaloneShim()` (a `page.addInitScript` that monkeypatches
`window.matchMedia` for that one query string, plus shims the nonexistent-in-
Chromium `navigator.standalone` property) fully covers the app's actual
standalone-detection logic — confirmed on the live page in the proof run
(`displayModeStandalone: true, navigatorStandalone: true` above). **If a
future PR adds a real CSS `@media (display-mode: standalone)` rule, this
harness cannot drive it and this section must be re-verified — grep
`apps/web/src` for `display-mode`/`standalone` first.**

### Recommendation for the plan (not implemented here, per instruction)

The CDP safe-area override is sufficient as-is for verifying anything already
written against `env(safe-area-inset-*)`. It is NOT a substitute for making
that CSS itself easier to test everywhere: if the upcoming Deck-E rework adds
new safe-area-dependent layout (the chat overlay), consider having the app
read the insets through overridable custom properties —
`--safe-top: env(safe-area-inset-top, 0px)` set once at the root, consumed as
`padding-top: var(--safe-top)` elsewhere — so a test can also inject a value
by setting the CSS variable directly on `documentElement.style`, independent
of whether the CDP override above continues to exist/work in future Chromium
versions. Flagging this as a suggestion for the plan; not implemented.

### What no amount of Chromium emulation proves

- Real WebKit rendering/layout/JS-engine behavior — this is still Chromium.
  The UA string from `devices['iPhone 14 Pro']` says Safari; the rendering
  engine underneath is Blink. A pass here is not a substitute for checking on
  an actual iPhone in actual Safari before shipping.
- The real values iOS assigns `safe-area-inset-*` for a given device/
  orientation (notch vs. Dynamic Island vs. home indicator, portrait vs.
  landscape) — the override accepts ANY numbers; 47/34 are typical iPhone-
  with-notch portrait values, not measured from a device.
- Home-indicator gesture-bar interaction, the real "Add to Home Screen"
  install flow/prompt UI, offline/service-worker behavior under iOS's
  stricter background-execution limits, or Safari's own viewport quirks
  (address bar show/hide changing `100vh`).

## 6. Exact commands

```bash
# Everything (desktop + mobile screenshots, mobile video + contact sheet, timing + diagnostics)
PLAYWRIGHT_MODULE=/path/to/node_modules/playwright \
  node scripts/visual-harness/run-visual-smoke.mjs --base http://localhost:5199

# Desktop only
PLAYWRIGHT_MODULE=/path/to/node_modules/playwright \
  node scripts/visual-harness/run-visual-smoke.mjs --base http://localhost:5199 --only desktop

# Mobile only (includes the video + contact sheet, since that interaction is mobile-profile)
PLAYWRIGHT_MODULE=/path/to/node_modules/playwright \
  node scripts/visual-harness/run-visual-smoke.mjs --base http://localhost:5199 --only mobile

# Other flags: --run <name> (output subfolder, default "smoke"), --out <dir> (override output root),
# --headed (show the browser, for local debugging)
```

If `playwright` is resolvable from the current directory (e.g. installed
globally, or you `cd` into the scratch folder first), `PLAYWRIGHT_MODULE` can
be omitted entirely.

## 7. Artifact output layout

```
<repoRoot>/.visual-harness/<run>/           (gitignored — see .gitignore diff below)
  desktop/
    landing.viewport.png
    landing.fullpage.png
    console-network.json
  mobile/
    landing.viewport.png
    landing.fullpage.png
    console-network.json
    pwa-safe-area-probe.json          (only produced when the mobile pass runs)
    faq-interaction.webm
    faq-interaction.contact-sheet.png
  timing-report.json
```

`.gitignore` diff (only file this task modified — no other tracked file
changed):

```diff
 .gate-shots/
 .vercel-bypass
 .preview-url
+
+# ── visual-verification harness artifacts (scripts/visual-harness) ───────
+# Screenshots, videos, contact sheets, and JSON reports from a run. Same
+# convention as .gate-shots/ above: operator-produced evidence, never
+# committed, regenerated on demand.
+.visual-harness/
```

## 8. Proof — the smoke run

Command:

```bash
PLAYWRIGHT_MODULE=<scratch>/node_modules/playwright \
  node scripts/visual-harness/run-visual-smoke.mjs --base http://localhost:5200
```

(`http://localhost:5200`, not `:5199`: `pnpm dev` picks the next free port
when 5199 is already taken by another running dev session on this machine —
vite's own log said so. This is not a harness concern; `--base` handles it.)

Output:

```
Visual harness smoke run — base http://localhost:5200, out .../.visual-harness/smoke, headless=true
  desktop viewport: .../.visual-harness/smoke/desktop/landing.viewport.png (2.84 MB)
  desktop fullpage: .../.visual-harness/smoke/desktop/landing.fullpage.png (4.50 MB)
  desktop diagnostics: .../.visual-harness/smoke/desktop/console-network.json
  PWA/safe-area probe on live page: {"displayModeStandalone":true,"navigatorStandalone":true,"safeAreaInsetTop":"47px","safeAreaInsetBottom":"34px"}
  mobile viewport: .../.visual-harness/smoke/mobile/landing.viewport.png (1.08 MB)
  mobile fullpage: .../.visual-harness/smoke/mobile/landing.fullpage.png (3.00 MB)
  mobile diagnostics: .../.visual-harness/smoke/mobile/console-network.json
  interaction video: .../.visual-harness/smoke/mobile/faq-interaction.webm (356.6 KB)
  contact sheet (3x3 grid, 9 frames): .../.visual-harness/smoke/mobile/faq-interaction.contact-sheet.png (962.4 KB)
  timing report: .../.visual-harness/smoke/timing-report.json

Smoke run OK — every artifact produced a non-trivial file.
```

Artifact paths, sizes, and what was checked in each (all under
`E:\Users\cheyr\deckpal\.visual-harness\smoke\`):

| Artifact | Size | Verified |
|---|---|---|
| `desktop/landing.viewport.png` | 2.84 MB | PNG header decoded: **2880×1800px** = 1440×900 × deviceScaleFactor 2, exactly as configured. Visually inspected (Read tool): real landing page content, not blank. |
| `desktop/landing.fullpage.png` | 4.50 MB | 2880×15910px — full scroll height captured, not clipped. |
| `desktop/console-network.json` | 1.4 KB | `{"consoleMessages":4,"consoleErrors":0,"failedRequests":0}` — 4 benign console messages, zero errors, zero failed/4xx/5xx requests. |
| `mobile/landing.viewport.png` | 1.08 MB | **1179×1980px** = iPhone-14-Pro-profile viewport 393×660 × DSR 3 (Playwright's device descriptor uses 660, not the full 852px screen height, to approximate Safari's chrome-subtracted visible viewport — confirmed against the descriptor directly). Visually inspected: real mobile-rendered landing page, "LIVE DATA · deckpal.app · signed out" ribbon clearly visible. |
| `mobile/landing.fullpage.png` | 3.00 MB | 1179×34341px. |
| `mobile/console-network.json` | 959 B | `{"consoleMessages":3,"consoleErrors":0,"failedRequests":0}`. |
| `mobile/pwa-safe-area-probe.json` | 129 B | `{"displayModeStandalone":true,"navigatorStandalone":true,"safeAreaInsetTop":"47px","safeAreaInsetBottom":"34px"}` — read back from a probe element injected into the REAL live page, not a synthetic test page. Proves §5's CDP capability against the actual product. |
| `mobile/faq-interaction.webm` | 356.6 KB / 365 KB (re-run) | Non-trivial size for a ~1.5s clip at 393×660. |
| `mobile/faq-interaction.contact-sheet.png` | 962.4 KB | PNG header decoded: **960×1617px** = 3 columns × 320px tile width, 3 rows. Visually inspected (Read tool): a 3×3 grid clearly showing the FAQ panel scrolled into view (frames 1–4), the accordion visibly opening with body text appearing (frames 5–6), and staying open (frames 7–9) — real, visible motion, exactly what a vision model needs to judge an animation. |
| `timing-report.json` | 483 B | `desktop:load` 923ms, `mobile:load` 861ms, `faq:click-to-expanded` 1483ms (click → `aria-expanded="true"` observed in the DOM). |

Also re-ran with `--only desktop` and `--only mobile` separately (§6 commands)
to prove those paths independently — both produced the expected subset of
artifacts with no errors, confirmed via the same non-trivial-size check the
script performs automatically (any artifact under ~500B–5KB, depending on
type, is flagged `⚠ SUSPICIOUSLY SMALL` in the script's own output; none
were, in any of the three runs).

## 9. Anything a human must authorize

- **The QA account** (`.qa-account`, gitignored, `qa@deckscout.io`) exists and
  was confirmed present but **not read or used** by anything in this harness.
  A signed-in visual spec (needed for anything behind auth — the actual
  Deck-E chat overlay, the safe-area padding on an authenticated route, the
  mobile chat scroll behavior) requires explicit human authorization before
  any spec here signs in, per AGENTS.md B12. When that's authorized, reuse
  `decke-gates.mjs`'s `signIn()`/`qaAccount()`/`unlockDeckE()` rather than
  reimplementing them.
- **A first-time Chromium download**, if this ever runs on a machine with no
  prior Playwright install: `npx playwright install chromium` from the
  scratch folder, ~150–200 MB over the network. Not needed on this machine
  (already cached) — this is a heads-up for a different machine, not a
  request for anything on this one.
- Nothing else. No infrastructure, CI, Vercel, or Supabase configuration was
  touched (AGENTS.md B9) — the only tracked-file change in this whole task is
  the `.gitignore` addition in §7, and `pnpm-lock.yaml`/`apps/web/package.json`
  are byte-for-byte their committed state (§0).
