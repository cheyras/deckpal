---
date: "2026-11-26"
title: "Quad labeler: agent suggestions you agree with or nudge, never labels"
decided_by: "Chey (via Claude Opus 5.5)"
areas: ["scanner", "labeler", "ml"]
supersedes: []
---
## 2026-11-26 — Quad labeler: agent suggestions you agree with or nudge, never labels
**Decided by:** Chey (via Claude Opus 5.5)

**Decision:** The 998 photos waiting in the quad labeler's queue get a **suggested label** each. The owner still reviews every photo, and the suggestion turns that review into one tap or a corner nudge.

**How a suggestion is made** (`scripts/label-assist`):
1. The shipping detector proposes a quad, on a crop made the way the owner crops.
2. A Sonnet agent fleet decides the verdict with a rulebook learned from the owner's 209 labels: card, card back, or one of the 11 rejection reasons. It also places rough corners.
3. A second pass places each corner from 3× close-ups. Two independent reads are averaged.

**How a suggestion is stored and used:**
- It is one object beside the queue: `PUT/GET /api/dev/scan-queue/suggestions`, `apps/api/src/dev/queueSuggestions.ts`.
- It never touches the queue or the corpus, so **a suggested photo stays not done**.
- In the labeler, a suggested photo shows a chip in the queue and opens straight in the editor, on the suggested square with the suggested corners. A banner shows the verdict and confidence, with **Agree**.
- Agree saves the suggestion as the owner's label. Nudging corners and pressing Save works as before.
- The saved label records `seededFrom: 'agent'` and `suggestion: {by, verdict, invalidReason?, confidence, agreed}`, so a harvest can tell confirmed suggestions from labels drawn by hand (HARVEST.md).

**Why:** The owner asked for "a good faith attempt by agents to get them correct first", with the agentic help kept from ever showing as done: "an agree to how it was classified or a quick nudge of a few corner points".

Validated blind on 59 frames the owner had already labelled:
- **Verdict:** 54/59 exact, reason included. All 24 answers the fleet marked high-confidence were exact. The 5 misses were all borderline blur or finger cases, where the owner is stricter than the written rule.
- **Corners:** a median of 5.0 px (of the 416 px square) from the owner's, with 23 of 29 cards within 8 px. The detector alone is at 11 px.
- **What did not help:**
  - The shipping refiner can only move a corner 1–3 px.
  - A tighter 5× zoom round made corners worse (12 px), because upscaling the 416 px frame adds blur, not detail.

Learned from the owner's labels and written into `RULEBOOK.md`:
- **The crop:** card centred, long side about 68% of the square.
- **Corners:** on the printed card's own edge, not the sleeve or slab.
- **Rejections:** "multiple cards, no clear foreground" for binder pages and spreads.
- **Stricter calls:** the owner rejects for blur and for fingers on corners more strictly than the written rule.

**Implications:**
- **The queue:** of 998 suggestions, 381 are cards, 21 card backs and 596 rejections (378 of those "multiple, no clear foreground"). Confidence: 384 high, 380 medium, 234 low.
- **Expected corner work:** most suggested cards should need at most a small nudge, and a few a real correction. Rejections should mostly be one tap.
- **For the harvest:** labels confirmed from a suggestion are the owner's verdict, but not independent of the agent.
- **For training:** a harvest that measures the detector against human quads should weight or hold out the confirmed rows.
- **Not run on new uploads automatically:** re-running `scripts/label-assist` for new uploads is a manual step.
