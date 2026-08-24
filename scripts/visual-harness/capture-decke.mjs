#!/usr/bin/env node
/**
 * Photograph Deck-E, signed in, on both platforms — the instrument every visual
 * claim about the chat depends on.
 *
 * ── WHAT THIS IS FOR ─────────────────────────────────────────────────────────
 *
 * `decke-gates.mjs` answers *"did it actually happen?"* by hooking the network.
 * `run-visual-smoke.mjs` proves this harness works, signed out, on the public
 * landing page. Neither can answer *"does the chat look right?"*, because the
 * chat is behind auth and behind an entitlement check — so this is the first
 * thing in the repo that can produce evidence about a Deck-E surface at all.
 *
 * It ASSERTS NOTHING on its own. It produces artifacts a human (or, through
 * `judge-motion.mjs`, a vision model) can be wrong in front of. That division
 * is deliberate: a script that both takes the photograph and grades it is a
 * script that grades its own homework.
 *
 * ── SCENES ───────────────────────────────────────────────────────────────────
 *
 * A scene is a named situation worth looking at, and every phase of the Deck-E
 * experience pass adds the scenes it needs rather than adding a script. Scenes
 * that capture a BEFORE are as valuable as the after: run one against the
 * current build, keep the artifact, run it again after the change.
 *
 *   node scripts/visual-harness/capture-decke.mjs --list
 *   node scripts/visual-harness/capture-decke.mjs --scene chat-open
 *   node scripts/visual-harness/capture-decke.mjs --scene all --only desktop
 *   node scripts/visual-harness/capture-decke.mjs --scene chat-open --run before
 *
 * ── SAFETY (AGENTS.md B12) ───────────────────────────────────────────────────
 *
 * This signs in. `pnpm dev` proxies to the LIVE backend, so the session is real
 * and so is anything it touches. It runs as the QA account from `.qa-account`
 * and never the owner's. Scenes here read and look; none of them sends a
 * message or approves a write, and a scene that wants to must say so in its own
 * `writes: true` flag so `--list` shows it and this header stays true.
 *
 * ── PREREQUISITES ────────────────────────────────────────────────────────────
 *
 *   pnpm dev                                          # or --base <a deployment>
 *   export PLAYWRIGHT_MODULE=/c/tmp/pw/node_modules/playwright
 *   .qa-account present at the repo root
 */
import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { resolvePlaywright } from './lib/resolve-playwright.mjs'
import { DESKTOP_PROFILE, mobileProfile } from './lib/devices.mjs'
import { captureForReview, captureScreenshots, captureViewport } from './lib/screenshot.mjs'
import { recordInteraction } from './lib/video.mjs'
import { buildContactSheet } from './lib/contact-sheet.mjs'
import { attachDiagnostics } from './lib/diagnostics.mjs'
import { TimingReport } from './lib/timing.mjs'
import {
  applySafeAreaInsets,
  applyStandaloneShim,
  IPHONE_14_PRO_PORTRAIT_INSETS,
} from './lib/pwa-emulation.mjs'
import { HOME_PATH, bypassHeaders, openDeckE, qaAccount, signIn, unlockDeckE } from './lib/session.mjs'
import { fmtBytes as fmtPayload, recordPayload } from './lib/payload.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..')

const argv = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback
}
const flag = (name) => argv.includes(`--${name}`)

const BASE = arg('base', 'http://localhost:5199').replace(/\/$/, '')
const RUN = arg('run', 'decke')
const OUT = arg('out', join(repoRoot, '.visual-harness', RUN))
const HEADED = flag('headed')
const ONLY = arg('only', 'all')
const WIDE = Number(arg('width', 1440))
const TALL = Number(arg('height', 900))
/**
 * `--reduced` runs the whole capture under `prefers-reduced-motion: reduce`.
 *
 * X1 says the reduce path ships in the same commit as the motion, which means
 * it has to be LOOKED AT in the same sitting — and reduced motion is the one
 * class of change where "it still renders" is not the question. The interesting
 * failures are a loading state that removed its only signal and now looks
 * frozen, and an entrance that was skipped so thoroughly the character never
 * arrives at all.
 */
const REDUCED = flag('reduced')

// ── The scenes ───────────────────────────────────────────────────────────────

/**
 * @typedef {object} Scene
 * @property {string} name
 * @property {string} what          - what a reader is meant to look for
 * @property {('desktop'|'mobile')[]} platforms
 * @property {boolean} [video]      - record the act, and build a contact sheet
 * @property {number} [frames]      - contact-sheet frames; more for fast motion
 * @property {boolean} [writes]     - true if the scene can write to the account
 * @property {string} [assert]      - the V4 claim this scene's artifact answers
 * @property {(ctx: object) => Promise<void>} act
 */

