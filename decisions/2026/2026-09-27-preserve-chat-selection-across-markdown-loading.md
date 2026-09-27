---
date: "2026-09-27"
title: "Preserve chat selection across Markdown loading"
decided_by: "Chey (via Codex)"
areas: ["agents"]
supersedes: []
---
## 2026-09-27 — Preserve chat selection across Markdown loading
**Decided by:** Chey (via Codex)

**Decision:** A background click in Deck-E's transcript does not dismiss the chat when the reader had selected answer text at pointerdown, or when the lazy Markdown renderer replaced the selected fallback node just before pointerdown. An ordinary background click still dismisses it.

**Why:** The initial plain-text fallback is selectable while the Markdown chunk loads. Replacing that fallback collapses the browser's selection, so the old click handler mistook a reader's selection for an empty-space click and closed the panel. A controlled browser case held the chunk until after selection and reproduced the close.

**Implications:** The transcript remembers the selected DOM anchor until the next pointerdown. A detached anchor suppresses one dismissal after Markdown replaces it; clearing a selection whose node is still attached does not. The browser suite holds and releases the Markdown chunk to keep this transition under test.
