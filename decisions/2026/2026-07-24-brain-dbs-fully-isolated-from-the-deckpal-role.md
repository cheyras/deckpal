---
date: "2026-07-24"
title: "Brain DBs fully isolated from the deckpal role"
decided_by: "user. **Done and verified by lead.**"
areas: ["decks"]
supersedes: []
---
## 2026-07-24 — Brain DBs fully isolated from the deckpal role
**Decided by:** user. **Done and verified by lead.**
`REVOKE CONNECT ON DATABASE <co-hosted DBs> FROM PUBLIC`, with explicit
`GRANT CONNECT` to each DB's owner so the owners are unaffected. Verified: the
deckpal role now gets `FATAL: permission denied` connecting to either co-hosted DB
(it could before); owners retain CONNECT (`has_database_privilege` = true); both
apps' live connections held at 5+5 unbroken across the change. `datacl` is now
`{=T/<owner>,<owner>=CTc/<owner>}` — PUBLIC keeps TEMP only.

