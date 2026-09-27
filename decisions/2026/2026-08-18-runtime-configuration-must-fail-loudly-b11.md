---
date: "2026-08-18"
title: "Runtime configuration must fail loudly (B11)"
decided_by: "user, prompted by a four-day silent outage."
areas: ["general"]
supersedes: []
---
## 2026-08-18 — Runtime configuration must fail loudly (B11)
**Decided by:** user, prompted by a four-day silent outage.

`/design` shipped on 2026-08-14 gated on `DESIGN_EDITOR_USER_ID`. The variable
was never set in Vercel, so the gate correctly resolved to "nobody" and the route
was shut to its only intended user. Nothing surfaced it. It was found on
2026-08-18 only because `/dev/decke` reused the same gate and the owner reported
being locked out of a feature that had just been deployed for him.

**The fail-closed default is right and is not being changed.** What was wrong is
that a deployment-shaped mistake was invisible from both the code and the running
system, and that the agent shipping the second feature ASSERTED the variable was
set ("it should be, since /design works in production today") rather than
verifying it. That inference, stated in the PR body, is what cost the diagnosis
time.

**Added:** AGENTS.md B11 — declare the variable in `DEPLOYMENT.md` in the same
commit as the code, make its absence observable at runtime, and never infer that
it is set. Per B9 an agent still does not set production configuration itself; it
hands over the exact name, value and environment and treats the feature as
unverified until confirmed.

**Mechanism, so the rule is enforced rather than remembered:**
`ownerGateStatus()` in `apps/api/src/routes/me.ts` reports `configured` /
`unset` / `self-host`. `createApp()` warns on boot when it is `unset`, naming
both affected routes, and `GET /health` carries it as `ownerGate`. It reports
whether an owner is configured, never who — the UUID stays server-side.

**Rejected:** exposing the flag on `/me`. It is already there as `owner`, but a
per-user answer cannot distinguish "you are not the owner" from "no owner
exists", which is exactly the distinction that was missing. `/health` is the
right surface because the question is about the deployment, not the caller.

