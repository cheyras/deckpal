# scripts/label-assist: suggested labels for the quad labeler's queue

The labeler queue holds photos waiting to become labels: a card's four
corners, or a reason the shot is rejected. This pipeline makes a good-faith
**suggestion** for each one. The owner still reviews every photo, and a
review becomes one tap (**Agree**) or a corner nudge instead of a label from
scratch.

A suggestion is never a label:

- It is stored beside the queue (`PUT /api/dev/scan-queue/suggestions`, one
  object: `apps/api/src/dev/queueSuggestions.ts`).
- The photo stays in the queue, not done, until the owner saves a label.
- That saved label records the suggestion it started from
  (`seededFrom: 'agent'`, `suggestion: {verdict, confidence, agreed}`), so a
  harvest can tell confirmed suggestions from labels drawn by hand.

## The pipeline

Data lives outside git under `~/deckpal-data/labeler` (`LABEL_ASSIST_DIR`);
the photos are the owner's.

| step | what | command |
|---|---|---|
| 0 | pull queue listing + labels (as QA) | see "Pulling" below |
| 1 | the detector against the owner's own labels | `node --import tsx scripts/label-assist/calibrate.ts` |
| 2 | detector proposals + review images | `node --import tsx scripts/label-assist/propose.ts <queue\|validate>` |
| 3 | fleet pass 1: verdict + rough corners | Sonnet agents with `RULEBOOK.md` → `fleet/<mode>/batch-*.json` |
| 4 | answers → suggestions | `node --import tsx scripts/label-assist/merge.ts <mode>` |
| 5 | corner close-ups | `node --import tsx scripts/label-assist/zoom.ts <mode>` |
| 6 | fleet pass 2: exact corners (two independent reads) | → `fleet2/`, `fleet2b/` |
| 7 | apply the averaged corners | `FLEET=fleet2,fleet2b REFINE=off node --import tsx scripts/label-assist/apply-corners.ts <mode>` |
| 8 | upload | `node scripts/label-assist/upload.mjs` |

`validate` mode runs the same steps on frames the owner already labelled,
blind, and scores the result against their labels. Run it before trusting a
change to the rulebook or the steps.

## What was learned from the owner's labels (2026-11-26, 209 labels)

- **Crops:** 60 of 133 uploads use the centre square. The rest zoom so the
  card sits centred, its long side about 68% of the square (p10 45%, p90 84%).
  `propose.ts` crops that way.
- **The detector disagrees with the owner:** a median of 11 px (of 416) on 116
  cards. It locks onto graded slabs, sleeves, piles and the card underneath;
  the owner marks the printed card's own edge. The refiner moves a corner only
  1–3 px, so it cannot repair that.
- **Rejections:** 45 of 93 are "multiple cards, no clear foreground" (binder
  pages, spreads). On blur and fingers the owner is stricter than the written
  rule; `RULEBOOK.md` says how.

## Validation (blind, 59 owner-labelled frames)

| | result |
|---|---|
| verdict (incl. reason) | 54/59 exact; the 24 `high`-confidence answers all exact |
| corners, pass 1 only | median 9.5 px off the owner's |
| corners, pass 2 (one read) | median 6.3 px; 21/29 cards within 8 px |
| a tighter 5× zoom round | worse (12 px): upscaling a 416 px frame adds blur, not detail. Dropped |

## Pulling

`propose.ts` expects `queue.json` (the `GET /api/dev/scan-queue` listing) and
the photos in `~/deckpal-data/quad-queue/raw` (`scripts/scan-bench/queue-pull.mjs`).
`calibrate.ts` and validation expect `labels/<id>.json|png`, the
`quad-label` rows of `GET /api/dev/scan-flags` (`HARVEST.md` §1).
