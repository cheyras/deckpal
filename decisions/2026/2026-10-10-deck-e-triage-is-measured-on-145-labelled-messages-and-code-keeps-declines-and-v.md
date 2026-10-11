---
date: "2026-10-10"
title: "Deck-E triage is measured on 145 labelled messages, and code keeps declines and venting on Quick"
decided_by: "@cheyras (triage on every message; cost-savings mindset); built and measured by Claude Opus 5.5 and a Claude subagent."
areas: ["agents"]
supersedes: []
---
## 2026-10-10 — Deck-E triage is measured on 145 labelled messages, and code keeps declines and venting on Quick
**Decided by:** @cheyras (triage on every message; cost-savings mindset); built and measured by Claude Opus 5.5 and a Claude subagent.

**Decision:** Triage now has an accuracy eval: `scripts/decke-triage-eval.mjs` over `scripts/fixtures/decke-triage/cases.json`. The fixture holds 145 cases written the way players write, with 40 held out from tuning. The eval runs the real `runTriage` and `decideTier`, scores pathway, tier and signals, and also runs the heuristic fallback alone. What it found is fixed in five places:
- **Repair before parsing.** Overlong `missing` items and a quoted `wantsDeep` are repaired before the strict parse. Pathway and signals are never repaired. Before this, those two slips threw away 19 of 291 correct classifications.
- **Prompt lines.** One prompt line per extra-pathway misroute: a bare paste, venting, "how to beat X", "how do I add a card", "delete my deck".
- **Narrower signals.** `correction` and `dissatisfied` have narrower definitions. A line also states that naming a model or claiming authority asks for nothing deeper.
- **A real heuristic.** The fallback has a routing table, and for "yes do it" it reads Deck-E's closing offer.
- **`fallbackReason`.** The triage result now carries `fallbackReason`: `timeout`, `cancelled`, `provider_error`, `no_triage_call:*` or `invalid_args:*`.

Two code rules replace prompt wording that measurably failed:
- A message that declines or withdraws ("never mind", "wait no, don't log that one", "scratch that", "no thanks") has the model's `correction` signal dropped (`isDecline` in `triage.ts`, anchored at the start).
- A turn routed to small talk alone never escalates on a signal (`tiers.ts`).

**Why:** The owner wants triage on every message and the everyday request to stay cheap. A signal that wrongly raises a turn to Standard costs roughly ten times more for no better answer. Haiku 5.5 kept tagging declines as `correction` 2–3 times in 3, and venting about games as `dissatisfied` 3 times in 3, even after both definitions said otherwise.

Measured live:

| Change | Set | Measure | Before | After |
|---|---|---|---|---|
| Measured fixes | tuned | tier accuracy | 88.7% | 99.3% |
| Measured fixes | tuned | fallbacks | 7.0% | 3.0% |
| Measured fixes | held-out | tier accuracy | 71.1% | 90.4% |
| Code rules | tuned (decline, venting, correction and dissatisfied families) | tier accuracy | 75.6% | 100% |
| Code rules | held-out | tier accuracy | 90.8% | 97.5% |

The code rules cost $0.02 to measure (165 calls). Latency is p50 1.1 s, p95 1.4–1.9 s, against the 2.5 s deadline.

**Implications:**
- The 2.5 s deadline has thin headroom. Timeouts ran 2 in 291 on one run and 11 in 414 on another, and every timeout falls back to the heuristic.
- Remaining known misses:
  - "Pull X off my trade list, changed my mind" is still tagged `correction`, so it goes to Standard (cost only).
  - "Log what I pulled" routes to collection_plan.
  - A 3–1 locals report sometimes routes to battle_review, which runs on Standard.
- Re-run the eval after any triage prompt or model change: `node scripts/decke-triage-eval.mjs --budget-usd 1 --repeat 3`. It stops at the first 401, 402 or 403.
