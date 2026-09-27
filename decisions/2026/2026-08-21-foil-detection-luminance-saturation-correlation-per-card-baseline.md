---
date: "2026-08-21"
title: "Foil detection: luminance/saturation correlation, per-card baseline"
decided_by: "Claude, from measurement; owner supplied the dataset."
areas: ["scanner","catalog"]
supersedes: ["roadmap/plans/foil-main.md reverse holo frame-only assumption"]
---
## 2026-08-21 — Foil detection: luminance/saturation correlation, per-card baseline
**Decided by:** Claude, from measurement; owner supplied the dataset.
**Decision:** Reverse-holo detection uses **`corrLS`** — the Pearson correlation
between per-pixel luminance and saturation over the rectified card face, averaged
across a ~5-frame window — compared against a **per-card baseline**. Not an
absolute threshold.

**Why:** A specular highlight is achromatic, so where foil catches light it goes
white and luminance anticorrelates with saturation; matte card brightness is
bright *art*, which keeps its hue. Measured over 146 labelled frames (3 cards ×
2 variants × 3 lightings, with sleeve-finish crossed against variant):
leave-one-pair-out **AUC 0.988**, worst pair 0.95, 8/8 pairs agreeing on
direction. The statistic is a bounded correlation coefficient — no fitted
parameters, so there is nothing to overfit.

**Implications:**
- **Needs a per-card reference.** Absolute values are set by the artwork (Kakuna
  sits at +0.16, Ninetales at −0.31); a global threshold overlaps by 0.431. This
  is affordable because pHash identifies the card before variant is asked.
- **Runs client-side.** The signal survives the live scanner's 480 px/q0.85
  encode but is destroyed by `phash.ts`'s 72×64 greyscale field, so detection
  taps the canvas rather than the hash path, and needs no upload.
- **Multi-frame is mandatory** — the sheen fires intermittently with tilt angle.
  Single-frame AUC is ~0.85; five frames is ~0.99.
- **Ships as a confidence-gated preselect** with an abstain path. The abstain path
  is a one-tap variant choice, which is also the total-failure fallback, so it is
  built first regardless.
- Rejected: texture/sparkle features (at or below chance, and they flip sign),
  and rejecting tilted frames (that selects against the signal — see
  `research/FOIL-DETECTION.md`).

**Supersedes** the assumption in `roadmap/plans/foil-main.md` that reverse holo
foils only the card frame: in the SV era it foils the whole card, art included,
so era layout rects are not a dependency for *detection*.

