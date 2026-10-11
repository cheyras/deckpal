---
date: "2026-10-10"
title: "Owner-photo truth: queue photos become verified scanner test data outside git"
decided_by: "Chey (via Claude Opus 5.5)"
areas: ["scanner", "ml", "tooling"]
supersedes: []
---
## 2026-10-10 — Owner-photo truth: queue photos become verified scanner test data outside git
**Decided by:** Chey (via Claude Opus 5.5)

**Decision:** The owner's labeler-queue photos become the scanner's real-photo
test data, through three dev scripts in `scripts/scan-bench/`:

- `queue-pull.mjs` reads the queue as the QA account.
- `extract_cards.py` proposes card crops at the scanner's capture geometry.
- `label_cards.py` tiers each crop with the production embedding pairing.

The scripts only PROPOSE. A crop counts as truth only after someone has read
its set symbol and number strip by eye and written it into a
`verify-truth.jsonl` row. Everything stays under `~/deckpal-data/quad-queue/`
(override: `SCAN_QUEUE_DIR`). Every write is checked before it happens, the
queue root and each file in it, and refused if it resolves inside the repo. The
check compares real paths, with symlinks and junctions resolved (dangling ones
included) and case folded on Windows. `label_cards.py`
gets its threshold gate only from a gallery tag it knows exactly. Any other
model must name `--model-id`.

**Why:** The scanner's benchmarks were catalogue renders and telemetry crops,
229x320 pixels at best. The owner's real photos are the distribution the
product meets: binder pages, sleeves, glare, colour casts. On those photos the
live ladder was confidently wrong 23 times in 105, mostly the right card in the
wrong printing. None of the existing benches showed that, and the reprint guard
(#294) exists because this data did.

Verification is by eye because the matcher's own answer is what is under test.
A crop labelled by the model would only measure the model against itself.

The photos are the owner's, so they cannot go into git, not even by a
mis-set variable. Astra's review of #298 found that a different-case spelling of
the checkout (`E:\USERS\...`) slipped past a lexical check on Windows.

The same review found a CLIP-named checkpoint borrowing ViT-B/32's thresholds.
A gate is measured on one vector space and means nothing on another.

**Implications:**

- The verified sets so far are `quad-verify` (300 crops) and `quad-verify2`
  (361, held out). They are merged in `verify-truth-all.jsonl` (719 unique
  crops). They live in a separate bench root, `~/deckpal-data/scan-bench-quad`,
  so they never mix with the catalogue datasets.
- A held-out set must stay held out. Do not train on `quad-verify2`.
- `SCAN_QUEUE_DIR` is a developer-machine variable, recorded in
  `DEPLOYMENT.md`'s table like `DRIVE_EXPORT_CREDENTIALS`. It never goes in
  Vercel.
- `scripts/scan-bench/test_queue_tools.py` and
  `scripts/scan-bench/__tests__/queue-guard.test.mjs` cover the reproduced
  review cases: the case bypass, child directories and files linked back into
  the repo (dangling links included), a card's duplicate inner contours, and an
  unknown CLIP checkpoint. The guard is not a defence against someone racing
  the script to swap a link after the check.
