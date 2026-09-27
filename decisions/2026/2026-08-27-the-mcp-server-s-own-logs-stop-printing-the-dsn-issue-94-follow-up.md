---
date: "2026-08-27"
title: "The MCP server's own logs stop printing the DSN (issue #94 follow-up)"
decided_by: "Claude Opus 5 on behalf of @cheyras"
areas: ["agents","operations"]
supersedes: []
---
## 2026-08-27 — The MCP server's own logs stop printing the DSN (issue #94 follow-up)

**Decided by:** Claude Opus 5 on behalf of @cheyras

**Decision:** The five `console.error` sites in `apps/mcp` that print a caught
`pg` error now go through a new `redactEndpoints()` export rather than
`(err as Error).message`.

**Why this is not the same call as `errText`.** A tool result goes to a model
and may be repeated to a reader, so `errText` reduces a driver error to its
SQLSTATE — the message is not needed and is not safe. A server log is the
opposite: an operator is reading it precisely because they need the message, and
reducing `could not connect to …` to `28P01` would make the log useless for the
job it exists to do.

What does not differ is the credential. AGENTS.md is unconditional — *"Secrets
are read at runtime only, never committed or logged"* — and a `pg` error's
message is built from the connection parameters, so the DSN appears exactly when
the database is unreachable. In cloud these lines land in Vercel's log
dashboard. Different audience, same secret.

So `redactEndpoints` keeps the prose and drops the endpoint, reusing
`errText`'s own patterns so the two cannot drift apart.

**Implications.**
- `errText` for anything a model sees; `redactEndpoints` for anything a log sees.
- Neither is a licence to log a secret deliberately.
