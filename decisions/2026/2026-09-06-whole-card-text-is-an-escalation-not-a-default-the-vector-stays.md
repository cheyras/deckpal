---
date: "2026-09-06"
title: "Whole-card text is an escalation, not a default; the vector stays"
decided_by: "Not recorded"
areas: ["catalog"]
supersedes: []
---
## 2026-09-06 — Whole-card text is an escalation, not a default; the vector stays

Owner rulings: full-card OCR runs ONLY when the two-ROI pass reads neither
name nor number ("using it as an escalation ring") — zero cost on the happy
path; the CLIP vector match STAYS in the recipe as an independent data point
("all good redundancy"), with phash demoted to a near-exact fast path +
telemetry column and retired only if the accuracy benchmark shows it never
changes an outcome; target is a MEASURED 99% card identity under reasonably
good conditions, gated by a benchmark built from the owner's ground-truthed
sessions; verified scans feed the vector store (labeled query embeddings),
so matching improves with use.

The escalation's two halves: re-extraction first (the field extractor over
every full-crop line — the toploader rescue, since the card's own lines are
inside the sleeve crop; name candidates stay filtered to the measured name
band because "most letters after furniture" picks attack text 21/21 on a
full card, and a badge without a number is dropped — the bakeoff's one wrong
read for this config), then bodyLines -> rung 9 family-text. Family =
playable_fingerprint (name-only grouping merges distinct same-name cards);
scoring Dice over token sets with MIN_SHARED_TOKENS=6 / MIN_SCORE=0.40 /
MIN_MARGIN=0.15 — the loosest cell with zero wrong families over 1,504
simulated reads of 376 real cards; the shared-token floor, not the margin,
is load-bearing. Rung 9 returns confident only for a single-printing family;
a multi-printing family is matched:false WITH candidates (a family is not a
card). Storage: card.flavor_text + card_text token bags (migrations 049/050,
files only), maintained by the importer in the same transaction as the child
tables; the rung skips silently until prod runs migrations + a sync.
