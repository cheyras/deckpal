---
date: "2026-08-27"
title: "A tool result may not carry the database's address (issue #94)"
decided_by: "Claude Opus 5, on issue #94 (found by the 2026-08-24 hygiene-pass"
areas: ["agents","data"]
supersedes: []
---
## 2026-08-27 — A tool result may not carry the database's address (issue #94)
**Decided by:** Claude Opus 5, on issue #94 (found by the 2026-08-24 hygiene-pass
recon, which correctly refused to fix it as hygiene because it changes an
emitted string).

**Decision:** Every tool handler's caught error is formatted by `errText()` —
not only the ones whose file runs SQL — and `errText` scrubs addresses out of
the message it falls back to. A source guard fails the build on any tool source
that formats a caught error itself.

**Why.** `errText` exists for one reason: a `pg` error's message is built from
the connection parameters, so `password authentication failed for user
"deckpal"` and `connect ECONNREFUSED 10.1.2.3:5432` are exactly what a catch
sees when the database is unreachable — the moment every tool fails at once and
the model is most likely to be asked what went wrong. That text is not a log
line. It is a **tool result**: it lands in a model's context, and over MCP it
lands in a third-party model provider's.

Sixteen tools — 21 catch sites — formatted `(err as Error).message` into their own `fail(...)`
text instead. Measured, against the real handler with a stubbed `ctx.db`:

    log_cards failed: password authentication failed for user "deckpal_prod"
    edit_list failed: could not connect to postgres://deckpal:hunter2@db.internal.example:5432/deckpal

**The rule that produced the bug was "route the SQL-backed tools".** It cannot
be applied correctly. `log_cards` reads as an API tool — its own header says the
write is one HTTP call — and its `planBatch` runs two queries (`resolveCardsBatch`,
`variantsOfMany`) before that call is made. `tools/lists.ts` opens with
"everything goes through deckpal-api via ctx.api" in a file whose item planner
calls the same two. Whether a given catch can see a driver error is a call-graph
question, re-answered wrongly every time somebody adds a lookup to an existing
tool. So the boundary is the checkable one instead: *text that becomes a tool
result is formatted by `errText`*. It costs nothing where no driver error can
reach — a message with no `code` and no address in it comes back unchanged.

**The helper had its own gap, and it is closed.** `errText` reduces a driver
error to its SQLSTATE *only when the error carries a `code`*; its comment
claimed "EVERY OTHER DRIVER ERROR IS REDUCED TO ITS CODE" while the fallback
returned the raw message. `pg` raises plenty of codeless plain `Error`s. The
fallback is now scrubbed: a URL carrying userinfo, a `postgres://` DSN, an IPv4
address, a `host:port` pair and `for user "…"` are replaced with `[redacted]`,
and nothing else is touched. It is deliberately NOT `safeToolError`'s
"it failed" — that is the right answer one layer out, where an error has
escaped a handler and nothing is known about it, but reducing every tool's own
message would take the tool layer's whole vocabulary with it ("no response
within 25s", "More than one deck matches 'slow'", every recovery instruction
these tools carry).

**Implications.**
- Emitted error strings changed, which is why this was an issue and not hygiene.
  Nothing asserted on them (checked: tests, prompts, SPEC, docs); a driver
  failure now reads `log_cards failed: the database refused that (28P01)`.
- `packages/agent-tools/src/__tests__/toolErrors.test.ts` runs the real
  `log_cards` and `edit_list` handlers against a `ctx.db` that throws real `pg`
  error shapes — no database, no network, so it runs in CI under contract B7 —
  and carries the source guard. 5 of its 10 tests fail on the pre-fix tree.
- `tools/logging.ts` contained a **literal NUL byte** as the fingerprint's field
  separator, which made git and grep treat the file as binary: no CRLF
  normalisation, `Binary file … matches` instead of hits, and no reviewable
  diff — in the one file in this package that most needed reviewing. It is
  written `\0` now. Identical character, identical hash input, so every derived
  idempotency key is unchanged; do not "tidy" it into a space.
- Out of scope, deliberately: `apps/mcp/src/{index,cloud}.ts` log caught pg
  errors to the **server console** (`console.error`). A log has a different
  audience and a different bar; that is a separate question from this one.

---

