---
date: "2026-11-26"
title: "Scanner keeps names OCR mangles in reach: dropped or glued ex, raw badges, DLR, 25 vector neighbours"
decided_by: "Chey (via Claude Opus 5.5)"
areas: ["scanner"]
supersedes: []
---
## 2026-11-26 — Scanner keeps names OCR mangles in reach: dropped or glued ex, raw badges, DLR, 25 vector neighbours
**Decided by:** Chey (via Claude Opus 5.5)

**Decision:** Five changes to how a read reaches the catalogue. No confidence rule changes.
- **Dropped suffix:** at the name-family rung, a read with no rule-box suffix keeps the suffixed cards of its name. "Oricorio" now also offers Oricorio ex (`narrowByNameFamily`, resolve.ts). A read that does carry `ex` is not widened, and the number rungs keep the strict best tier.
- **Glued suffix:** an `ex`/`gx` read glued to the name ("Latiasex") reaches the name at tier 1 (`nameTier`).
- **Raw badge text:** when the device cannot resolve the set badge but read a number and denominator beside it, it sends the badge as read (`badgeText` → `setCode`). The server's matcher scans one glyph wider and vetoes on the denominator.
- **DLR:** Delta Reign (me06, /103) joins the printed set codes. This touches `codes.ts`, `printed-set-code.json` and migration 091 for `card_set.prints_set_code`.
- **25 vector neighbours:** the device asks for 25 instead of 5 (`EMBED_K`), so the image orders the printings of the name it read. `fuse.ts` still reads only the top two, so no confidence moves.

**Why:** The owner's 2026-11-26 session: "it will completely correctly read the name ... and still passes it to me to select ... a few times the correct set wasn't there", and once "it read the numbers correctly ... but didn't read the little tag".
- **Oricorio ex:** read as "Oricorio". Tier 0 kept 17 plain Oricorio and dropped all three Oricorio ex, so the true card was never offered.
- **Latias ex:** read as "Latiasex", which matched no Latias at all.
- **Delta Reign:** yesterday's badges read `DLR044/103` and matched no row.
- **Short badge reads:** a `PFL` badge read as `PL` (`PL018/094`) failed the device's exact-length window.

Bench (scripts/scan-bench, all datasets plus the 15 labelled captures of 2026-11-26):
- **Overall:** auto-ID 229 → 231 of 276. Confident-wrong 0 → 0. Picker top-5 81% → 82%.
- **Today's captures:** 11 → 13 of 15. Latias ex and Oricorio ex now resolve, and both remaining misses have the truth in the picker.
- **DLR cards (11-25):** now resolve by badge+number rather than number+denominator.
- **Older datasets:** unchanged.

**Implications:**
- **Still unsolved:** Dragapult ex me02.5-160 and the stamped Water Energy mee-003 share their art with other printings, and their bottom strip was unreadable in the one captured frame. Only the printed set code and number decide them. That is the multi-frame strip re-read, which is next and must not feed the number rungs unguarded (see the plan review).
- **Migration 091** has to be run on production (`pnpm --filter @deckpal/db migrate`). Until then the startup consistency check logs one DLR line. The badge lookup itself reads the JSON and works without it.
- **CROSSWALK.md** lives in the untracked plan folder, so DLR is recorded here and in the JSON, not there.
