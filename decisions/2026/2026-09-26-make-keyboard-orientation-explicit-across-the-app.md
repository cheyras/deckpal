---
date: "2026-09-26"
title: "Make keyboard orientation explicit across the app"
decided_by: "Chey (via Codex)"
areas: ["operations"]
supersedes: []
---
## 2026-09-26 — Make keyboard orientation explicit across the app

**Decided by:** Chey (via Codex)

**Decision:** The shared skip link is an explicit first Tab stop in WebKit, paints below the phone header in a reserved row while focused, and focuses the `main` landmark on activation. The first visible control in `main` receives an explicit Tab stop for WebKit's default keyboard setting. Empty card counters show `+` on hover or keyboard focus. Opening Deck-E closes the phone navigation drawer without returning focus to Menu; opening the drawer minimises an open Deck-E chat before the drawer traps focus. Route announcements use a page-specific label when a visual heading is shared, including the admin section and a card's set and number; query-only URL changes on the same page keep the existing announcement watcher.

**Why:** On a fresh page, WebKit skipped the ordinary skip-link anchor; on phones, the link's transparent face could disappear into the header. The hash alone left focus on the document body. A blank counter was easy to mistake for a lost focus stop between cards. Identical headings on distinct routes made the announcer fall back to a generic title. Astra found that opening Deck-E above a modal drawer could leave its focus trap active, and a debounced search URL change could announce the generic site title four seconds later.

**Implications:** Enter and click on the skip link focus content, and the next Tab reaches a content control. Each card counter remains a separate, visibly named action; card links retain one Tab stop each. Deck-E and the phone drawer do not hold focus at once, regardless of opening order. Admin sections and same-name cards announce their actual destination; search filter changes preserve `Search`. Browser checks cover Chromium and WebKit at desktop and phone widths, card-grid Tab order, overlay focus, and same-heading navigation.

