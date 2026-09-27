---
date: "2026-07-24"
title: "Database: host Postgres, dedicated DB + role"
decided_by: "user, at the Phase 1 checkpoint."
areas: ["data"]
supersedes: []
---
## 2026-07-24 — Database: host Postgres, dedicated DB + role
**Decided by:** user, at the Phase 1 checkpoint.
**Decision:** a dedicated `deckpal` database and role on the existing host
Postgres 17.9, application pool capped at **3** connections. All tuning
role-scoped. **No `postgresql.conf` change and no Postgres restart.**

**Why:** `max_connections` is 20 with 10 already in use by other co-hosted
apps — a 3-connection pool fits with 7 spare, so blast radius is zero. Marginal
RAM 25–35 MB vs ~180–250 MB for a second instance. Postgres also gives the price
time-series range partitioning and BRIN, which SQLite cannot.

**Implications:** pokedex is now coupled to a shared Postgres cluster.
Mitigations: cap the pool at 3 and never raise it without re-checking headroom;
scope every setting to the role; and **backup/restore must cover the `pokedex`
database specifically**, not the whole cluster.

