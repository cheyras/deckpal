---
date: "2026-08-21"
title: "Deck-E attends a pack rip"
decided_by: "Claude, per the original brief."
areas: ["agents","decks"]
supersedes: []
---
## 2026-08-21 — Deck-E attends a pack rip
**Decided by:** Claude, per the original brief.
**Decision:** `character/host/ripPresence.ts`. He flies to the rip list when one
exists and reacts once per card as it lands: `alert_star` for a chase pull,
`nod_yes` otherwise, both `mode: 'once'`.

**Implications:**
- **Every export is a no-op when he is not loaded, and nothing throws into the
  rip path.** The scanner is a core feature; he is an enhancement behind an
  entitlement, so the rip may never depend on him.
- Reaction fires on the catalog's answer, not on commit — commit knows a name and
  a hash, not whether the pull was worth anything.
- The rarity bar is set at the CHASE tiers, not at "rare": every pack contains a
  guaranteed rare, so reacting to that is reacting to nothing.
- Rarity is matched as a LOOSE SUBSTRING pattern rather than by copying
  `apps/api/src/rarity.ts`'s 40-entry ladder across the app boundary. A second
  copy would rot silently; a substring miss costs a nod instead of a gasp.
- `once` not `sustain` — sustaining `alert_star` would leave him permanently
  startled at a list that has moved on.

