---
date: "2026-09-08"
title: "CI had never run the scanner's own regressions"
decided_by: "Not recorded"
areas: ["scanner","operations"]
supersedes: []
---
## 2026-09-08 — CI had never run the scanner's own regressions

**Found while merging the sweep work.** `ci` has failed on every commit since
the scanner landed on `main` (first red: `e6a84bc`, the build currently serving
production). Six tests, one cause.

`e2e-drive-regressions`, `e2e-round2/3-regressions`, `owner-session-1/2` and
`overlay-alignment` read their fixtures from an ABSOLUTE PATH on the author's
laptop — `E:/users/cheyr/deckpal/roadmap/plans/card-scanner-redesign/p2-work/…`
— inside a directory that is not tracked by git. Each has a
`if (!existsSync(p)) return []` guard that reads as graceful degradation, and
then the suite asserts the artifacts ARE present. So on any machine but that
one, the guard returned empty and the assertion failed.

**The consequence is the part worth recording.** These are not incidental
tests: they are the recorded evidence for the defects the 2026-09-04 fake-camera
drive and the two owner sessions found on the deployed build — 13 capture
events, 81 locks, the rectified-crops-rotated-90° regression, the
one-card-became-fifteen-captures regression. CI has never checked a single one
of them, and `bypass_mode: always` on the `main` ruleset meant a red CI never
stopped the merge that introduced it.

**Fix:** the JSON the assertions actually read — 14 files, ~420 KB — is now
committed at `apps/web/src/scan/engine/__tests__/fixtures/` and addressed with
`fileURLToPath(new URL('./fixtures/…', import.meta.url))`. The recorded sessions
themselves are gigabytes of frames and crops and stay out of git; only the event
and analysis JSON moves. The `existsSync` guard is kept, and is now the honest
thing it always claimed to be.

`deckpal-web test:scan`: 671/671, **0 skipped** — CI's own run of the same suite
reported 6 failed and 64 skipped.

