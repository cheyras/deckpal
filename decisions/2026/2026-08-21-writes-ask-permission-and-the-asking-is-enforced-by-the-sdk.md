---
date: "2026-08-21"
title: "Writes ask permission, and the asking is enforced by the SDK"
decided_by: "Claude (Opus 5), on behalf of @cheyras."
areas: ["security"]
supersedes: []
---
## 2026-08-21 — Writes ask permission, and the asking is enforced by the SDK
**Decided by:** Claude (Opus 5), on behalf of @cheyras.

**Decision.** Every write tool declares `needsApproval`; the turn pauses, the
reader answers, and a `tool-approval-response` goes back on the next leg.

**Why not a prompt.** This codebase records the same lesson twice in the same
words — "a prompt is not an enforcement mechanism" — once about `click` and once
about trying to stop a model repeating itself by asking it not to. "Wait for
confirmation before writing" would have been the third.

`ai@7.0.66` ships a real control, verified against the pinned version rather
than read from a changelog: with `needsApproval: true` the execute function ran
exactly **0 times** and the wire carried
`{"type":"tool-approval-request","approvalId":"…","toolCallId":"call_w"}`.

**What needs approval**, derived from annotations and schema and never from the
verb in the name: anything `destructiveHint` (always, including on a preview),
any real write (always), and a preview never — being made to authorise something
before being told what it would do is the opposite of the point. Three write
tools have no `dry_run` at all, so every call to them is a real write; that
falls out of the rule rather than being a special case.

**The server also forces the preview.** When a call is classified as a preview,
`dry_run: true` is written into the arguments explicitly rather than left to the
tool's default, so classification and coercion agree by construction. Only an
explicit boolean `false` is read as permission to write — `'false'`, `0`, `null`,
`''`, `NaN`, `[]` and a missing field all land on the safe side, because those
are the values a model actually produces when it stringifies a boolean.

**A denial is an answer**, sent back explicitly, so he can say "alright, left it
alone" rather than stopping mid-turn with no explanation. **An abort resolves
the question as a denial** — without that, pressing stop with an approval on
screen parks the turn's promise for ever, the `finally` never runs, and
`thinking` never clears.

