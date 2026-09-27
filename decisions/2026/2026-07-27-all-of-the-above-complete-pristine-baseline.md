---
date: "2026-07-27"
title: "\"All of the above\" complete + pristine baseline"
decided_by: "Not recorded"
areas: ["general"]
supersedes: []
---
## 2026-07-27 — "All of the above" complete + pristine baseline

Every remaining item done and lead-verified against the live stack:
- ✅ Split-horizon DNS + LAN HTTPS (valid cert) · ✅ nightly backup cron
- ✅ Set imagery filled (326 logos/symbols, series index, set headers) — the "empty" fix
- ✅ PDF export (deck/list/set checklist) + UI buttons
- ✅ PWA (manifest, SW, offline shell+visited-art, iOS mitigations)
- ✅ Card scanner (perceptual-hash, 21,828-card index, ImageMagick decode, no native deps) + UI (upload/camera → match → add), verified dist-0 exact match
- ✅ Stream overlay (transparent OBS source at /deckpal/overlay)
- ✅ **Demo data zeroed to pristine** (collection/lists/decks/events/value-points/dex/progress all 0; catalog + prices + sprites + set imagery intact; app_user seeded). Empty-state endpoints all 200.

**Genuine follow-ups (not done, by design/limitation):**
1. Energy-type icons on cards — no local/derivable source; needs 11 hand-authored SVGs (design work).
2. Overlay names no card — needs a `GET /collection/events` read endpoint (activity feed exists in DB, no route); currently watches owned-count deltas only.
3. BW/XY-era ACE SPEC sublist (10 names) vendored from public docs, not DB-derivable — flagged in deck engine `data/_provenance.json` for refresh.
4. Offline is tiered (shell + visited art + collection), not full-catalog — deliberate on a phone.
5. Remote HTTPS works via the SSO gate.

