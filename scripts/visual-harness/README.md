# visual-harness — seeing whether a change actually looks right

Operator tooling. Not run by CI, not a package dependency, not imported by the
app. Sibling of `scripts/decke-gates.mjs`, and it follows that file's rules
about how Playwright is obtained.

## Why this exists

`decke-gates.mjs` already answers *"did the thing actually happen?"* — it hooks
the network and checks `page.url()` and real tool-call payloads, because this
codebase once shipped a character that narrated actions the browser never
received. Its header puts it well: *the transcript is the model's account of
what happened, which is precisely the witness under suspicion.*

This harness answers a different question: **"does it look right?"** Layout,
spacing, safe areas, blur, and — the hard one — motion. A passing unit test
says nothing about whether a character grew from nothing or was simply already
there.

It also closes the same trust gap one level up. An agent that captures a
screenshot and then asserts from memory that the animation worked has verified
nothing. So `judge-motion.mjs` reads the artifact back with an independent pair
of eyes.

## What's here

| File | What it does |
|---|---|
| `capture-decke.mjs` | **Photograph Deck-E, signed in, on both platforms.** Named scenes, before/after runs. The only thing here that can see a surface behind auth. |
| `run-visual-smoke.mjs` | End-to-end proof the harness works: desktop + mobile screenshots, a recorded interaction, a contact sheet, timing and console/network reports. |
| `judge-motion.mjs` | Ask a vision model what a video or screenshot actually shows. Prose (`--describe`) or a machine-checkable verdict (`--assert`). |
| `probe-decke-size.mjs` | **Does he change SIZE when nothing about the viewport did?** Measures his silhouette off the pixels, types a draft into the composer, measures again. Exits non-zero on a change. |
| `probe-decke-flight.mjs` | **Does his hop stop halfway, and does he twitch after landing?** Samples `DeckE.screenRect()` every animation frame of a real entrance and reads the answer off the trajectory. Repeats, because "happens every time pretty much" is a claim about a rate. |
| `lib/resolve-playwright.mjs` | Finds Playwright without it being a repo dependency. |
| `lib/devices.mjs` | Desktop and iPhone-class viewport profiles. |
| `lib/screenshot.mjs` | Viewport and full-page captures to a predictable path. |
| `lib/video.mjs` | Records one interaction; owns the context lifecycle so the `.webm` is finalized. |
| `lib/contact-sheet.mjs` | ffmpeg: video → one PNG grid of evenly-spaced frames, in time order. |
| `lib/pwa-emulation.mjs` | Safe-area insets and standalone-PWA signals (see caveat below). |
| `lib/diagnostics.mjs` | Console errors and failed requests to a JSON log. |
| `lib/timing.mjs` | Marks and durations to a JSON report. |
| `lib/judge.mjs` | The vision-model client. `judge()` for prose, `assertVisual()` for verdicts. |
| `lib/session.mjs` | Signing in as the QA account, the preview bypass header, and the entitlement shim. |
| `lib/payload.mjs` | What the page actually downloaded, measured — not cited. |

Artifacts land in `.visual-harness/` (gitignored, same convention as
`.gate-shots/`). Regenerate them; never commit them.

### The two probes ASSERT, and the captures do not

`capture-decke.mjs` deliberately asserts nothing — it produces artifacts a human
can be wrong in front of, because a script that both takes the photograph and
grades it grades its own homework. The probes are the other kind of instrument
and exist because two defects from the 2026-08-24 review cannot be settled by
looking at pictures:

- **"He grew for no reason"** is a claim about a RATIO, and no contact sheet of
  a twenty-minute session can hold both sides of it. `probe-decke-size.mjs`
  reads it off the pixels: 1.281 before the fix, 0.995 after, same machine, same
  minute, two dev servers.
- **"He makes to stop before continuing"** is a shape in TIME, roughly 60 ms
  long. `probe-decke-flight.mjs` samples every frame instead.

**Run the flight probe `--headed`.** Headless Chromium throttles
`requestAnimationFrame` to about 5 Hz here — measured, 200 ms between samples —
which is coarser than the entire defect. Headless it reported a clean leg on a
build that stalls to a dead stop 4 times out of 4; headed, at 180 fps, it found
it every run. This is the same trap `character/decke/README.md` records for
float measurements, arriving down a different path.

**Both probes want a CONTROL.** A probe that has never failed is a probe that
cannot fail. Cut a second worktree at the commit before the fix, run a second
dev server on another port, and run the probe against both:

