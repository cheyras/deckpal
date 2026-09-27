---
date: "2026-08-12"
title: "Every colour now resolves to a named scale"
decided_by: "user (direction), agent (mapping)."
areas: ["general"]
supersedes: []
---
## 2026-08-12 — Every colour now resolves to a named scale
**Decided by:** user (direction), agent (mapping).

**Decision.** The palette is: primary = Tailwind **cyan**, secondary = **pink**,
tertiary = **amber**, surfaces/borders/text = **stone**, positive = **emerald**,
negative/danger = **red**, warning = **orange**. Semantic tokens reference
`--color-brand-*` rather than repeating hex, so a future recolour is one line
per family instead of a hunt.

Hexes are Tailwind **4** values converted from its oklch source. v4 shifted
these from v3 — cyan-400 is `#00d3f3`, not v3's `#22d3ee`; stone-400 is
`#a6a09b`, not `#a8a29e` — so anything copied from a v3 chart is subtly off from
the utility classes.

**The grey problem.** text-body/secondary/muted and the icon ramp were blue-cool
(`#c1c7d8`, `#7f8596`, `#484f60`). Invisible against neutral surfaces, a clear
colour cast against warm ones. Each was re-derived in OKLCh: keep its lightness
EXACTLY, adopt stone's chroma and hue interpolated at that lightness. Contrast is
therefore preserved by construction — text-body 10.61→10.31, text-secondary
6.72→6.60, text-muted 4.86→4.75, and 4.11→4.12 on a panel.

**Strays retired:**
- `action-brand` was blue-400, a fourth unrelated hue, and 5 of its 7 uses are
  icon tints inside neutral chips. Folded into primary. Amber would have given
  the external/commerce role its own colour, but PurchaseSetMenu renders
  `text-warning` orange in the same panel and amber-beside-orange is muddy.
- `completion-grandmaster` was `#9b6bff`. Now amber — gold reads as the top
  tier, it pairs against `success` green in ProgressCluster, and it finally
  gives the tertiary scale a job.
- `pro-pink` was `#7f42ff`. Now pink-**600**, not 500: it is a 9px badge and
  white on pink-500 measures 3.58:1, under the 4.5:1 that size needs. 4.54:1.
- The `#ffe165` leftovers (`glow-active`, `overlay-ring`, `halo-neutral`) were
  from the original pkmn-derived palette and matched nothing. Now primary.
- `success` was green-400 while `change-positive` was emerald — two greens.
  Both emerald now.
- Deleted with zero usages: `pro-accent`, `pro-accent-text`, `announcement`,
  `announcement-text`, `icon-active`.

**Deliberately NOT swept:** the eleven `--color-energy-*` tokens. Those are the
TCG's own type identities (grass green, fire orange, water blue) and are read as
data, not as brand. Pulling them toward the palette would make them wrong.

**Fixed in passing:** `action-brand-text` was white — 2.54:1 on the old blue,
and would have been 1.81:1 on cyan. Now cyan-950 at 7.42:1.

---

