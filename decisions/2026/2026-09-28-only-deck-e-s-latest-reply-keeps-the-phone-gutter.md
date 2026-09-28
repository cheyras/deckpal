---
date: "2026-09-28"
title: "Only Deck-E's latest reply keeps the phone gutter"
decided_by: "Chey (via Claude)"
areas: ["decke"]
supersedes: []
---
## 2026-09-28 — Only Deck-E's latest reply keeps the phone gutter
**Decided by:** Chey (via Claude)

**Decision:** On phones, only the text bubbles of Deck-E's latest reply carry the `.decke-beside` gutter. His earlier replies take the whole column (`.decke-settled`). This refines 2026-09-27 ("Deck-E phone chat keeps widgets full width and rides with his latest reply"), which gave every reply of his the gutter.

**Why:** Chey, asked the #258 follow-up question: only the latest, "because he is now supposed to scroll out of the frame with the top of his latest text box". Since #258 he never stands higher than his latest reply's top, so a gutter on an older reply held space for nobody and cost every earlier answer a gutter's width of line length.

**Implications:** A reply gives up its gutter once, when the next turn starts (the new assistant message becomes the latest), and never while the reader scrolls, so the 2026-09-27 no-width-change-on-scroll guarantee holds. The `decke-chat-phone` browser case now also asserts that the first answer's long paragraph is full column width and that the latest answer's words are indented past him. On desktop the gutter is 0, so nothing changes there.
