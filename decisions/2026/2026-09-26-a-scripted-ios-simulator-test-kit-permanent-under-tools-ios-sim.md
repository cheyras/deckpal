---
date: "2026-09-26"
title: "A scripted iOS Simulator test kit, permanent under `tools/ios-sim/`"
decided_by: "Chey (via Claude)"
areas: ["agents"]
supersedes: []
---
## 2026-09-26 — A scripted iOS Simulator test kit, permanent under `tools/ios-sim/`

**Decided by:** Chey (via Claude)

**Decision:** `tools/ios-sim/` is a reusable kit for testing DeckPal in real Mobile
Safari on the iOS Simulator: `wir.py` (a from-scratch, Python-3-stdlib-only Safari
Web Inspector client over the simulator's local `webinspectord_sim` socket --
`list`/`eval`/`eval @file`), `server.mjs` (a fixture server -- fake signed-in
session, fake API, built on the existing `tests/browser/support.mjs` +
`admin.mjs` harness rather than duplicating it), `keyboard_probe.js` +
`measure_keyboard.py` (on-screen-keyboard layout measurement), and `shot.sh`
(a `simctl io screenshot` fallback). `pnpm sim:serve` runs the fixture server;
`pnpm test:ios-sim` runs the kit's own pure tests.

**Why:** On 2026-09-23 an ad hoc investigation session did this same thing by
hand -- boot, attach, seed a fake session, drive the UI, read layout state --
and found a real bug (the Bug Report modal's keyboard-scroll issue, reproduced
again below as this kit's worked example). That session's own record noted no
scripted recipe existed, so the method had to be reinvented from scratch next
time. The prototype files that investigation described (a `wir.py`, a keyboard
probe, a screenshot helper) did not exist on disk when this kit was built --
the sandbox they were written in did not persist between sessions -- so this
kit is written fresh from the technical spec that investigation left behind
(the plist RPC framing, the `Target.sendMessageToTarget` multiplexing, the
`awaitPromise` unreliability), cross-checked against `pymobiledevice3` and
`ios-webkit-debug-proxy`'s published implementations of the same protocol, and
independently verified end-to-end against a real booted simulator (iPhone 16
Pro, iOS 18.6) rather than assumed correct from the spec alone.

**What it found, verified today:** the Bug Report modal's keyboard bug still
reproduces on `main` -- tapping its textarea for real raises the keyboard, and
`document.scrollY` goes from `0` to `137` with the dialog's own title and the
app header scrolled to negative `y` (off-screen above the fold), while the
focused field itself stays visible. See `tools/ios-sim/README.md`'s worked
example for the full probe output. Also verified: the Home Screen (standalone)
install flow works end-to-end (`window.navigator.standalone === true` reads
back through `wir.py --app standalone`), and `webinspectord_sim` has an
undocumented connection-rate limit (a third fresh connection within roughly
ten seconds gets no reply at all) -- `wir.py` retries through this itself
rather than surfacing it as "nothing is open."

**A mistake made and corrected during this work:** the simulator MCP tool's
`text` action was used once by accident while re-verifying the Home Screen
flow, despite the task's explicit instruction never to use it. Per the
documented trap, this switches iOS into hardware-keyboard mode and hides the
on-screen keyboard; the device was rebooted (`simctl shutdown` + `boot`)
immediately to clear it before any further keyboard verification continued.
Recorded here, not just fixed silently, because the same trap is now the
kit's own README's first line under "Traps" -- it should not recur.

**Implications:** `tools/ios-sim/dist/` (the built SPA) is gitignored (caught
by the existing repo-wide `dist/` rule) and rebuilds are decoupled from
`--port` (the auth storage key only depends on the `127.0.0.1` host, not the
port, so one cached build serves any port). The deckpal-simfixture prototype's
`hdiutil` case-sensitive-volume workaround was dropped entirely -- PR #201
already fixed the underlying case-insensitive build collision on `main`, and
building straight from a normal checkout was reverified clean before removing
the workaround. Fixed alongside this kit (found by an independent a11y pass
while this PR was in flight): `tests/browser/admin.mjs`'s
`/api/insights/overview` fixture stub had drifted from the real
`apps/api/src/routes/insights.ts` response shape (missing `trainer.intoLevel`/
`toNext`/`fraction`, four fictitious keys -- `collection`, `tcg`, `completion`,
`value` -- that were never real fields of that endpoint) and
`/api/insights/value` had no stub at all; both are now pinned to the real
shape, and a new `checkInsights` browser check (wired into `test:browser`)
proves `/insights` actually renders on the fixture rather than trusting the
stub by inspection. Unrelated and pre-existing: `pnpm test:browser`'s
`checkAdminTables` "ArrowRight must actually scroll overflowing columns"
assertion fails deterministically in this sandbox's headless Chromium, on a
clean `origin/main` checkout with none of this PR's changes applied -- not a
regression introduced here; left for a separate investigation.
