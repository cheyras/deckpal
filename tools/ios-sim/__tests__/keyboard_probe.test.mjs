// Pure tests for keyboard_probe.js's verdict logic -- no simulator, no real DOM. The probe
// script is plain browser JS (it has to be, since wir.py ships it to a page verbatim), so it's
// exercised here the same way Astra's own review verified its finding: run the script's source
// in a synthetic `window`/`document` via node:vm and check the returned verdicts.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PROBE_SOURCE = fs.readFileSync(path.join(HERE, '..', 'keyboard_probe.js'), 'utf8')

function runProbe({ innerWidth = 402, innerHeight = 844, scrollY = 0, scrollHeight = innerHeight, visualViewport = null, activeElement = null } = {}) {
  const context = {
    window: { innerWidth, innerHeight, scrollY, visualViewport },
    document: {
      documentElement: { scrollHeight, clientHeight: innerHeight },
      activeElement,
      body: {},
      querySelector: () => null,
    },
  }
  vm.createContext(context)
  return vm.runInContext(PROBE_SOURCE, context)
}

describe('keyboard_probe.js documentPannable', () => {
  it('is false for an ordinary keyboard-up page with no real document overflow', () => {
    // Astra's exact counter-example: the keyboard shrinks the VISUAL viewport (844 -> 500) but
    // the document's own scrollHeight never exceeds the LAYOUT viewport (innerHeight, which iOS
    // Safari does not shrink for the keyboard). Comparing against the shrunk visual viewport
    // instead reported this as "the document became pannable" on every ordinary keyboard
    // appearance, bug-free or not.
    const result = runProbe({
      innerHeight: 844, scrollHeight: 844,
      visualViewport: { width: 390, height: 500, offsetTop: 0, offsetLeft: 0, pageTop: 0, pageLeft: 0, scale: 1 },
    })
    assert.equal(result.documentPannable, false)
    assert.equal(result.verdicts.documentBecamePannable, false)
  })
  it('is true when the document genuinely has more content than the layout viewport', () => {
    // The real 2026-09-26 finding this probe exists to catch: scrollHeight exceeds even the
    // full (non-shrunk) layout viewport, independent of whatever the keyboard is doing.
    const result = runProbe({ innerHeight: 541, scrollHeight: 678, visualViewport: { width: 402, height: 409.65625, offsetTop: 136.65625, offsetLeft: 0, pageTop: 136.65625, pageLeft: 0, scale: 1 } })
    assert.equal(result.documentPannable, true)
    assert.equal(result.verdicts.documentBecamePannable, true)
  })
  it('handles a page with no visualViewport at all (older WebKit) the same way', () => {
    const result = runProbe({ innerHeight: 800, scrollHeight: 700, visualViewport: null })
    assert.equal(result.documentPannable, false)
    assert.equal(result.visualViewport, null)
  })
})

describe('keyboard_probe.js scroll verdict', () => {
  it('flags a nonzero document scrollY regardless of pannability', () => {
    const result = runProbe({ innerHeight: 541, scrollHeight: 400, scrollY: 137 })
    assert.equal(result.verdicts.documentScrolledWhileKeyboardUp, true)
  })
  it('does not flag a page that never scrolled', () => {
    const result = runProbe({ scrollY: 0 })
    assert.equal(result.verdicts.documentScrolledWhileKeyboardUp, false)
  })
})
