---
date: "2026-08-11"
title: "a stale Vercel build cache 500'd every signed-in user"
decided_by: "Not recorded"
areas: ["frontend","operations"]
supersedes: []
---
## 2026-08-11 — a stale Vercel build cache 500'd every signed-in user

Right after the OAuth work above shipped and was verified live, `git commit`
followed by a second `vercel --prod` (same source tree, no edits in between)
silently reused a build cache from an older, unrelated deployment — the build
log said "Restored build cache from previous deployment (AHeDKv…)", an id
matching neither of the two OAuth-era deployments that preceded it. The
result: every route behind `index.ts`'s `resolveIdentity` + RLS pipeline
(`/api/avatar`, `/api/tokens`, `/api/insights/*`) started 500ing for every
signed-in user, while public and unauthenticated routes stayed healthy — a
mismatched hybrid build, not a code regression (the same source had already
passed a full signed-in QA pass on the deploy immediately before it).

Caught within minutes because the owner was actively trying to use the site
right after the deploy, not because anything alerted on it. `vercel --prod
--force` (skip the build cache entirely) fixed it on the next deploy;
re-verified with a fresh signed-in Playwright session against production
(clean 200s, zero console errors on Profile) and a full OAuth
register→consent→token→`/mcp` pass repeated end-to-end to make sure the force
rebuild hadn't broken what it had just fixed.

**Implication:** a `vercel --prod` run that follows closely on the heels of
another deploy of the same project should default to `--force` rather than
trust cache provenance — the failure mode is silent (build succeeds, deploy
succeeds, only specific routes break at runtime) and costs real signed-in
users, not just the deployer.

_Filed by agent on behalf of @cheyras — 2026-08-11._

