---
date: "2026-09-27"
title: "Measure Deck-E scroll motion without counting WebKit settling twice"
decided_by: "Chey (via Codex)"
areas: ["agents", "testing"]
supersedes: []
---
## 2026-09-27 — Measure Deck-E scroll motion without counting WebKit settling twice
**Decided by:** Chey (via Codex)

**Decision:** Keep the application's single scroll owner unchanged. In the browser check, separate a long throw by its per-frame distance (more than half a viewport), then count the remaining runs. Runs spanning at most 4 CSS pixels are reported as settling, with a maximum of 5 pixels of total travel across the entire trip. Larger runs also charge travel beyond their range against that budget, so small oscillations cannot hide inside a glide. Measure reversals cumulatively from the furthest point reached, so a slow backwards drift cannot hide in a per-frame tolerance. Save raw frames and metrics before assertions, including failures.

**Why:** The old counter classified a jump or glide only by the number of moving samples separated by four still frames. A captured WebKit run reported `0 jumps, 2 glides` for `0 → 1 → 17829 → 17828`, followed by one eased flight: the 1px route nudge and 1px settling correction turned the single throw into three moving samples. Another captured run settled by another 3px before the flight. Tracing `window.scrollTo` showed one throw and the flight's own writes, with no extra request at these small corrections. This establishes a measurement defect; it does not establish the exact native WebKit mechanism responsible for the small readback changes.

**Implications:** The one-throw/one-glide limits remain. An extra 5px glide, adjacent throws, a slow reversal, repeated small moves, and small oscillations are covered by negative tests. The total settling budget prevents an unbounded noise exemption. Snap, landing, arrival-order, bubble, reader-takeover and reduced-motion checks stay in place. Pure analyser regression tests run as part of the existing decke-show browser suite; no new browser case or shard is added. This changes test measurement only, not production motion.

**Evidence:** Linux Actions run 36334485511 repeated WebKit at 390px twenty times on the unchanged app. The old counter failed fourteen runs; their traces contain the same small preflight corrections, not another substantial scroll. Replaying all twenty traces through the corrected counter gives one jump, one glide and zero reversals, with 0–3px of settling. Representative Linux and macOS traces are committed as regression fixtures. The diagnostic twenty-run loop was removed after capture; CI retains the normal suite size.
