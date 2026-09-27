---
date: "2026-08-29"
title: "Two turn guards that shipped unplugged, and a third for the promise"
decided_by: "Claude (Fable 5) on behalf of @cheyras, from the #138 review"
areas: ["general"]
supersedes: []
---
## 2026-08-29 — Two turn guards that shipped unplugged, and a third for the promise

**Decided by:** Claude (Fable 5) on behalf of @cheyras, from the #138 review
**Decision:** `needsAnswerNudge` is called with all five arguments and
`shouldFireFlailing` replaces the bare `errorBudgetExceeded` at the turn-end
note (the mid-turn breaker in `stopWhen` keeps the bare predicate). A new
`promisedWithoutActing` fires when the turn's last spoken sentences promise
imminent first-person action ("One sec.", "First, I'll grab…") and nothing ran
after them; it joins the one-guard-per-turn chain between phantom claims and
ungrounded ids. Every one of these wirings is now pinned by source text in
`chatWiring.test.ts`.
**Why:** `needsAnswerNudge` shipped in #138 with 3 of 5 args, so the
pending-tool carve-out matched everything and the guard could never fire;
`shouldFireFlailing` was imported and never called, so a recovered turn was
still told it flailed. Both had green unit tests — the tests exercised the
functions, not the wiring. The measured turn ended "First, I'll grab your
deck's battle logs … One sec." with no call after it, which no existing
detector's tense or shape covered.
**Implications:** `phantomClaims` was NOT widened — its precision argument is
its design. A new detector in this chain must arrive with a `chatWiring` pin,
or it is dead code with a green suite, which is what happened twice.

