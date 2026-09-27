---
date: "2026-09-13"
title: "Close new-object client permissions within creation migrations"
decided_by: "@cheyras; recorded by Codex during the super-admin review."
areas: ["security","data"]
supersedes: []
---
## 2026-09-13 — Close new-object client permissions within creation migrations

**Decided by:** @cheyras; recorded by Codex during the super-admin review.

**Why.** The migration runner commits each numbered SQL file separately.
Deferring client-permission cleanup from creation files 064/066 to 065/067
can leave new objects accessible through deployment default grants when an
upgrade stops between those files. A correct completed schema alone does not
prove a safe interrupted upgrade.

**Decision.** End each creation migration with explicitly scoped revocations
for its new tables, sequences and functions: PUBLIC always, and anon and
authenticated only when those roles already exist. Revocations occur inside
the same transaction as object creation. Existing explicit trusted-server
access is preserved. This does not create platform roles, alter schema-wide
default privileges or sweep unrelated objects. Later security migrations
retain their narrow function grants unchanged. A stop after creation leaves
the new client surfaces private; complete 064–067 and verify checksums before
serving the new application.

**Observed verification.** The backend's declared check passed all 54
disposable PostgreSQL integration cases. Cloud staging checks verified 52
client privilege denials after 064 and 36 after 066, including closed PUBLIC
access and retained creator authority. Current UUID self-host stages passed
without cloud roles, and the final 065/067 authorized flows remained green.
The private cluster was stopped and removed. These checks establish the
isolated interrupted-upgrade boundary; final independent approval and CI
remain pending. Production migration access is still unavailable, so no live
schema/bootstrap, Stripe subscriptions or payment delivery are verified.

---

