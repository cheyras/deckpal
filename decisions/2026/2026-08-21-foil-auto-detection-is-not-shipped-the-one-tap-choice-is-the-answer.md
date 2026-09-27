---
date: "2026-08-21"
title: "Foil auto-detection is NOT shipped; the one-tap choice is the answer"
decided_by: "Claude, from measurement. Reverses the optimistic reading of the"
areas: ["scanner"]
supersedes: []
---
## 2026-08-21 — Foil auto-detection is NOT shipped; the one-tap choice is the answer
**Decided by:** Claude, from measurement. Reverses the optimistic reading of the
earlier entry the same day.
**Decision:** `corrLS` is a real discriminator (AUC 0.988 with card and lighting
held constant) but is **not shipped as auto-detection**. The variant stays a
one-tap reader choice.

**Why:** at scan time pHash names the CARD but nothing names the LIGHT, and the
statistic moves with both. For one of three cards tested (Kakuna) the
across-lighting spread of `corrLS` is 0.255 for the normal printing alone —
larger than the foil effect on most pairs — and its normal in dim light scores
*below* its reverse holo in daylight. Leave-one-lighting-out with a per-card
threshold: **15/17**, both failures on that card, both missing by 0.17–0.22 and
therefore CONFIDENTLY wrong rather than marginal. An abstain band does not catch
them.

A collection tracker exists to record what someone owns. Confidently writing the
wrong printing is worse than asking, so it asks.

**Also killed:** comparing a card to itself across a window — "foil swings as it
tilts, matte stays put". That would have needed no reference at all, which made it
the most attractive option. On rectified frames it scores AUC 0.50/0.52, exactly
chance. Window averaging helps only as ordinary noise reduction on the mean.

**What would change this:** more cards (three is too few to know whether Kakuna is
the exception or the rule), and a lighting-invariant formulation. Catalog images
as a per-card reference are not worth pursuing until then — a single flat scan
cannot track a 0.255 spread. Full write-up: `research/FOIL-DETECTION.md`.

