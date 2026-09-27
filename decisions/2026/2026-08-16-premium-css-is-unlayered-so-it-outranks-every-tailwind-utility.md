---
date: "2026-08-16"
title: "premium.css is unlayered, so it outranks every Tailwind utility"
decided_by: "Claude, chasing a 24px band of bare background above the landing"
areas: ["frontend"]
supersedes: []
---
## 2026-08-16 — premium.css is unlayered, so it outranks every Tailwind utility
**Decided by:** Claude, chasing a 24px band of bare background above the landing
hero.

**Cause:** the landing page's skip-to-content link is `sr-only` (which needs
`position: absolute`) and also carried `bg-action-primary` for its focused
look. premium.css matches `.bg-action-primary` and sets `position: relative`, so
the visually-hidden link fell back into normal flow and its padding box pushed
`<main>` down 24px.

**The mechanism is cascade layers, not specificity — and this is the part worth
remembering.** Tailwind v4 emits utilities into `@layer utilities`.
premium.css is imported unlayered. **Unlayered CSS beats layered CSS at any
specificity**, so `.sr-only` and `.absolute` lose to a premium rule no matter
what. Wrapping the premium selector in `:where()` does nothing about this; an
earlier fix in this file assumed it did, and that assumption was wrong.

**Decision (tactical):** elements that need their own `position` and match one
of these skin selectors must state it where an unlayered rule cannot reach:
- inline `style` — LevelRing's avatar disc, which was offsetting by its `inset`
  instead of filling the ring;
- or by not carrying the class until visible — the skip link's decorated classes
  are all `focus:` variants now, so while hidden it carries only `sr-only`.

**The real fix, not taken here:** move premium.css into `@layer components`.
Then utilities win by layer order and none of this arises. It is a broad change
— every rule in the skin would start losing to any utility — and wants its own
visual regression pass rather than being smuggled into a spacing fix.

**Smell to watch for:** a Tailwind utility that "does nothing" under the premium
skin. Check premium.css before assuming the markup is wrong.

