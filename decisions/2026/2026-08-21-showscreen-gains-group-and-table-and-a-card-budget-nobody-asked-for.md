---
date: "2026-08-21"
title: "`showScreen` gains `group` and `table`, and a card budget nobody asked for"
decided_by: "Claude (Opus 5), on behalf of @cheyras."
areas: ["frontend","catalog"]
supersedes: []
---
## 2026-08-21 — `showScreen` gains `group` and `table`, and a card budget nobody asked for
**Decided by:** Claude (Opus 5), on behalf of @cheyras.

**Decision.** Two new block kinds, a caption on `cardGrid` (reusing `text`
rather than adding a field), the block cap raised 8 → 12, real card art, and a
new screen-wide `SCREEN_CARD_BUDGET = 60`.

**The budget is the important one and it was not in the brief.** Raising the
block cap created it: 12 blocks x 60 cards is 720 catalog lookups the browser
makes, triggerable by a single tool call. The per-grid cap becomes a per-screen
budget spent in block order, counting grids nested inside groups. A grid that
does not fit is dropped WHOLE with a reason, never truncated — a half-shown grid
is a lie about what was found.

**Depth is limited structurally, not by a rule.** A `group` column is TYPED as a
leaf block, so a nested group is a sentence the schema cannot express. No
`z.lazy`, no recursion driven by model output.

**Every new kind rejects rather than clamps.** A short table row is refused
rather than padded — the case that most looks like it deserves the `quantities`
treatment and least does, because padding means inventing which column a figure
belongs to. The one permitted clamp is unchanged.

**Card art resolves safely.** The model supplies a catalog ID; the APP resolves
it through `cardSource.artForIds`, and the model's string only ever reaches
`encodeURIComponent` in a path. Three states are kept deliberately distinct:
resolved → art, still-asking → skeleton, resolved-to-nothing → the honest
monospace id. A slow network must not look like a hallucinated id.

**The sync hazard this file flagged is now checked.** The 2026-08-21 adversarial
review left `BLOCK_KINDS` ↔ renderer and `WireCommand` ↔ `tools.ts` as "real
extension hazards … worth a shared type when either list next changes." This was
that moment. A test reads the server's source as text and compares — the
`uiTools.test.ts` precedent, since `deckpal-web` does not depend on
`deckpal-api`. Rejected: a shared type (`packages/` is the wrong home for one
character's vocabulary) and codegen (it puts a build step between a clone and a
running app, which `CLAUDE.md` promises there is not). The test was
mutation-tested to confirm it fails when the lists disagree.

