---
date: "2026-08-21"
title: "Deck-E's browser tools had never executed, and nothing said so"
decided_by: "Claude (Opus 5), on behalf of @cheyras. Implementing"
areas: ["agents","decks"]
supersedes: []
---
## 2026-08-21 — Deck-E's browser tools had never executed, and nothing said so
**Decided by:** Claude (Opus 5), on behalf of @cheyras. Implementing
`DECKE-AGENT-SPEC.md` rev 2.

**What was wrong.** `flyTo`, `goTo`, `highlight` and `scrollToMe` had never run.
Not once, for anyone, since the day they shipped. `useDeckeChat.ts` collected
forwarded tool calls with `part.type.startsWith('tool-') && part.state ===
'input-available'`, and `state` is not a field on that wire chunk. It is a field
on a UI MESSAGE PART — a different object that happens to share the vocabulary.
So the guard evaluated `undefined === 'input-available'` on every chunk that
ever arrived, `pending` never filled, and he narrated journeys the browser was
never told to take.

Nothing failed. No type error, no exception, no log line. A stream chunk that
matches no branch is not an error, it is silence.

**Proven rather than assumed.** `apps/api/src/decke/__tests__/wire.test.ts`
drives the real `buildTools()` through the real `createUIMessageStream` and
asserts the bytes: `{"type":"tool-input-available","toolCallId":"call_1",
"toolName":"goTo","input":{"route":"/decks"}}`. No `state`.

**Three repairs, because fixing only the first is wrong in a new way.**

1. Match `type === 'tool-input-available'`, name from `toolName`. NOT
   `type.slice('tool-'.length)` — that yields the string `"input-available"`,
   which is then dispatched as a tool name and answered "I do not know how to do
   that". A repair that looks like it worked.
2. Filter to `CLIENT_TOOLS`. Server-executed tools emit the identical chunk
   after they have already run — the test asserts `express` announces exactly
   like `goTo`. Unfiltered, the browser re-runs it, fails, and posts a second
   output contradicting the one the server already gave that call id.
3. One reader for every leg. `sendToolResults` understood only `text-delta`, so
   a tool call in a follow-up turn — which is what a journey is made of — was
   parsed, matched nothing, and vanished.

**The journey loop is governed by the client, not `stopWhen`.** A client tool
has no server `execute`, so it ENDS the server turn (`finishReason:
"tool-calls"`). The loop is: stream closes → browser runs tools → browser POSTs
a follow-up. Raising `stepCountIs` does nothing for navigation. The one-round
cap became `MAX_LEGS = 4`, and each leg is a full request re-billing the entire
prompt and history — a spend ceiling as much as a loop guard.

**Two further bugs found in the same file.** `sendToolResults` was passed the
USER's text as `saidSoFar` and replayed it to the model as the assistant's own
words. And history was read back out of `currentRef` after `setMessages`, a race
whose two outcomes were "history is right" and "history contains this turn
twice".

**Implications.** Verified in a real browser against the live backend, not
asserted: two legs, `goTo={"ok":true}` replayed in the follow-up request,
browser at `/decks`. `scripts/decke-gates.mjs` is that check, kept as a program
rather than a checklist — it asserts the WIRE, never the transcript, because the
transcript is written by the thing under test.