```bash
git -C <repo> worktree add --detach ../wt-base <commit-before>
# install, start it on 5211, then:
node scripts/visual-harness/probe-decke-flight.mjs --base http://localhost:5211 --headed
```

## Looking at Deck-E

Every chat surface is behind `AuthGuard` **and** behind an entitlement check, so
the signed-out smoke run cannot photograph one. `capture-decke.mjs` signs in as
the QA account and captures named **scenes**:

```bash
node scripts/visual-harness/capture-decke.mjs --list
node scripts/visual-harness/capture-decke.mjs --base http://localhost:5199 --scene idle --run before
node scripts/visual-harness/capture-decke.mjs --base http://localhost:5199 --scene all
```

`--run <name>` puts the artifacts under `.visual-harness/<name>/`, which is how
a before/after pair is made: capture `--run before`, make the change, capture
`--run after`, then compare — by eye, or with `judge-motion.mjs` on the pair.

Each scene writes a `notes.json` beside its images with three things a
screenshot alone cannot tell you:

- **`presence`** — is the 3D body on screen, is the launcher chip on screen, and
  are *both* (`twoDeckEs`, an invariant `DeckeHost.tsx:433-436` states in its own
  comment and which the idle page currently violates).
- **`characterPayload`** — how many bytes of character runtime this page pulled
  and when the first request fired. An eagerly-loaded character and a lazily-
  loaded one look identical in a photograph; the difference is entirely in the
  wire, so the wire is recorded.
- **`entitlementShimFired`** — whether `/api/me` had to be rewritten for the
  chat to render at all. **Read it.** A run where it fired is a run where the
  client was told something the server does not agree with.

A scene may also carry an **`assert`** — the one falsifiable claim its artifact
exists to settle, written the way `judge-motion.mjs --assert` wants it. `--list`
prints it, `notes.json` records it, and after the capture the runner prints the
exact command with the artifact path already filled in. It is **not run for
you**: `judge-motion.mjs` is optional by design (see below), and a capture that
refused to finish without a vision model would take that away from every scene
at once.

Write assertions to the instrument's own standard — *one claim a human could
settle in two seconds by looking.* "He looks good" is not judgeable; "his body
is roughly upright" is. The field exists because D8's assertion was asked for in
as many words during this pass, nobody wrote it, and `grep -rn 'upright\|tilt'
scripts/` came back empty a whole phase later.

Scenes also write a `.review.jpg` next to the full-resolution PNG. Open that
one: the PNG is the evidence, the JPEG is the thing a person (or a vision model)
can actually read without an image-processing step in between.

**B12 applies with teeth here.** This signs in, `pnpm dev` proxies to the live
backend, and the session is real. It runs as the QA account from `.qa-account`,
never the owner's. No scene sends a message or approves a write; one that wants
to must set `writes: true` so `--list` says so.

## Prerequisites

**Playwright** is deliberately *not* a dependency of this repo — CI installs
with `--frozen-lockfile`, and adding it would tax every build for a tool only an
operator runs by hand. Install it anywhere outside the repo and point at it:

```bash
mkdir -p /c/tmp/pw && cd /c/tmp/pw && npm install playwright && npx playwright install chromium
export PLAYWRIGHT_MODULE=/c/tmp/pw/node_modules/playwright
```

**ffmpeg**, for contact sheets only — and note that Playwright's *bundled*
ffmpeg is not one: it is a stripped build with the webm muxer and no image
decoder, so pointing at it fails with "Invalid data found when processing
input". Any ordinary ffmpeg works; the cheapest way to get one without touching
the repo is the same scratch-folder trick Playwright uses:

```bash
cd /c/tmp/pw && npm install ffmpeg-static
export FFMPEG_PATH=/c/tmp/pw/node_modules/ffmpeg-static/ffmpeg.exe
```

Override the paths if yours differ:

```bash
export FFMPEG_PATH=/path/to/ffmpeg.exe
export FFPROBE_PATH=/path/to/ffprobe.exe
```

**AI_GATEWAY_API_KEY** — **optional**, and only for automated judging. Read from
the environment, falling back to the gitignored `.env.prod` / `.env`. This is
the **shared** gateway key, deliberately not `DECKE_VERCEL_AI_GATEWAY_KEY` —
Deck-E's own key exists so his per-user spend stays legible (`api/chat.mjs`
explains why they are separate), and dev tooling must not pollute that number.
The key is never printed or logged.

