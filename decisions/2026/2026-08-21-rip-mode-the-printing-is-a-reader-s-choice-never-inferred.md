---
date: "2026-08-21"
title: "Rip mode: the printing is a reader's choice, never inferred"
decided_by: "Claude, from the foil measurement."
areas: ["general"]
supersedes: []
---
## 2026-08-21 — Rip mode: the printing is a reader's choice, never inferred
**Decided by:** Claude, from the foil measurement.
**Decision:** Each row in the rip list carries its own printing selector,
defaulted to the primary variant and changeable by the reader. `commitRip` writes
the chosen `variantId`; the idempotency key is derived from resolved items so a
correction is not swallowed as a duplicate.

**Why:** The scanner matches **artwork**, and a card and its reverse holo share
artwork — the hash cannot separate them even in principle. Every booster pack
contains reverse holos, so the previous behaviour (always resolve `isPrimary`) did
not mis-file an edge case, it mis-filed a guaranteed fraction of every pack.

This is also the abstain path that foil detection needs: `research/FOIL-DETECTION.md`
concludes detection can only ever be a confidence-gated preselect, because under
bright diffuse light there is no signal to find. The one-tap control is required
whether or not detection ships, so it is built first and detection becomes an
optional layer on top rather than a prerequisite.

**Implications:**
- Variants are fetched as each card lands, not at commit — the reader can only
  correct a printing while the pack is still in their hand.
- A failed lookup costs the CHOICE, not the card: `commitRip` still falls back to
  resolving the primary printing itself.
- The selector renders only when there is more than one printing. A select with a
  single option is furniture that teaches readers to stop reading the row.
- Sized 13px to match the sibling quantity input. `theme.css:326` forces form
  controls to 16px below the nav breakpoint so iOS Safari does not auto-zoom on
  focus, so 13px is what desktop sees. Verified in-browser at 390px and 1280px.

