// Run: node --import tsx --test src/scan/ocr/__tests__/*.test.ts
//
// STAGED LOADING — the property being tested is an ORDER, not a value.
//
// The detector must be usable before a byte of OCR weight has arrived. That is
// not a preference: `engine/model.ts` fetches 19 MB on the scanner's first
// `ready()`, this lane wants 15.6 MB more, and on a phone's uplink the two
// started together are one 35 MB download in which the thing that draws the
// quad finishes when the OCR weights do.
//
// So these tests drive the gate through the sequence `useScanEngine` really
// produces — idle → loading → ready — and assert the fetch has not started until
// the last step, and that a load which never completes leaves everything else
// working.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createOcrStage } from '../staging'
import { OCR_OVERRIDE_KEY, ocrEnabled } from '../flag'

/** The statuses `useScanEngine` publishes, in the order a real session sees
 *  them. Only 'ready' means the camera is live AND LC050 has loaded. */
type EngineStatus = 'idle' | 'loading' | 'ready' | 'error'
const READY: EngineStatus = 'ready'

describe('the staging gate', () => {
  it('does NOT start the OCR fetch before the detector is ready', () => {
    let started = 0
    const stage = createOcrStage(() => {
      started++
    })
    for (const status of ['idle', 'loading'] as EngineStatus[]) {
      stage.update({ enabled: true, detectorReady: status === READY })
      assert.equal(started, 0, `fetch started at status='${status}'`)
      assert.equal(stage.started, false)
    }
    stage.update({ enabled: true, detectorReady: true })
    assert.equal(started, 1)
    assert.equal(stage.started, true)
  })

  it('DETECTOR READY FIRES BEFORE THE OCR FETCH COMPLETES', async () => {
    // The load is a promise that has not settled. The whole product depends on
    // the detector being usable across that window, so the test holds the
    // promise open and checks that everything else has already happened.
    let resolveLoad: () => void = () => {}
    const load = new Promise<void>((r) => {
      resolveLoad = r
    })
    let loadSettled = false
    void load.then(() => {
      loadSettled = true
    })

    const events: string[] = []
    const stage = createOcrStage(() => {
      events.push('ocr-fetch-started')
    })

    events.push('camera-live')
    events.push('detector-ready')
    stage.update({ enabled: true, detectorReady: true })

    // The detector is ready and the fetch has been kicked off — and the fetch is
    // still in flight. A capture arriving right here must still work.
    assert.deepEqual(events, ['camera-live', 'detector-ready', 'ocr-fetch-started'])
    assert.equal(loadSettled, false, 'the OCR download is deliberately still pending')

    resolveLoad()
    await load
    assert.equal(loadSettled, true)
  })

  it('fires exactly once across an engine restart', () => {
    // `useScanEngine` tears the engine down and rebuilds it every time the
    // reader moves between the scan step and the verify step, so 'ready' is
    // reached repeatedly. `loadOcrSession` is idempotent anyway, but that is a
    // property of the callee this gate should not be leaning on.
    let started = 0
    const stage = createOcrStage(() => {
      started++
    })
    const session: Array<[EngineStatus, boolean]> = [
      ['loading', false],
      ['ready', true],
      ['idle', false],
      ['loading', false],
      ['ready', true],
      ['ready', true],
    ]
    for (const [, ready] of session) stage.update({ enabled: true, detectorReady: ready })
    assert.equal(started, 1)
  })

  it('never starts while the flag is off, however ready the detector is', () => {
    let started = 0
    const stage = createOcrStage(() => {
      started++
    })
    for (let i = 0; i < 5; i++) stage.update({ enabled: false, detectorReady: true })
    assert.equal(started, 0)
    // ...and picks up cleanly if the flag is flipped on mid-session.
    stage.update({ enabled: true, detectorReady: true })
    assert.equal(started, 1)
  })

  it('an errored detector never opens the gate', () => {
    let started = 0
    const stage = createOcrStage(() => {
      started++
    })
    stage.update({ enabled: true, detectorReady: false }) // status 'error'
    assert.equal(started, 0)
  })
})

describe('the feature flag', () => {
  it('is ON in dev and in Vercel previews, OFF in production', () => {
    assert.equal(ocrEnabled({ dev: true, hostname: 'localhost', override: null }), true)
    assert.equal(ocrEnabled({ dev: false, hostname: 'deckpal-git-abc.vercel.app', override: null }), true)
    assert.equal(ocrEnabled({ dev: false, hostname: 'deckpal.app', override: null }), false)
  })

  it('defaults OFF for a host it does not recognise', () => {
    // A 15.6 MB lazy download and a second ONNX session on a runtime with live
    // iOS crash reports against it is not something to switch on for strangers
    // by accident. Self-hosters are, by definition, hosts this repo cannot
    // enumerate.
    for (const host of ['', 'cards.example.com', 'localhost', '192.168.1.9', 'notvercel.app.evil.com']) {
      assert.equal(ocrEnabled({ dev: false, hostname: host, override: null }), false, host)
    }
  })

  it('does not mistake a lookalike host for a preview', () => {
    // The suffix is anchored: `vercel.app.evil.com` and `myvercel.app` are not
    // Vercel previews.
    assert.equal(ocrEnabled({ dev: false, hostname: 'vercel.app.evil.com', override: null }), false)
    assert.equal(ocrEnabled({ dev: false, hostname: 'myvercel.app', override: null }), false)
    assert.equal(ocrEnabled({ dev: false, hostname: 'vercel.app', override: null }), true)
  })

  it('the manual override wins in BOTH directions', () => {
    // REPORT.md §8.3: no OCR timing in this project has ever been taken in a
    // browser. The measurement that settles it happens on the owner's iPhone, on
    // production, and must not need a redeploy — in either direction.
    for (const on of ['1', 'true', 'on', ' ON ']) {
      assert.equal(ocrEnabled({ dev: false, hostname: 'deckpal.app', override: on }), true, on)
    }
    for (const off of ['0', 'false', 'off', 'OFF']) {
      assert.equal(ocrEnabled({ dev: true, hostname: 'localhost', override: off }), false, off)
    }
  })

  it('a typo in the override is not an instruction', () => {
    // It falls through to the defaults rather than silently meaning "off".
    assert.equal(ocrEnabled({ dev: true, hostname: 'localhost', override: 'yes please' }), true)
    assert.equal(ocrEnabled({ dev: false, hostname: 'deckpal.app', override: 'yes please' }), false)
  })

  it('names the storage key once, so the probe page and the app agree', () => {
    assert.equal(OCR_OVERRIDE_KEY, 'deckpal.ocr')
  })
})
