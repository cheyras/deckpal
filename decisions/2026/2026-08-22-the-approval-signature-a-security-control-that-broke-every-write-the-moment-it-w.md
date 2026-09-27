---
date: "2026-08-22"
title: "The approval signature: a security control that broke every write the moment it was switched on"
decided_by: "Claude (Opus 5) on behalf of @cheyras, after an adversarial review by a Fable subagent returned DON'T SHIP."
areas: ["security"]
supersedes: []
---
## 2026-08-22 — The approval signature: a security control that broke every write the moment it was switched on
**Decided by:** Claude (Opus 5) on behalf of @cheyras, after an adversarial review by a Fable subagent returned DON'T SHIP.

`experimental_toolApprovalSecret` makes the SDK sign each approval and verify the
signature when it comes back, so a client cannot forge "the reader said yes". We
set `DECKE_APPROVAL_SECRET` in Production and Preview. The reader captured the
approval's `approvalId`, `toolCallId`, name and input from the
`tool-approval-request` chunk — and dropped `signature`.

**With the secret set, every approved write then failed.**
`validateApprovedToolApprovals` throws `InvalidToolApprovalSignatureError:
missing signature`, the leg dies, nothing is written. Preview, "Go ahead", "my
brain glitched" — *consent given, nothing happened*, which is the exact failure
this branch's headline fix removed, reintroduced by hardening the control that
prevents it. Turning on the security feature is what broke it, so no test that
ran without the secret could see it, and none did.

Two lines in `ai@7.0.66` are the whole contract, and both were read before
fixing rather than after: `dist/index.js:7704-7712` puts `signature` on the
chunk; `dist/index.js:10906-10913` reads it back from `part.approval.signature`
and nowhere else. Capture it, replay it there.

**The class matters more than the bug.** This is the SECOND defect in the same
buried replay construction — the first sent a bare `tool-approval-response` that
`convertToModelMessages` silently read as a call to a tool named
"approval-response". Both were invisible because the logic lived inside a React
hook that does its own `fetch` and its own `supabase.auth.getSession()`, so no
test could drive it. So the round trip is now two pure functions in
`apps/web/src/character/host/approval.ts`, with tests — including three that run
the real `convertToModelMessages` from the pinned `ai@7.0.66` over a replayed
part, and one that feeds the bug-1 shape in and asserts it is STILL broken, so
an upgrade that fixes it fails the test rather than leaving a stale explanation
in the codebase.

Their own file rather than exports on the hook, and that detail is load-bearing:
`useDeckeChat.ts` imports `lib/supabase`, which reads `import.meta.env` at module
scope, and under `node --test` there is no Vite — importing the hook throws
before a single test runs. Exporting from it would have left this code exactly as
untestable as it was when it shipped both bugs.

Both bugs were then RE-INTRODUCED to check the tests are load-bearing: bug 2
turns 3 tests red, bug 1 turns 2 red, including the real-SDK one each time.

### Three more from the same review

**`search_cards` on an unknown set now returns `fail`, not `ok`.** The message
echoes the model's own `set_id` back at it, which is right — it needs to know
which id was wrong. But `grounding.observe` harvests card-id-shaped tokens from
every *successful* tool result as evidence a tool returned them, and a guess of
`sv1-25` is card-id-shaped. Echoed through `ok`, the guess grounded ITSELF, and
`sanitizeScreen` would then wave through a grid built on it. `fail` is excluded
from grounding (`adapters/aisdk.ts:341`) and is the honest shape anyway.

**A stale justification, corrected rather than quietly left.** `tools.ts` kept
the `.min(1)` workaround on the grounds that "the declared fallback is still a
model where the defect is live". The chat fallback is `google/gemini-2.5-flash`
— a different vendor, where it is not. The workaround stays, on the honest
reason: it is a no-op that cannot bite, and it replaced a silent failure.

**An orphan `text-delta`.** The narration filter flushed its held tail under a
literal id of `'narration'`, a block no `text-start` ever opened. Our own reader
concatenates and does not care; `readUIMessageStream` does, and the part it
drops is the tail of a real sentence. It now flushes under the live text id.

