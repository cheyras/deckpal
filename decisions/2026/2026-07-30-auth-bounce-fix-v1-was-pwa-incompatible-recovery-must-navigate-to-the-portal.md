---
date: "2026-07-30"
title: "Auth-bounce fix v1 was PWA-incompatible; recovery must navigate to the portal"
decided_by: "agent (root-cause), after user reported the \"fixed\" issue recurring."
areas: ["security"]
supersedes: []
---
## 2026-07-30 — Auth-bounce fix v1 was PWA-incompatible; recovery must navigate to the portal
**Decided by:** agent (root-cause), after user reported the "fixed" issue recurring.
**Correction to the 2026-07-30 01:52 fix (3ae8c27):** detecting the expired-SSO bounce
and *reloading the current URL* can never work in the installed PWA — the service worker's
NavigationRoute serves every in-scope navigation from the precached shell, so the reload
never reaches nginx, the login flow never runs, and the loop guard then pins the app on the
error screen. In a plain browser tab (no controlling SW) the reload works, which is why the
first fix looked verified.
**Rule:** any auth-recovery path in this app MUST navigate to the SSO portal's login URL
with a redirect parameter (outside the SW's scope — the browser guarantees the SW cannot
intercept it), never reload an in-scope URL. Implemented in api.ts `redirectToAuth()` (portal
origin taken from the bounce response when available), with hardened detection
(`opaqueredirect`, ok-but-HTML on an API path, bare 401) and a 15s guard so an abandoned
login falls through to the error UI instead of ping-ponging. Verified in-browser via
Playwright with a faithful nginx simulation (intercepted 302 -> portal-HTML): app lands on
the SSO login URL; and an SW-controlled page demonstrably escapes to the network for the
external portal path. Note: installed PWAs pick this up after the next SW update prompt is
accepted.

