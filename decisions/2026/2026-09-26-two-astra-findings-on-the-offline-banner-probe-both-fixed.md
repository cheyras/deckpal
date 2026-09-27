---
date: "2026-09-26"
title: "Two Astra findings on the offline-banner probe, both fixed"
decided_by: "Chey (via Claude)"
areas: ["general"]
supersedes: []
---
## 2026-09-26 — Two Astra findings on the offline-banner probe, both fixed

**Decided by:** Chey (via Claude)

**Decision:** Two corrections to the reachability probe from the entry above, both raised by the required independent Astra review on PR #211:

1. `useConnectivity.ts` schedules a bounded 5-second self-retry
   (`RETRY_WHILE_OFFLINE_MS`) while — and only while — the banner is
   confirmed offline, cancelled the instant a check clears it. Without this,
   a single transient probe failure with `navigator.onLine` staying `true`
   and the tab staying focused fired none of the `online`/`offline`/`focus`
   events the hook listened for, so the banner would show "Offline." forever
   after one bad request on an otherwise-working connection.
2. `api.ts#pingReachable` now fetches with `redirect: 'manual'`. Self-host's
   supported reverse-proxy-auth deployment turns an expired session into a
   3xx to a cross-origin login page (the same shape `sw.ts`'s SSO guard
   already exists for); default `fetch` FOLLOWS that redirect, and a login
   page with no CORS headers for this origin makes the followed request
   reject — reporting a perfectly reachable proxy as offline, and (after
   fix 1) retrying on a timer forever. `redirect: 'manual'` stops at the 3xx
   itself: fetch resolves with an opaque `type: 'opaqueredirect'` response
   instead of throwing, which is the reachability evidence the probe wants
   — the response body is never read, so an opaque one is no loss.

**Why:** Both are exactly the class of bug an independent adversarial pass
exists to catch before merge rather than after a self-host operator reports
"the app thinks I'm offline and won't stop retrying."

**Implications:** `tests/browser/offline.mjs` gained a fourth case
(`recovers-without-window-event`) simulating a transient probe failure via a
page-level route abort, asserting the banner clears on its own within the
retry window. The redirect fix has no unit-level regression test (it needs a
real cross-origin redirect target, which the existing fixture harness
doesn't model) — verified by code review against `sw.ts`'s own documented SSO
scenario and the `fetch()` `redirect: 'manual'` spec instead. Also bumped
`.github/workflows/browser.yml`'s timeout from 15 to 20 minutes: a CI run on
this branch (36267286821) hit the ceiling with both cloud and self-host
admin/feedback journeys complete but the chat/offline fixture never reached;
a full local run measured ~18 minutes on the (contended) dev machine.