/**
 * ── `assert`: THE V4 CLAIM, CARRIED WITH THE SCENE ───────────────────────────
 *
 * `what` tells a reader what to look for. `assert` is the same thing said as a
 * single falsifiable claim, in the form `judge-motion.mjs --assert` takes, so
 * the check is a command rather than an intention. `runScene` prints that exact
 * command line after it builds the artifact and records the claim in
 * `notes.json`, which means a scene's assertion cannot quietly go missing the
 * way D8's did — it was asked for in as many words, nobody wrote it, and
 * `grep -rn 'upright\|tilt\|tumbl' scripts/` was empty for a whole pass.
 *
 * IT IS NOT RUN HERE, and that is deliberate. `judge-motion.mjs` is optional by
 * design (no `AI_GATEWAY_API_KEY` → contact sheet + exit 3, "nobody checked" as
 * distinct from "the change is wrong"), and a capture that refused to finish
 * without a vision model would take that property away from every scene at
 * once. So the capture produces the artifact and hands over the command.
 *
 * ONE CLAIM A HUMAN COULD SETTLE IN TWO SECONDS BY LOOKING. That is the
 * instrument's own stated standard and it is the whole discipline: "he looks
 * good" is not judgeable, "his body is roughly upright" is.
 */

/** @type {Scene[]} */
const SCENES = [
  {
    name: 'idle',
    what:
      'The page as a visitor finds it: the launcher chip and nothing else. ' +
      'Two things to check — the chip is the ONLY Deck-E on screen (a 3D body ' +
      'here as well is the "two Deck-Es" defect), and the network log shows ' +
      'whether the 7.1 MB runtime loaded without being asked for.',
    platforms: ['desktop', 'mobile'],
    async act({ page }) {
      // Long enough to be past the old idle/1.5 s auto-load window, so the
      // network log answers the A1 question rather than racing it.
      await page.waitForTimeout(6000)
    },
  },
  {
    name: 'chat-open',
    what:
      'The chat, open, with an empty conversation — the most-seen screen in ' +
      'the feature. Look at: where the composer sits, whether the composer ' +
      'reads as a card or as a pill floating on the scrim, how strong the ' +
      'scrim is, whether the app header stays sharp, and on mobile whether ' +
      'anything is under the notch or the home indicator.',
    platforms: ['desktop', 'mobile'],
    async act({ page, timing, notes }) {
      timing.mark('open:click')
      await openDeckE(page)
      timing.measure('open:click-to-composer', 'open:click')
      notes.characterArrival = await waitForCharacter(page)
      notes.characterSettled = await waitForSettled(page)
      // The panel's entrance is 320 ms and he flies after arriving; this
      // photographs the settled state, not the transition (see `chat-entry`).
      await page.waitForTimeout(1200)
    },
  },
  {
    name: 'chat-entry',
    what:
      'The open transition, as motion. The entrance is CONCURRENT since the ' +
      '2026-08-24 pass: he grows out of the launcher chip in the corner WHILE ' +
      'the panel plays its own entrance, and the hop to his stand point ' +
      'launches as the panel settles, overlapping the tail of the grow — ' +
      '"chat window up → wait → ok, I\'m coming" is the exact staging this ' +
      'replaced. The whole beat is ~0.7-1 s now, so judge this with frames ' +
      'DENSE enough to catch it (24+; the judge\'s 9-frame default reads a ' +
      'fast entrance as a teleport and fails honest work).',
    platforms: ['desktop', 'mobile'],
    video: true,
    frames: 24,
    assert:
      'the character is absent at first, then present and at or near full ' +
      'size beside the text input by the end, and at least one intermediate ' +
      'frame shows it partially grown or between positions — it never blinks ' +
      'from absent straight to settled with no frame of motion in between',
    async act({ page }) {
      // WARM FIRST, AND WAIT FOR THE RUNTIME, so the recording is of the
      // ENTRANCE and not of the download. This was the first version's mistake
      // and it made the artifact useless rather than wrong: a five-second clip
      // of a seven-megabyte fetch, sampled at twelve frames, puts about 400 ms
      // between frames — and the grow is around 325 ms, so it could fall
      // entirely between two of them. The judge then reports, correctly, that
      // it never saw a character scale up.
      //
      // The download has its own scene (`cold-open`). This one is about what
      // happens after it.
      await page.getByRole('button', { name: 'Chat with Deck-E' }).hover()
      await page
        .waitForFunction(() => !!window.__decke, undefined, { timeout: 60_000 })
        .catch(() => {})
      await page.waitForTimeout(1200) // let the load settle, off camera
      await page.waitForTimeout(300) // a beat of "before"
      await openDeckE(page)
      await page.waitForTimeout(1800) // the grow (~325ms) and the flight
    },
  },
  {
    name: 'close-reopen',
    what:
      'D8, which was filed and then never looked at. Closing the panel sends ' +
      'him home across the page (`DeckeHost.tsx` → `returnHome`); reopening ' +
      'cuts him to the launcher, grows him, and flies him to his mark. Both ' +
      'legs are long, and the flight layer leans by ACCELERATION — so the ' +
      'question is whether the lean reads as banking or as tumbling. The ' +
      'owner caught him at 25-35 degrees off vertical in both directions.\n' +
      'Look at the contact sheet for a frame where his body is diagonal ' +
      'enough that you would describe him as falling rather than flying.',
    platforms: ['desktop', 'mobile'],
    video: true,
    // The two flights are ~940 ms and ~1050 ms at the shipped desktop framing,
    // inside a clip of about seven seconds. At 12 frames the extreme pose can
    // fall between two samples — which is how a real tilt gets reported as
    // "never saw one". 20 puts a frame roughly every 350 ms.
    frames: 20,
    assert:
      'the character stays roughly upright throughout — there is no frame in ' +
      'which its body is tilted far enough off vertical to read as tumbling',
    async act({ page, timing, notes }) {
      // Warm off camera, for the reason `chat-entry` gives at length: a clip of
      // a seven-megabyte download sampled at twenty frames has no motion in it.
      await page.getByRole('button', { name: 'Chat with Deck-E' }).hover()
      await page
        .waitForFunction(() => !!window.__decke, undefined, { timeout: 60_000 })
        .catch(() => {})
      await page.waitForTimeout(1200)

      await openDeckE(page)
      notes.characterArrival = await waitForCharacter(page)
      notes.characterSettled = await waitForSettled(page)
      // Let him finish arriving and stand still, so the clip separates the
      // ENTRANCE from the two legs this scene is about.
      await page.waitForTimeout(1400)

      timing.mark('close')
      // ── TWO ELEMENTS CARRY THIS LABEL, AND `.first()` PICKED THE WRONG ONE ──
      //
      // The scrim (`DeckeChat.tsx:771`) and the header's X (`:864`) are both
      // `aria-label="Close chat"` — the scrim so that tapping the blurred page
      // dismisses him. `.first()` resolved to the scrim, which the panel then
      // intercepts pointer events for, so the click retried until it timed out
      // and the scene could never run. Exactly the shared-label trap that once
      // made `readPresence` report the launcher visible while it was unmounted.
      //
      // The header button is inside the dialog; the scrim is not.
      await page
        .getByRole('dialog', { name: 'Chat with Deck-E' })
        .getByRole('button', { name: 'Close chat' })
        .click({ timeout: 5000 })
      // `returnHome` is ~940 ms at the shipped desktop framing and the canvas
      // then fades and he is scaled to nothing 520 ms later — so this covers the
      // whole close, including the part where he is meant to be gone.
      await page.waitForTimeout(2000)
      timing.measure('close:to-gone', 'close')

      timing.mark('reopen')
      await openDeckE(page)
      timing.measure('reopen:click-to-composer', 'reopen')
      // The panel's entrance is 320 ms, the grow ~325 ms, and the flight to his
      // mark ~1050 ms. This is that, plus a beat of him standing still at the
      // end so the last frames show the pose he SETTLES into.
      await page.waitForTimeout(2600)
    },
  },
  {
    name: 'chat-exit',
    what:
      'The close, as motion — the owner: "he should remain exactly where he ' +
      'was but quickly jump back to his chat bubble and scale down to zero so ' +
      'that it looks like he\'s jumping into his chat bubble/hiding," and ' +
      '"Chat window should also animate out, always, rather than simply ' +
      'disappearing." The 2026-08-23 recording measured the opposite of both: ' +
      'the panel unmounted in one frame, he LEFT the viewport (the off-screen ' +
      'beacon fired), grew from 260 to 452 px on the way back, and vanished in ' +
      'a 70 ms cut at full size. `scaleTo` now drives the shrink from the ' +
      'flight\'s own progress, so a mid-air wink-out is structurally ' +
      'impossible — this scene is the claim that stays true.',
    platforms: ['desktop', 'mobile'],
    video: true,
    // The dive is ~500-900 ms inside a clip of about four seconds; 16 frames
    // puts a sample roughly every 250 ms, tight enough that "vanished in one
    // frame from mid-screen" cannot hide between samples.
    frames: 16,
    assert:
      'after the chat closes, the character moves toward the launcher button ' +
      'in the bottom-right while getting smaller, and is last seen small at ' +
      'or near the button — it never disappears abruptly at full size in the ' +
      'middle of the screen, and it never grows during the trip',
    async act({ page }) {
      // Warm off camera — see `chat-entry` for why at length.
      await page.getByRole('button', { name: 'Chat with Deck-E' }).hover()
      await page
        .waitForFunction(() => !!window.__decke, undefined, { timeout: 60_000 })
        .catch(() => {})
      await page.waitForTimeout(1200)
      await openDeckE(page)
      await waitForCharacter(page)
      await waitForSettled(page)
      // A beat of him standing on his mark, so the clip has a clean "before".
      await page.waitForTimeout(900)
      // The header X, not the scrim — see `close-reopen` for the shared-label
      // trap in full.
      await page
        .getByRole('dialog', { name: 'Chat with Deck-E' })
        .getByRole('button', { name: 'Close chat' })
        .click({ timeout: 5000 })
      // The dive plus the farewell line's dwell, and a beat of "after" where
      // only the launcher chip should be on screen.
      await page.waitForTimeout(3200)
    },
  },
  {
    name: 'answering',
    what:
      'A real question, asked and answered — the scene that shows the ' +
      'transcript doing its job. A thinking row that appears immediately and ' +
      'keeps counting; tool rows in the order the calls actually happened; his ' +
      'answer as rendered markdown rather than one raw paragraph. Look for ' +
      'anything that stops changing while work is still going on.',
    platforms: ['desktop', 'mobile'],
    // IT ASKS HIM A QUESTION, so it spends a metered turn on the QA account and
    // puts a real request on the live backend. Read-only — "how many cards do I
    // have" reaches no write tool and needs no approval — but not free, and a
    // scene that costs something should say so where `--list` shows it.
    writes: false,
    async act({ page, timing, notes, dir }) {
      const composer = await openDeckE(page)
      notes.characterArrival = await waitForCharacter(page)
      timing.mark('ask')
      await composer.fill('How many cards do I have in Pitch Black?')
      await composer.press('Enter')
      // PHOTOGRAPH THE WAIT, not only the answer. The thinking row is the
      // point of this scene and it exists only while he is working, so a
      // capture taken after he finishes cannot show whether it was ever there.
      await page.waitForTimeout(1500)
      await captureForReview(page, dir, 'answering.mid-turn')
      const settled = await page
        .waitForFunction(() => !document.querySelector('[data-decke-thinking]'), undefined, {
          timeout: 120_000,
        })
        .then(() => true)
        .catch(() => false)
      timing.measure('ask:to-settled', 'ask')
      notes.turnSettled = settled
      await page.waitForTimeout(900)
    },
  },
  {
    name: 'journey',
    what:
      'He is asked to take someone somewhere. The transcript should record ' +
      'the MOVEMENT — where he went, what he outlined, what he pressed — not ' +
      'just his words about it. Before this pass it recorded nothing at all ' +
      'of a journey, because the movement tools run in the browser and only ' +
      'the server ever emitted a row.',
    platforms: ['desktop'],
    writes: false,
    async act({ page, timing, notes, dir }) {
      const composer = await openDeckE(page)
      notes.characterArrival = await waitForCharacter(page)
      timing.mark('ask')
      await composer.fill('Take me to my decks')
      await composer.press('Enter')
      await page
        .waitForFunction(() => !document.querySelector('[data-decke-thinking]'), undefined, {
          timeout: 120_000,
        })
        .catch(() => {})
      timing.measure('ask:to-settled', 'ask')
      await page.waitForTimeout(1500)
      notes.finalUrl = page.url()
      // He minimises the transcript while he is out on the page, so the rows
      // are behind the bar. Expand it — the point of this scene is the record.
      await page
        .getByRole('button', { name: 'Back to the conversation' })
        .click({ timeout: 3000 })
        .catch(() => {})
      await page.waitForTimeout(900)
      await captureForReview(page, dir, 'journey.expanded')
    },
  },
  {
    name: 'failure-states',
    what:
      'What a call that FAILED and a call that ran out of time look like. ' +
      'Both must be louder than a success, both must say what went wrong in ' +
      'WORDS rather than only in colour, and both must offer a way to try ' +
      'again. This is the surface the owner read a timeout on and called "a ' +
      'great response" — he did not notice it had failed.',
    platforms: ['desktop', 'mobile'],
    async act({ page }) {
      // A SYNTHETIC STREAM, and it is the only honest way to see this today.
      //
      // `pnpm dev` proxies to the LIVE backend, so the server that answers here
      // is production — which does not yet emit `partial`, because that change
      // is in this branch and not deployed. Waiting for a real timeout would
      // also mean waiting out a 210-second budget and hoping it fires.
      //
      // So the transport is faked and NOTHING ELSE IS: these are real
      // `data-decke-tool` parts in the real wire format, rendered by the real
      // renderer. What this proves is exactly "the client draws a failure
      // loudly", which is the half that lives in this repo's web app. It
      // proves nothing about whether the server sends them — that is the
      // server's own tests' job, and it is worth being clear about which is
      // which.
      const sse = (o) => `data: ${JSON.stringify(o)}\n\n`
      await page.route('**/api/chat', async (route) => {
        await route.fulfill({
          status: 200,
          headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' },
          body:
            sse({ type: 'text-delta', delta: 'Let me look at the whole collection.' }) +
            sse({
              type: 'data-decke-tool',
              data: { phase: 'start', id: 't1', name: 'analyse', title: 'Analyse the collection' },
            }) +
            sse({
              type: 'data-decke-tool',
              data: {
                phase: 'partial',
                id: 't1',
                name: 'analyse',
                title: 'Analyse the collection',
                reason: 'timeout',
                summary: 'Read 300 of 604 cards before the deadline.',
              },
            }) +
            sse({
              type: 'data-decke-tool',
              data: { phase: 'start', id: 't2', name: 'search_cards', title: 'Search the card catalog' },
            }) +
            sse({
              type: 'data-decke-tool',
              data: {
                phase: 'error',
                id: 't2',
                name: 'search_cards',
                title: 'Search the card catalog',
                summary: 'The catalog did not answer in time.',
              },
            }) +
            sse({
              type: 'data-decke-tool',
              data: {
                phase: 'ok',
                id: 't3',
                name: 'set_progress',
                title: 'Check set completion',
                summary: 'Pitch Black (me05): 13 of 120 complete.',
              },
            }) +
            sse({ type: 'text-delta', delta: '\n\nI could only get part of the way through.' }),
        })
      })
      const composer = await openDeckE(page)
      await composer.fill('Analyse my whole collection')
      await composer.press('Enter')
      await page.waitForTimeout(2200)
    },
  },
  {
    name: 'approval',
    what:
      'The consent card, segmented by PROVENANCE rather than by a confidence ' +
      'number. Section one is what he knows — plain rows, nothing to answer, ' +
      'a way to strike one out. Section two is "what was the variant on ' +
      'these?", where he genuinely does not know. No meter, because a ' +
      'miscalibrated confidence number measurably degrades decisions and ' +
      '~93% of permission prompts are approved regardless of content.',
    platforms: ['desktop', 'mobile'],
    async act({ page }) {
      // SYNTHETIC, and only the transport is. The preview part is in the real
      // wire format and is rendered by the real card. Production does not emit
      // these yet — the server half is in this branch and undeployed — and the
      // alternative, pointing a real write at the live backend to photograph a
      // dialog, is not a trade worth making.
      const sse = (o) => `data: ${JSON.stringify(o)}\n\n`
      const preview = {
        toolCallId: 'call_a7f3',
        tool: 'log_cards',
        title: 'Log collection changes',
        summary: 'log_cards DRY RUN — 3 item(s)',
        ok: true,
        editable: true,
        rows: [
          {
            index: 0, cardId: 'me05-014', cardName: 'Mega Gardevoir ex', setId: 'me05', number: '014',
            certainty: 'stated', candidates: [], variantId: 37101, variantLabel: 'Normal',
            mode: 'delta', value: 1, before: 0, after: 1, clamped: false,
          },
          {
            index: 1, cardId: 'me05-003', cardName: 'Fomantis', setId: 'me05', number: '003',
            certainty: 'only-one', candidates: [], variantId: 37110, variantLabel: 'Normal',
            mode: 'delta', value: 2, before: 1, after: 3, clamped: false,
          },
          {
            index: 2, cardId: 'me05-084', cardName: 'Pitch Black', setId: 'me05', number: '084',
            certainty: 'unstated',
            candidates: [
              { variantId: 37183, kindCode: 'normal', label: 'Normal', isPrimary: true, ownedQty: 0 },
              { variantId: 37184, kindCode: 'reverse', label: 'Reverse Holo', isPrimary: false, ownedQty: 2 },
            ],
            wouldUseVariantId: 37183, variantId: 37183, variantLabel: 'Normal',
            mode: 'delta', value: 1, before: 0, after: 1, clamped: false,
          },
        ],
        skipped: [],
      }
      await page.route('**/api/chat', async (route) => {
        await route.fulfill({
          status: 200,
          headers: { 'content-type': 'text/event-stream; charset=utf-8' },
          body:
            sse({ type: 'text-delta', delta: "Here's what I'd add." }) +
            sse({ type: 'data-decke-approval-preview', data: preview }) +
            sse({
              type: 'tool-input-available',
              toolCallId: 'call_a7f3',
              toolName: 'log_cards',
              input: { items: [{}, {}, {}] },
            }) +
            sse({ type: 'tool-approval-request', approvalId: 'ap_1', toolCallId: 'call_a7f3', signature: 'x' }),
        })
      })
      const composer = await openDeckE(page)
      await waitForCharacter(page)
      await composer.fill('add a Mega Gardevoir, two Fomantis and a Pitch Black')
      await composer.press('Enter')
      await page.waitForTimeout(2500)
    },
  },
  {
    name: 'cold-open',
    what:
      'The tap-and-wait path, with NO warming hover — what a phone gets. ' +
      'Frames should show the chip in a loading state that reads as coming ' +
      'rather than broken, then the character arriving. The timing report ' +
      'says how long the wait actually was.',
    platforms: ['mobile'],
    video: true,
    async act({ page, timing, notes }) {
      await page.waitForTimeout(500)
      timing.mark('cold:tap')
      await openDeckE(page, { warm: false })
      timing.measure('cold:tap-to-composer', 'cold:tap')
      // THE NUMBER THIS SCENE EXISTS FOR: tap to character, with no warming
      // hover, which is what every phone gets now.
      notes.characterArrival = await waitForCharacter(page)
      timing.measure('cold:tap-to-character', 'cold:tap')
      await page.waitForTimeout(2200)
    },
  },
]

