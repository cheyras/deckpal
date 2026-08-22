/**
 * The two viewport profiles every visual gate runs against.
 *
 * Desktop is a plain viewport — no device emulation needed. Mobile borrows
 * Playwright's built-in `devices['iPhone 14 Pro']` descriptor (viewport,
 * deviceScaleFactor, isMobile, hasTouch, and a real iOS Safari UA string) so
 * the app sees the same signals it would from an actual iPhone's Safari.
 *
 * `devices` is passed in rather than imported here, because this module has
 * no static dependency on the `playwright` package (see lib/resolve-playwright.mjs
 * for why) — the caller resolves it once and hands the map down.
 */

export const DESKTOP_PROFILE = Object.freeze({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
})

export function mobileProfile(devices, name = 'iPhone 14 Pro') {
  const device = devices[name]
  if (!device) {
    throw new Error(
      `Unknown Playwright device "${name}". Known devices: ${Object.keys(devices).slice(0, 10).join(', ')}, …`,
    )
  }
  return { ...device }
}
