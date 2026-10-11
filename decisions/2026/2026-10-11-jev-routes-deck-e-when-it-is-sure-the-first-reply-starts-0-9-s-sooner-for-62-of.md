---
date: "2026-10-11"
title: "Jev routes Deck-E when it is sure: the first reply starts ~0.9 s sooner for 62% of messages, at Haiku triage's accuracy"
decided_by: "@cheyras (\"use jev to very quickly decide on the model\"; \"yes\" to the hybrid), measured by Claude Opus 5.5."
areas: ["agents"]
supersedes: []
---
## 2026-10-11 — Jev routes Deck-E when it is sure: the first reply starts ~0.9 s sooner for 62% of messages, at Haiku triage's accuracy
**Decided by:** @cheyras ("use jev to very quickly decide on the model"; "yes" to the hybrid), measured by Claude Opus 5.5.

**Decision:** Each new reader message starts two reads at once. One is Haiku 5.5 triage, as before (#293). The other is a Jev route read (`decke/jevRoute.ts`): one `/v1/evaluate` call that answers six questions.
- **pathway:** a choice over the twelve pathways, using each pathway's own summary.
- **five yes/no signals:** correction, dissatisfied, wants_depth, large_analysis (Haiku's `wantsDeep: 'offer'`) and asks_why.

If Jev's pathway answer is at least 0.9 confident, its route is used and the reply stops waiting for Haiku. Haiku is not aborted: it finishes in the background and the request's settlement waits for it (`usage.pending`), so its real cost is recorded. If Haiku has already answered, its answer is used. Otherwise Haiku's triage routes. The cases where Haiku routes are:
- Jev unsure;
- `DECKE_JEV` or `DECKE_JEV_ROUTE` off;
- no key;
- a timeout or an error.

The same code rules apply to both answers:
- the ask card's own pathway wins;
- a decline is never a correction;
- "why did I lose" on a game makes it a review as well as a log;
- `decideTier` picks the tier.

The `[deck-e] route` line now records `triage: "jev"` and Jev's confidence and milliseconds on every request, used or not.

**Why:** The owner asked whether Jev could make the first routing decision faster than Haiku. Jev already reads every message for the reflex at about 0.27 s; Haiku triage takes about 1.2 s, and the first reply waited for it. Measured on the triage eval's 148 labelled cases × 3 (`scripts/decke-jev-route-eval.mjs`, about $0.08 a run):

| Router | Tier accuracy (all / held-out) | Under-routed | Over-routed | p50 / p95 |
|---|---|---|---|---|
| Haiku triage | 97.5% / 96.7% | 1 | 10 | 1,181 / 1,520 ms |
| Jev alone | 92.8% / 95.1% | 3 | 29 | 266 / 346 ms |
| Jev at confidence ≥ 0.9, else Haiku | 96.6% / 96.7% | 1 | 14 | 294 / 1,333 ms |

Jev decided 62% of messages. The hybrid's extra misses are over-routes to Standard, which cost a little and never lower the answer. The 0.9 threshold was chosen after seeing held-out results, so treat held-out as tuning data, not validation; production's route line is the real check. Jev alone is not good enough: a fake JSON override moves it to Standard at 0.87 confidence. That costs money, never safety. An earlier run under-routed a pasted game ending in "what went wrong?" because the state kept only the start of a long paste. The state now uses triage's own head-and-tail clip, and the under-routes went to zero. At 0.8 Jev decides 72% of messages but over-routes more, so the threshold is 0.9.

**Implications:**
- `DECKE_JEV_ROUTE=off` turns routing off alone, and Deck-E routes exactly as it did after #293. `DECKE_JEV=off` turns it off along with the reflex and the audit.
- **Haiku still runs on every first leg.** The saving is time, not money: about $0.00013 of Haiku per message continues, and Jev adds about $0.00004. A review caught that an aborted Haiku call would settle at no recorded cost while the Gateway still billed it, so Haiku finishes instead.
- **`large_analysis`** was added after review: without it, a confident Jev left tournament prep on a Quick-floor pathway (research) on Haiku. Three such cases are now in the eval, and both routers send them to Standard.
- **Local measurement.** The eval's `--no-zdr` exists because the local eval key's Vercel plan cannot use zero data retention. The cases are synthetic, and production keeps ZDR and the TypeSafe provider pin.
- **Latency was measured from a laptop.** Read the route line's `jev.ms` and `triageMs` in production before moving the threshold.
