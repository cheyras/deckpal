---
date: "2026-08-16"
title: "Layer only the sheen scaffolding, not all of premium.css"
decided_by: "Claude, at the user's request, after measuring the override"
areas: ["frontend"]
supersedes: ["2026-08-16 move premium.css into @layer components suggestion"]
---
## 2026-08-16 — Layer only the sheen scaffolding, not all of premium.css
**Decided by:** Claude, at the user's request, after measuring the override
surface. **Supersedes** the "move premium.css into `@layer components`"
suggestion in the entry above — that was the right diagnosis and the wrong
remedy.

**The measurement.** premium.css is 878 lines / 88 rule blocks. Declarations
that can collide with a Tailwind utility:

| property | live rules | note |
|---|---|---|
| `transform` | 25 | 9 more sit in `@keyframes`, which layers do not touch — animations are a separate cascade origin above normal declarations |
| `box-shadow` | 17 | the relief pass; 14 distinct selectors |
| `position` | 8 | the only property that has actually caused bugs |
| `background` | 7 | |
| `border-radius` / `border-color` | 4 each | |
| `z-index` / `overflow` / `isolation` | 2–3 each | |

Nearly all of that is *intended*: restyling `.bg-surface-tertiary` and friends
is the entire point of the skin. Only a narrow case fails — an element that
carries a skin-matched class **and** needs a specific layout property of its
own. Three found, all `position`: the landing skip link, LevelRing's avatar
disc, the card sheet's close button.

**Why not layer the whole file.** Moving all of premium.css into
`@layer components` hands `shadow-panel` (11 uses), `shadow-lg` (4) and
`shadow-xl` (1) a win over premium's relief `box-shadow` wherever an element
carries both — and those shadows *are* the premium pass. It would need all 16
usages checked against the 14 box-shadow selectors plus a visual pass over
inputs, the header, the sidebar and the profile card. Large blast radius to fix
a problem that only manifests in one property.

**Decision.** Layer only the scaffolding: the rule blocks whose whole job is
`position: relative; isolation: isolate; overflow: hidden` so a `::after` sheen
has a containing block. Those three properties are plumbing, never the point of
the skin, and `absolute`/`fixed`/`sticky` host a `::after` just as well as
`relative` does — so the sheens are unaffected while every positioning utility
starts working again.

**Plan**
1. Wrap the two sheen-scaffolding blocks (the `.btn-fill-*` / `.bg-action-*`
   group, and `.bg-surface-tertiary.rounded-full`) in `@layer components`.
   `@import 'tailwindcss'` in theme.css already declares the layer order, so an
   `@layer components` block in premium.css appends beneath `utilities`.
2. Verify in the BUILT css that the block really nested — a mis-scoped
   `@layer` silently becomes a no-op and everything still "looks fine".
3. Revert the two workarounds this made unnecessary: LevelRing's inline
   `position`, and (optionally) the card sheet header's spacer-based layout.
   Leave the skip link's `focus:`-only classes — those are correct regardless.
4. Audit for remaining casualties: any element whose className carries both a
   premium-matched class and a positioning utility.
5. Visual pass on the surfaces those selectors touch: buttons, pills, the
   profile ring, the card sheet.

**Acceptance:** a positioning utility on an element matching those selectors
wins; sheens still render on buttons and pills; no visual diff elsewhere.

**Not in scope:** the box-shadow, background, radius and transform rules stay
unlayered. If those ever need to lose to a utility, that is a separate decision
with a real regression pass behind it.

**Tracked as:** https://github.com/cheyras/deckpal/issues/44

**Smell to watch for meanwhile:** a Tailwind utility that "does nothing" under
the premium skin. Check premium.css before assuming the markup is wrong.