**Without a vision model the harness still works.** Screenshots, videos, contact
sheets, timings and console logs need no key at all. `judge-motion.mjs` will
build the contact sheet, print where it is, and exit `3` — a code distinct from
both "fail" and "error", so a calling script can tell *"the change is wrong"*
apart from *"nobody checked"*. Collapsing those two is how an unverified change
gets recorded as a passing one. Pass `--require-judge` if a missing model
genuinely should be a hard failure in your context.

## Running it

```bash
# start the app first — `pnpm dev` proxies to the LIVE backend (contract B12)
pnpm dev

PLAYWRIGHT_MODULE=/c/tmp/pw/node_modules/playwright \
  node scripts/visual-harness/run-visual-smoke.mjs --base http://localhost:5199

# one platform only
... run-visual-smoke.mjs --base http://localhost:5199 --only desktop
... run-visual-smoke.mjs --base http://localhost:5199 --only mobile
```

**B12 applies.** `pnpm dev` talks to production. These specs are signed-out and
read-only. Anything that needs a signed-in session must use the QA account from
`.qa-account`, never the owner's — and that is a decision for a human, not
something a spec should reach for on its own.

## Judging motion

A vision model cannot watch a `.webm`, so a video is first tiled into a contact
sheet — frames in time order, left to right, top to bottom.

```bash
# explore: what changed?
node scripts/visual-harness/judge-motion.mjs run/open.webm \
  --describe "What happens to the 3D character across this sequence?"

# gate: settle one falsifiable claim
node scripts/visual-harness/judge-motion.mjs run/open.webm \
  --assert "the character is absent at the start, scales up from nothing, then travels across the screen"

# compare two stills
node scripts/visual-harness/judge-motion.mjs before.png after.png \
  --assert "the backdrop in the second image is more blurred and darker than in the first"
```

Useful options: `--frames 12`, `--tile 400`, `--context "..."`, `--model <id>`,
`--out <dir>`, `--require-judge`.

Exit codes:

| Code | Meaning |
|---|---|
| 0 | pass |
| 1 | fail |
| 2 | unclear — the images don't settle it |
| 3 | no vision model configured; the artifact was still produced |
| 4 | error (bad arguments, missing file, ffmpeg not found) |

### How to use verdicts honestly

- **Assert things a human could settle by looking for two seconds** — "is the
  character facing left or right", "is there a gap below the input". Not
  "does this feel polished".
- **A `fail` is a reason to go and look, not a fact.** The raw answer and the
  model id are in the output so a human can overrule it.
- **`unclear` is a real answer.** The prompt pushes toward it deliberately: a
  confident wrong verdict is worse than an admission, because the entire point
  is to catch the case where the implementer's belief and the pixels disagree.
- **Write the claim so that failure is possible.** "the layout looks correct"
  cannot fail. "the composer's bottom edge is at least 30px above the bottom of
  the screen" can.
- **Don't loop it.** Roughly $0.01–$0.03 per call.

## What Chromium can and cannot prove about iOS

Verified, not assumed:

- **Safe-area insets work.** CDP `Emulation.setSafeAreaInsetsOverride` makes
  `env(safe-area-inset-top)` resolve to a real value (measured: `47px` top,
  `34px` bottom against the live page, versus Chromium's `0px` default). This is
  what makes the chat overlay's missing safe-area padding visible in
  automation at all.
- **`display-mode: standalone` via CDP does NOT work.** The
  `Emulation.setEmulatedMedia` feature is accepted without error and then has no
  effect — `matchMedia('(display-mode: standalone)').matches` stays `false`
  after reload. `lib/pwa-emulation.mjs` shims `matchMedia` and
  `navigator.standalone` in an init script instead, which covers DeckPal's only
  standalone check (`PwaUi.tsx`, a JS one). **If the app ever adds a real CSS
  `@media (display-mode: standalone)` rule, re-verify this** — the shim will not
  cover it.
- **A real device is still the final word** for `backdrop-filter` compositing
  under a translucent status bar (`viewport-fit=cover` +
  `apple-mobile-web-app-status-bar-style: black-translucent`, `index.html:5,13`).
  Chromium approximates the geometry; it does not reproduce the compositing.

Per `AGENTS.md` verification standard 1, UI changes are checked at desktop width
**and** 390px, and you actually look at them. This harness makes that repeatable
and gives an agent a way to be caught out; it does not replace looking.
