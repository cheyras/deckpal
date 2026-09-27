---
date: "2026-09-26"
title: "Bound crash beacons before the identity-free logging route"
decided_by: "Chey (via Codex)"
areas: ["security", "observability"]
supersedes: []
---
## 2026-09-26 — Bound crash beacons before the identity-free logging route
**Decided by:** Chey (via Codex)

**Decision:** Give `POST /client-errors` a 32 KB JSON parser in the per-route
body-limit block, before the 100 KB default and before its unauthenticated,
rate-limited handler. Keep the handler before authentication and RLS.

**Why:** The crash beacon sends only route, message, stack and build id. The
handler logs at most 300, 500, 4,000 and 100 characters respectively; even
ASCII-escaped at six bytes per character, those fields plus the JSON wrapper
fit inside 32 KB. Without an earlier parser, the handler returns success but
logs an empty report because `req.body` is undefined. The limit bounds memory
spent on a malicious or runaway beacon.

**Implications:** A beacon above 32 KB receives `413 payload_too_large`
without reaching the logger. The normal browser beacon remains accepted, and
both the beacon parser and its 20/minute/IP limiter stay ahead of database
work. New identity-free routes mounted in this area need their own explicit
body parser before their handler.
