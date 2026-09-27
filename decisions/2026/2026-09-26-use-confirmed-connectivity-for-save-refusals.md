---
date: "2026-09-26"
title: "Use confirmed connectivity for save refusals"
decided_by: "Chey (via Claude)"
areas: ["general"]
supersedes: []
---
## 2026-09-26 — Use confirmed connectivity for save refusals

**Decided by:** Chey (via Claude)

**Decision:** The offline banner, collection counters, and list and deck write
gate use the same server probe result. A successful probe permits writes even
when `navigator.onLine` is false. A failed probe refuses them up front. While
the probe is pending or timed out, a write is attempted and its existing save
lane reports the result.

**Why:** On iOS and some flaky networks, the browser can claim it is offline
while DeckPal reaches the server. The old split hid the offline banner yet
refused a working list or deck save with “You're offline.”

**Implications:** No offline write queue is added. Confirmed offline still
refuses before sending, and an attempted write still saves or rolls back with
its existing message. A timed-out probe no longer falls back to the browser
hint for the banner; neither surface claims an outage without confirmation.
Browser and unit tests cover
the false browser hint, confirmed offline, and unknown states.
