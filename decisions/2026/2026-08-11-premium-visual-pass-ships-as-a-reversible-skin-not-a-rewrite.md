---
date: "2026-08-11"
title: "Premium visual pass ships as a reversible skin, not a rewrite"
decided_by: "user (direction), agent (mechanism)."
areas: ["general"]
supersedes: []
---
## 2026-08-11 — Premium visual pass ships as a reversible skin, not a rewrite
**Decided by:** user (direction), agent (mechanism).
**Decision:** move the app off its pkmn.gg-derived flat look with a "premium"
pass — subtle dark neumorphism, procedural paper grain, plastic sheen on
filled controls, more interaction motion, and animated micro-illustration nav
icons — delivered as an **additive skin layer** rather than as edits to the
existing design system.

Every rule lives in `apps/web/src/premium.css`, scoped under
`:root[data-skin='premium']`. `lib/skin.ts` sets that attribute at boot from
`?skin=` → localStorage → `DEFAULT_SKIN`. A toggle in the dev design-system
header flips it live.

**Why a skin and not a redesign of theme.css:**
- The pass is a taste call being evaluated, not a settled requirement. It has
  to be reversible *while it is being looked at*, not only by `git revert`.
- Scoping to an attribute means classic is provably byte-identical: no rule in
  the file can match when the attribute is absent.
- Reverting for real is one constant (`DEFAULT_SKIN = 'classic'`), or deleting
  one CSS import.

**Implications / constraints this created:**
- The pass hangs off the design system's own utility classes
  (`.bg-surface-secondary.rounded-lg`, `.bg-track-subtle`, `input`), so ~93
  components upgraded without being edited. The cost is that those class
  combinations are now load-bearing for the skin — renaming a surface utility
  silently drops the relief on whatever used it.
- `--radius-*` is redefined under the skin. Tailwind compiles `rounded-lg` to
  `var(--radius-lg)`, so this re-shapes every corner at once. Highest-leverage
  line in the file; also the one most likely to surprise.
- Paper grain is composited as low-alpha (~3%) light speckle with a NORMAL
  blend, not `soft-light`/`overlay`. Measured in the browser: blending grey
  turbulence onto a near-black surface washes it milky grey. Alpha is baked
  into each SVG data-URI; those `opacity` values are the subtlety knob.
- Nav icons needed different *markup*, so `components/NavIcon.tsx` branches on
  `useSkin()` and falls back to `<Icon>` for classic. It must: the resting
  states of the animated parts are established by premium.css, so rendering
  that markup with the stylesheet inert would show every part at once.
- Animated icons draw on via `animation` keyframes, never a static hidden
  state. An unselected "Insights" missing its trend line reads as a broken
  icon, not a subtle one — caught in the browser on the first pass.
- `prefers-reduced-motion` drops the movement only. Relief, paper and sheen
  are not motion, so the pass degrades to a still premium look rather than
  back to flat.

**Not covered:** the signed-in surfaces (lists, decks/DeckBuilder, insights,
profile, scan) were not visually verified — no local session. They inherit the
shared surface vocabulary, so they should follow, but they are unconfirmed.

---

