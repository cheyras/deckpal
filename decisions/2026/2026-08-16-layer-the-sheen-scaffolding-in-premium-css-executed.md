---
date: "2026-08-16"
title: "Layer the sheen scaffolding in premium.css (executed)"
decided_by: "Claude (on behalf of @cheyras). Executes the plan logged above; fixes #44."
areas: ["frontend"]
supersedes: []
---
## 2026-08-16 — Layer the sheen scaffolding in premium.css (executed)
**Decided by:** Claude (on behalf of @cheyras). Executes the plan logged above; fixes #44.
**Decision:** Only the two sheen-scaffolding rule blocks (the
`.btn-fill-*`/`.bg-action-*` group and `.bg-surface-tertiary.rounded-full`)
moved into `@layer components`. Everything else in premium.css stays
unlayered. LevelRing's inline-position workaround reverted; the card sheet
header's spacer layout kept (it is a layout convenience, not a workaround).
**Why:** As planned — layers resolve before specificity, so the unlayered
scaffolding beat every positioning utility (`absolute`, `fixed`, `sr-only`)
on matched elements. `@layer components` sits beneath `utilities` in the
order declared by `@import 'tailwindcss'`, and any position value hosts a
`::after` sheen as well as `relative` does.
**Implications:** The box-shadow/background/radius/transform rules remain
unlayered by design — making those lose to utilities is a separate decision
with a 16-selector regression pass behind it. Casualties confirmed fixed:
Profile avatar edit button, LevelRing level badge and avatar disc (the
"empty profile image" of #41 was this bug), Pokédex dex-count badge,
CardTile badge, landing skip-link. Any future scaffolding-only rule in
premium.css goes inside `@layer components` too.

