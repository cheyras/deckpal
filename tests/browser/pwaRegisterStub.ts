// Stub for the `virtual:pwa-register` module `vite-plugin-pwa` injects into
// the real app build. This fixture's own `vite.config.mjs` doesn't register
// that plugin (it builds a tiny test-only entry, not the PWA), so importing
// `PwaUi` here — which pulls in `apps/web/src/pwa.ts` — has nothing to
// resolve the virtual module against. `OfflineHarness` (fixture.tsx) never
// calls `registerPwa()`, so `registerSW` itself is never invoked; this exists
// purely to satisfy the bundler's module graph. Aliased in vite.config.mjs.
export function registerSW(_options?: { onNeedRefresh?: () => void; onOfflineReady?: () => void }): (reload?: boolean) => Promise<void> {
  return async () => {}
}
