/**
 * Approximating "installed as an iOS standalone PWA" in headless Chromium.
 *
 * ── WHAT ACTUALLY WORKS, VERIFIED ON THIS MACHINE ────────────────────────────
 *
 * Chromium 151 (bundled with Playwright 1.62.1) supports a real,
 * previously-undocumented-here CDP method:
 *
 *   Emulation.setSafeAreaInsetsOverride({
 *     insets: { top, topMax, bottom, bottomMax, left, leftMax, right, rightMax }
 *   })
 *
 * This is NOT exposed through any Playwright API — it has to go over a raw
 * CDPSession. Once applied, `env(safe-area-inset-top)` etc. resolve to the
 * given pixel values in CSS on that page, for real — confirmed by round-
 * tripping `getComputedStyle` on a `padding-top: env(safe-area-inset-top,
 * 999px)` element (999px fallback, 47px once the override lands). DeckPal's
 * own layout uses exactly this primitive: `AppShell.tsx` sets
 * `paddingTop: 'env(safe-area-inset-top)'` etc. directly, so this override is
 * sufficient to visually verify safe-area handling — including catching a
 * missing safe-area rule on an element that should have one, which ordinary
 * Chromium (insets always 0, no notch) cannot exercise at all.
 *
 * Parameter shape note: the field is a single `insets` OBJECT with one
 * top/topMax/bottom/bottomMax/left/leftMax/right/rightMax pair — not an array
 * of `{edge, size}` entries (that shape returns "Invalid parameters"; the
 * plural-sounding name is misleading).
 *
 * ── WHAT DOES NOT WORK ───────────────────────────────────────────────────────
 *
 * `Emulation.setEmulatedMedia({ features: [{ name: 'display-mode', value:
 * 'standalone' }] })` is ACCEPTED without error but has NO effect — verified:
 * `window.matchMedia('(display-mode: standalone)').matches` stays `false`
 * after calling it, even after a full page reload. Chromium's CSS engine does
 * not honor this feature name through that CDP method in this build. If
 * DeckPal ever adds a real `@media (display-mode: standalone)` CSS rule, this
 * harness cannot drive it — there is no known Chromium override for that
 * case; a real device or Safari's own responsive-design mode would be needed.
 *
 * DeckPal does not currently have that problem: the only standalone check in
 * the app is a JS one (`PwaUi.tsx`: `window.matchMedia('(display-mode:
 * standalone)').matches`), which `applyStandaloneShim` below satisfies
 * directly by monkey-patching `matchMedia` before any app code runs — no CDP
 * needed for that half. Re-grep `apps/web/src` for `display-mode` /
 * `standalone` before trusting this if the app's PWA detection logic changes.
 *
 * `navigator.standalone` (the actual iOS Safari signal, distinct from the
 * `display-mode` media feature) does not exist in Chromium at all; shimmed
 * the same way for code that reads it directly.
 *
 * ── WHAT NO AMOUNT OF CHROMIUM EMULATION CAN PROVE ───────────────────────────
 *
 * - Real WebKit rendering, layout quirks, and JS engine differences — this is
 *   still Chromium underneath. A visual pass here is not a substitute for
 *   checking on an actual iPhone in actual Safari before shipping.
 * - The real values iOS assigns to `safe-area-inset-*` on a given device/
 *   orientation (notch vs. Dynamic Island vs. home indicator) — the override
 *   above accepts ANY numbers; 47/34 here are typical iPhone 14 Pro portrait
 *   values, not measured from a device.
 * - Home-indicator gesture-bar interaction, PWA install prompts/banners, the
 *   real "Add to Home Screen" flow, offline/service-worker behavior under
 *   iOS's stricter background execution limits, or Safari's own viewport
 *   quirks (address bar show/hide changing `100vh`).
 */

/**
 * Shim the JS-visible signals of "running as an installed standalone app".
 * Must be applied via `page.addInitScript` semantics — call this BEFORE any
 * navigation on the page, so the override exists when the app's own scripts
 * run for the first time.
 *
 * @param {import('playwright').Page} page
 */
export async function applyStandaloneShim(page) {
  await page.addInitScript(() => {
    const originalMatchMedia = window.matchMedia ? window.matchMedia.bind(window) : null
    if (originalMatchMedia) {
      window.matchMedia = (query) => {
        if (typeof query === 'string' && query.includes('display-mode: standalone')) {
          return {
            matches: true,
            media: query,
            addListener() {},
            removeListener() {},
            addEventListener() {},
            removeEventListener() {},
            dispatchEvent() {
              return true
            },
            onchange: null,
          }
        }
        return originalMatchMedia(query)
      }
    }
    try {
      Object.defineProperty(window.navigator, 'standalone', { get: () => true, configurable: true })
    } catch {
      /* some contexts (extensions, certain iframes) disallow redefining navigator props */
    }
  })
}

/**
 * Override `env(safe-area-inset-*)` for this page via CDP. Verified working
 * (see module header). Typical iPhone-with-notch portrait values are used as
 * the default; pass your own for landscape or a different device class.
 *
 * @param {import('playwright').Page} page
 * @param {{ top?: number, bottom?: number, left?: number, right?: number }} [insets]
 * @returns {Promise<import('playwright').CDPSession>} the session, in case the caller wants to reset it later
 */
export async function applySafeAreaInsets(page, insets = {}) {
  const { top = 47, bottom = 34, left = 0, right = 0 } = insets
  const session = await page.context().newCDPSession(page)
  await session.send('Emulation.setSafeAreaInsetsOverride', {
    insets: {
      top, topMax: top,
      bottom, bottomMax: bottom,
      left, leftMax: left,
      right, rightMax: right,
    },
  })
  return session
}

/** iPhone 14 Pro portrait, Dynamic Island + home indicator. The default this harness uses for mobile specs. */
export const IPHONE_14_PRO_PORTRAIT_INSETS = Object.freeze({ top: 47, bottom: 34, left: 0, right: 0 })
