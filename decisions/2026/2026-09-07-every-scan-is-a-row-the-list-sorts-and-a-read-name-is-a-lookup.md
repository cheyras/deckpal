---
date: "2026-09-07"
title: "Every scan is a row, the list sorts, and a read name is a lookup"
decided_by: "Not recorded"
areas: ["scanner"]
supersedes: []
---
## 2026-09-07 — Every scan is a row, the list sorts, and a read name is a lookup

Owner rulings from field session 4 (the first on the full recipe — "It's
working a lot better"): (1) EVERY SCAN IS ITS OWN ROW — the automatic
same-card quantity merge is gone, because a normal and a reverse holo of one
card need two rows with two printing selectors; commit aggregates identical
(card, printing) rows client-side before the wire (foldCommitLines), and the
250-item batch cap plus the idempotency fingerprint are why that fold is
client-side. (2) SORT on the verify list — default first-scanned-on-top
(reversing the old newest-first), plus newest-first and set order both ways;
unnamed rows pin to the top of set order. (3) No horizontal scroll — the
printing select's automatic minimum size (its longest option) was pushing
rows past the viewport, and overflow-y-auto alone computes overflow-x to
auto. (4) "read Ultra Ball, showed zero Ultra Balls": a read name is now a
LOOKUP (rung 5b, name families from the catalog, showable candidates,
confident only for a sole exact-read printing), not a sieve over phash's
top-25; the picker shows the ladder's candidates above phash's with a seam,
and no percentage where phash has no opinion. (5) The install pill hides on
the scan/labeler surfaces (it sat on the labeler's corner controls), and the
camera's play() await gets the same bound the labeler's hang taught.

