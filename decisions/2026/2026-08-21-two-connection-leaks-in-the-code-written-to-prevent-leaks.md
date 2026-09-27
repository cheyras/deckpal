---
date: "2026-08-21"
title: "Two connection leaks, in the code written to prevent leaks"
decided_by: "Claude (Opus 5), on behalf of @cheyras. Found by testing the"
areas: ["general"]
supersedes: []
---
## 2026-08-21 — Two connection leaks, in the code written to prevent leaks
**Decided by:** Claude (Opus 5), on behalf of @cheyras. Found by testing the
failure paths rather than the happy one.

**What was wrong.** Both are the shape of the 2026-08-12 pool-exhaustion
incident, arriving through the watchdog added to stop it.

1. `Promise.race` abandons the loser, it does not cancel it — so a
   `pool.connect()` that resolved a moment after its deadline handed back a
   checked-out client with nobody holding a reference to release it. Checked out
   for the life of the instance. With `PGPOOL_MAX_CHAT=2` that is two slow
   moments from a wedged pool.
2. The query deadline and the session watchdog fire at almost the same instant
   with no guaranteed order, so a query could reject while its connection was
   still returned to the pool — with a statement Postgres was very much still
   running on it, inside an open transaction, carrying that turn's RLS claims.
   The next borrower would set its own claims on top of a live session.

**Decision.** The losing connect promise is reclaimed and destroyed; a timed-out
query destroys its connection at the point of timeout rather than leaving it to
a race. Queries are bounded by what is LEFT of the session budget, not by a
fresh copy of it — ten queries of nine seconds each inside a ten-second session
made the deadline mean nothing.

**Implications.** A timed-out query is by definition a connection in an unknown
state; there is no version of that which is safe to hand to someone else. The
cost of destroying is one reconnect. The cost of sharing is a cross-user data
leak.

**Worth recording separately:** one of the two failures the new suite first
produced was a bad ASSERTION rather than a bug. "The string `'; DROP TABLE` does
not appear in the preamble" passes for the wrong reason either way, because
correctly-escaped output contains `''; DROP TABLE`, which has the naive needle
as a substring. It now checks that the quote was doubled and that the literal's
quotes are balanced — the escaping, not the scary words.

