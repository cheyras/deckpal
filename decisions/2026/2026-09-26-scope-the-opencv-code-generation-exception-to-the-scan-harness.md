---
date: "2026-09-26"
title: "Scope the OpenCV code generation exception to the scan harness"
decided_by: "Chey (via Codex)"
areas: ["security", "frontend", "scanner"]
supersedes: []
---
## 2026-09-26 — Scope the OpenCV code generation exception to the scan harness
**Decided by:** Chey (via Codex)

**Decision:** Emit the scan harness HTML as a separate, hashed iframe document.
Give only that asset a CSP with `'unsafe-eval'` in `script-src` and
`frame-ancestors 'self'`; the `/dev/scan-harness` app document keeps the
general strict policy. Exclude the iframe asset from the service worker's
cached shell and precache so it receives its own header on demand. Check that
OpenCV initializes after following the real Dev tools link.

**Why:** Independent review found that the shipped OpenCV embind wrapper calls
`new Function()` while registering bindings. `'wasm-unsafe-eval'` alone does
not permit JavaScript code generation, so the enforcing CSP made the
diagnostic harness's OpenCV and Fused engines fail despite the page loading.
The first route-specific policy attempt failed when the app followed its
ordinary client-side link: no new document request meant no new policy. A
separate iframe document gets the needed policy regardless of how the parent
route was reached.

**Implications:** A script injection inside the harness iframe has a weaker
JavaScript execution boundary than one in the surrounding app. The remaining
directives match the general policy, except `frame-ancestors 'self'` and the
matching `X-Frame-Options: SAMEORIGIN` needed for that iframe, and are checked
for drift. The general header exclusion matches only the hashed `.html` asset:
an extensionless path sharing its prefix can serve the app shell and must keep
the general policy. Vercel's SPA rewrite and the service worker's navigation
fallback exclude the entire `/assets/` tree, so a missing harness-shaped HTML
file cannot turn into the app shell under the harness policy. A future
CSP-compatible OpenCV build could remove the exception;
until then, the browser suite must start OpenCV and check that an active
service worker preserves the iframe's header.
