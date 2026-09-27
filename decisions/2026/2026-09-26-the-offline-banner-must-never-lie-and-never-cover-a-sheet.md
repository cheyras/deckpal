---
date: "2026-09-26"
title: "The offline banner must never lie and never cover a sheet"
decided_by: "Chey (via Claude)"
areas: ["general"]
supersedes: []
---
## 2026-09-26 — The offline banner must never lie and never cover a sheet

**Decided by:** Chey (via Claude)

**Decision:** Three changes to `apps/web/src/components/PwaUi.tsx` and its
supporting modules:

1. **Layering:** `theme.css`'s `--z-toast` token moves from `9999` to `50` —
   above `--z-chrome` (20, app nav/header) but below `--z-modal` (100, every
   `Sheet`). The install pill / offline banner / update toast were the only
   things in the app painting above an open modal; now Sheet's own scrim dims
   them exactly like the rest of the page behind it, instead of them floating
   over the sheet's footer. Chosen over "suppress the toast layer while a
   sheet is open" or "move it to the top": a shared z-index token is a
   one-line, permanent fix that needs no new open/closed state to track, and
   it fixes every current and future `Sheet` at once, not just Bug Report and
   Add Cards.
2. **Truthfulness:** the offline banner now reads `useConnectivity()`
   (`apps/web/src/lib/useConnectivity.ts`), not the raw `useOnline()` hint.
   `navigator.onLine` is confirmed with a cheap same-origin probe
   (`api.ts#pingReachable`, hitting `/me` — deliberately not `/health`, which
   `sw.ts`'s `publicCatalog` allowlist routes NetworkFirst and could answer
   from a stale cache while genuinely offline) on mount, on the `online` and
   `offline` events, and on window `focus`. The decision table lives in
   `apps/web/src/lib/connectivity.ts` (pure, unit-tested): a settled probe
   wins outright either direction; an errored probe (a real network failure)
   reports offline even over a hint that says online; a timed-out probe is
   inconclusive and falls back to the hint. No polling — event-driven only.
   `lib/useOnline.ts` (the raw hint) is UNCHANGED and still backs the
   collection-write gate in CardDetail/CardTile/TableView, which wants
   "offline → disable, online → let it try and surface any real error" and
   is fine with an occasional false disable; the banner makes a claim the
   write-gate never does, so it alone earns the extra round trip.
3. **Safe-area:** `PwaUi`'s two fixed bottom-pinned wrappers now sit at
   `bottom: calc(16px + env(safe-area-inset-bottom))` instead of a bare
   `16px`, matching `Sheet.tsx`'s own footer padding idiom, so the toasts
   clear the home indicator on a Home-Screen install (flagged but left
   unfixed by the 2026-09 R5 mobile-layout research pass).

**Why:** Observed in the iOS Simulator: `navigator.onLine` reported `false`
while every real request succeeded, so the banner said "Offline." on a working
connection and never corrected itself — a banner that lies erodes trust in
every other status the app shows. Separately, the banner's `z-index: 9999`
painted over the Bug Report sheet's Submit/Cancel footer and the Add Cards
results, unreachable underneath it; a user who is genuinely offline could not
submit a bug report about it.

**Implications:** `api.ts` gains one bespoke, auth-free, no-retry probe
(`pingReachable`/`api.ping`) alongside its existing `keepaliveJson`/`upload`
bespoke helpers — same "owns the base path" contract, enforced by
`scripts/check-api-base.mjs`. A known, explicitly out-of-scope gap: Deck-E's
own chat panel (`DeckeChat.tsx`) is a hand-rolled overlay, not built on
`Sheet`, and its z-index (15–25) sits below the new `--z-toast: 50` too — the
same class of collision could still occur there and is left for a future pass
rather than expanding this fix into an unrelated, heavily-tested surface.

**Evidence:** `apps/web/src/lib/__tests__/connectivity.test.ts` (4 cases: the
decision table plus a flapping sequence) and a new
`tests/browser/offline.mjs`, wired into `pnpm test:browser`, using the real
`PwaUi` and `Sheet` components against a real fetch — a lying
`navigator.onLine` over a reachable network, a real `context.setOffline`
round trip at 1280px and 390px, and an open sheet's Submit button hit-tested
on top of the banner while genuinely offline. Manually re-verified against
the signed-in app (sim fixture, port 5320) with headless Playwright:
screenshots of all of the above plus the real Bug Report sheet.

