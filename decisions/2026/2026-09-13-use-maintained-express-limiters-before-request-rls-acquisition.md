---
date: "2026-09-13"
title: "Use maintained Express limiters before request RLS acquisition"
decided_by: "@cheyras; recorded by Codex during the super-admin CI repair."
areas: ["security","frontend"]
supersedes: []
---
## 2026-09-13 — Use maintained Express limiters before request RLS acquisition

**Decided by:** @cheyras; recorded by Codex during the super-admin CI repair.

**Why and decision.** Replace the ingress/admin/wallet middleware with genuine
express-rate-limit 8.7.0, pinned in the API dependencies, and adapt the existing
bounded store rather than substituting a static-analysis suppression. Preserve
the 600/min ingress, 120/min shared admin and 180/min wallet budgets, separate
prefixes and shared 10,000-key per-process capacity. No skip rules, response-based
counter refunds or validation suppression are introduced. Store errors refuse
requests; throttled responses retain 429, Retry-After and no-store.

Place the admin/wallet session gates and limiters after authentication and
resolved self-host identity, before RLS acquires its request connection. Keep
active-account and action/SQL authorization before handlers. Nested credit
administration is counted once; database checkout quotas and owner-facing
behavior remain unchanged. Authentication lookup and trusted bootstrap can
use their own pool earlier, so the guarantee concerns the RLS request connection,
not all possible database access. These remain per-instance budgets, not
distributed quotas.

**Observed verification.** The implementation author's final check passed
API typechecking, 33 actual rate-limit tests, six admin tests and the declared
CodeQL-repair check. The supervisor also reran the declared check through Ringer
baseline, passing 1/1. Tests covered real HTTP 120/180 enforcement, single nested
admin accounting, independent user/wallet budgets, PAT/anonymous denial, local
identity keys, 600/min ingress rejection before authentication, self-host
forwarding-header handling, window reset and 10,000-key saturation. No skip rules
or package validation warnings were reported.
[PR #188](https://github.com/cheyras/deckpal/pull/188) holds current review/CI
status. Production migration access, live schema/bootstrap and actual payments
remain outside this isolated verification and have not been established.

---

