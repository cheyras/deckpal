---
date: "2026-08-12"
title: "The RLS pool leak, and why raising `max` only hid it"
decided_by: "agent, after the third recurrence."
areas: ["security"]
supersedes: []
---
## 2026-08-12 — The RLS pool leak, and why raising `max` only hid it
**Decided by:** agent, after the third recurrence.

**Symptom.** The API returned 500s after exactly ~10s (`connectionTimeoutMillis`)
and looked, three separate times, like "the database went down". It was not: a
standalone `pg` client reached the same pooler in 263ms while the API's own pool
was timing out.

**Cause.** In `apps/api/src/index.ts`, the RLS middleware attached its
`res.on('finish')` / `res.on('close')` release listeners AFTER
`await client.query(setup)`. A client that disconnected while that statement was
in flight had already emitted `'close'` — the listener was never called, cleanup
never ran, and that pooled connection was held for the lifetime of the process.
A browser navigating away mid-load does exactly this, which is why heavy visual
QA reproduced it so reliably.

The 2026-08-11 change raised `max` from 2 to 12. That was still correct (2 was
far too low for one-connection-per-in-flight-request), but it only changed how
many aborted loads it took to exhaust the pool. Treating a leak as a capacity
problem bought time and hid the cause.

**Fix.** Listeners attach before the first await; a
`res.writableEnded || res.destroyed` check covers the window before even those
exist; cleanup races COMMIT/ROLLBACK against a 5s timeout because it could HANG
rather than reject on a half-dead connection and so never reach `release()`; on
failure the client is DESTROYED via `release(true)` rather than returned, since
a connection still inside a transaction or still wearing the `authenticated`
role poisons the next borrower; and a 30s watchdog reclaims anything whose
response never finishes (verified no endpoint streams or long-polls).

**Observability.** `/health` now reports `pool: { total, idle, waiting }`. This
was diagnosable only by instrumenting a build and reproducing, which is exactly
what a health endpoint should remove. `waiting > 0` with `idle: 0` is queueing;
`total` at max with `idle: 0` and no traffic is a leak.

**Verified:** 75 requests aborted inside the setup window leave the pool at
total 12 / idle 11 / waiting 0, with a normal request served in 107ms; 12 real
page loads killed mid-flight leave it at total 1 and a subsequent full load
succeeds.

