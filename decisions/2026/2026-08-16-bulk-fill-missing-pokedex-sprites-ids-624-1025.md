---
date: "2026-08-16"
title: "Bulk-fill missing Pokédex sprites (IDs 624–1025)"
decided_by: "Claude (on behalf of @cheyras). Fixes #39."
areas: ["images","catalog"]
supersedes: []
---
## 2026-08-16 — Bulk-fill missing Pokédex sprites (IDs 624–1025)
**Decided by:** Claude (on behalf of @cheyras). Fixes #39.
**Decision:** Bulk-uploaded the 450 missing pixel sprites to Supabase Storage
through `putUnmanifestedObject`, sourced from the existing pinned PokeAPI SHA
(`bf4c47ac82c33b330e33d98b8882d1cedb2f53e7`). No code change — the pipeline
was correct; the initial fill had only covered IDs 1–623.
**Why:** The lazy-fill mechanism works per-request but leaves species showing
Poké-ball placeholders until each is individually visited. Pre-filling makes
every species render on first load.
**Implications:** All 1025 pixel sprites now exist in the bucket. Art/shiny
variants continue to lazy-fill from the species detail page. A future
generation past #1025 will lazy-fill on demand, or another bulk fill can run
through the same choke-point path.