/**
 * Wait until the character is actually on screen, and say how long it took.
 *
 * A fixed `waitForTimeout` was the first version and it was wrong in both
 * directions: too short and the capture photographs an empty panel and reports
 * it as "the character did not appear", too long and every run pays for the
 * slowest case. Worse, neither tells you the number that this whole change is
 * about — how long somebody waits between tapping and Deck-E arriving.
 *
 * Returns `{ arrived, ms }`. `arrived: false` is a real answer, not an error:
 * a load can genuinely fail, and the capture should record that rather than
 * throw and lose every other artifact from the run.
 */
async function waitForCharacter(page, timeoutMs = 20_000) {
  const started = Date.now()
  try {
    await page.waitForFunction(
      () => {
        const c = document.querySelector('canvas.fixed.inset-0')
        return !!c && Number(getComputedStyle(c).opacity) > 0.99
      },
      undefined,
      { timeout: timeoutMs },
    )
    return { arrived: true, ms: Date.now() - started }
  } catch {
    return { arrived: false, ms: Date.now() - started }
  }
}

/**
 * Wait until he has stopped BOOTING, in dev builds where the handle exists.
 *
 * "The canvas is opaque" is not the same as "he looks like himself". He plays a
 * boot animation on start, with its own pose and its own gaze, and a capture
 * taken during it photographs a character mid-wake — which then gets read as
 * his resting appearance and reasoned about. That happened: his pupils were up
 * and away in a still meant to show him at rest, and the obvious inference was
 * that a thinking-gaze edit had leaked into idle. It had not; the scene was
 * simply early.
 *
 * Best-effort by design. `window.__decke` is DEV-only, so against a production
 * build this resolves immediately rather than failing — a capture that refuses
 * to run is worse than one that is occasionally early, as long as it says so.
 */
