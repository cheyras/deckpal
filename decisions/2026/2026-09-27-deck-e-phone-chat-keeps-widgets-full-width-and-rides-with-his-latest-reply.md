---
date: "2026-09-27"
title: "Deck-E phone chat keeps widgets full width and rides with his latest reply"
decided_by: "Chey (via Claude)"
areas: ["decke"]
supersedes: []
---
## 2026-09-27 — Deck-E phone chat keeps widgets full width and rides with his latest reply
**Decided by:** Chey (via Claude)

**Decision:** On phones, widgets (card grids, lists, tool rows, screens) are always full width and never resize for Deck-E. Only his own text bubbles carry a fixed left gutter (`.decke-beside`). He is anchored to the top of his most recent response (`data-decke-anchor`; a spacer after a trailing widget), stays sticky until the reader scrolls past that top, then rides off with it by a compositor transform written from the scroll handler. His canvas is clipped at his resting line so he never draws over the content below. No element's width is toggled on scroll.

**Why:** The old layout narrowed any element whose bottom sat below his head (widgets included). Narrowing re-wrapped the element, moved it across the line, widened it again, at scroll rate: measured 30 widget width changes and 134 layouts in one scroll in Chromium, 21 in WebKit, and he covered widgets while it flipped.

**Implications:** The `decke-chat-phone` browser suite pins it frame by frame at 390px in Chromium and WebKit: zero widget or text width changes, zero drawn overlap with a widget, widgets at least 356px wide, he rests on his anchor, and layouts stay near one per scroll step. A new message type that should sit beside him needs `.decke-beside`; anything else stays full width.
