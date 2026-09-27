---
date: "2026-09-13"
title: "Retire superseded scanner HTML and separate research ownership"
decided_by: "@cheyras; recorded by Codex."
areas: ["scanner"]
supersedes: []
---
## 2026-09-13 — Retire superseded scanner HTML and separate research ownership

**Decided by:** @cheyras; recorded by Codex.

**Decision.** Project Holo now has its own repository. Remove DeckPal's local
`tools/frame-survey/` research toolkit, its dedicated ignore rules, and the
standalone `roadmap/plans/foil-main.md` plan. Remove the renderer workstream
from the current battle spec and orchestration roadmap. Preserve the battle
features and historical decisions, along with DeckPal's production variant,
matching and image-provenance functionality.

The tracked scanner implements the prototype's core capture, identification,
batch review and collection-commit flow, so retire only
`roadmap/plans/card-scanner-redesign/prototype.html`. Keep the rest of that
local directory: current diagnostic tools still reference its test inputs,
and it contains unique captures and experiment evidence. This is not a claim
that every prototype experiment or desired edge-case behavior shipped.

Ingest the seven-result `r2.json` GitHub research snapshot into the wiki's
[Capacitor iOS Research](https://github.com/cheyras/deckpal/wiki/Capacitor-iOS-Research)
page and preserve its exact bytes in the wiki repository. The snapshot concerns
Capacitor's iOS/App Store compatibility research, including SDK requirements,
privacy manifests and restricted APIs; it is historical research, not a current
release checklist. Delete the local `r2.json` only after verifying the identical
archive in a published wiki commit.

**Observed local verification.** The guarded cleanup removed 90 files from
exactly the three authorized local targets after verifying they were untracked,
inside the expected checkout and free of reparse points. The `r2.json` archive
matched SHA-256
`d9cd20920664865a88282765ea7315923f59573d05643a91e05b3066b3ac3cb9`
and the identical Git blob in published wiki commit
`87ea1299d471eca3e3d2c33a53bfc8dd7878a989`. The deletion receipt records every
removed path and byte count. Before/after snapshots confirmed unchanged
representative scanner dependency hashes or pre-existing absence, and unchanged
retained top-level scanner metadata. This is documentation and local-artifact
cleanup, with no application, package or test changes; no CI or deployment
result is claimed.

---