async function waitForSettled(page, timeoutMs = 12_000) {
  const started = Date.now()
  const settled = await page
    .waitForFunction(
      () => {
        const d = window.__decke
        if (!d?.getState) return true // production build: nothing to wait for
        return d.getState().state !== 'boot'
      },
      undefined,
      { timeout: timeoutMs },
    )
    .then(() => true)
    .catch(() => false)
  return { settled, ms: Date.now() - started }
}

// ── Runner ───────────────────────────────────────────────────────────────────

function fmtBytes(n) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

/**
 * Report a produced file, and flag one that is suspiciously small.
 *
 * A blank or torn capture is the failure mode that matters here, because unlike
 * a crash it produces a file, and a file is what a caller checks for.
 */
function reportArtifact(list, label, path, minBytes = 500) {
  const size = statSync(path).size
  const small = size < minBytes
  console.log(
    `    ${label}: ${relative(repoRoot, path)} (${fmtBytes(size)})${small ? '  ⚠ SUSPICIOUSLY SMALL' : ''}`,
  )
  list.push({ label, path, bytes: size, suspiciouslySmall: small })
}

/**
 * Hand over the V4 check as a command, not as a suggestion.
 *
 * Printed with the artifact path already filled in so it is copy-pasteable, and
 * with a reminder of the exit codes — because the useful one is 3. A caller who
 * gets 3 knows the artifact exists and NOBODY LOOKED, which is a different
 * state from a failure and the whole reason `judge-motion.mjs` degrades instead
 * of refusing.
 */
