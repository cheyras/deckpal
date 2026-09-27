---
date: "2026-09-26"
title: "Keep route announcements accurate through slow page loads"
decided_by: "Chey (via Codex)"
areas: ["frontend","operations"]
supersedes: []
---
## 2026-09-26 — Keep route announcements accurate through slow page loads

**Decided by:** Chey (via Codex)

**Decision:** The route announcer writes its live region only when a new heading differs from the previous route's heading and keeps watching the current route after the four-second title fallback. The next navigation replaces that observer.

**Why:** Replacing an unchanged live-region text node can make screen readers repeat the same heading. A catalog request can also finish after the fallback timer, especially when the previous set's heading remains visible while new data loads. The fallback must not end observation before the real heading arrives.

**Implications:** Repeated page mutations leave the announcement untouched. A retained old heading cannot mark a new navigation complete or overwrite the title fallback after an error, while a late new heading can still replace that fallback. The observer watches only the React root, so writing the sibling live region cannot feed back into it.

