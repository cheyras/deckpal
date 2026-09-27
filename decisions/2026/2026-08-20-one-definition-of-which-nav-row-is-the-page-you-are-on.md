---
date: "2026-08-20"
title: "One definition of \"which nav row is the page you are on\""
decided_by: "Claude Opus 5 on behalf of @cheyras."
areas: ["frontend"]
supersedes: []
---
## 2026-08-20 — One definition of "which nav row is the page you are on"
**Decided by:** Claude Opus 5 on behalf of @cheyras.

**Decision:** `isNavActive(pathname, item)` in AppShell.tsx is the single test,
used by the rail, the expandable row and the mobile drawer.

**Why:** The drawer passed a hardcoded `active={false}` while the rail computed
the answer inline (#52). On a phone the drawer is the ONLY navigation, so the
one surface that got it wrong was the one where being wrong cost the most: the
current page was never highlighted, on any route. Two copies of an expression
that must agree is the shape of that bug, so there is now one copy.

**Implications:** Adding a nav surface means calling `isNavActive`, not
re-deriving it. Verified in the browser: `data-active` is `true` on My Lists in
both the rail and the drawer at 390px, and the premium skin's lit recess and
accent edge now appear in the drawer.