function printAssertion(scene, artifactPath) {
  if (!scene.assert) return
  const rel = relative(repoRoot, artifactPath).replace(/\\/g, '/')
  console.log(`    V4 claim: ${scene.assert.replace(/\s+/g, ' ')}`)
  console.log(
    `      node scripts/visual-harness/judge-motion.mjs ${rel} \\\n` +
      `        --assert "${scene.assert.replace(/\s+/g, ' ')}"`,
  )
  console.log('      (0 pass · 1 fail · 2 unclear · 3 no vision model configured · 4 error)')
}

/**
 * Everything that must be true before a page is worth photographing, in the one
 * order that works: the standalone shim and the safe-area override go on BEFORE
 * navigation (app code reads them from first paint), the entitlement unlock
 * goes on the context, and sign-in happens last.
 */
async function preparePage(page, context, platform) {
  if (platform === 'mobile') {
    await applyStandaloneShim(page)
    await applySafeAreaInsets(page, IPHONE_14_PRO_PORTRAIT_INSETS)
  }
  const diag = attachDiagnostics(page)
  const payload = recordPayload(page)
  await signIn(page, BASE, qaAccount())
  return { diag, payload }
}

/**
 * Read the safe-area insets back OFF the live page.
 *
 * Setting an override and trusting it is exactly the class of mistake this
 * harness exists to catch. Chromium's default is 0px on every edge, which is
 * indistinguishable from "the app has no safe-area handling" — so a mobile
 * capture is only evidence about safe areas if the insets are non-zero, and
 * this is what says whether they were.
 */
