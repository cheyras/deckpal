---
date: "2026-07-24"
title: "Never run the self-hosted TCGdex API"
decided_by: "lead agent, on measured evidence ([Data Layer wiki](https://github.com/cheyras/deckpal/wiki/Data-Layer))."
areas: ["catalog"]
supersedes: ["BRIEF §3a local TCGdex API container"]
---
## 2026-07-24 — Never run the self-hosted TCGdex API
**Decided by:** lead agent, on measured evidence ([Data Layer wiki](https://github.com/cheyras/deckpal/wiki/Data-Layer)).
**Decision:** We do **not** run `tcgdex/cards-database`'s API server, in any
phase, even ad hoc. We extract the compiled catalog JSON from the published
image (`docker save` streamed through `tar`, no container ever created) and
import it directly into our own DB.

**Why:** their server statically `import`s all 18 languages' `cards.json`
(161 MB) into an in-memory dict **per cluster worker**, and forks one worker per
core. Measured JSON→object expansion on this Pi is **6.4×** (27.24 MB → 172.6 MB
peak RSS). Stock defaults would want ~2.5–4.5 GB on a box with ~3.7 GB
available, alongside other co-hosted services. This is the most likely cause
of the crash that preceded this session.

**Implications:** the BRIEF's §3a instruction to "stand up a local TCGdex API
container as the upstream" is **superseded** — it is a live hazard to this box,
not merely suboptimal. If it is ever genuinely needed for a one-off, the only
sanctioned form is `MAX_WORKERS=1` + `--memory=1.5g` on port 3702, stopped
immediately after. Extraction is only ~29.75 MB of English JSON, so there is no
real reason to.

