---
date: "2026-08-16"
title: "Own the last word on scroll-to-top"
decided_by: "Claude (on behalf of @cheyras). Fixes #40."
areas: ["general"]
supersedes: []
---
## 2026-08-16 — Own the last word on scroll-to-top
**Decided by:** Claude (on behalf of @cheyras). Fixes #40.
**Decision:** main.tsx registers a `router.subscribe('onRendered', ...)`
listener after `createRouter()` that nudges `scrollY` to 1 (not 0) after
every route render, gated on `scrollY === 0` so native back/forward scroll
restoration is untouched. theme.css gives `body` a
`min-height: calc(100dvh + 1px)` so every page has 1px of scroll runway.
**Why:** TanStack Router's own internal `onRendered` subscriber
unconditionally resets scroll to exactly 0 on every render (regardless of
the unset `scrollRestoration` option) — and scrollY 0 is the one state iOS
Safari 26 ("Liquid Glass") paints its fallback root color behind the
translucent status bar instead of real content, cutting off page titles.
Subscriber order = registration order, so registering after `createRouter()`
gets the final say.
**Implications:** Any future code wanting the final word on post-render
scroll must register its `onRendered` subscriber after this one. The
theme.css runway rule and the main.tsx nudge are a pair — removing either
alone reintroduces the bug on short pages. Verified mechanically in
Chromium; the Safari-26 compositor symptom still needs an on-device check
after deploy.