async function readSafeArea(page) {
  return page.evaluate(() => {
    const probe = document.createElement('div')
    probe.style.cssText =
      'padding-top:env(safe-area-inset-top,999px);padding-bottom:env(safe-area-inset-bottom,999px)'
    document.body.appendChild(probe)
    const s = getComputedStyle(probe)
    const out = {
      top: s.paddingTop,
      bottom: s.paddingBottom,
      standalone: window.matchMedia('(display-mode: standalone)').matches,
    }
    probe.remove()
    return out
  })
}

/**
 * How many Deck-Es are on screen, and whether the runtime loaded unasked.
 *
 * `button[aria-label="Chat with Deck-E"]`, WITH the tag name, and that is not
 * belt-and-braces. `DeckeChat.tsx:436` puts the identical aria-label on the
 * PANEL, so the obvious attribute-only selector matches the open conversation
 * and reports the launcher as visible in the very state the launcher is
 * unmounted — turning "two Deck-Es on screen" from a finding into an artifact
 * of the instrument. It did exactly that, and the only reason it was caught is
 * that somebody opened the screenshot and saw one chip where the JSON claimed
 * two. Which is the argument for this whole harness, aimed at itself.
 */
async function readPresence(page) {
  return page.evaluate(() => {
    const visible = (el) => {
      if (!el) return false
      const r = el.getBoundingClientRect()
      const s = getComputedStyle(el)
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && Number(s.opacity) > 0.01
    }
    const canvas = document.querySelector('canvas.fixed.inset-0')
    const launcher = document.querySelector('button[aria-label="Chat with Deck-E"]')
    const body = visible(canvas)
    const chip = visible(launcher)
    return {
      characterBodyVisible: body,
      launcherChipVisible: chip,
      // The invariant `DeckeHost.tsx:433-436` states in its own comment: the
      // chip is hidden while he is standing in the panel, because "two Deck-Es
      // is the exact thing the whole well design exists to avoid."
      twoDeckEs: body && chip,
    }
  })
}

