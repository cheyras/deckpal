---
date: "2026-09-26"
title: "Scope the OpenCV code generation exception to the scan harness"
decided_by: "Chey (via Codex)"
areas: ["security", "frontend", "scanner"]
supersedes: []
---
## 2026-09-26 — Scope the OpenCV code generation exception to the scan harness
**Decided by:** Chey (via Codex)

**Decision:** Give `/dev/scan-harness` its own CSP with `'unsafe-eval'` in
`script-src`. Keep the general policy and Deck-E comparison policy without
that permission. Exclude the harness navigation from the service worker's
cached shell so its response retains the route-specific header. Check that
the OpenCV engine initializes under the actual CSP in the browser suite.

**Why:** Independent review found that the shipped OpenCV embind wrapper calls
`new Function()` while registering bindings. `'wasm-unsafe-eval'` alone does
not permit JavaScript code generation, so the enforcing CSP made the
diagnostic harness's OpenCV and Fused engines fail despite the page loading.
The exception belongs on that permission-gated diagnostic page rather than
on every user-facing page.

**Implications:** A script injection on the harness route has a weaker
JavaScript execution boundary than one on an ordinary page. The remaining
directives, including `frame-ancestors 'none'`, stay identical to the general
policy and are checked for drift. A future CSP-compatible OpenCV build could
remove this exception; until then, the browser suite must initialize OpenCV
and check that an active service worker preserves this page's header.
