---
date: "2026-08-19"
title: "The response is sent after COMMIT, for the one endpoint that is about truthfulness"
decided_by: "Claude (on behalf of @cheyras)."
areas: ["general"]
supersedes: []
---
## 2026-08-19 — The response is sent after COMMIT, for the one endpoint that is about truthfulness
**Decided by:** Claude (on behalf of @cheyras).
**Decision:** New `commitRequestTx(userId)` in `apps/api/src/db.ts`. The batch
collection endpoint calls it before `res.json`.

**Why.** The RLS middleware commits on `res.on('finish')` — after the response
has flushed. For almost every endpoint that is fine; for the one whose entire
purpose is truthful accounting of what was written, a COMMIT that fails after
the response leaves the caller holding a 200 for writes that never landed. That
is the incident's own failure mode in a smaller form.

**The trap it avoids.** `SET LOCAL role` and `set_config(…, true)` are
transaction-scoped, so a bare `COMMIT; BEGIN` would hand the rest of the request
back to the pool user — `postgres`, which owns every table and therefore
BYPASSES RLS. The replacement transaction re-establishes the claims and the role
in the same simple-query batch. It must also be called with no savepoint open.

**And the escape hatch.** `GET /mutations?idempotency_key=…` lets `log_cards`
answer "what actually landed?" after any ambiguous failure, instead of returning
a bare error that hides committed work. That question had no answer during the
incident.