async function runScene(browser, devices, scene, platform, timing) {
  const label = `${scene.name} · ${platform}`
  console.log(`\n  ── ${label} ─────────────────────────────`)
  const dir = join(OUT, scene.name, platform)
  mkdirSync(dir, { recursive: true })
  const artifacts = []
  const contextOptions = {
    ...(platform === 'mobile'
      ? mobileProfile(devices)
      : { ...DESKTOP_PROFILE, viewport: { width: WIDE, height: TALL } }),
    extraHTTPHeaders: bypassHeaders(),
    ...(REDUCED ? { reducedMotion: 'reduce' } : {}),
  }

  /** Recorded once per scene run and written beside the images. */
  const notes = { scene: scene.name, platform, what: scene.what, base: BASE, reducedMotion: REDUCED }
  if (scene.assert) notes.assert = scene.assert

  if (scene.video) {
    // A recorded context cannot be reused, so sign-in happens inside `interact`.
    const { path: videoPath } = await recordInteraction(
      browser,
      { contextOptions, dir, name: scene.name, keepOpenFor: 700 },
      async (page, context) => {
        const unlock = await unlockDeckE(context)
        const { diag, payload } = await preparePage(page, context, platform)
        await page.goto(`${BASE}${HOME_PATH}`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
        await scene.act({ page, context, timing, platform, notes, dir })
        notes.entitlementShimFired = unlock.fired()
        notes.presence = await readPresence(page)
        if (platform === 'mobile') notes.safeArea = await readSafeArea(page)
        notes.characterPayload = await payload.settle(page)
        diag.writeLog(join(dir, 'console-network.json'))
        await captureViewport(page, dir, `${scene.name}.final`)
        await captureForReview(page, dir, `${scene.name}.final`)
      },
    )
    reportArtifact(artifacts, 'video', videoPath, 5000)
    reportArtifact(artifacts, 'final frame', join(dir, `${scene.name}.final.png`))
    const sheet = await buildContactSheet(videoPath, join(dir, `${scene.name}.contact-sheet.png`), {
      frames: scene.frames ?? 12,
    })
    reportArtifact(
      artifacts,
      `contact sheet (${sheet.columns}×${sheet.rows}, ${sheet.frames} frames)`,
      sheet.path,
      5000,
    )
    printAssertion(scene, videoPath)
  } else {
    const context = await browser.newContext(contextOptions)
    const unlock = await unlockDeckE(context)
    const page = await context.newPage()
    try {
      const { diag, payload } = await preparePage(page, context, platform)
      await page.goto(`${BASE}${HOME_PATH}`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      await scene.act({ page, context, timing, platform, notes, dir })
      notes.entitlementShimFired = unlock.fired()
      notes.presence = await readPresence(page)
      if (platform === 'mobile') notes.safeArea = await readSafeArea(page)
      notes.characterPayload = await payload.settle(page)
      diag.writeLog(join(dir, 'console-network.json'))
      const shots = await captureScreenshots(page, dir, scene.name)
      reportArtifact(artifacts, 'viewport', shots.viewport)
      reportArtifact(artifacts, 'fullpage', shots.fullPage, 2000)
      reportArtifact(artifacts, 'review copy (open THIS one)', await captureForReview(page, dir, scene.name))
      printAssertion(scene, shots.viewport)
    } finally {
      await context.close()
    }
  }

  writeFileSync(join(dir, 'notes.json'), JSON.stringify(notes, null, 2))
  console.log(`    presence: ${JSON.stringify(notes.presence)}`)
  if (notes.characterSettled && !notes.characterSettled.settled) {
    console.log('    NOTE: he was still booting when photographed — the still is not his resting look.')
  }
  if (notes.characterArrival) {
    const a = notes.characterArrival
    console.log(`    character arrival: ${a.arrived ? `${a.ms} ms` : `NEVER (gave up after ${a.ms} ms)`}`)
  }
  if (notes.safeArea) console.log(`    safe area: ${JSON.stringify(notes.safeArea)}`)
  const cp = notes.characterPayload
  console.log(
    `    character runtime: ${cp.count} requests, ${fmtPayload(cp.bytes)}` +
      (cp.unmeasured ? ` (${cp.unmeasured} unmeasured)` : '') +
      (cp.firstAtMs == null ? ' — none' : `, first at ${cp.firstAtMs} ms`),
  )
  if (notes.entitlementShimFired) {
    console.log('    NOTE: the /api/me entitlement shim FIRED — this account is not really entitled.')
  }
  return artifacts
}

async function main() {
  if (flag('list')) {
    console.log('Scenes:\n')
    for (const s of SCENES) {
      console.log(`  ${s.name}  [${s.platforms.join(', ')}]${s.video ? ' (video)' : ''}${s.writes ? ' (WRITES)' : ''}`)
      console.log(`    ${s.what.replace(/\s+/g, ' ')}`)
      if (s.assert) console.log(`    V4: ${s.assert.replace(/\s+/g, ' ')}`)
      console.log('')
    }
    return
  }

  const want = arg('scene', null)
  if (!want) {
    console.error('Pass --scene <name> (or --scene all). --list shows what there is.')
    process.exitCode = 1
    return
  }
  const chosen = want === 'all' ? SCENES : SCENES.filter((s) => s.name === want)
  if (!chosen.length) {
    console.error(`No scene named "${want}". Known: ${SCENES.map((s) => s.name).join(', ')}`)
    process.exitCode = 1
    return
  }

  const { chromium, devices } = await resolvePlaywright()
  console.log(
    `Deck-E visual capture — base ${BASE}, out ${OUT}, headless=${!HEADED}\n` +
      'Signed in as the QA account (.qa-account) — never the owner. AGENTS.md B12.',
  )

  const browser = await chromium.launch({ headless: !HEADED })
  const timing = new TimingReport()
  const artifacts = []
  try {
    for (const scene of chosen) {
      for (const platform of scene.platforms) {
        if (ONLY !== 'all' && ONLY !== platform) continue
        artifacts.push(...(await runScene(browser, devices, scene, platform, timing)))
      }
    }
    timing.save(join(OUT, 'timing-report.json'))
  } finally {
    await browser.close()
  }

  console.log(`\nArtifacts under: ${OUT}`)
  if (artifacts.some((a) => a.suspiciouslySmall)) {
    console.error('\nOne or more artifacts were suspiciously small — look at them before trusting this run.')
    process.exitCode = 1
  } else if (!artifacts.length) {
    console.error('\nNo artifacts were produced — nothing was verified.')
    process.exitCode = 1
  } else {
    console.log('\nCapture OK. Now go and LOOK at them; this script asserted nothing.')
  }
}

main().catch((err) => {
  console.error('\nDeck-E visual capture FAILED:', err)
  process.exitCode = 1
})
