---
date: "2026-08-16"
title: "Tabs underline padding: source omission, not a cascade bug"
decided_by: "Claude (on behalf of @cheyras). Fixes #42."
areas: ["general"]
supersedes: []
---
## 2026-08-16 — Tabs underline padding: source omission, not a cascade bug
**Decided by:** Claude (on behalf of @cheyras). Fixes #42.
**Decision:** Tabs.tsx underline-variant className changed from `pb-[10px]`
to `py-[10px]`.
**Why:** `padding-top` was 0px because no `pt-` utility was ever in the
className string — confirmed via computed styles, which ruled out the
premium.css layering mechanism (that fix touched sheen scaffolding, not
tabs; padding was byte-identical under Premium and Classic skins).
**Implications:** None beyond the fix — the pill variant never had the bug
and is unchanged. The residual ~2px visual asymmetry is the `border-b-2`
underline indicator, by design.

