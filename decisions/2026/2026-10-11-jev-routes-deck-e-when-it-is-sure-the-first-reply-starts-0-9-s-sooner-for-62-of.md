---
date: "2026-10-11"
title: "Jev routes Deck-E when it is sure: the first reply starts ~0.9 s sooner for 62% of messages, at Haiku triage's accuracy"
decided_by: "@cheyras (\"use jev to very quickly decide on the model\"; \"yes\" to the hybrid), measured by Claude Opus 5.5."
areas: ["agents"]
supersedes: []
---
## 2026-10-11 — Jev routes Deck-E when it is sure: the first reply starts ~0.9 s sooner for 62% of messages, at Haiku triage's accuracy
**Decided by:** @cheyras ("use jev to very quickly decide on the model"; "yes" to the hybrid), measured by Claude Opus 5.5.

**Decision:** Each new reader message starts two reads at once. One is Haiku 5.5 triage, as before (#293). The other is a Jev route read (`decke/jevRoute.ts`): one `/v1/evaluate` call that answers five questions.
- **pathway:** a choice over the twelve pathways, using each pathway's own summary.
- **four yes/no signals:** correction, dissatisfied, wants_depth and asks_why.

If Jev's pathway answer is at least 0.9 confident, its route is used and Haiku is aborted. Otherwise Haiku's triage routes. The cases where Haiku routes are:
- Jev unsure;
- `DECKE_JEV` off;
- no key;
- a timeout or an error.

The same code rules apply to both answers:
- the ask card's own pathway wins;
- a decline is never a correction;
- "why did I lose" on a game makes it a review as well as a log;
- `decideTier` picks the tier.

The `[deck-e] route` line now records `triage: "jev"` and Jev's confidence and milliseconds on every request, used or not.

**Why:** The owner asked whether Jev could make the first routing decision faster than Haiku. Jev already reads every message for the reflex at about 0.27 s; Haiku triage takes about 1.2 s, and the first reply waited for it. Measured on the triage eval's 145 labelled cases × 3 (`scripts/decke-jev-route-eval.mjs`, about $0.07 a run):

| Router | Tier accuracy (all / held-out) | Under-routed | p50 / p95 |
|---|---|---|---|
| Haiku triage | 97.5% / 96.7% | 0 | 1,186 / 1,513 ms |
| Jev alone | 93.3% / 96.7% | 3 | 257 / 360 ms |
| Jev at confidence ≥ 0.9, else Haiku | 97.2% / 100% | 0 | 304 / 1,342 ms |

Jev decided 62% of messages. Jev alone is not good enough: a fake JSON override moves it to Standard at 0.87 confidence. That costs money, never safety. An earlier run under-routed a pasted game ending in "what went wrong?" because the state kept only the start of a long paste. The state now uses triage's own head-and-tail clip, and the under-routes went to zero. At 0.8 Jev decides 72% of messages but over-routes more, so the threshold is 0.9.

**Implications:**
- `DECKE_JEV=off` turns the route read off along with the reflex, and Deck-E routes exactly as it did after #293.
- **Billing for a stopped Haiku call.** Its usage settles as cancelled. The Gateway may still bill the tokens it read before the stop, about $0.0002 at most.
- **Local measurement.** The eval's `--no-zdr` exists because the local eval key's Vercel plan cannot use zero data retention. The cases are synthetic, and production keeps ZDR and the TypeSafe provider pin.
- **Latency was measured from a laptop.** Read the route line's `jev.ms` and `triageMs` in production before moving the threshold.
