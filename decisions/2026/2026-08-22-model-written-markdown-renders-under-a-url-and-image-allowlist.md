---
date: "2026-08-22"
title: "Model-written markdown renders under a URL and image allowlist"
decided_by: "Claude."
areas: ["agents","images"]
supersedes: []
---
## 2026-08-22 — Model-written markdown renders under a URL and image allowlist
**Decided by:** Claude.
**Decision:** `lib/markdownSafety.ts` is shared by the chat renderer and the deck
strategy view. Links are limited to http/https/mailto plus relative; **no remote
image is ever fetched** — the alt text is shown instead.

**Why:** `routes/deck/MarkdownView.tsx` renders `strategyMd`, which Deck-E's own
`deck_strategy` tool writes over a context including card text, deck descriptions
and list names — strings other people typed. Its component map had no `img` entry,
so react-markdown's default applied and a remote image in a strategy guide was a
tracking beacon firing on render, handing the reader's IP and referrer to whoever
got a string into that context.

**Implications:** pinned by tests that render genuinely hostile input through both
surfaces and assert the attacker's host does not appear in the output; verified
failable by removing the guard from one surface and watching only that one go red.

