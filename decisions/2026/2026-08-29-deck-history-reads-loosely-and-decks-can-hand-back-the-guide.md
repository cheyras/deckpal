---
date: "2026-08-29"
title: "deck_history reads loosely, and `decks` can hand back the guide"
decided_by: "Claude (Fable 5) on behalf of @cheyras (Deck-E reliability pass)"
areas: ["decks","frontend"]
supersedes: []
---
## 2026-08-29 — deck_history reads loosely, and `decks` can hand back the guide

**Decided by:** Claude (Fable 5) on behalf of @cheyras (Deck-E reliability pass)
**Decision:** `deck_history` resolves its deck with `strict: revert_to !==
undefined` instead of unconditionally strict, and echoes the resolver's
`picked.note` on the timeline and snapshot returns. `decks` gains
`include: ['strategy']`, which renders the full strategy-guide markdown from
the deck-detail payload it already fetches.
**Why:** Two of `deck_history`'s three modes are GETs, but all three paid the
write branch's price — in one measured turn `decks({deck_id:'slowking
toolbox'})` returned the deck and `deck_history` refused the same words.
Separately, `decks` reported the guide only as a label plus character count, so
reading it meant a second, approval-gated `deck_strategy` call; Deck-E kept
quoting "14k characters" and offering that call instead of answering.
**Implications:** `revert_to` is unchanged — still strict, still ≤N ranked
candidates and never a guess (pinned by a test). Read paths now name the deck
they picked. The guide renders in full and last: in full because
`deck_strategy`'s read branch returns no less, last because it is the only
unbounded section in that response. Zero extra API calls.

