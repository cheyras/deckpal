// THE OCR FEATURE FLAG, as a pure predicate.
//
// The value the product reads is `OCR_ENABLED` in `scan/ui/flags.ts`. The RULE
// lives here, taking its three inputs as arguments, for the same reason
// `scan/ui/eventPost.ts` was split out of that file: `flags.ts` imports
// `lib/api.ts`, which reads `import.meta.env`, which a plain Node test process
// cannot evaluate. A flag whose behaviour cannot be tested is a flag nobody
// will trust to be off in production.
//
// ── WHY A HOSTNAME AND NOT AN ENV VAR ───────────────────────────────────────
//
// Vite only exposes `VITE_`-prefixed variables to client code, so "on in
// preview" via the environment means introducing a new `VITE_*` var — and
// AGENTS.md B11 requires any env var a feature depends on to be declared in
// `DEPLOYMENT.md`'s environment table in the same commit that introduces the
// code reading it. Preview deployments are already distinguishable without one:
// production is `deckpal.app`, previews are `*.vercel.app`. No new
// configuration surface, nothing to forget to set, and nothing that can be set
// WRONG on production.
//
// ── AND WHY THERE IS A MANUAL OVERRIDE ──────────────────────────────────────
//
// REPORT.md §8.3 is blunt that no OCR timing in this project has ever been taken
// in a browser: every number is onnxruntime-node on a desktop, corrected by a
// factor calibrated on a different model, and the projection is "treat 1.8-3.4 s
// as a floor". The measurement that settles it has to happen on the owner's
// iPhone, on a real capture, and it must be possible to turn the lane on and off
// there without a redeploy. `localStorage['deckpal.ocr'] = '1' | '0'` is that
// switch, and it wins in BOTH directions so it is equally usable to disable a
// lane that is misbehaving in front of a reader.

/** What the rule is allowed to look at. */
export interface OcrFlagInputs {
  /** `import.meta.env.DEV` — the Vite dev server. */
  dev: boolean
  /** `location.hostname`, or '' where there is no location (tests, SSR). */
  hostname: string
  /** `localStorage['deckpal.ocr']`, or null when unset/unreadable. */
  override: string | null
}

/** The localStorage key. Exported so the probe page and any future debug UI
 *  spell it the same way. */
export const OCR_OVERRIDE_KEY = 'deckpal.ocr'

/**
 * Is the on-device OCR lane enabled?
 *
 *   override '1' / 'true' / 'on'   ->  yes, anywhere
 *   override '0' / 'false' / 'off' ->  no, anywhere
 *   dev server                     ->  yes
 *   *.vercel.app (preview)         ->  yes
 *   anything else (production,
 *   self-host, unknown)            ->  no
 *
 * The default for an unrecognised host is OFF, not ON. A 15.6 MB lazy download
 * and a second ONNX session on a runtime with live iOS crash reports against it
 * (`model.ts`'s header; REPORT.md §8.4) is not something to switch on for
 * strangers by accident.
 */
export function ocrEnabled({ dev, hostname, override }: OcrFlagInputs): boolean {
  if (override != null) {
    const v = override.trim().toLowerCase()
    if (v === '1' || v === 'true' || v === 'on') return true
    if (v === '0' || v === 'false' || v === 'off') return false
    // Anything else is not an instruction; fall through to the defaults rather
    // than letting a typo silently mean "off".
  }
  if (dev) return true
  // Vercel preview deployments only. `deckpal.app` — production — is NOT here,
  // and neither is a self-hosted origin, which by definition is not a domain
  // this repo can enumerate.
  return /(^|\.)vercel\.app$/i.test(hostname)
}

/** Read the override without letting a locked-down browser throw. Safari in
 *  private mode makes `localStorage` a getter that raises; a feature flag is
 *  never worth a white screen. */
export function readOcrOverride(): string | null {
  try {
    return globalThis.localStorage?.getItem(OCR_OVERRIDE_KEY) ?? null
  } catch {
    return null
  }
}
