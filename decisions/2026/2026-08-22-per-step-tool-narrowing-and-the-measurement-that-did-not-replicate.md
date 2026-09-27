---
date: "2026-08-22"
title: "Per-step tool narrowing, and the measurement that did not replicate"
decided_by: "@cheyras, on Claude's recommendation. Recorded with its"
areas: ["agents"]
supersedes: []
---
## 2026-08-22 — Per-step tool narrowing, and the measurement that did not replicate
**Decided by:** @cheyras, on Claude's recommendation. Recorded with its
uncertainty intact, because the tidy version of this entry would be wrong.

**What was done.** `streamText` now takes `activeTools`, recomputed per step by
`prepareStep` (`apps/api/src/decke/focus.ts`). On the FIRST step Deck-E sees 24
of his 34 tools — everything except the ten heavy write tools. On every step
after, he sees all 34. `log_cards` stays visible from step one, because "add
these cards" is the request this feature exists to serve.

**What motivated it.** A bisection against the live model, 5 trials per arm, on
the prompt that reproduced the defect ("add 4000 Charizards", which should fire
a reaction):

    34 tools ... narrated the command as visible text 5/5, called `express` 0/5
    23 tools ... 1/5 and 1/5
    10 tools ... 3/5 and 1/5

Two conclusions: the write tools were implicated, and FEWER WAS NOT BETTER — ten
was worse than twenty-three, so a blunt trim would have cost capability for a
worse result.

**And then it did not replicate.** A follow-up run, designed to test whether
`log_cards` could stay, could not reproduce the defect in ANY arm: 0/24 on the
primary trigger where the first run had seen 5/5. That agent also found a real
bug in its own harness — `fullStream`'s `text-delta` carries the increment in
`.text`, not `.delta`, a field name that only exists after
`toUIMessageStream()` — and could not rule out that the first harness had an
analogous gap.

So the evidence that motivated this change is **weak**, and this entry says so
rather than quietly keeping the flattering half.

**Why it stays anyway**, which is a different question from whether the
measurement was sound:

- It removes no capability. Everything returns on step two; a heavy write is
  delayed by one step and never denied.
- It costs nothing measurable — no extra call, no extra latency.
- It is independently supported. arXiv 2605.24660 measures adaptive tool
  shortlists beating large fixed sets (Claude Sonnet 93.1% vs 87.1% overall,
  76.8% vs 60.9% on medium-difficulty queries), and narrowing per context is
  convergent practitioner guidance for large tool sets.
- The defect it targets is REAL and reproduced repeatedly outside the
  measurement — the gate suite caught two more spellings of it
  (`<function_call name="flyTo">`, `<xai:showScreen>`) on the deployed preview,
  with the flight failing to happen both times.

**What would settle it**: a third run with the corrected harness and a larger n,
on the secondary trigger where the only narration this session appeared. It is
not blocking anything, and nobody should treat the table above as settled fact
until then.

**A note on why the numbers are in this file at all.** `models.ts` is a file of
measurements, and its value comes from every number in it having been observed.
Adding one that did not replicate — without saying so — would devalue the rest.
That is the whole reason this entry exists in the shape it does.

