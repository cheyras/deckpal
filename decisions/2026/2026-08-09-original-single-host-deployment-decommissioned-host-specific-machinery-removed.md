---
date: "2026-08-09"
title: "Original single-host deployment decommissioned, host-specific machinery removed"
decided_by: "Not recorded"
areas: ["operations"]
supersedes: []
---
## 2026-08-09 — Original single-host deployment decommissioned, host-specific machinery removed

The original single-host deployment is decommissioned: managed processes deleted,
nginx includes removed, full backup taken first (DB dump + image tar). Host-specific
machinery removed from the repo — `deploy/` (nginx fragments, DNS config, process-
manager ecosystem config, BACKUP.md, DEPLOY.md), `tools/dev-dashboard/` (LAN dev
tooling, standalone/no workspace deps), `issues/` (46 resolved personal bug
reports — a SaaS project tracks issues on GitHub instead), the prior CI config
directory (superseded by GitHub Actions), and root `ecosystem.config.cjs`. `.gitignore` gained a `deploy/` rule
(deploy artifacts are intentionally untracked, not just deleted) and dropped the
now-pointless `issues/*/*.jpg` rule. Pivot to a Vercel + Supabase cloud-first,
open-core direction is underway; a docs wave will follow to fix the dangling
references this leaves in README/ARCHITECTURE/AGENTS/roadmap/skills.

