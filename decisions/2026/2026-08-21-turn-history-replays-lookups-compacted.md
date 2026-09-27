---
date: "2026-08-21"
title: "Turn history replays lookups, compacted"
decided_by: "@cheyras, choosing between three options Claude put."
areas: ["general"]
supersedes: []
---
## 2026-08-21 — Turn history replays lookups, compacted
**Decided by:** @cheyras, choosing between three options Claude put.

**What was wrong.** `messagesToWire` kept text and nothing else, so turn N+1 had
no record that turn N read 604 cards — only its own prose about them. That
re-creates the original fabrication pathology in a new form: he asserts from his
own earlier sentences rather than from data, and a sentence is exactly the thing
that drifts. "You've got 70 of them" becomes "most of them" becomes a number
nobody looked up.

**The three options.** Replay everything (truthful; input bill grows without
bound on a long conversation, colliding with the per-turn input budget the tool
ceiling exists to defend). Re-read per turn (always fresh; costs a tool call and
a round trip on every follow-up question). Replay COMPACTED — what a lookup
FOUND, in one line, not its 200 rows.

**Decision: compacted.** The compact form is the chip's own summary, which is
the first line of the real tool result produced by the server's execute wrapper.
So the record cannot describe a lookup that did not happen — there is no chip
without an invocation.

**Marked as a record, not folded into his speech.** Appending "I read 604 cards"
to his words would put sentences in his mouth he never said, and the next turn
would replay them as if he had.

