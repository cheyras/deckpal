---
date: "2026-07-24"
title: "microSD is not the constraint the brief assumed"
decided_by: "lead agent, on measured evidence. **No SSD purchase required.**"
areas: ["general"]
supersedes: []
---
## 2026-07-24 — microSD is not the constraint the brief assumed
**Decided by:** lead agent, on measured evidence. **No SSD purchase required.**
TCGdex serves **WebP natively**, so the full English corpus at both resolutions
is **1.87 GB** — not the 20+ GB the brief's PNG-based estimate implied
(`high.png` alone would be 19.2 GB). Measured over 59 random cards spanning
every era. AVIF re-encode was benchmarked on-Pi and **rejected**: 620 MB saved
for 41 minutes of full 4-core load.

Write wear: the box already writes **6.84 GB/day at idle** (measured over a 180 s
`/proc/diskstats` window). pokedex adds ~55 MB/day steady-state, +0.8%, plus a
one-time ~2 GB ingest. **Wear from this project is not a real risk.** The real
risks on this box are the existing write baseline and the absence of a backup —
worth raising with the user as a separate concern from pokedex.

Image cache: WebP only, both resolutions, eager full warm (43,656 GETs @ 5 rps
≈ 2.4 h), 4 GB cap, LRU eviction on `high` only.

